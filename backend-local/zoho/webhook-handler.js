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

    console.log('[ZOHO Webhook] Received webhook event');

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

    if (eventType === 'mail.received' || eventType === 'NEW_MAIL') {
      // Process new message
      await processNewMessage(webhookData.data || webhookData);
    } else {
      console.log('[ZOHO Webhook] Unhandled event type:', eventType);
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('[ZOHO Webhook] Error handling webhook:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
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
      // Emit WebSocket event for real-time updates (if broadcastEvent is available)
      if (global.broadcastEvent) {
        global.broadcastEvent('email:created', saved);
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
