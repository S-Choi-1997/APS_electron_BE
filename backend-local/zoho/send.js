/**
 * ZOHO Mail Integration - Send Email
 *
 * Handles sending email responses via ZOHO Mail API
 */

const axios = require('axios');
const config = require('./config');
const { getValidAccessToken } = require('./oauth');
const { getAccountId } = require('./mail-api');

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
 * @returns {Promise<Object>} Sent email details
 */
async function sendEmail(emailData) {
  try {
    const { to, subject, body, bodyHtml, inReplyTo, references, cc, bcc } = emailData;

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
      fromAddress: config.accountEmail,
      toAddress: to,
      subject: subject,
      content: bodyHtml || body,
      mailFormat: bodyHtml ? 'html' : 'plaintext'
    };

    // Add optional fields
    if (cc && cc.length > 0) {
      payload.ccAddress = cc.join(',');
    }

    if (bcc && bcc.length > 0) {
      payload.bccAddress = bcc.join(',');
    }

    // Add threading headers for replies
    if (inReplyTo) {
      payload.inReplyTo = inReplyTo;
    }

    if (references) {
      payload.references = references;
    }

    console.log('[ZOHO Send] Sending email to:', to);
    console.log('[ZOHO Send] Subject:', subject);

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
    console.log('[ZOHO Send] Response:', response.data);

    return {
      success: true,
      messageId: response.data.data?.messageId,
      ...response.data.data
    };
  } catch (error) {
    console.error('[ZOHO Send] Error sending email:', error.response?.data || error.message);
    throw new Error(`Failed to send email: ${error.response?.data?.message || error.message}`);
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
 * @returns {Promise<Object>} Sent reply details
 */
async function replyToEmail(replyData) {
  try {
    const { originalMessageId, to, subject, body, bodyHtml } = replyData;

    if (!originalMessageId) {
      throw new Error('Original message ID is required for reply');
    }

    // Build subject with "Re:" prefix if not already present
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

    // Build threading headers
    const emailData = {
      to,
      subject: replySubject,
      body,
      bodyHtml,
      inReplyTo: originalMessageId,
      references: originalMessageId
    };

    return await sendEmail(emailData);
  } catch (error) {
    console.error('[ZOHO Reply] Error replying to email:', error.message);
    throw error;
  }
}

module.exports = {
  sendEmail,
  replyToEmail
};
