/**
 * ZOHO Mail Integration - Mail API Client
 *
 * Handles communication with ZOHO Mail API
 */

const axios = require('axios');
const config = require('./config');
const { getValidAccessToken } = require('./oauth');

const AUTH_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
let authRetryBlockedUntil = 0;

async function zohoRequest(method, path, { params, data, responseType, retryOnUnauthorized = true } = {}) {
  let accessToken = await getValidAccessToken();
  const accountId = await getAccountId();
  const requestConfig = () => ({
    method,
    url: `${config.apiBaseUrl}/accounts/${accountId}${path}`,
    params,
    data,
    responseType,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  try {
    return await axios(requestConfig());
  } catch (error) {
    if (error.response?.status === 401 && retryOnUnauthorized) {
      if (Date.now() < authRetryBlockedUntil) {
        throw new Error(getSafeErrorMessage(error));
      }
      console.warn('[ZOHO Mail API] Request unauthorized; refreshing token and retrying once');
      try {
        accessToken = await getValidAccessToken({ forceRefresh: true });
      } catch (refreshError) {
        authRetryBlockedUntil = Date.now() + AUTH_RETRY_COOLDOWN_MS;
        console.warn('[ZOHO Mail API] Token refresh after unauthorized request failed; suppressing auth retries temporarily:', getSafeErrorMessage(refreshError));
        throw new Error(getSafeErrorMessage(error));
      }
      try {
        return await axios(requestConfig());
      } catch (retryError) {
        if (retryError.response?.status === 401) {
          authRetryBlockedUntil = Date.now() + AUTH_RETRY_COOLDOWN_MS;
        }
        throw new Error(getSafeErrorMessage(retryError));
      }
    }
    throw new Error(getSafeErrorMessage(error));
  }
}

function getSafeErrorMessage(error) {
  if (error.response) {
    return `ZOHO API request failed with status ${error.response.status || 'unknown'}`;
  }
  return error.message;
}

function assertZohoSuccess(response) {
  const body = response?.data || {};
  const status = body.status || body.data?.status;
  const code = status?.code ?? status?.statusCode;
  const description = status?.description || status?.message || body.message;

  if (code !== undefined) {
    const normalizedCode = String(code).toLowerCase();
    const success = normalizedCode === 'success' || normalizedCode.startsWith('2') || normalizedCode === '200';
    if (!success) {
      throw new Error(description || `ZOHO operation failed with status ${code}`);
    }
  }

  return response;
}

function getResponseData(response) {
  assertZohoSuccess(response);
  return response.data?.data ?? response.data;
}

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
    console.error('[ZOHO Mail API] Error getting account ID:', error.message);
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

    // Add folderId to each message (ZOHO API doesn't include it in the response)
    const messagesWithFolderId = messagesResponse.data.data.map(msg => ({
      ...msg,
      folderId: targetFolder.folderId
    }));

    return messagesWithFolderId;
  } catch (error) {
    console.error('[ZOHO Mail API] Error fetching messages:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
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
    console.error('[ZOHO Mail API] Error fetching message details:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
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
    console.error('[ZOHO Mail API] Error fetching folders:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
  }
}

async function fetchLabels() {
  try {
    const response = await zohoRequest('get', '/labels', { retryOnUnauthorized: false });
    const labels = Array.isArray(response.data?.data) ? response.data.data : [];
    console.log(`[ZOHO Mail API] Fetched ${labels.length} labels`);
    return labels;
  } catch (error) {
    console.error('[ZOHO Mail API] Error fetching labels:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
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
    console.error('[ZOHO Mail API] Error fetching message content:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
  }
}

async function fetchOriginalMessage(messageId) {
  try {
    const response = await zohoRequest('get', `/messages/${messageId}/originalmessage`);
    console.log(`[ZOHO Mail API] Fetched original message: ${messageId}`);
    return getResponseData(response);
  } catch (error) {
    console.error('[ZOHO Mail API] Error fetching original message:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
  }
}

async function downloadInlineImage(messageId, folderId, contentId) {
  try {
    if (!folderId) {
      throw new Error('folderId is required to download inline image');
    }

    const response = await zohoRequest('get', `/folders/${folderId}/messages/${messageId}/inline`, {
      params: { contentId },
      responseType: 'stream',
    });

    console.log(`[ZOHO Mail API] Downloading inline image: ${contentId}`);
    return response;
  } catch (error) {
    console.error('[ZOHO Mail API] Error downloading inline image:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
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
    console.error('[ZOHO Mail API] Error fetching attachment info:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
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
    console.error('[ZOHO Mail API] Error downloading attachment:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
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
    console.error('[ZOHO Mail API] Error searching messages:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
  }
}

async function updateMessage(payload) {
  try {
    const response = await zohoRequest('put', '/updatemessage', { data: payload });
    return getResponseData(response);
  } catch (error) {
    console.error('[ZOHO Mail API] Error updating message:', getSafeErrorMessage(error));
    throw new Error(getSafeErrorMessage(error));
  }
}

function messageUpdatePayload(mode, messageId, extra = {}) {
  return {
    mode,
    messageId: Array.isArray(messageId) ? messageId : [messageId],
    ...extra,
  };
}

async function markMessageRead(messageId, options = {}) {
  return updateMessage(messageUpdatePayload('markAsRead', messageId, options));
}

async function markMessageUnread(messageId, options = {}) {
  return updateMessage(messageUpdatePayload('markAsUnread', messageId, options));
}

async function moveMessage(messageId, destinationFolderId, options = {}) {
  if (!destinationFolderId) {
    throw new Error('destinationFolderId is required');
  }
  return updateMessage(messageUpdatePayload('moveMessage', messageId, {
    destfolderId: destinationFolderId,
    ...options,
  }));
}

async function trashMessage(messageId, folderId) {
  if (!folderId) {
    throw new Error('folderId is required to move email to trash');
  }
  const response = await zohoRequest('delete', `/folders/${folderId}/messages/${messageId}`, {
    params: { expunge: false },
  });
  return getResponseData(response);
}

async function restoreMessage(messageId, destinationFolderId, options = {}) {
  return moveMessage(messageId, destinationFolderId, options);
}

async function deleteMessage(messageId, folderId) {
  if (!folderId) {
    throw new Error('folderId is required to permanently delete email');
  }
  const response = await zohoRequest('delete', `/folders/${folderId}/messages/${messageId}`, {
    params: { expunge: true },
  });
  return getResponseData(response);
}

async function archiveMessage(messageId) {
  return updateMessage(messageUpdatePayload('archiveMails', messageId));
}

async function unarchiveMessage(messageId) {
  return updateMessage(messageUpdatePayload('unArchiveMails', messageId));
}

async function flagMessage(messageId, flagId, options = {}) {
  if (!flagId) {
    throw new Error('flagId is required');
  }
  return updateMessage(messageUpdatePayload('setFlag', messageId, {
    flagid: flagId,
    ...options,
  }));
}

async function applyLabel(messageId, labelId, options = {}) {
  const labelIds = Array.isArray(labelId) ? labelId : [labelId];
  if (!labelIds.every(Boolean)) {
    throw new Error('labelId is required');
  }
  return updateMessage(messageUpdatePayload('applyLabel', messageId, {
    labelId: labelIds,
    ...options,
  }));
}

async function removeLabel(messageId, labelId, options = {}) {
  const labelIds = Array.isArray(labelId) ? labelId : [labelId];
  if (!labelIds.every(Boolean)) {
    throw new Error('labelId is required');
  }
  return updateMessage(messageUpdatePayload('removeLabel', messageId, {
    labelId: labelIds,
    ...options,
  }));
}

async function createLabel({ name, color }) {
  if (!name || !String(name).trim()) {
    throw new Error('Label name is required');
  }
  const response = await zohoRequest('post', '/labels', {
    data: {
      displayName: String(name).trim(),
      ...(color ? { color } : {}),
    },
  });
  return getResponseData(response);
}

async function updateLabel(labelId, { name, color }) {
  if (!labelId) {
    throw new Error('labelId is required');
  }
  const response = await zohoRequest('put', `/labels/${labelId}`, {
    data: {
      ...(name ? { displayName: String(name).trim() } : {}),
      ...(color ? { color } : {}),
    },
  });
  return getResponseData(response);
}

async function deleteLabel(labelId) {
  if (!labelId) {
    throw new Error('labelId is required');
  }
  const response = await zohoRequest('delete', `/labels/${labelId}`);
  return getResponseData(response);
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
  const accountEmail = (config.accountEmail || '').toLowerCase();

  // Check if this is an outgoing email based on sender
  // Even if it's in Inbox folder, if sender is our account, it's outgoing
  const actuallyOutgoing = isOutgoing || (accountEmail && fromEmail.toLowerCase() === accountEmail);

  // Extract inReplyTo from IntegIdList (ZOHO webhook format)
  // IntegIdList contains comma-separated message IDs that this email is replying to
  let inReplyTo = null;
  let references = [];
  if (message.IntegIdList) {
    console.log('[ZOHO Parse] Raw IntegIdList:', message.IntegIdList);
    const replyIds = message.IntegIdList.split(',').map(id => id.trim()).filter(id => id);
    console.log('[ZOHO Parse] Parsed reply IDs:', replyIds);
    if (replyIds.length > 0) {
      // Take the first ID as the direct parent
      inReplyTo = replyIds[0];
      references = replyIds;
    }
  } else if (message.inReplyTo) {
    inReplyTo = message.inReplyTo;
  }

  if (Array.isArray(message.references)) {
    references = [...new Set([...references, ...message.references.filter(Boolean)])];
  } else if (typeof message.references === 'string') {
    const providerReferences = message.references.split(/[,\s]+/).map(id => id.trim()).filter(Boolean);
    references = [...new Set([...references, ...providerReferences])];
  }

  if (inReplyTo) {
    references = [...new Set([inReplyTo, ...references])];
  }

  const providerThreadId = message.threadId || message.thread_id || message.conversationId || message.conversation_id;

  console.log('[ZOHO Parse] Email parsing debug:');
  console.log('  - fromEmail:', fromEmail);
  console.log('  - config.accountEmail:', config.accountEmail);
  console.log('  - actuallyOutgoing:', actuallyOutgoing);
  console.log('  - inReplyTo:', inReplyTo);
  console.log('  - messageId:', message.messageId);

  return {
    messageId: message.messageId,
    folderId: message.folderId, // Required for fetchMessageDetails
    folderName: message.folderName,
    folderType: actuallyOutgoing ? 'sent' : normalizeFolderType(message.folderName),
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
    readState: message.status === '0' || message.isRead === false ? 'unread' : 'read',
    responseState: actuallyOutgoing ? 'responded' : 'pending',
    flagId: message.flagid || message.flagId || null,
    starred: Boolean(message.flagid && message.flagid !== 'flag_not_set'),
    labels: Array.isArray(message.labels) ? message.labels : [],
    inReplyTo: inReplyTo,
    references,
    threadId: providerThreadId,
    providerRaw: message
  };
}

function normalizeFolderType(folderName) {
  const value = String(folderName || '').toLowerCase();
  if (value.includes('inbox')) return 'inbox';
  if (value.includes('sent')) return 'sent';
  if (value.includes('draft')) return 'drafts';
  if (value.includes('trash') || value.includes('deleted')) return 'trash';
  if (value.includes('archive')) return 'archive';
  if (value.includes('spam') || value.includes('junk')) return 'spam';
  if (value.includes('outbox')) return 'outbox';
  return null;
}

module.exports = {
  fetchMessages,
  fetchMessageDetails,
  fetchMessageContent,
  fetchOriginalMessage,
  downloadInlineImage,
  fetchAttachmentInfo,
  downloadAttachment,
  fetchFolders,
  fetchLabels,
  searchMessages,
  markMessageRead,
  markMessageUnread,
  moveMessage,
  trashMessage,
  restoreMessage,
  deleteMessage,
  archiveMessage,
  unarchiveMessage,
  flagMessage,
  applyLabel,
  removeLabel,
  createLabel,
  updateLabel,
  deleteLabel,
  assertZohoSuccess,
  parseMessageToInquiry,
  getAccountId
};
