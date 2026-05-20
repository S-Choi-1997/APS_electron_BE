/**
 * ZOHO Mail Integration - Route Handlers
 *
 * Extracted route logic that can be called from both:
 * - Express routes (direct HTTP)
 * - WebSocket tunnel handler (relay)
 */

const zoho = require('./sync');
const { replyToEmail } = require('./send');
const { getOAuthTokens, getEmailById, saveOutgoingEmail, updateEmailStatus } = require('./db-helper');
const config = require('./config');

const MAX_RESPONSE_ATTACHMENT_BYTES = Number(process.env.EMAIL_ATTACHMENT_MAX_BYTES || 20 * 1024 * 1024);
const MAX_RESPONSE_ATTACHMENT_TOTAL_BYTES = Number(process.env.EMAIL_ATTACHMENT_TOTAL_MAX_BYTES || 25 * 1024 * 1024);
const MAX_RESPONSE_ATTACHMENT_COUNT = Number(process.env.EMAIL_ATTACHMENT_MAX_COUNT || 10);

function sanitizeAttachmentName(filename) {
  const fallback = 'attachment';
  const cleaned = String(filename || fallback)
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function normalizeResponseAttachments(attachments) {
  if (!attachments) {
    return [];
  }

  if (!Array.isArray(attachments)) {
    throw new Error('Attachments must be an array');
  }

  if (attachments.length > MAX_RESPONSE_ATTACHMENT_COUNT) {
    throw new Error(`첨부파일은 한 번에 최대 ${MAX_RESPONSE_ATTACHMENT_COUNT}개까지 보낼 수 있습니다.`);
  }

  const normalized = attachments.map((attachment, index) => {
    const filename = sanitizeAttachmentName(attachment?.filename || attachment?.name || `attachment-${index + 1}`);
    const contentBase64 = String(attachment?.contentBase64 || '').replace(/^data:[^,]+,/, '');
    const contentType = attachment?.contentType || attachment?.type || 'application/octet-stream';
    const size = Number(attachment?.size || 0);

    if (!contentBase64) {
      throw new Error(`첨부파일 "${filename}"의 내용이 비어 있습니다.`);
    }

    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
      throw new Error(`첨부파일 "${filename}"의 전송 데이터가 올바르지 않습니다.`);
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    if (!buffer.length) {
      throw new Error(`첨부파일 "${filename}"의 내용이 비어 있습니다.`);
    }

    if (size && size !== buffer.length) {
      throw new Error(`첨부파일 "${filename}"의 크기 정보가 올바르지 않습니다.`);
    }

    if (buffer.length > MAX_RESPONSE_ATTACHMENT_BYTES) {
      throw new Error(`첨부파일 "${filename}"이 ${Math.floor(MAX_RESPONSE_ATTACHMENT_BYTES / 1024 / 1024)}MB 제한을 초과했습니다.`);
    }

    return {
      filename,
      contentType,
      size: buffer.length,
      buffer,
    };
  });

  const totalBytes = normalized.reduce((sum, attachment) => sum + attachment.size, 0);
  if (totalBytes > MAX_RESPONSE_ATTACHMENT_TOTAL_BYTES) {
    throw new Error(`첨부파일 총 용량이 ${Math.floor(MAX_RESPONSE_ATTACHMENT_TOTAL_BYTES / 1024 / 1024)}MB 제한을 초과했습니다.`);
  }

  return normalized;
}

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
 * @param {Array<Object>} [body.attachments] - Attachments encoded as base64
 * @returns {Object} Response object with status and body
 */
async function handleEmailResponse(user, body) {
  try {
    console.log(`[ZOHO Routes] Email response requested by: ${user?.email || 'unknown'}`);

    const { emailId, responseText } = body;

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

    let responseAttachments = [];
    try {
      responseAttachments = normalizeResponseAttachments(body.attachments);
    } catch (attachmentError) {
      return {
        status: 400,
        body: {
          error: 'Bad request',
          message: attachmentError.message
        }
      };
    }

    const originalEmail = await getEmailById(emailId);

    if (!originalEmail) {
      return {
        status: 404,
        body: {
          error: 'Not found',
          message: 'Email inquiry not found'
        }
      };
    }
    const responseBody = responseText.trim();

    if (originalEmail.source !== 'zoho') {
      return {
        status: 400,
        body: {
          error: 'Unsupported source',
          message: 'Email response is only supported for ZOHO emails'
        }
      };
    }

    if (originalEmail.isOutgoing) {
      return {
        status: 400,
        body: {
          error: 'Unsupported email',
          message: 'Cannot send a response to an outgoing email'
        }
      };
    }

    if (!originalEmail.messageId || !originalEmail.from || !originalEmail.subject) {
      return {
        status: 400,
        body: {
          error: 'Bad request',
          message: 'Original email is missing required provider metadata'
        }
      };
    }

    // Send reply via ZOHO Mail API
    const result = await replyToEmail({
      originalMessageId: originalEmail.messageId,
      to: originalEmail.from,
      subject: originalEmail.subject,
      body: responseBody,
      attachments: responseAttachments
    });

    console.log('[ZOHO Routes] Email response sent successfully');

    if (!result.success || !result.messageId) {
      return {
        status: 502,
        body: {
          error: 'Provider response invalid',
          message: 'ZOHO did not return a sent message ID; local status was not changed',
          providerResult: result
        }
      };
    }

    let savedEmail = null;
    let statusUpdated = false;

    // Save the outgoing email to database
    try {
      savedEmail = await saveOutgoingEmail({
        messageId: result.messageId,
        inReplyTo: originalEmail.messageId,
        to: originalEmail.from,
        subject: result.subject || `Re: ${originalEmail.subject}`,
        body: responseBody,
        bodyHtml: responseBody, // Could be enhanced with HTML formatting
        fromEmail: config.accountEmail || 'admin@apsconsulting.kr',
        fromName: 'APS Admin',
        hasAttachments: responseAttachments.length > 0,
        sentAt: new Date()
      });

      console.log('[ZOHO Routes] Outgoing email saved to database');

      // Broadcast WebSocket event for real-time updates
      if (global.broadcastEvent && savedEmail) {
        global.broadcastEvent('email:created', savedEmail);
        console.log('[ZOHO Routes] WebSocket event broadcast for outgoing email');
      }

      const updatedOriginal = await updateEmailStatus(emailId, 'responded');
      statusUpdated = true;

      if (global.broadcastEvent && updatedOriginal) {
        global.broadcastEvent('email:updated', updatedOriginal);
        console.log('[ZOHO Routes] WebSocket event broadcast for original email status update');
      }

      console.log('[ZOHO Routes] Original email status updated to responded');

    } catch (dbError) {
      console.error('[ZOHO Routes] Failed to save outgoing email to DB:', dbError.message);
      return {
        status: 500,
        body: {
          error: 'Local persistence failed',
          message: 'Email was sent by ZOHO, but local persistence or status update failed',
          providerMessageId: result.messageId,
          statusUpdated: false,
          savedEmailId: savedEmail?.id || null,
        }
      };
    }

    return {
      status: 200,
      body: {
        success: true,
        message: 'Response sent',
        statusUpdated,
        savedEmailId: savedEmail?.id || null,
        warning: statusUpdated ? undefined : 'Email was sent, but local persistence/status update did not complete',
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
