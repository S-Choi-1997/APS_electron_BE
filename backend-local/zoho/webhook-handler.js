/**
 * ZOHO Mail Integration - Webhook Handler
 *
 * Handles incoming webhooks from ZOHO Mail
 * Note: Webhooks must be configured in ZOHO Mail settings
 */

const crypto = require('crypto');
const config = require('./config');
const { saveEmailInquiry, updateEmailStatusByMessageId } = require('./db-helper');
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

    // ZOHO webhook structure: data comes directly in body (no nested 'data' or 'event' field)
    const messageData = webhookData;

    // Check if this has messageId - the most critical field for a real email
    const hasMessageId = messageData.messageId || messageData.messageIdString;

    // If no messageId, it's a verification/test ping
    if (!hasMessageId) {
      console.log('[ZOHO Webhook] No messageId found - treating as verification ping');
      return res.status(200).json({
        success: true,
        message: 'Webhook verification successful'
      });
    }

    // Process the email message
    try {
      await processNewMessage(messageData);
      console.log('[ZOHO Webhook] Email processed and saved successfully');
    } catch (dbError) {
      // Log DB error but still return 200 to ZOHO
      // This prevents webhook registration failure due to DB issues
      console.error('[ZOHO Webhook] DB save failed but returning 200 to ZOHO:', dbError.message);
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
        isOutgoing: saved.is_outgoing || false,
        status: saved.status || (saved.check ? 'read' : 'unread'),
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

      // If this is an outgoing email (reply), update the original email's status to 'responded'
      if (inquiry.isOutgoing && inquiry.inReplyTo) {
        console.log('[ZOHO Webhook] Detected outgoing reply, updating original email status');
        try {
          const updatedOriginal = await updateEmailStatusByMessageId(inquiry.inReplyTo, 'responded');

          if (updatedOriginal && global.broadcastEvent) {
            global.broadcastEvent('email:updated', {
              id: updatedOriginal.id,
              status: 'responded'
            });
            console.log('[ZOHO Webhook] Original email status updated to responded and event broadcast');
          }
        } catch (error) {
          console.error('[ZOHO Webhook] Failed to update original email status:', error);
          // Don't fail the webhook processing
        }
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
