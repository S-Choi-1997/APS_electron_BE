import { apiFetch, apiRequest } from '../config/api';
import { auth } from '../auth/authManager';

export const EMAIL_STATUS = {
  UNREAD: 'unread',
  READ: 'read',
  RESPONDED: 'responded',
};

function compactParams(params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') return;
    searchParams.append(key, String(value));
  });
  return searchParams.toString();
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function stripHtml(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function toBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return Boolean(value);
}

function normalizeLabel(label = {}) {
  return {
    id: label.labelId || label.id || label.tagId || label.name,
    labelId: label.labelId || label.id || label.tagId || label.name,
    name: label.name || label.labelName || label.displayName || label.labelId || label.id || '',
    color: label.color || null,
  };
}

export function normalizeEmailInquiry(inquiry = {}) {
  const readState = inquiry.readState || inquiry.read_state || (inquiry.status === EMAIL_STATUS.UNREAD ? EMAIL_STATUS.UNREAD : EMAIL_STATUS.READ);
  const responseState = inquiry.responseState || inquiry.response_state || (inquiry.status === EMAIL_STATUS.RESPONDED ? EMAIL_STATUS.RESPONDED : 'pending');
  const status = inquiry.status || (responseState === 'responded' ? EMAIL_STATUS.RESPONDED : readState);
  const bodyText = inquiry.bodyText || inquiry.body_text || inquiry.body || '';
  const bodyHtml = inquiry.bodyHtml || inquiry.body_html || '';
  const preview = inquiry.preview || stripHtml(bodyText || bodyHtml).slice(0, 180);
  const isOutgoing = toBoolean(inquiry.isOutgoing ?? inquiry.is_outgoing ?? false);
  const to = asArray(inquiry.to || inquiry.to_email || inquiry.toEmails);
  const cc = asArray(inquiry.cc || inquiry.cc_emails || inquiry.ccEmails);
  const bcc = asArray(inquiry.bcc || inquiry.bcc_emails || inquiry.bccEmails);
  const receivedAt = inquiry.receivedAt || inquiry.received_at || inquiry.sentAt || inquiry.sent_at || inquiry.createdAt || inquiry.created_at;

  return {
    ...inquiry,
    id: inquiry.id,
    messageId: inquiry.messageId || inquiry.message_id || '',
    threadId: inquiry.threadId || inquiry.thread_id || '',
    source: inquiry.source || 'zoho',
    mailbox: inquiry.mailbox || inquiry.folderType || inquiry.folder_type || (isOutgoing ? 'sent' : 'inbox'),
    folderId: inquiry.folderId || inquiry.folder_id || null,
    folderName: inquiry.folderName || inquiry.folder_name || '',
    folderType: inquiry.folderType || inquiry.folder_type || (isOutgoing ? 'sent' : 'inbox'),
    direction: isOutgoing ? 'outgoing' : 'incoming',
    from: inquiry.from || inquiry.from_email || '',
    fromName: inquiry.fromName || inquiry.from_name || '',
    to,
    toEmail: to.join(', '),
    cc,
    bcc,
    subject: inquiry.subject || '(no subject)',
    preview,
    body: bodyText,
    bodyText,
    bodyHtml,
    receivedAt,
    sentAt: inquiry.sentAt || inquiry.sent_at || (isOutgoing ? receivedAt : null),
    scheduledAt: inquiry.scheduledAt || inquiry.scheduled_at || null,
    updatedAt: inquiry.updatedAt || inquiry.updated_at || null,
    readState,
    responseState,
    status,
    check: status !== EMAIL_STATUS.UNREAD,
    isOutgoing,
    hasAttachments: toBoolean(inquiry.hasAttachments ?? inquiry.has_attachments),
    attachmentCount: Number(inquiry.attachmentCount || inquiry.attachment_count || 0),
    labels: asArray(inquiry.labels).map(normalizeLabel),
    starred: toBoolean(inquiry.starred),
    flagId: inquiry.flagId || inquiry.flag_id || null,
    translationStatus: inquiry.translationStatus || inquiry.translation_status || 'not_required',
    detectedLanguage: inquiry.detectedLanguage || inquiry.detected_language || null,
    translatedSubject: inquiry.translatedSubject || inquiry.translated_subject || null,
    translatedBody: inquiry.translatedBody || inquiry.translated_body_text || null,
    translationModel: inquiry.translationModel || inquiry.translation_model || null,
    translationError: inquiry.translationError || inquiry.translation_error || null,
    translatedAt: inquiry.translatedAt || inquiry.translated_at || null,
  };
}

export const normalizeEmailMessage = normalizeEmailInquiry;

function normalizeMailboxResponse(response, fallback = {}) {
  const rawItems = response?.data || response?.items || (Array.isArray(response) ? response : []);
  const items = rawItems.map(normalizeEmailInquiry);
  return {
    items,
    data: items,
    total: Number(response?.total ?? response?.count ?? items.length),
    count: Number(response?.count ?? items.length),
    limit: Number(response?.limit ?? fallback.limit ?? items.length),
    offset: Number(response?.offset ?? fallback.offset ?? 0),
    hasMore: Boolean(response?.hasMore),
  };
}

function normalizeDraft(row = {}) {
  return {
    ...row,
    id: row.id,
    to: asArray(row.to || row.to_emails || row.toEmails),
    cc: asArray(row.cc || row.cc_emails || row.ccEmails),
    bcc: asArray(row.bcc || row.bcc_emails || row.bccEmails),
    subject: row.subject || '',
    body: row.body || row.body_text || row.bodyText || '',
    bodyHtml: row.bodyHtml || row.body_html || '',
    attachments: asArray(row.attachments),
    createdAt: row.createdAt || row.created_at,
    updatedAt: row.updatedAt || row.updated_at,
  };
}

function normalizeScheduled(row = {}) {
  return {
    ...normalizeDraft(row),
    scheduledAt: row.scheduledAt || row.scheduled_at,
    status: row.status || 'scheduled',
    failureReason: row.failureReason || row.failure_reason || row.provider_raw?.lastError || null,
  };
}

function normalizeAttachment(attachment = {}) {
  return {
    ...attachment,
    id: attachment.attachmentId || attachment.id || attachment.storeName || attachment.attachmentName,
    attachmentId: attachment.attachmentId || attachment.id || attachment.storeName || attachment.attachmentName,
    name: attachment.attachmentName || attachment.fileName || attachment.name || attachment.filename || 'attachment',
    filename: attachment.attachmentName || attachment.fileName || attachment.name || attachment.filename || 'attachment',
    size: Number(attachment.size || attachment.fileSize || attachment.attachmentSize || 0),
    contentType: attachment.contentType || attachment.mimeType || attachment.type || 'application/octet-stream',
  };
}

function parseContentDispositionFilename(header) {
  if (!header) return '';
  const starMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch?.[1]) {
    try {
      return decodeURIComponent(starMatch[1].trim());
    } catch {
      return starMatch[1].trim();
    }
  }
  const match = header.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || '';
}

export async function fetchEmailMailbox(params = {}) {
  const query = compactParams(params);
  const response = await apiRequest(query ? `/email-inquiries?${query}` : '/email-inquiries', { method: 'GET' }, auth);
  return normalizeMailboxResponse(response, params);
}

export async function fetchEmailInquiryPage(options = {}) {
  return fetchEmailMailbox(options);
}

export async function fetchEmailInquiries(options = {}) {
  const page = await fetchEmailMailbox(options);
  return page.items;
}

export async function fetchEmailDetail(id) {
  const response = await apiRequest(`/email-inquiries/${id}`, { method: 'GET' }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function fetchEmailStats() {
  const response = await apiRequest('/email-inquiries/stats', { method: 'GET' }, auth);
  return response.data || response || {};
}

export async function fetchEmailThread(id, { order = 'asc' } = {}) {
  const query = compactParams({ includeCurrent: true, order });
  const response = await apiRequest(`/email-inquiries/${id}/thread?${query}`, { method: 'GET' }, auth);
  const items = response.data || response.items || (Array.isArray(response) ? response : []);
  return items.map(normalizeEmailInquiry);
}

export async function fetchEmailContent(id) {
  const response = await apiFetch(`/email-inquiries/${id}/content`, { method: 'GET' }, auth);
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (response.status === 400) {
    return {
      content: null,
      html: null,
      text: null,
      contentType: null,
      unavailableReason: data?.message || data?.error || 'Content is unavailable for this message.',
    };
  }
  if (!response.ok) throw new Error(data?.message || data?.error || `Failed to load email content (${response.status})`);
  const content = data?.content || '';
  const contentType = data?.contentType || (/<[^>]+>/.test(content) ? 'html' : 'text');
  return {
    content,
    html: contentType === 'html' ? content : null,
    text: contentType === 'text' ? content : stripHtml(content),
    contentType,
    unavailableReason: data?.unavailableReason || null,
  };
}

export async function fetchEmailAttachments(id) {
  const response = await apiRequest(`/email-inquiries/${id}/attachments`, { method: 'GET' }, auth);
  const attachments = response.attachments || response.data || [];
  return attachments.map(normalizeAttachment);
}

export async function downloadEmailAttachment(emailId, attachmentId, fallbackFilename = '') {
  const response = await apiFetch(`/email-inquiries/${emailId}/attachments/${attachmentId}/download`, { method: 'GET' }, auth);
  if (!response.ok) throw new Error(`Failed to download attachment (${response.status})`);
  const blob = await response.blob();
  const headerFilename = parseContentDispositionFilename(response.headers.get('content-disposition'));
  return {
    blob,
    filename: headerFilename || fallbackFilename || `attachment-${attachmentId}`,
    contentType: response.headers.get('content-type') || blob.type || 'application/octet-stream',
  };
}

export async function fetchEmailFolders() {
  const response = await apiRequest('/email-folders', { method: 'GET' }, auth);
  return (response.data || response || []).map(folder => ({
    ...folder,
    id: folder.folderId || folder.id,
    folderId: folder.folderId || folder.id,
    name: folder.name || folder.folderName || folder.folderId || folder.id,
    type: folder.type || folder.folderType || 'custom',
  }));
}

export async function fetchEmailLabels() {
  const response = await apiRequest('/email-labels', { method: 'GET' }, auth);
  return (response.data || response || []).map(normalizeLabel);
}

export async function searchEmails(params = {}) {
  const query = compactParams(params);
  const response = await apiRequest(query ? `/emails/search?${query}` : '/emails/search', { method: 'GET' }, auth);
  return normalizeMailboxResponse(response, params);
}

export async function sendEmail(payload) {
  const response = await apiRequest('/emails', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, auth);
  return response.data ? normalizeEmailInquiry(response.data) : response;
}

export async function replyToEmail(id, payload) {
  const response = await apiRequest(`/email-inquiries/${id}/reply`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, auth);
  return {
    ...response,
    sentEmail: response.sentEmail ? normalizeEmailInquiry(response.sentEmail) : null,
    originalEmail: response.originalEmail ? normalizeEmailInquiry(response.originalEmail) : null,
  };
}

export async function fetchDrafts(params = {}) {
  const query = compactParams(params);
  const response = await apiRequest(query ? `/email-drafts?${query}` : '/email-drafts', { method: 'GET' }, auth);
  const data = response.data || response.items || [];
  return { items: data.map(normalizeDraft), count: Number(response.count ?? data.length) };
}

export async function createDraft(payload) {
  const response = await apiRequest('/email-drafts', { method: 'POST', body: JSON.stringify(payload) }, auth);
  return normalizeDraft(response.data || response);
}

export async function updateDraft(id, payload) {
  const response = await apiRequest(`/email-drafts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, auth);
  return normalizeDraft(response.data || response);
}

export async function deleteDraft(id) {
  const response = await apiRequest(`/email-drafts/${id}`, { method: 'DELETE' }, auth);
  return normalizeDraft(response.data || response);
}

export async function sendDraft(id) {
  const response = await apiRequest(`/email-drafts/${id}/send`, { method: 'POST' }, auth);
  return response.data ? normalizeEmailInquiry(response.data) : response;
}

export async function fetchScheduledEmails(params = {}) {
  const query = compactParams(params);
  const response = await apiRequest(query ? `/scheduled-emails?${query}` : '/scheduled-emails', { method: 'GET' }, auth);
  const data = response.data || response.items || [];
  return { items: data.map(normalizeScheduled), count: Number(response.count ?? data.length) };
}

export async function createScheduledEmail(payload) {
  const response = await apiRequest('/scheduled-emails', { method: 'POST', body: JSON.stringify(payload) }, auth);
  return normalizeScheduled(response.data || response);
}

export async function updateScheduledEmail(id, payload) {
  const response = await apiRequest(`/scheduled-emails/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, auth);
  return normalizeScheduled(response.data || response);
}

export async function deleteScheduledEmail(id) {
  const response = await apiRequest(`/scheduled-emails/${id}`, { method: 'DELETE' }, auth);
  return normalizeScheduled(response.data || response);
}

export async function sendScheduledNow(id) {
  const response = await apiRequest(`/scheduled-emails/${id}/send-now`, { method: 'POST' }, auth);
  return response.data ? normalizeEmailInquiry(response.data) : response;
}

export async function setEmailReadState(id, readState) {
  const response = await apiRequest(`/email-inquiries/${id}/read-state`, {
    method: 'PATCH',
    body: JSON.stringify({ readState }),
  }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function setEmailResponseState(id, responseState) {
  const response = await apiRequest(`/email-inquiries/${id}/response-state`, {
    method: 'PATCH',
    body: JSON.stringify({ responseState }),
  }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function updateEmailInquiry(id, updates) {
  if (updates.readState) return setEmailReadState(id, updates.readState);
  if (updates.responseState) return setEmailResponseState(id, updates.responseState);
  if (updates.status === EMAIL_STATUS.READ || updates.status === EMAIL_STATUS.UNREAD) return setEmailReadState(id, updates.status);
  if (updates.status === EMAIL_STATUS.RESPONDED) return setEmailResponseState(id, 'responded');
  const response = await apiRequest(`/email-inquiries/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function moveEmail(id, folderId, extra = {}) {
  const response = await apiRequest(`/email-inquiries/${id}/move`, { method: 'POST', body: JSON.stringify({ folderId, ...extra }) }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function trashEmail(id) {
  const response = await apiRequest(`/email-inquiries/${id}/trash`, { method: 'POST' }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function restoreEmail(id, folderId, extra = {}) {
  const response = await apiRequest(`/email-inquiries/${id}/restore`, { method: 'POST', body: JSON.stringify({ folderId, ...extra }) }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function archiveEmail(id) {
  const response = await apiRequest(`/email-inquiries/${id}/archive`, { method: 'POST' }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function unarchiveEmail(id) {
  const response = await apiRequest(`/email-inquiries/${id}/unarchive`, { method: 'POST' }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function deleteEmailPermanently(id) {
  const response = await apiRequest(`/email-inquiries/${id}?permanent=true`, { method: 'DELETE' }, auth);
  return response.data ? normalizeEmailInquiry(response.data) : response;
}

export async function deleteEmailInquiry(id) {
  return trashEmail(id);
}

export async function setEmailFlag(id, starred) {
  const response = await apiRequest(`/email-inquiries/${id}/flag`, { method: 'PATCH', body: JSON.stringify({ starred }) }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function addEmailLabel(id, labelId) {
  const response = await apiRequest(`/email-inquiries/${id}/labels`, { method: 'POST', body: JSON.stringify({ labelId }) }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function removeEmailLabel(id, labelId) {
  const response = await apiRequest(`/email-inquiries/${id}/labels/${encodeURIComponent(labelId)}`, { method: 'DELETE' }, auth);
  return normalizeEmailInquiry(response.data || response);
}

export async function triggerZohoSync() {
  return apiRequest('/api/zoho/sync', { method: 'POST' }, auth);
}

export async function translateEmailInquiry(id) {
  const response = await apiRequest(`/email-inquiries/${id}/translate`, { method: 'POST' }, auth);
  return response.data ? normalizeEmailInquiry(response.data) : response.data;
}

export async function sendEmailResponse(emailId, responseText, attachments = []) {
  return replyToEmail(emailId, { body: responseText, attachments });
}
