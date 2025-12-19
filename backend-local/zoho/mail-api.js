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
    const { folder = 'Inbox', limit = 50, start = 0, sortBy = 'receivedTime', sortOrder = 'desc' } = options;

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
    const messagesResponse = await axios.get(`${config.apiBaseUrl}/accounts/${accountId}/messages/view`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      params: {
        folderId: targetFolder.folderId,
        limit,
        start,
        sortBy,
        sortOrder
      }
    });

    console.log(`[ZOHO Mail API] Fetched ${messagesResponse.data.data.length} messages from ${folder}`);
    return messagesResponse.data.data;
  } catch (error) {
    console.error('[ZOHO Mail API] Error fetching messages:', error);
    throw error;
  }
}

/**
 * Fetch single message details
 */
async function fetchMessageDetails(messageId) {
  try {
    const accessToken = await getValidAccessToken();
    const accountId = await getAccountId();

    const response = await axios.get(`${config.apiBaseUrl}/accounts/${accountId}/messages/${messageId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    console.log(`[ZOHO Mail API] Fetched message details: ${messageId}`);
    return response.data.data;
  } catch (error) {
    console.error('[ZOHO Mail API] Error fetching message details:', error);
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
    console.error('[ZOHO Mail API] Error fetching folders:', error);
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
    console.error('[ZOHO Mail API] Error searching messages:', error);
    throw error;
  }
}

/**
 * Parse ZOHO message to inquiry format
 */
function parseMessageToInquiry(message) {
  return {
    messageId: message.messageId,
    from: message.fromAddress,
    fromName: message.sender,
    subject: message.subject,
    body: message.content || message.summary,
    bodyHtml: message.content,
    receivedAt: new Date(message.receivedTime),
    toEmail: message.toAddress,
    ccEmails: message.ccAddress ? message.ccAddress.split(',').map(e => e.trim()) : [],
    hasAttachments: message.hasAttachment || false
  };
}

module.exports = {
  fetchMessages,
  fetchMessageDetails,
  fetchFolders,
  searchMessages,
  parseMessageToInquiry,
  getAccountId
};
