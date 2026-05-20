/**
 * ZOHO Mail Integration - Send Email
 *
 * Handles sending email responses via ZOHO Mail API
 */

const axios = require('axios');
const config = require('./config');
const { getValidAccessToken } = require('./oauth');
const { getAccountId } = require('./mail-api');

const MAX_ATTACHMENT_BYTES = Number(process.env.EMAIL_ATTACHMENT_MAX_BYTES || 20 * 1024 * 1024);
const MAX_TOTAL_ATTACHMENT_BYTES = Number(process.env.EMAIL_ATTACHMENT_TOTAL_MAX_BYTES || 25 * 1024 * 1024);
const MAX_ATTACHMENT_COUNT = Number(process.env.EMAIL_ATTACHMENT_MAX_COUNT || 10);
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function getSafeErrorMessage(error) {
  if (error.response) {
    return `ZOHO API request failed with status ${error.response.status || 'unknown'}`;
  }
  return error.message;
}

function getZohoData(response) {
  const status = response.data?.status || response.data?.data?.status;
  const code = status?.code ?? status?.statusCode;
  if (code !== undefined) {
    const normalizedCode = String(code).toLowerCase();
    const success = normalizedCode === 'success' || normalizedCode.startsWith('2') || normalizedCode === '200';
    if (!success) {
      throw new Error(status?.description || status?.message || `ZOHO operation failed with status ${code}`);
    }
  }
  return response.data?.data || {};
}

function formatFromAddress(email, displayName) {
  const normalizedEmail = String(email || '').trim();
  const normalizedDisplayName = String(displayName || '')
    .replace(/[\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedEmail || !normalizedDisplayName || /[<>]/.test(normalizedEmail)) {
    return normalizedEmail;
  }

  const escapedDisplayName = normalizedDisplayName
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  return `"${escapedDisplayName}" <${normalizedEmail}>`;
}

function sanitizeAttachmentName(filename) {
  const cleaned = String(filename || '')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    throw new Error('Attachment filename is required');
  }
  return cleaned;
}

function normalizeAttachment(attachment, index) {
  const filename = sanitizeAttachmentName(attachment?.filename || attachment?.name);
  const rawBase64 = String(attachment?.contentBase64 || '').replace(/^data:[^,]+,/, '');
  if (!Buffer.isBuffer(attachment?.buffer) && (!rawBase64 || !BASE64_RE.test(rawBase64))) {
    throw new Error(`Attachment "${filename}" contentBase64 is invalid`);
  }
  const buffer = Buffer.isBuffer(attachment?.buffer)
    ? attachment.buffer
    : Buffer.from(rawBase64, 'base64');
  const declaredSize = Number(attachment?.size || buffer.length);

  if (!buffer.length) {
    throw new Error(`Attachment "${filename}" is empty`);
  }

  if (declaredSize !== buffer.length) {
    throw new Error(`Attachment "${filename}" size does not match uploaded content`);
  }

  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment "${filename}" exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit`);
  }

  return {
    filename,
    contentType: attachment?.contentType || attachment?.type || 'application/octet-stream',
    buffer,
    size: buffer.length,
  };
}

function normalizeAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`A maximum of ${MAX_ATTACHMENT_COUNT} attachments can be sent at once`);
  }

  const normalized = attachments.map(normalizeAttachment);
  const totalBytes = normalized.reduce((sum, attachment) => sum + attachment.size, 0);

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(`Attachments exceed the ${Math.floor(MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024)}MB total limit`);
  }

  return normalized;
}

async function uploadAttachment({ accessToken, accountId, attachment }) {
  const uploadUrl = `${config.apiBaseUrl}/accounts/${accountId}/messages/attachments`;

  const response = await axios.post(uploadUrl, attachment.buffer, {
    params: {
      fileName: attachment.filename,
      isInline: false,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      // ZOHO raw attachment uploads reject some specific MIME types with 415.
      // The API accepts binary raw uploads reliably as application/octet-stream.
      'Content-Type': 'application/octet-stream',
    },
  });

  const data = Array.isArray(response.data?.data)
    ? response.data.data[0]
    : response.data?.data;

  if (!data?.storeName || !data?.attachmentName || !data?.attachmentPath) {
    throw new Error(`ZOHO attachment upload response was invalid for "${attachment.filename}"`);
  }

  return {
    storeName: data.storeName,
    attachmentName: data.attachmentName,
    attachmentPath: data.attachmentPath,
  };
}

/**
 * Send an email via ZOHO Mail API
 *
 * @param {Object} emailData - Email data
 * @param {string} emailData.to - Recipient email address
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.body - Email body (plain text)
 * @param {string} [emailData.bodyHtml] - Email body (HTML)
 * @param {string} [emailData.inReplyTo] - Message ID being replied to
 * @param {string} [emailData.references] - Message IDs for threading
 * @param {Array<string>} [emailData.cc] - CC email addresses
 * @param {Array<string>} [emailData.bcc] - BCC email addresses
 * @param {Array<Object>} [emailData.attachments] - Attachments with filename/contentType/buffer or contentBase64
 * @returns {Promise<Object>} Sent email details
 */
async function sendEmail(emailData) {
  try {
    const {
      to,
      subject,
      body,
      bodyHtml,
      inReplyTo,
      references,
      cc,
      bcc,
      mode,
      isSchedule,
      scheduleType,
      scheduleTime,
      timeZone,
    } = emailData;
    const attachments = normalizeAttachments(emailData.attachments);

    if (!to) {
      throw new Error('Recipient email (to) is required');
    }

    if (!subject) {
      throw new Error('Email subject is required');
    }

    if (!body && !bodyHtml) {
      throw new Error('Email body is required');
    }

    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();

    // Build email payload according to ZOHO Mail API
    const payload = {
      fromAddress: formatFromAddress(config.accountEmail, config.fromDisplayName),
      toAddress: to,
      subject: subject,
      content: bodyHtml || body,
      mailFormat: bodyHtml ? 'html' : 'plaintext',
      encoding: 'UTF-8'
    };

    if (mode) {
      payload.mode = mode;
    }

    if (isSchedule) {
      payload.isSchedule = true;
      payload.scheduleType = scheduleType || 6;
      if (scheduleTime) payload.scheduleTime = scheduleTime;
      if (timeZone) payload.timeZone = timeZone;
    }

    if (inReplyTo) {
      payload.inReplyTo = inReplyTo;
    }
    if (references) {
      payload.refHeader = Array.isArray(references) ? references.join(' ') : references;
    }

    // Add optional fields
    if (cc && cc.length > 0) {
      payload.ccAddress = cc.join(',');
    }

    if (bcc && bcc.length > 0) {
      payload.bccAddress = bcc.join(',');
    }

    if (attachments.length > 0) {
      console.log(`[ZOHO Send] Uploading ${attachments.length} attachment(s)`);
      payload.attachments = [];

      for (const attachment of attachments) {
        const uploadedAttachment = await uploadAttachment({ accessToken, accountId, attachment });
        payload.attachments.push(uploadedAttachment);
      }
    }

    console.log('[ZOHO Send] Sending email to:', to);
    console.log('[ZOHO Send] Subject:', subject);
    console.log('[ZOHO Send] Attachments:', payload.attachments?.length || 0);

    const response = await axios.post(
      `${config.apiBaseUrl}/accounts/${accountId}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('[ZOHO Send] Email sent successfully');
    const data = getZohoData(response);

    return {
      success: true,
      messageId: data.messageId,
      ...data
    };
  } catch (error) {
    console.error('[ZOHO Send] Error sending email:', getSafeErrorMessage(error));
    throw new Error(`Failed to send email: ${getSafeErrorMessage(error)}`);
  }
}

/**
 * Reply to an email via ZOHO Mail API
 *
 * @param {Object} replyData - Reply data
 * @param {string} replyData.originalMessageId - Original message ID
 * @param {string} replyData.to - Recipient email address
 * @param {string} replyData.subject - Reply subject (usually "Re: ...")
 * @param {string} replyData.body - Reply body (plain text)
 * @param {string} [replyData.bodyHtml] - Reply body (HTML)
 * @param {Array<Object>} [replyData.attachments] - Attachments to send with the reply
 * @returns {Promise<Object>} Sent reply details
 */
async function replyToEmail(replyData) {
  try {
    const { originalMessageId, to, subject, body, bodyHtml, attachments, cc, bcc } = replyData;

    if (!originalMessageId) {
      throw new Error('Original message ID is required for reply');
    }

    // Build subject with "Re:" prefix if not already present
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();
    const normalizedAttachments = normalizeAttachments(attachments);

    const payload = {
      fromAddress: formatFromAddress(config.accountEmail, config.fromDisplayName),
      toAddress: to,
      subject: replySubject,
      content: bodyHtml || body,
      action: 'reply',
      mailFormat: bodyHtml ? 'html' : 'plaintext',
      encoding: 'UTF-8'
    };

    if (cc && cc.length > 0) payload.ccAddress = cc.join(',');
    if (bcc && bcc.length > 0) payload.bccAddress = bcc.join(',');

    if (normalizedAttachments.length > 0) {
      payload.attachments = [];
      for (const attachment of normalizedAttachments) {
        const uploadedAttachment = await uploadAttachment({ accessToken, accountId, attachment });
        payload.attachments.push(uploadedAttachment);
      }
    }

    const response = await axios.post(
      `${config.apiBaseUrl}/accounts/${accountId}/messages/${originalMessageId}`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = getZohoData(response);

    return {
      success: true,
      messageId: data.messageId,
      ...data
    };
  } catch (error) {
    console.error('[ZOHO Reply] Error replying to email:', getSafeErrorMessage(error));
    throw new Error(`Failed to reply to email: ${getSafeErrorMessage(error)}`);
  }
}

async function createDraft(emailData) {
  return sendEmail({ ...emailData, mode: 'draft' });
}

async function scheduleEmail(emailData) {
  return sendEmail({
    ...emailData,
    isSchedule: true,
    scheduleType: emailData.scheduleType || 6,
  });
}

module.exports = {
  sendEmail,
  replyToEmail,
  createDraft,
  scheduleEmail,
  formatFromAddress
};
