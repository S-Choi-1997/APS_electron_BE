/**
 * ZOHO Mail Integration - Route Handlers
 *
 * Extracted route logic that can be called from both:
 * - Express routes (direct HTTP)
 * - WebSocket tunnel handler (relay)
 */

const zoho = require('./sync');
const { replyToEmail } = require('./send');
const { getOAuthTokens } = require('./db-helper');

/**
 * Handle ZOHO sync request
 * Can be called from both Express router and WebSocket tunnel
 *
 * @param {Object} user - Authenticated user object from JWT
 * @returns {Object} Response object with status and body
 */
async function handleZohoSync(user) {
  try {
    console.log(`[ZOHO Routes] Sync requested by: ${user?.email || 'unknown'}`);

    const result = await zoho.performFullSync();

    return {
      status: 200,
      body: {
        success: true,
        message: 'Sync completed',
        ...result
      }
    };
  } catch (error) {
    console.error('[ZOHO Routes] Sync failed:', error.message);

    return {
      status: 500,
      body: {
        error: 'Sync failed',
        message: error.message
      }
    };
  }
}

/**
 * Handle email response request
 * Sends a reply to an email inquiry
 *
 * @param {Object} user - Authenticated user object from JWT
 * @param {Object} body - Request body
 * @param {string} body.emailId - Email inquiry ID from database
 * @param {string} body.responseText - Response text to send
 * @param {Object} body.originalEmail - Original email data (from, subject, messageId)
 * @returns {Object} Response object with status and body
 */
async function handleEmailResponse(user, body) {
  try {
    console.log(`[ZOHO Routes] Email response requested by: ${user?.email || 'unknown'}`);

    const { emailId, responseText, originalEmail } = body;

    if (!emailId) {
      return {
        status: 400,
        body: {
          error: 'Bad request',
          message: 'Email ID is required'
        }
      };
    }

    if (!responseText || !responseText.trim()) {
      return {
        status: 400,
        body: {
          error: 'Bad request',
          message: 'Response text is required'
        }
      };
    }

    if (!originalEmail || !originalEmail.from || !originalEmail.subject) {
      return {
        status: 400,
        body: {
          error: 'Bad request',
          message: 'Original email data (from, subject) is required'
        }
      };
    }

    // Send reply via ZOHO Mail API
    const result = await replyToEmail({
      originalMessageId: originalEmail.messageId,
      to: originalEmail.from,
      subject: originalEmail.subject,
      body: responseText
    });

    console.log('[ZOHO Routes] Email response sent successfully');

    return {
      status: 200,
      body: {
        success: true,
        message: 'Response sent',
        ...result
      }
    };
  } catch (error) {
    console.error('[ZOHO Routes] Email response failed:', error.message);

    return {
      status: 500,
      body: {
        error: 'Failed to send response',
        message: error.message
      }
    };
  }
}

module.exports = {
  handleZohoSync,
  handleEmailResponse
};
