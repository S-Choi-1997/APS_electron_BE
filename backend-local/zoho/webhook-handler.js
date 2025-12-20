/**
 * ZOHO Mail Integration - Webhook Handler
 *
 * Handles incoming webhooks from ZOHO Mail
 * Note: Webhooks must be configured in ZOHO Mail settings
 */

const crypto = require('crypto');
const config = require('./config');
const { saveEmailInquiry } = require('./db-helper');
const { parseMessageToInquiry } = require('./mail-api');

/**
 * Handle incoming webhook from ZOHO Mail
 */
async function handleWebhook(req, res) {
  try {
    const webhookData = req.body;
    const signature = req.headers['x-zoho-signature'];

    console.log('[ZOHO Webhook] ========================================');
    console.log('[ZOHO Webhook] Received webhook event');
    console.log('[ZOHO Webhook] Raw body:', JSON.stringify(webhookData, null, 2));
    console.log('[ZOHO Webhook] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[ZOHO Webhook] ========================================');

    // Verify webhook signature if secret is configured
    if (config.webhookSecret && signature) {
      const isValid = verifyWebhookSignature(JSON.stringify(webhookData), signature);
      if (!isValid) {
        console.error('[ZOHO Webhook] Invalid signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Determine event type
    const eventType = webhookData.event || webhookData.eventType;
    const messageData = webhookData.data || webhookData;

    // Check if this is a verification/test request
    // ZOHO sends test webhooks during registration that may not have complete data
    // We should accept these with 200 OK without trying to save to DB
    const isTestOrVerification =
      !eventType || // No event type = verification ping
      !messageData.messageId || // No messageId = test payload
      !messageData.subject; // No subject = incomplete data

    if (isTestOrVerification) {
      console.log('[ZOHO Webhook] Detected verification/test request - returning 200 OK without processing');
      return res.status(200).json({
        success: true,
        message: 'Webhook verification successful',
        note: 'Test/verification request - no data saved'
      });
    }

    // Process actual email events
    if (eventType === 'mail.received' || eventType === 'NEW_MAIL') {
      // Validate that we have minimum required fields before attempting to save
      if (!messageData.toAddress && !messageData.to) {
        console.log('[ZOHO Webhook] Missing required field: toAddress - treating as test request');
        return res.status(200).json({
          success: true,
          message: 'Webhook accepted',
          note: 'Incomplete data - no toAddress field'
        });
      }

      if (!messageData.fromAddress && !messageData.from) {
        console.log('[ZOHO Webhook] Missing required field: fromAddress - treating as test request');
        return res.status(200).json({
          success: true,
          message: 'Webhook accepted',
          note: 'Incomplete data - no fromAddress field'
        });
      }

      // Only process if we have complete data
      try {
        await processNewMessage(messageData);
        console.log('[ZOHO Webhook] Email processed and saved successfully');
      } catch (dbError) {
        // Log DB error but still return 200 to ZOHO
        // This prevents webhook registration failure due to DB issues
        console.error('[ZOHO Webhook] DB save failed but returning 200 to ZOHO:', dbError.message);
      }
    } else {
      console.log('[ZOHO Webhook] Unhandled event type:', eventType);
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('[ZOHO Webhook] Error handling webhook:', error);
    // Still return 200 to avoid webhook registration failure
    // Log the error but don't fail the webhook
    res.status(200).json({
      success: true,
      message: 'Webhook received',
      note: 'Processing error logged but webhook accepted'
    });
  }
}

/**
 * Verify webhook signature
 */
function verifyWebhookSignature(payload, signature) {
  try {
    if (!config.webhookSecret) {
      console.warn('[ZOHO Webhook] Webhook secret not configured, skipping verification');
      return true;
    }

    // Calculate expected signature using HMAC SHA256
    const expectedSignature = crypto
      .createHmac('sha256', config.webhookSecret)
      .update(payload)
      .digest('hex');

    // Compare signatures (constant-time comparison to prevent timing attacks)
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    return isValid;
  } catch (error) {
    console.error('[ZOHO Webhook] Error verifying signature:', error);
    return false;
  }
}

/**
 * Process new message event from webhook
 */
async function processNewMessage(messageData) {
  try {
    console.log('[ZOHO Webhook] Processing new message:', messageData.messageId || 'unknown');

    // Parse message to inquiry format
    const inquiry = parseMessageToInquiry(messageData);

    // Save to database
    const saved = await saveEmailInquiry(inquiry);

    if (saved) {
      // Map DB column names to frontend-friendly camelCase
      const mappedEmail = {
        id: saved.id,
        messageId: saved.message_id,
        source: saved.source,
        from: saved.from_email,
        fromName: saved.from_name,
        to: saved.to_email,
        cc: saved.cc_emails,
        subject: saved.subject,
        body: saved.body_text,
        bodyHtml: saved.body_html,
        hasAttachments: saved.has_attachments,
        receivedAt: saved.received_at,
        check: saved.check,
        createdAt: saved.created_at,
        updatedAt: saved.updated_at
      };

      // Emit WebSocket event for real-time updates (if broadcastEvent is available)
      if (global.broadcastEvent) {
        global.broadcastEvent('email:created', mappedEmail);
        console.log('[ZOHO Webhook] Real-time event emitted');
      }

      console.log('[ZOHO Webhook] Message processed successfully');
    } else {
      console.log('[ZOHO Webhook] Message already exists, skipped');
    }
  } catch (error) {
    console.error('[ZOHO Webhook] Error processing new message:', error);
    throw error;
  }
}

module.exports = {
  handleWebhook,
  verifyWebhookSignature,
  processNewMessage
};
