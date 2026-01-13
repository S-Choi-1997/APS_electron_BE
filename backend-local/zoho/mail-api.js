/**
 * ZOHO Mail Integration - Mail API Client
 *
 * Handles communication with ZOHO Mail API
 */

const axios = require('axios');
const config = require('./config');
const { getValidAccessToken } = require('./oauth');

/**
 * Get account ID from configured email
 * Uses stored zoho_user_id from database instead of querying ZOHO API
 */
async function getAccountId() {
  try {
    const { getOAuthTokens } = require('./db-helper');
    const zohoEmail = config.accountEmail;

    if (!zohoEmail) {
      throw new Error('ZOHO_ACCOUNT_EMAIL not configured');
    }

    // Get account ID from database (saved during OAuth)
    const tokenRecord = await getOAuthTokens(zohoEmail);

    if (!tokenRecord) {
      throw new Error('No OAuth tokens found. Please authorize the application first.');
    }

    if (!tokenRecord.zoho_user_id) {
      throw new Error('ZOHO user ID not found in database. Please re-authorize the application.');
    }

    console.log(`[ZOHO Mail API] Using account ID from database: ${tokenRecord.zoho_user_id}`);
    return tokenRecord.zoho_user_id;
  } catch (error) {
    console.error('[ZOHO Mail API] Error getting account ID:', error);
    throw error;
  }
}

/**
 * Fetch messages from ZOHO Mail
 */
async function fetchMessages(options = {}) {
  try {
    const { folder = 'Inbox', limit = 50, start = 0 } = options;

    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();

    // Get folder ID
    const foldersResponse = await axios.get(`${config.apiBaseUrl}/accounts/${accountId}/folders`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const targetFolder = foldersResponse.data.data.find(f => f.folderName === folder);
    if (!targetFolder) {
      throw new Error(`Folder not found: ${folder}`);
    }

    // Fetch messages from folder
    // Note: ZOHO API does NOT support sortBy/sortOrder parameters on /messages/view
    const messagesResponse = await axios.get(`${config.apiBaseUrl}/accounts/${accountId}/messages/view`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      params: {
        folderId: targetFolder.folderId,
        limit,
        start
      }
    });

    console.log(`[ZOHO Mail API] Fetched ${messagesResponse.data.data.length} messages from ${folder}`);
    return messagesResponse.data.data;
  } catch (error) {
    console.error('[ZOHO Mail API] Error fetching messages:', error.response?.data || error.message);
    console.error('[ZOHO Mail API] Full error:', error);
    throw error;
  }
}

/**
 * Fetch single message details
 * Note: ZOHO API requires folderId in the path
 */
async function fetchMessageDetails(messageId, folderId) {
  try {
    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();

    if (!folderId) {
      throw new Error('folderId is required to fetch message details');
    }

    const response = await axios.get(`${config.apiBaseUrl}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/details`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    console.log(`[ZOHO Mail API] Fetched message details: ${messageId}`);
    return response.data.data;
  } catch (error) {
    console.error('[ZOHO Mail API] Error fetching message details:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch folders from ZOHO Mail
 */
async function fetchFolders() {
  try {
    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();

    const response = await axios.get(`${config.apiBaseUrl}/accounts/${accountId}/folders`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    console.log(`[ZOHO Mail API] Fetched ${response.data.data.length} folders`);
    return response.data.data;
  } catch (error) {
    console.error('[ZOHO Mail API] Error fetching folders:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch full message content (not truncated)
 * Uses the /content endpoint to get complete email body
 */
async function fetchMessageContent(messageId, folderId) {
  try {
    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();

    if (!folderId) {
      throw new Error('folderId is required to fetch message content');
    }

    const response = await axios.get(
      `${config.apiBaseUrl}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/content`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        params: {
          includeBlockContent: true
        }
      }
    );

    console.log(`[ZOHO Mail API] Fetched full content for message: ${messageId}`);
    return response.data.data?.content || response.data.data;
  } catch (error) {
    console.error('[ZOHO Mail API] Error fetching message content:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch attachment info for a message
 */
async function fetchAttachmentInfo(messageId, folderId) {
  try {
    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();

    if (!folderId) {
      throw new Error('folderId is required to fetch attachment info');
    }

    const response = await axios.get(
      `${config.apiBaseUrl}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/attachmentinfo`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        params: {
          includeInline: false
        }
      }
    );

    const attachments = response.data.data?.attachments || [];
    console.log(`[ZOHO Mail API] Fetched ${attachments.length} attachments for message: ${messageId}`);
    return attachments;
  } catch (error) {
    console.error('[ZOHO Mail API] Error fetching attachment info:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Download attachment as stream
 */
async function downloadAttachment(messageId, folderId, attachmentId) {
  try {
    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();

    if (!folderId) {
      throw new Error('folderId is required to download attachment');
    }

    const response = await axios.get(
      `${config.apiBaseUrl}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/attachments/${attachmentId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        responseType: 'stream'
      }
    );

    console.log(`[ZOHO Mail API] Downloading attachment: ${attachmentId}`);
    return response;
  } catch (error) {
    console.error('[ZOHO Mail API] Error downloading attachment:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Search messages by criteria
 */
async function searchMessages(searchQuery, options = {}) {
  try {
    const { limit = 50, start = 0 } = options;

    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();

    const response = await axios.get(`${config.apiBaseUrl}/accounts/${accountId}/messages/search`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      params: {
        searchKey: searchQuery,
        limit,
        start
      }
    });

    console.log(`[ZOHO Mail API] Search found ${response.data.data.length} messages`);
    return response.data.data;
  } catch (error) {
    console.error('[ZOHO Mail API] Error searching messages:', error.response?.data || error.message);
    console.error('[ZOHO Mail API] Full error:', error);
    throw error;
  }
}

/**
 * Helper function to decode HTML entities and extract clean email address
 */
function decodeAndCleanEmail(emailStr) {
  if (!emailStr) return '';

  // Decode common HTML entities
  const decoded = emailStr
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

  // Extract email from formats like "Name <email@domain.com>" or "<email@domain.com>"
  const emailMatch = decoded.match(/<([^>]+)>/) || decoded.match(/([^\s<>]+@[^\s<>]+)/);
  return emailMatch ? emailMatch[1].trim() : decoded.trim();
}

/**
 * Parse ZOHO message to inquiry format
 */
function parseMessageToInquiry(message, isOutgoing = false) {
  // Parse receivedAt with fallback to current time
  let receivedAt;
  if (message.receivedTime) {
    const timestamp = parseInt(message.receivedTime);
    receivedAt = isNaN(timestamp) ? new Date() : new Date(timestamp);
  } else if (message.receivedAt) {
    receivedAt = new Date(message.receivedAt);
  } else {
    receivedAt = new Date();
  }

  const fromEmail = decodeAndCleanEmail(message.fromAddress || message.from);

  // Check if this is an outgoing email based on sender
  // Even if it's in Inbox folder, if sender is our account, it's outgoing
  const actuallyOutgoing = isOutgoing || (config.accountEmail && fromEmail === config.accountEmail);

  // Extract inReplyTo from IntegIdList (ZOHO webhook format)
  // IntegIdList contains comma-separated message IDs that this email is replying to
  let inReplyTo = null;
  if (message.IntegIdList) {
    console.log('[ZOHO Parse] Raw IntegIdList:', message.IntegIdList);
    const replyIds = message.IntegIdList.split(',').map(id => id.trim()).filter(id => id);
    console.log('[ZOHO Parse] Parsed reply IDs:', replyIds);
    if (replyIds.length > 0) {
      // Take the first ID as the direct parent
      inReplyTo = replyIds[0];
    }
  } else if (message.inReplyTo) {
    inReplyTo = message.inReplyTo;
  }

  console.log('[ZOHO Parse] Email parsing debug:');
  console.log('  - fromEmail:', fromEmail);
  console.log('  - config.accountEmail:', config.accountEmail);
  console.log('  - actuallyOutgoing:', actuallyOutgoing);
  console.log('  - inReplyTo:', inReplyTo);
  console.log('  - messageId:', message.messageId);

  return {
    messageId: message.messageId,
    folderId: message.folderId, // Required for fetchMessageDetails
    from: fromEmail,
    fromName: message.sender || message.fromName,
    subject: message.subject,
    body: message.content || message.summary || message.body,
    bodyHtml: message.content || message.bodyHtml,
    receivedAt: receivedAt,
    toEmail: decodeAndCleanEmail(message.toAddress || message.to),
    ccEmails: message.ccAddress && message.ccAddress !== 'Not Provided'
      ? message.ccAddress.split(',').map(e => decodeAndCleanEmail(e))
      : (message.ccEmails || []),
    hasAttachments: message.hasAttachment === '1' || message.hasAttachment === true || message.hasAttachments,
    isOutgoing: actuallyOutgoing,
    inReplyTo: inReplyTo
  };
}

module.exports = {
  fetchMessages,
  fetchMessageDetails,
  fetchMessageContent,
  fetchAttachmentInfo,
  downloadAttachment,
  fetchFolders,
  searchMessages,
  parseMessageToInquiry,
  getAccountId
};
