const fs = require('fs');
const path = require('path');
const db = require('./db');
const mailApi = require('./zoho/mail-api');
const zohoSync = require('./zoho/sync');
const { sendEmail, replyToEmail } = require('./zoho/send');
const { saveOutgoingEmail, updateEmailStatus } = require('./zoho/db-helper');
const config = require('./zoho/config');

const READ_STATES = new Set(['unread', 'read']);
const RESPONSE_STATES = new Set(['pending', 'responded']);
const LEGACY_STATUS = new Set(['unread', 'read', 'responded']);
const MAILBOXES = new Set(['inbox', 'sent', 'drafts', 'trash', 'archive', 'spam', 'outbox', 'all']);
const FOLDER_TYPES = new Set(['inbox', 'sent', 'drafts', 'trash', 'archive', 'spam', 'outbox', 'custom']);
const FLAGS = new Set(['info', 'important', 'followup', 'flag_not_set']);

async function ensureMailClientSchema() {
  const migrationPath = path.join(__dirname, 'migrations', '005_email_mail_client_backend.sql');
  if (!fs.existsSync(migrationPath)) {
    console.warn('[Email Mail Client] Schema migration file missing');
    return;
  }

  await db.query(fs.readFileSync(migrationPath, 'utf8'));
  console.log('[Email Mail Client] Schema ensured');
}

function parsePositiveInt(value, fallback, { min = 0, max = 500 } = {}) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

function parseBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function normalizeComparableEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parseArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return String(value).split(',').map(v => v.trim()).filter(Boolean);
}

function normalizeJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function redactAttachment(attachment = {}) {
  return {
    filename: attachment.filename || attachment.name || 'attachment',
    name: attachment.name || attachment.filename || 'attachment',
    contentType: attachment.contentType || attachment.type || 'application/octet-stream',
    type: attachment.type || attachment.contentType || 'application/octet-stream',
    size: Number(attachment.size || 0),
  };
}

function redactAttachments(value) {
  return normalizeJsonArray(value).map(redactAttachment);
}

function sanitizeDraftRow(row) {
  if (!row) return null;
  return {
    ...row,
    providerMode: row.provider_draft_id ? 'provider' : 'local',
    localOnly: !row.provider_draft_id,
    attachments: redactAttachments(row.attachments),
    provider_raw: row.provider_raw ? { stored: true } : {},
  };
}

function sanitizeScheduledRow(row) {
  if (!row) return null;
  return {
    ...row,
    providerMode: row.provider_schedule_id ? 'provider' : 'local',
    localOnly: !row.provider_schedule_id,
    attachments: redactAttachments(row.attachments),
    provider_raw: row.provider_raw ? { stored: true } : {},
  };
}

function contentDispositionFilename(filename) {
  const cleaned = String(filename || 'attachment')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'attachment';
  const ascii = cleaned.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}

function unsupportedProviderFeature(feature) {
  const error = new Error(`${feature} is not safely supported by the Zoho provider integration yet`);
  error.statusCode = 400;
  error.payload = {
    error: 'unsupported_provider_operation',
    feature,
    message: error.message,
  };
  return error;
}

function buildOutgoingFallbackEmail({
  result,
  payload,
  subject,
  body,
  bodyHtml,
  fromEmail,
  fromName,
  inReplyTo = null,
  error,
}) {
  const sentAt = new Date().toISOString();
  return {
    id: null,
    messageId: result.messageId,
    source: 'zoho',
    from: fromEmail,
    fromName,
    to: Array.isArray(payload.to) ? payload.to : parseArray(payload.to),
    cc: Array.isArray(payload.cc) ? payload.cc : parseArray(payload.cc),
    bcc: Array.isArray(payload.bcc) ? payload.bcc : parseArray(payload.bcc),
    subject,
    body,
    bodyText: body,
    bodyHtml: bodyHtml || body,
    hasAttachments: Array.isArray(payload.attachments) && payload.attachments.length > 0,
    receivedAt: sentAt,
    sentAt,
    check: true,
    status: 'responded',
    readState: 'read',
    responseState: 'responded',
    folderName: 'Sent',
    folderType: 'sent',
    inReplyTo,
    isOutgoing: true,
    providerSaved: false,
    localSaveError: error?.message || 'Failed to save sent email locally',
  };
}

function deriveReadState(row) {
  if (row.read_state) return row.read_state;
  return row.status === 'unread' || row.check === false ? 'unread' : 'read';
}

function deriveResponseState(row) {
  if (row.response_state) return row.response_state;
  return row.status === 'responded' ? 'responded' : 'pending';
}

function deriveStatus(readState, responseState) {
  if (responseState === 'responded') return 'responded';
  return readState === 'read' ? 'read' : 'unread';
}

function normalizeEmailRow(row) {
  if (!row) return null;

  const readState = deriveReadState(row);
  const responseState = deriveResponseState(row);
  const status = deriveStatus(readState, responseState);
  const labels = normalizeJsonArray(row.labels);

  return {
    id: row.id,
    messageId: row.message_id,
    source: row.source,
    folderId: row.folder_id,
    folderName: row.folder_name || (row.is_outgoing ? 'Sent' : 'Inbox'),
    folderType: row.folder_type || (row.is_outgoing ? 'sent' : 'inbox'),
    from: row.from_email,
    fromName: row.from_name,
    to: row.to_email,
    cc: row.cc_emails || [],
    bcc: row.bcc_emails || [],
    subject: row.subject,
    body: row.body_text,
    bodyHtml: row.body_html,
    receivedAt: row.received_at,
    isOutgoing: Boolean(row.is_outgoing),
    readState,
    responseState,
    status,
    check: status !== 'unread',
    threadId: row.thread_id,
    inReplyTo: row.in_reply_to,
    references: row.references || [],
    threadCount: Number(row.thread_count || 1),
    latestThreadAt: row.latest_thread_at || row.received_at,
    hasAttachments: Boolean(row.has_attachments),
    starred: Boolean(row.starred),
    flagId: row.flag_id || null,
    labels,
    archivedAt: row.archived_at || null,
    trashedAt: row.trashed_at || null,
    providerDeletedAt: row.provider_deleted_at || null,
    lastProviderSyncAt: row.last_provider_sync_at || null,
    translationStatus: row.translation_status || 'not_required',
    detectedLanguage: row.detected_language || null,
    translatedSubject: row.translated_subject || null,
    translatedBody: row.translated_body_text || null,
    translationModel: row.translation_model || null,
    translationError: row.translation_error || null,
    translatedAt: row.translated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeProviderMessage(message) {
  const inquiry = mailApi.parseMessageToInquiry(message, false);
  return normalizeEmailRow({
    id: null,
    message_id: inquiry.messageId,
    source: 'zoho',
    folder_id: inquiry.folderId,
    folder_name: inquiry.folderName || message.folderName || null,
    folder_type: inquiry.folderType || normalizeFolderType({ folderName: inquiry.folderName || message.folderName }),
    from_email: inquiry.from,
    from_name: inquiry.fromName,
    to_email: inquiry.toEmail,
    cc_emails: inquiry.ccEmails || [],
    bcc_emails: inquiry.bccEmails || [],
    subject: inquiry.subject,
    body_text: inquiry.body,
    body_html: inquiry.bodyHtml,
    received_at: inquiry.receivedAt,
    is_outgoing: inquiry.isOutgoing,
    read_state: inquiry.readState,
    response_state: inquiry.responseState,
    status: inquiry.readState === 'read' ? 'read' : 'unread',
    thread_id: inquiry.threadId,
    in_reply_to: inquiry.inReplyTo,
    references: inquiry.references,
    has_attachments: inquiry.hasAttachments,
    starred: inquiry.starred,
    flag_id: inquiry.flagId,
    labels: inquiry.labels,
    provider_raw: message,
  });
}

function capabilitiesFor(email) {
  const zoho = email?.source === 'zoho' && Boolean(email.messageId);
  return {
    reply: zoho && !email.isOutgoing,
    content: zoho && Boolean(email.folderId),
    attachments: zoho && Boolean(email.folderId),
    markRead: zoho,
    move: zoho,
    trash: zoho && Boolean(email.folderId),
    archive: zoho,
    flag: zoho,
    labels: zoho,
  };
}

function assertEnum(value, allowed, name) {
  if (value !== undefined && value !== null && value !== '' && !allowed.has(value)) {
    const error = new Error(`Invalid ${name}`);
    error.statusCode = 400;
    error.payload = { error: `invalid_${name}`, allowed: [...allowed] };
    throw error;
  }
}

function readStateFromBody(body = {}) {
  if (body.readState !== undefined) return body.readState;
  if (body.read !== undefined) return body.read ? 'read' : 'unread';
  if (body.unread !== undefined) return body.unread ? 'unread' : 'read';
  return undefined;
}

function responseStateFromBody(body = {}) {
  if (body.responseState !== undefined) return body.responseState;
  if (body.responded !== undefined) return body.responded ? 'responded' : 'pending';
  if (body.pending !== undefined) return body.pending ? 'pending' : 'responded';
  return undefined;
}

function assertZohoEmail(row) {
  if (!row) {
    const error = new Error('Email inquiry not found');
    error.statusCode = 404;
    throw error;
  }
  if (row.source !== 'zoho') {
    const error = new Error('This operation is only supported for Zoho emails');
    error.statusCode = 400;
    error.payload = { error: 'unsupported_source', message: error.message };
    throw error;
  }
  if (!row.message_id) {
    const error = new Error('Provider message ID is missing');
    error.statusCode = 400;
    throw error;
  }
}

function handleError(res, error, fallback = 'Request failed') {
  console.error('[Email Mail Client]', error);
  const status = error.statusCode || 500;
  res.status(status).json(error.payload || {
    error: status === 500 ? 'internal_error' : 'bad_request',
    message: error.message || fallback,
  });
}

async function recordProviderOperation({ operationType, targetType = 'message', targetId, status, requestPayload, responsePayload, errorMessage }) {
  await db.query(`
    INSERT INTO email_provider_operations (
      operation_type, target_type, target_id, provider, status,
      request_payload, response_payload, error_message, created_at, updated_at
    ) VALUES ($1, $2, $3, 'zoho', $4, $5::jsonb, $6::jsonb, $7, NOW(), NOW());
  `, [
    operationType,
    targetType,
    String(targetId),
    status,
    JSON.stringify(requestPayload || {}),
    JSON.stringify(responsePayload || {}),
    errorMessage || null,
  ]);
}

async function callProviderWithAudit({ operationType, targetType = 'message', targetId, requestPayload }, providerCall) {
  try {
    const responsePayload = await providerCall();
    await recordProviderOperation({
      operationType,
      targetType,
      targetId,
      status: 'success',
      requestPayload,
      responsePayload,
    });
    return responsePayload;
  } catch (error) {
    await recordProviderOperation({
      operationType,
      targetType,
      targetId,
      status: 'failed',
      requestPayload,
      errorMessage: error.message,
    });
    throw error;
  }
}

function buildListWhere(query) {
  const values = [];
  const clauses = ['provider_deleted_at IS NULL'];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  const mailbox = query.mailbox || (query.includeOutgoing === 'true' ? 'all' : 'inbox');
  assertEnum(mailbox, MAILBOXES, 'mailbox');

  if (mailbox === 'inbox') {
    clauses.push(
      'is_outgoing = false',
      'trashed_at IS NULL',
      'archived_at IS NULL',
      "COALESCE(folder_type, 'inbox') NOT IN ('sent', 'trash', 'archive', 'spam')"
    );
  } else if (mailbox === 'sent') {
    clauses.push("(is_outgoing = true OR folder_type = 'sent')", 'trashed_at IS NULL');
  } else if (mailbox === 'trash') {
    clauses.push('(trashed_at IS NOT NULL OR folder_type = \'trash\')');
  } else if (mailbox === 'archive') {
    clauses.push('(archived_at IS NOT NULL OR folder_type = \'archive\')');
  } else if (mailbox !== 'all') {
    clauses.push(`folder_type = ${push(mailbox)}`);
  }

  if (mailbox === 'all' && query.direction === 'incoming') clauses.push('is_outgoing = false');
  if (mailbox === 'all' && query.direction === 'outgoing') clauses.push('is_outgoing = true');
  if (query.source) clauses.push(`source = ${push(query.source)}`);
  if (query.folderId) clauses.push(`folder_id = ${push(query.folderId)}`);
  if (query.threadId) clauses.push(`thread_id = ${push(query.threadId)}`);
  if (query.status) {
    assertEnum(query.status, LEGACY_STATUS, 'status');
    clauses.push(`status = ${push(query.status)}`);
  }
  if (query.readState) {
    assertEnum(query.readState, READ_STATES, 'read_state');
    clauses.push(`COALESCE(read_state, CASE WHEN status = 'unread' THEN 'unread' ELSE 'read' END) = ${push(query.readState)}`);
  }
  if (query.responseState) {
    assertEnum(query.responseState, RESPONSE_STATES, 'response_state');
    clauses.push(`COALESCE(response_state, CASE WHEN status = 'responded' THEN 'responded' ELSE 'pending' END) = ${push(query.responseState)}`);
  }

  const starred = parseBoolean(query.starred);
  if (starred !== undefined) clauses.push(`starred = ${push(starred)}`);

  const hasAttachments = parseBoolean(query.hasAttachments);
  if (hasAttachments !== undefined) clauses.push(`has_attachments = ${push(hasAttachments)}`);

  if (query.labelId) {
    clauses.push(`(labels @> ${push(JSON.stringify([{ labelId: query.labelId }]))}::jsonb OR labels @> ${push(JSON.stringify([{ id: query.labelId }]))}::jsonb)`);
  }
  if (query.from) clauses.push(`LOWER(COALESCE(from_email, '')) LIKE ${push(`%${String(query.from).trim().toLowerCase()}%`)}`);
  if (query.to) clauses.push(`LOWER(COALESCE(to_email, '')) LIKE ${push(`%${String(query.to).trim().toLowerCase()}%`)}`);

  if (query.search) {
    const searchValue = `%${String(query.search).trim().toLowerCase()}%`;
    clauses.push(`(
      LOWER(COALESCE(from_name, '')) LIKE ${push(searchValue)}
      OR LOWER(COALESCE(from_email, '')) LIKE ${push(searchValue)}
      OR LOWER(COALESCE(to_email, '')) LIKE ${push(searchValue)}
      OR LOWER(COALESCE(subject, '')) LIKE ${push(searchValue)}
      OR LOWER(COALESCE(body_text, '')) LIKE ${push(searchValue)}
      OR LOWER(COALESCE(body_html, '')) LIKE ${push(searchValue)}
      OR LOWER(COALESCE(translated_subject, '')) LIKE ${push(searchValue)}
      OR LOWER(COALESCE(translated_body_text, '')) LIKE ${push(searchValue)}
      OR LOWER(COALESCE(source, '')) LIKE ${push(searchValue)}
      OR LOWER(COALESCE(message_id, '')) LIKE ${push(searchValue)}
    )`);
  }

  if (query.dateFrom) clauses.push(`received_at >= ${push(query.dateFrom)}`);
  if (query.dateTo) clauses.push(`received_at < (${push(query.dateTo)}::date + INTERVAL '1 day')`);

  return { where: `WHERE ${clauses.join(' AND ')}`, values };
}

async function listEmails(query) {
  const limit = parsePositiveInt(query.limit, 50, { min: 1, max: 500 });
  const offset = parsePositiveInt(query.offset, 0, { min: 0, max: 100000 });
  const order = String(query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const sortColumn = query.sort === 'createdAt' ? 'created_at' : 'received_at';
  const { where, values } = buildListWhere(query);

  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM email_inquiries ${where}`, values);
  const total = countResult.rows[0]?.total || 0;

  const sql = `
    SELECT email_inquiries.*,
      (
        SELECT COUNT(*)::int
        FROM email_inquiries t
        WHERE t.provider_deleted_at IS NULL
          AND (
            (email_inquiries.thread_id IS NOT NULL AND t.thread_id = email_inquiries.thread_id)
            OR t.message_id = email_inquiries.in_reply_to
            OR t.in_reply_to = email_inquiries.message_id
            OR t.message_id = ANY(COALESCE(email_inquiries."references", ARRAY[]::text[]))
            OR email_inquiries.message_id = ANY(COALESCE(t."references", ARRAY[]::text[]))
          )
      ) AS thread_count,
      (
        SELECT MAX(t.received_at)
        FROM email_inquiries t
        WHERE t.provider_deleted_at IS NULL
          AND (
            (email_inquiries.thread_id IS NOT NULL AND t.thread_id = email_inquiries.thread_id)
            OR t.message_id = email_inquiries.in_reply_to
            OR t.in_reply_to = email_inquiries.message_id
            OR t.message_id = ANY(COALESCE(email_inquiries."references", ARRAY[]::text[]))
            OR email_inquiries.message_id = ANY(COALESCE(t."references", ARRAY[]::text[]))
          )
      ) AS latest_thread_at
    FROM email_inquiries
    ${where}
    ORDER BY ${sortColumn} ${order}
    LIMIT $${values.length + 1} OFFSET $${values.length + 2};
  `;
  const result = await db.query(sql, [...values, limit, offset]);
  const data = result.rows.map(normalizeEmailRow);

  return {
    data,
    count: data.length,
    total,
    limit,
    offset,
    hasMore: offset + data.length < total,
  };
}

async function getEmailRowById(id) {
  const result = await db.query('SELECT * FROM email_inquiries WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] || null;
}

async function getEmailDetail(id) {
  const row = await getEmailRowById(id);
  if (!row) return null;

  const email = normalizeEmailRow(row);
  const threadResult = await getThreadForEmail(id, { includeCurrent: true });
  return {
    ...email,
    thread: {
      count: threadResult.count,
      latestAt: threadResult.data[threadResult.data.length - 1]?.receivedAt || email.receivedAt,
    },
    content: {
      available: capabilitiesFor(email).content,
      cached: Boolean(email.body || email.bodyHtml),
    },
    attachments: {
      available: capabilitiesFor(email).attachments,
      hasAttachments: email.hasAttachments,
    },
    capabilities: capabilitiesFor(email),
  };
}

async function getThreadForEmail(id, { includeCurrent = false, order = 'asc' } = {}) {
  const sortOrder = String(order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const result = await db.query(`
    WITH current_email AS (
      SELECT * FROM email_inquiries WHERE id = $1 LIMIT 1
    )
    SELECT e.*
    FROM email_inquiries e
    CROSS JOIN current_email c
    WHERE e.provider_deleted_at IS NULL
      AND ($2::boolean = true OR e.id <> c.id)
      AND (
        e.id = c.id
        OR (c.thread_id IS NOT NULL AND e.thread_id = c.thread_id)
        OR (c.message_id IS NOT NULL AND e.in_reply_to = c.message_id)
        OR (c.in_reply_to IS NOT NULL AND e.message_id = c.in_reply_to)
        OR (c.in_reply_to IS NOT NULL AND e.in_reply_to = c.in_reply_to)
        OR (c.message_id = ANY(COALESCE(e."references", ARRAY[]::text[])))
        OR (e.message_id = ANY(COALESCE(c."references", ARRAY[]::text[])))
      )
    ORDER BY e.received_at ${sortOrder}
    LIMIT 500;
  `, [id, Boolean(includeCurrent)]);
  const data = result.rows.map(normalizeEmailRow);
  return { data, count: data.length };
}

async function getThreadById(threadId, { order = 'asc' } = {}) {
  const sortOrder = String(order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const result = await db.query(`
    SELECT * FROM email_inquiries
    WHERE provider_deleted_at IS NULL AND thread_id = $1
    ORDER BY received_at ${sortOrder}
    LIMIT 500;
  `, [threadId]);
  const data = result.rows.map(normalizeEmailRow);
  return { data, count: data.length };
}

function filterProviderSearchResults(messages, query) {
  const folderId = query.folderId ? String(query.folderId) : null;
  const dateFrom = query.dateFrom ? new Date(query.dateFrom) : null;
  const dateTo = query.dateTo ? new Date(query.dateTo) : null;
  if (dateTo && !Number.isNaN(dateTo.getTime())) dateTo.setDate(dateTo.getDate() + 1);
  const hasAttachments = parseBoolean(query.hasAttachments);
  const from = normalizeComparableEmail(query.from);
  const to = normalizeComparableEmail(query.to);
  const includeSpamTrash = parseBoolean(query.includeSpamTrash);

  return messages.filter((email) => {
    if (folderId && String(email.folderId || '') !== folderId) return false;
    if (includeSpamTrash === false && ['spam', 'trash'].includes(email.folderType)) return false;
    if (hasAttachments !== undefined && Boolean(email.hasAttachments) !== hasAttachments) return false;
    if (from && !normalizeComparableEmail(email.from).includes(from)) return false;
    if (to && !normalizeComparableEmail(email.to).includes(to)) return false;

    const receivedAt = new Date(email.receivedAt);
    if (dateFrom && !Number.isNaN(dateFrom.getTime()) && receivedAt < dateFrom) return false;
    if (dateTo && !Number.isNaN(dateTo.getTime()) && receivedAt >= dateTo) return false;
    return true;
  });
}

function normalizeFolderType(folder) {
  const name = String(folder.folderName || folder.name || '').toLowerCase();
  if (name.includes('inbox')) return 'inbox';
  if (name.includes('sent')) return 'sent';
  if (name.includes('draft')) return 'drafts';
  if (name.includes('trash') || name.includes('deleted')) return 'trash';
  if (name.includes('archive')) return 'archive';
  if (name.includes('spam') || name.includes('junk')) return 'spam';
  if (name.includes('outbox')) return 'outbox';
  return 'custom';
}

async function upsertFolders(folders) {
  for (const folder of folders) {
    const folderId = String(folder.folderId || folder.id || folder.URI || folder.folderName);
    const folderName = folder.folderName || folder.name || folder.displayName || folderId;
    const folderType = FOLDER_TYPES.has(folder.folderType) ? folder.folderType : normalizeFolderType(folder);
    await db.query(`
      INSERT INTO email_folders (
        folder_id, folder_name, folder_type, path, unread_count, total_count,
        provider_raw, last_synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW(), NOW())
      ON CONFLICT (folder_id) DO UPDATE SET
        folder_name = EXCLUDED.folder_name,
        folder_type = EXCLUDED.folder_type,
        path = EXCLUDED.path,
        unread_count = EXCLUDED.unread_count,
        total_count = EXCLUDED.total_count,
        provider_raw = EXCLUDED.provider_raw,
        last_synced_at = NOW(),
        updated_at = NOW();
    `, [
      folderId,
      folderName,
      folderType,
      folder.path || folderName,
      Number(folder.unreadCount || folder.unReadCount || 0),
      Number(folder.count || folder.totalCount || 0),
      JSON.stringify(folder),
    ]);
  }
}

async function getFolders({ refresh = false } = {}) {
  if (refresh) {
    const folders = await mailApi.fetchFolders();
    await upsertFolders(folders);
  }

  const result = await db.query(`
    SELECT * FROM email_folders
    ORDER BY
      CASE folder_type
        WHEN 'inbox' THEN 1 WHEN 'sent' THEN 2 WHEN 'drafts' THEN 3
        WHEN 'archive' THEN 4 WHEN 'trash' THEN 5 WHEN 'spam' THEN 6
        ELSE 20
      END,
      folder_name ASC;
  `);

  return result.rows.map(row => ({
    folderId: row.folder_id,
    name: row.folder_name,
    type: row.folder_type,
    path: row.path,
    unreadCount: row.unread_count || 0,
    totalCount: row.total_count || 0,
    providerRaw: row.provider_raw || {},
  }));
}

async function upsertLabels(labels) {
  for (const label of labels) {
    const labelId = String(label.labelId || label.tagId || label.id);
    const labelName = label.displayName || label.labelName || label.name || labelId;
    await db.query(`
      INSERT INTO email_labels (
        label_id, label_name, color, provider_raw, last_synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW(), NOW())
      ON CONFLICT (label_id) DO UPDATE SET
        label_name = EXCLUDED.label_name,
        color = EXCLUDED.color,
        provider_raw = EXCLUDED.provider_raw,
        last_synced_at = NOW(),
        updated_at = NOW();
    `, [labelId, labelName, label.color || null, JSON.stringify(label)]);
  }
}

async function getLabels({ refresh = false } = {}) {
  if (refresh) {
    const labels = await mailApi.fetchLabels();
    await upsertLabels(labels);
  }

  const result = await db.query('SELECT * FROM email_labels ORDER BY label_name ASC');
  return result.rows.map(row => ({
    labelId: row.label_id,
    name: row.label_name,
    color: row.color,
    providerRaw: row.provider_raw || {},
  }));
}

async function createProviderLabel(body) {
  const providerResult = await callProviderWithAudit({
    operationType: 'create_label',
    targetType: 'label',
    targetId: body.name || 'new',
    requestPayload: { name: body.name, color: body.color },
  }, () => mailApi.createLabel(body));
  const label = providerResult?.labelId ? providerResult : {
    labelId: providerResult?.tagId || body.name,
    displayName: body.name,
    color: body.color,
    providerResult,
  };
  await upsertLabels([label]);
  return label;
}

async function updateProviderLabel(labelId, body) {
  const providerResult = await callProviderWithAudit({
    operationType: 'update_label',
    targetType: 'label',
    targetId: labelId,
    requestPayload: { name: body.name, color: body.color },
  }, () => mailApi.updateLabel(labelId, body));
  const label = {
    labelId,
    displayName: body.name,
    color: body.color,
    providerResult,
  };
  await upsertLabels([label]);
  return label;
}

async function deleteProviderLabel(labelId) {
  const providerResult = await callProviderWithAudit({
    operationType: 'delete_label',
    targetType: 'label',
    targetId: labelId,
    requestPayload: { labelId },
  }, () => mailApi.deleteLabel(labelId));
  await db.query('DELETE FROM email_labels WHERE label_id = $1', [labelId]);
  await db.query(`
    UPDATE email_inquiries
    SET labels = COALESCE((
      SELECT jsonb_agg(label)
      FROM jsonb_array_elements(COALESCE(labels, '[]'::jsonb)) AS label
      WHERE COALESCE(label->>'labelId', label->>'id', '') <> $1
    ), '[]'::jsonb),
    updated_at = NOW()
    WHERE labels::text LIKE $2;
  `, [labelId, `%${labelId}%`]);
  return providerResult;
}

async function updateLocalState(id, fields) {
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    values.push(value);
    const cast = key === 'labels' || key === 'provider_raw' ? '::jsonb' : '';
    sets.push(`${key} = $${values.length}${cast}`);
  }
  values.push(id);
  const result = await db.query(`
    UPDATE email_inquiries
    SET ${sets.join(', ')}, updated_at = NOW()
    WHERE id = $${values.length}
    RETURNING *;
  `, values);
  return normalizeEmailRow(result.rows[0]);
}

async function setReadState(id, readState, { provider = true } = {}) {
  assertEnum(readState, READ_STATES, 'read_state');
  if (!readState) {
    const error = new Error('readState is required');
    error.statusCode = 400;
    error.payload = { error: 'missing_read_state', allowed: [...READ_STATES] };
    throw error;
  }
  const row = await getEmailRowById(id);
  if (!row) {
    const error = new Error('Email inquiry not found');
    error.statusCode = 404;
    throw error;
  }

  if (provider && row.source === 'zoho') {
    try {
      const providerResult = readState === 'read'
        ? await mailApi.markMessageRead(row.message_id)
        : await mailApi.markMessageUnread(row.message_id);
      await recordProviderOperation({
        operationType: readState === 'read' ? 'mark_read' : 'mark_unread',
        targetId: row.message_id,
        status: 'success',
        requestPayload: { readState },
        responsePayload: providerResult,
      });
    } catch (error) {
      await recordProviderOperation({
        operationType: readState === 'read' ? 'mark_read' : 'mark_unread',
        targetId: row.message_id,
        status: 'failed',
        requestPayload: { readState },
        errorMessage: error.message,
      });
      console.warn(
        '[Email Mail Client] Provider read-state update failed; continuing with local state update:',
        error.message
      );
    }
  }

  const responseState = deriveResponseState(row);
  const status = deriveStatus(readState, responseState);
  return updateLocalState(id, {
    read_state: readState,
    status,
    '"check"': status !== 'unread',
    last_provider_sync_at: new Date(),
  });
}

async function setResponseState(id, responseState) {
  assertEnum(responseState, RESPONSE_STATES, 'response_state');
  if (!responseState) {
    const error = new Error('responseState is required');
    error.statusCode = 400;
    error.payload = { error: 'missing_response_state', allowed: [...RESPONSE_STATES] };
    throw error;
  }
  const row = await getEmailRowById(id);
  if (!row) {
    const error = new Error('Email inquiry not found');
    error.statusCode = 404;
    throw error;
  }
  const readState = deriveReadState(row);
  const status = deriveStatus(readState, responseState);
  return updateLocalState(id, {
    response_state: responseState,
    status,
    '"check"': status !== 'unread',
  });
}

async function runProviderMutation(id, operationType, providerCall, localFields, options = {}) {
  const { localOnProviderFailure = true } = options;
  const row = await getEmailRowById(id);
  assertZohoEmail(row);

  let providerResult = null;
  let providerError = null;
  try {
    providerResult = await providerCall(row);
    await recordProviderOperation({
      operationType,
      targetId: row.message_id,
      status: 'success',
      requestPayload: { id },
      responsePayload: providerResult,
    });
  } catch (error) {
    await recordProviderOperation({
      operationType,
      targetId: row.message_id,
      status: 'failed',
      requestPayload: { id },
      errorMessage: error.message,
    });
    providerError = error;
    if (!localOnProviderFailure) {
      throw error;
    }
    console.warn(
      `[Email Mail Client] Provider ${operationType} failed; continuing with local state update:`,
      error.message
    );
  }

  const updated = await updateLocalState(id, {
    ...localFields(row),
    ...(providerError ? {} : { last_provider_sync_at: new Date() }),
  });
  return {
    data: updated,
    providerResult,
    ...(providerError ? { providerError: providerError.message, providerSynced: false } : { providerSynced: true }),
  };
}

function assertThreadZohoSupported(thread, operation) {
  const unsupported = thread.data.filter(email => email.source !== 'zoho' || !email.messageId);
  if (unsupported.length > 0) {
    const error = new Error(`Thread ${operation} is only supported when every message is Zoho-backed`);
    error.statusCode = 400;
    error.payload = {
      error: 'unsupported_thread_source',
      message: error.message,
      unsupportedIds: unsupported.map(email => email.id),
    };
    throw error;
  }
}

async function runThreadProviderMutation(threadId, operationType, providerCall, localFields) {
  const thread = await getThreadById(threadId);
  assertThreadZohoSupported(thread, operationType);

  const updated = [];
  for (const email of thread.data) {
    const result = await runProviderMutation(email.id, operationType, providerCall, localFields);
    updated.push(result.data);
  }

  return { data: updated, count: updated.length };
}

async function deleteLocalEmail(id) {
  const result = await db.query('DELETE FROM email_inquiries WHERE id = $1 RETURNING *', [id]);
  if (!result.rows[0]) {
    const error = new Error('Email inquiry not found');
    error.statusCode = 404;
    throw error;
  }
  return normalizeEmailRow(result.rows[0]);
}

async function addLabelToEmail(id, labelId) {
  const labels = await getLabels();
  const label = labels.find(item => item.labelId === String(labelId)) || { labelId: String(labelId), name: String(labelId) };
  return runProviderMutation(
    id,
    'apply_label',
    row => mailApi.applyLabel(row.message_id, labelId, { isFolderSpecific: Boolean(row.folder_id), folderId: row.folder_id || undefined }),
    row => {
      const current = normalizeJsonArray(row.labels);
      const exists = current.some(item => item.labelId === label.labelId || item.id === label.labelId);
      return { labels: exists ? JSON.stringify(current) : JSON.stringify([...current, label]) };
    }
  );
}

async function removeLabelFromEmail(id, labelId) {
  return runProviderMutation(
    id,
    'remove_label',
    row => mailApi.removeLabel(row.message_id, labelId, { isFolderSpecific: Boolean(row.folder_id), folderId: row.folder_id || undefined }),
    row => ({
      labels: JSON.stringify(normalizeJsonArray(row.labels).filter(item => item.labelId !== String(labelId) && item.id !== String(labelId))),
    })
  );
}

function normalizeOutgoingPayload(body) {
  const to = parseArray(body.to || body.toEmails);
  const cc = parseArray(body.cc || body.ccEmails);
  const bcc = parseArray(body.bcc || body.bccEmails);
  const subject = String(body.subject || '').trim();
  const text = String(body.body || body.bodyText || '').trim();
  const html = body.bodyHtml ? String(body.bodyHtml) : null;

  if (to.length === 0) {
    const error = new Error('At least one recipient is required');
    error.statusCode = 400;
    throw error;
  }
  if (!subject) {
    const error = new Error('Subject is required');
    error.statusCode = 400;
    throw error;
  }
  if (!text && !html) {
    const error = new Error('Body is required');
    error.statusCode = 400;
    throw error;
  }

  return {
    to,
    cc,
    bcc,
    subject,
    body: text || html,
    bodyHtml: html,
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
  };
}

async function sendNewEmail(body) {
  const payload = normalizeOutgoingPayload(body);
  const result = await callProviderWithAudit({
    operationType: 'send_email',
    targetType: 'message',
    targetId: `compose:${Date.now()}`,
    requestPayload: {
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      attachmentCount: payload.attachments.length,
    },
  }, () => sendEmail({
    to: payload.to.join(','),
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    body: payload.body,
    bodyHtml: payload.bodyHtml,
    attachments: payload.attachments,
  }));

  if (!result.success || !result.messageId) {
    const error = new Error('Zoho did not return a sent message ID');
    error.statusCode = 502;
    throw error;
  }

  let saved;
  let localSaveError = null;
  try {
    saved = await saveOutgoingEmail({
      messageId: result.messageId,
      inReplyTo: null,
      to: payload.to.join(','),
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      body: payload.body,
      bodyHtml: payload.bodyHtml || payload.body,
      fromEmail: config.accountEmail || 'admin@apsconsulting.kr',
      fromName: config.fromDisplayName || 'APS Admin',
      hasAttachments: payload.attachments.length > 0,
      sentAt: new Date(),
      providerRaw: result,
    });
  } catch (error) {
    localSaveError = error.message;
    console.error('[Email Mail Client] Email sent but local sent-record save failed:', error);
    saved = buildOutgoingFallbackEmail({
      result,
      payload,
      subject: payload.subject,
      body: payload.body,
      bodyHtml: payload.bodyHtml || payload.body,
      fromEmail: config.accountEmail || 'admin@apsconsulting.kr',
      fromName: config.fromDisplayName || 'APS Admin',
      error,
    });
  }

  return { providerResult: result, data: saved, localSaveError };
}

async function replyToInquiry(id, body) {
  const row = await getEmailRowById(id);
  assertZohoEmail(row);
  if (row.is_outgoing) {
    const error = new Error('Cannot reply to an outgoing email');
    error.statusCode = 400;
    throw error;
  }

  const responseBody = String(body.body || body.bodyText || body.responseText || '').trim();
  if (!responseBody) {
    const error = new Error('Reply body is required');
    error.statusCode = 400;
    throw error;
  }

  const requestedTo = parseArray(body.to || body.toEmails);
  const to = requestedTo.length > 0 ? requestedTo : parseArray(row.from_email);
  if (to.length === 0) {
    const error = new Error('Reply recipient is required');
    error.statusCode = 400;
    throw error;
  }

  const requestedSubject = String(body.subject || row.subject || '(no subject)').trim() || '(no subject)';
  const requestedCc = parseArray(body.cc || body.ccEmails);
  const ownAddresses = new Set(parseArray([config.accountEmail, config.fromEmail, row.to_email].filter(Boolean).join(',')));
  const replyAllCc = body.replyAll
    ? parseArray(row.cc_emails).filter(email => email !== row.from_email && !ownAddresses.has(email))
    : [];
  const cc = [...new Set([...requestedCc, ...replyAllCc])];
  const bcc = parseArray(body.bcc || body.bccEmails);
  const result = await callProviderWithAudit({
    operationType: 'reply_email',
    targetType: 'message',
    targetId: row.message_id,
    requestPayload: {
      to,
      cc,
      bcc,
      subject: requestedSubject,
      attachmentCount: Array.isArray(body.attachments) ? body.attachments.length : 0,
    },
  }, () => replyToEmail({
    originalMessageId: row.message_id,
    to: to.join(','),
    subject: requestedSubject,
    body: responseBody,
    bodyHtml: body.bodyHtml,
    cc,
    bcc,
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
  }));

  if (!result.success || !result.messageId) {
    const error = new Error('Zoho did not return a sent message ID');
    error.statusCode = 502;
    throw error;
  }

  const replySubject = result.subject || (requestedSubject.startsWith('Re:') ? requestedSubject : `Re: ${requestedSubject}`);
  const sentPayload = {
    to,
    cc,
    bcc,
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
  };
  let savedEmail;
  let localSaveError = null;
  try {
    savedEmail = await saveOutgoingEmail({
      messageId: result.messageId,
      inReplyTo: row.message_id,
      to: to.join(','),
      cc,
      bcc,
      subject: replySubject,
      body: responseBody,
      bodyHtml: body.bodyHtml || responseBody,
      fromEmail: config.accountEmail || 'admin@apsconsulting.kr',
      fromName: config.fromDisplayName || 'APS Admin',
      hasAttachments: Array.isArray(body.attachments) && body.attachments.length > 0,
      sentAt: new Date(),
      providerRaw: result,
    });
  } catch (error) {
    localSaveError = error.message;
    console.error('[Email Mail Client] Reply sent but local sent-record save failed:', error);
    savedEmail = buildOutgoingFallbackEmail({
      result,
      payload: sentPayload,
      subject: replySubject,
      body: responseBody,
      bodyHtml: body.bodyHtml || responseBody,
      fromEmail: config.accountEmail || 'admin@apsconsulting.kr',
      fromName: config.fromDisplayName || 'APS Admin',
      inReplyTo: row.message_id,
      error,
    });
  }

  const updatedOriginal = await updateEmailStatus(id, 'responded');
  return {
    providerResult: result,
    sentEmail: savedEmail,
    originalEmail: normalizeEmailRow(updatedOriginal),
    localSaveError,
  };
}

async function createDraftRecord(body, user) {
  const payload = normalizeOutgoingPayload(body);
  let providerResult = null;
  let providerDraftId = null;

  if (body.provider === true) {
    throw unsupportedProviderFeature('provider_draft_create_update_delete');
  }

  const result = await db.query(`
    INSERT INTO email_drafts (
      provider_draft_id, original_email_id, to_emails, cc_emails, bcc_emails,
      subject, body_text, body_html, attachments, provider_raw, created_by, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, NOW(), NOW())
    RETURNING *;
  `, [
    providerDraftId,
    body.originalEmailId || null,
    payload.to,
    payload.cc,
    payload.bcc,
    payload.subject,
    payload.body,
    payload.bodyHtml,
    JSON.stringify(payload.attachments),
    JSON.stringify(providerResult || {}),
    user?.email || null,
  ]);

  return sanitizeDraftRow(result.rows[0]);
}

async function updateDraftRecord(id, body) {
  const payload = normalizeOutgoingPayload(body);
  const result = await db.query(`
    UPDATE email_drafts
    SET to_emails = $1, cc_emails = $2, bcc_emails = $3,
        subject = $4, body_text = $5, body_html = $6,
        attachments = $7::jsonb, updated_at = NOW()
    WHERE id = $8 AND status = 'draft'
    RETURNING *;
  `, [payload.to, payload.cc, payload.bcc, payload.subject, payload.body, payload.bodyHtml, JSON.stringify(payload.attachments), id]);
  return sanitizeDraftRow(result.rows[0] || null);
}

async function sendDraftRecord(id) {
  const draftResult = await db.query('SELECT * FROM email_drafts WHERE id = $1 AND status = $2 LIMIT 1', [id, 'draft']);
  const draft = draftResult.rows[0];
  if (!draft) {
    const error = new Error('Draft not found');
    error.statusCode = 404;
    throw error;
  }
  const sent = await sendNewEmail({
    to: draft.to_emails,
    cc: draft.cc_emails,
    bcc: draft.bcc_emails,
    subject: draft.subject,
    bodyText: draft.body_text,
    bodyHtml: draft.body_html,
    attachments: normalizeJsonArray(draft.attachments),
  });
  await db.query('UPDATE email_drafts SET status = $1, updated_at = NOW() WHERE id = $2', ['sent', id]);
  return sent;
}

async function createScheduledRecord(body, user) {
  const payload = normalizeOutgoingPayload(body);
  const scheduledAt = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
    const error = new Error('scheduledAt must be a future date');
    error.statusCode = 400;
    throw error;
  }

  let providerResult = null;
  if (body.provider === true) {
    throw unsupportedProviderFeature('provider_scheduled_email_update_cancel');
  }

  const result = await db.query(`
    INSERT INTO scheduled_emails (
      provider_schedule_id, original_email_id, to_emails, cc_emails, bcc_emails,
      subject, body_text, body_html, attachments, scheduled_at, provider_raw,
      created_by, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, NOW(), NOW())
    RETURNING *;
  `, [
    providerResult?.messageId || providerResult?.scheduleId || null,
    body.originalEmailId || null,
    payload.to,
    payload.cc,
    payload.bcc,
    payload.subject,
    payload.body,
    payload.bodyHtml,
    JSON.stringify(payload.attachments),
    scheduledAt,
    JSON.stringify(providerResult || {}),
    user?.email || null,
  ]);
  return sanitizeScheduledRow(result.rows[0]);
}

async function sendScheduledNow(id) {
  const scheduledResult = await db.query('SELECT * FROM scheduled_emails WHERE id = $1 AND status = $2 LIMIT 1', [id, 'scheduled']);
  const scheduled = scheduledResult.rows[0];
  if (!scheduled) {
    const error = new Error('Scheduled email not found');
    error.statusCode = 404;
    throw error;
  }
  const sent = await sendNewEmail({
    to: scheduled.to_emails,
    cc: scheduled.cc_emails,
    bcc: scheduled.bcc_emails,
    subject: scheduled.subject,
    bodyText: scheduled.body_text,
    bodyHtml: scheduled.body_html,
    attachments: normalizeJsonArray(scheduled.attachments),
  });
  await db.query('UPDATE scheduled_emails SET status = $1, sent_email_id = $2, updated_at = NOW() WHERE id = $3', ['sent', sent.data?.id || null, id]);
  return sent;
}

async function claimDueScheduledEmail() {
  const result = await db.query(`
    UPDATE scheduled_emails
    SET status = 'processing', updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM scheduled_emails
      WHERE status = 'scheduled'
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC, id ASC
      LIMIT 1
    )
    RETURNING *;
  `);
  return result.rows[0] || null;
}

async function requeueStaleScheduledEmails({ staleMinutes = Number(process.env.EMAIL_SCHEDULER_PROCESSING_TIMEOUT_MINUTES || 15) } = {}) {
  const timeoutMinutes = Number.isFinite(staleMinutes) && staleMinutes > 0 ? staleMinutes : 15;
  const result = await db.query(`
    UPDATE scheduled_emails
    SET status = 'scheduled', updated_at = NOW()
    WHERE status = 'processing'
      AND updated_at < NOW() - ($1::int * INTERVAL '1 minute')
    RETURNING id;
  `, [timeoutMinutes]);
  if (result.rowCount > 0) {
    console.warn(`[Email Scheduler] Requeued ${result.rowCount} stale processing emails`);
  }
  return result.rowCount;
}

async function processDueScheduledEmails({ limit = 10 } = {}) {
  const sent = [];
  const failed = [];
  const requeued = await requeueStaleScheduledEmails();

  for (let i = 0; i < limit; i += 1) {
    const scheduled = await claimDueScheduledEmail();
    if (!scheduled) break;

    try {
      const result = await sendNewEmail({
        to: scheduled.to_emails,
        cc: scheduled.cc_emails,
        bcc: scheduled.bcc_emails,
        subject: scheduled.subject,
        bodyText: scheduled.body_text,
        bodyHtml: scheduled.body_html,
        attachments: normalizeJsonArray(scheduled.attachments),
      });

      await db.query(
        'UPDATE scheduled_emails SET status = $1, sent_email_id = $2, updated_at = NOW() WHERE id = $3',
        ['sent', result.data?.id || null, scheduled.id]
      );
      sent.push({ scheduledId: scheduled.id, email: result.data });
      if (global.broadcastEvent && result.data?.id) global.broadcastEvent('email:created', result.data);
    } catch (error) {
      await db.query(`
        UPDATE scheduled_emails
        SET status = 'failed',
            provider_raw = jsonb_set(COALESCE(provider_raw, '{}'::jsonb), '{lastError}', to_jsonb($1::text), true),
            updated_at = NOW()
        WHERE id = $2;
      `, [error.message || 'Scheduled email send failed', scheduled.id]);
      failed.push({ scheduledId: scheduled.id, error: error.message || 'Scheduled email send failed' });
    }
  }

  return { sent, failed, requeued, processed: sent.length + failed.length };
}

function startScheduledEmailDispatcher({ intervalMs = Number(process.env.EMAIL_SCHEDULER_INTERVAL_MS || 60000), batchSize = Number(process.env.EMAIL_SCHEDULER_BATCH_SIZE || 10) } = {}) {
  if (process.env.EMAIL_SCHEDULER_ENABLED === 'false') {
    console.log('[Email Scheduler] Disabled');
    return null;
  }

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await processDueScheduledEmails({ limit: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 10 });
      if (result.processed > 0) {
        console.log(`[Email Scheduler] Processed ${result.processed} scheduled emails`);
      }
    } catch (error) {
      console.error('[Email Scheduler] Dispatch failed:', error.message);
    } finally {
      running = false;
    }
  };

  const normalizedInterval = Number.isFinite(intervalMs) && intervalMs >= 5000 ? intervalMs : 60000;
  tick();
  return setInterval(tick, normalizedInterval);
}

async function getStats() {
  const result = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL)::int AS all_count,
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL AND is_outgoing = false AND trashed_at IS NULL AND archived_at IS NULL)::int AS inbox_count,
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL AND is_outgoing = true AND trashed_at IS NULL)::int AS sent_count,
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL AND trashed_at IS NOT NULL)::int AS trash_count,
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL AND archived_at IS NOT NULL)::int AS archive_count,
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL AND COALESCE(read_state, CASE WHEN status = 'unread' THEN 'unread' ELSE 'read' END) = 'unread')::int AS unread_count,
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL AND COALESCE(read_state, CASE WHEN status = 'unread' THEN 'unread' ELSE 'read' END) = 'read')::int AS read_count,
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL AND COALESCE(response_state, CASE WHEN status = 'responded' THEN 'responded' ELSE 'pending' END) = 'pending')::int AS pending_response_count,
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL AND COALESCE(response_state, CASE WHEN status = 'responded' THEN 'responded' ELSE 'pending' END) = 'responded')::int AS responded_count,
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL AND starred = true)::int AS starred_count,
      COUNT(*) FILTER (WHERE provider_deleted_at IS NULL AND has_attachments = true)::int AS attachments_count,
      COUNT(*) FILTER (WHERE source = 'zoho' AND provider_deleted_at IS NULL)::int AS zoho_count,
      COUNT(*) FILTER (WHERE source = 'gmail' AND provider_deleted_at IS NULL)::int AS gmail_count
    FROM email_inquiries;
  `);
  const scheduled = await db.query(`SELECT COUNT(*)::int AS count FROM scheduled_emails WHERE status = 'scheduled'`);
  const drafts = await db.query(`SELECT COUNT(*)::int AS count FROM email_drafts WHERE status = 'draft'`);
  const byFolder = await db.query(`
    SELECT folder_id AS "folderId", COALESCE(folder_name, folder_id, 'Unknown') AS name, COUNT(*)::int AS count
    FROM email_inquiries
    WHERE provider_deleted_at IS NULL
    GROUP BY folder_id, folder_name
    ORDER BY count DESC;
  `);
  const byLabel = await db.query(`
    SELECT
      COALESCE(label->>'labelId', label->>'id') AS "labelId",
      COALESCE(label->>'name', label->>'labelName', label->>'displayName', COALESCE(label->>'labelId', label->>'id')) AS name,
      COUNT(*)::int AS count
    FROM email_inquiries
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(labels, '[]'::jsonb)) AS label
    WHERE provider_deleted_at IS NULL
      AND COALESCE(label->>'labelId', label->>'id') IS NOT NULL
    GROUP BY 1, 2
    ORDER BY count DESC, name ASC;
  `);
  const stats = result.rows[0] || {};
  return {
    all: stats.all_count || 0,
    inbox: stats.inbox_count || 0,
    sent: stats.sent_count || 0,
    drafts: drafts.rows[0]?.count || 0,
    scheduled: scheduled.rows[0]?.count || 0,
    trash: stats.trash_count || 0,
    archive: stats.archive_count || 0,
    unread: stats.unread_count || 0,
    read: stats.read_count || 0,
    pendingResponse: stats.pending_response_count || 0,
    responded: stats.responded_count || 0,
    starred: stats.starred_count || 0,
    attachments: stats.attachments_count || 0,
    total: stats.inbox_count || 0,
    gmail: stats.gmail_count || 0,
    zoho: stats.zoho_count || 0,
    byFolder: byFolder.rows,
    byLabel: byLabel.rows,
  };
}

function registerRoutes(app, auth, asyncHandler) {
  app.get('/email-folders', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.json({ data: await getFolders({ refresh: req.query.refresh === 'true' }) });
  }));

  app.get('/email-labels', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.json({ data: await getLabels({ refresh: req.query.refresh === 'true' }) });
  }));

  app.post('/api/zoho/sync/folder/:folderId', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const folderResult = await db.query('SELECT folder_name FROM email_folders WHERE folder_id = $1 LIMIT 1', [req.params.folderId]);
    const folderName = folderResult.rows[0]?.folder_name || req.params.folderId;
    const result = await zohoSync.syncSingleFolder(folderName, {
      pageSize: parsePositiveInt(req.body?.pageSize, 100, { min: 1, max: 200 }),
    });
    if (global.broadcastEvent) global.broadcastEvent('email:sync-completed', result);
    res.json(result);
  }));

  app.post('/email-labels', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.status(201).json({ data: await createProviderLabel(req.body || {}) });
  }));

  app.patch('/email-labels/:labelId', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.json({ data: await updateProviderLabel(req.params.labelId, req.body || {}) });
  }));

  app.delete('/email-labels/:labelId', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.json({ data: await deleteProviderLabel(req.params.labelId) });
  }));

  app.get('/email-inquiries', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.json(await listEmails(req.query));
  }));

  app.get('/email-inquiries/stats', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.json({ data: await getStats() });
  }));

  app.get('/emails/search', auth.authenticateJWT, asyncHandler(async (req, res) => {
    if (req.query.provider === 'true') {
      const providerData = await mailApi.searchMessages(req.query.query || req.query.search || '', {
        limit: parsePositiveInt(req.query.limit, 50, { min: 1, max: 200 }),
        start: parsePositiveInt(req.query.offset, 0, { min: 0, max: 100000 }),
      });
      const data = filterProviderSearchResults(providerData.map(normalizeProviderMessage), req.query);
      return res.json({ data, count: data.length, provider: 'zoho' });
    }
    return res.json(await listEmails({ ...req.query, search: req.query.query || req.query.search, mailbox: req.query.mailbox || 'all' }));
  }));

  app.get('/email-inquiries/:id/thread', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.json(await getThreadForEmail(req.params.id, {
      includeCurrent: req.query.includeCurrent === 'true',
      order: req.query.order,
    }));
  }));

  app.get('/email-threads/:threadId/messages', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.json(await getThreadById(req.params.threadId, { order: req.query.order }));
  }));

  app.patch('/email-threads/:threadId/read-state', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const readState = readStateFromBody(req.body);
    assertEnum(readState, READ_STATES, 'read_state');
    const thread = await getThreadById(req.params.threadId);
    const updated = [];
    for (const email of thread.data) {
      updated.push(await setReadState(email.id, readState, { provider: req.body.provider !== false }));
    }
    if (global.broadcastEvent) updated.forEach(email => global.broadcastEvent('email:updated', email));
    res.json({ data: updated, count: updated.length });
  }));

  app.patch('/email-threads/:threadId/response-state', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const responseState = responseStateFromBody(req.body);
    assertEnum(responseState, RESPONSE_STATES, 'response_state');
    const thread = await getThreadById(req.params.threadId);
    const updated = [];
    for (const email of thread.data) {
      updated.push(await setResponseState(email.id, responseState));
    }
    if (global.broadcastEvent) updated.forEach(email => global.broadcastEvent('email:updated', email));
    res.json({ data: updated, count: updated.length });
  }));

  app.post('/email-threads/:threadId/move', auth.authenticateJWT, asyncHandler(async (req, res) => {
    if (!req.body.folderId) return res.status(400).json({ error: 'missing_folder_id' });
    const result = await runThreadProviderMutation(
      req.params.threadId,
      'move',
      row => mailApi.moveMessage(row.message_id, req.body.folderId),
      () => ({
        folder_id: req.body.folderId,
        folder_name: req.body.folderName || null,
        folder_type: req.body.folderType || 'custom',
        trashed_at: null,
        archived_at: null,
      })
    );
    if (global.broadcastEvent) result.data.forEach(email => global.broadcastEvent('email:updated', email));
    res.json(result);
  }));

  app.post('/email-threads/:threadId/trash', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await runThreadProviderMutation(
      req.params.threadId,
      'trash',
      row => mailApi.trashMessage(row.message_id, row.folder_id),
      () => ({ trashed_at: new Date(), folder_type: 'trash' })
    );
    if (global.broadcastEvent) result.data.forEach(email => global.broadcastEvent('email:updated', email));
    res.json(result);
  }));

  app.post('/email-threads/:threadId/archive', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await runThreadProviderMutation(
      req.params.threadId,
      'archive',
      row => mailApi.archiveMessage(row.message_id),
      () => ({ archived_at: new Date(), folder_type: 'archive' })
    );
    if (global.broadcastEvent) result.data.forEach(email => global.broadcastEvent('email:updated', email));
    res.json(result);
  }));

  app.post('/email-threads/:threadId/unarchive', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await runThreadProviderMutation(
      req.params.threadId,
      'unarchive',
      row => mailApi.unarchiveMessage(row.message_id),
      row => ({ archived_at: null, folder_type: row.is_outgoing ? 'sent' : 'inbox' })
    );
    if (global.broadcastEvent) result.data.forEach(email => global.broadcastEvent('email:updated', email));
    res.json(result);
  }));

  async function handleThreadFlag(req, res) {
    const flagId = req.body.flagId || req.body.flag || (req.body.starred ? 'important' : 'flag_not_set');
    assertEnum(flagId, FLAGS, 'flag_id');
    const result = await runThreadProviderMutation(
      req.params.threadId,
      'flag',
      row => mailApi.flagMessage(row.message_id, flagId, { isFolderSpecific: Boolean(row.folder_id), folderId: row.folder_id || undefined }),
      () => ({ flag_id: flagId, starred: flagId !== 'flag_not_set' })
    );
    if (global.broadcastEvent) result.data.forEach(email => global.broadcastEvent('email:updated', email));
    res.json(result);
  }

  app.patch('/email-threads/:threadId/flag', auth.authenticateJWT, asyncHandler(handleThreadFlag));
  app.post('/email-threads/:threadId/flag', auth.authenticateJWT, asyncHandler(handleThreadFlag));

  app.post('/email-threads/:threadId/labels', auth.authenticateJWT, asyncHandler(async (req, res) => {
    if (!req.body.labelId) return res.status(400).json({ error: 'missing_label_id' });
    const labels = await getLabels();
    const label = labels.find(item => item.labelId === String(req.body.labelId)) || { labelId: String(req.body.labelId), name: String(req.body.labelId) };
    const result = await runThreadProviderMutation(
      req.params.threadId,
      'apply_label',
      row => mailApi.applyLabel(row.message_id, req.body.labelId, { isFolderSpecific: Boolean(row.folder_id), folderId: row.folder_id || undefined }),
      row => {
        const current = normalizeJsonArray(row.labels);
        const exists = current.some(item => item.labelId === label.labelId || item.id === label.labelId);
        return { labels: exists ? JSON.stringify(current) : JSON.stringify([...current, label]) };
      }
    );
    if (global.broadcastEvent) result.data.forEach(email => global.broadcastEvent('email:updated', email));
    res.json(result);
  }));

  app.delete('/email-threads/:threadId/labels/:labelId', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const labelId = String(req.params.labelId);
    const result = await runThreadProviderMutation(
      req.params.threadId,
      'remove_label',
      row => mailApi.removeLabel(row.message_id, labelId, { isFolderSpecific: Boolean(row.folder_id), folderId: row.folder_id || undefined }),
      row => ({
        labels: JSON.stringify(normalizeJsonArray(row.labels).filter(item => item.labelId !== labelId && item.id !== labelId)),
      })
    );
    if (global.broadcastEvent) result.data.forEach(email => global.broadcastEvent('email:updated', email));
    res.json(result);
  }));

  app.get('/email-inquiries/:id/raw', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const row = await getEmailRowById(req.params.id);
    assertZohoEmail(row);
    res.json({ data: await mailApi.fetchOriginalMessage(row.message_id) });
  }));

  app.patch('/email-inquiries/:id/read-state', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const data = await setReadState(req.params.id, readStateFromBody(req.body), { provider: req.body.provider !== false });
    if (global.broadcastEvent) global.broadcastEvent('email:updated', data);
    res.json({ data });
  }));

  app.patch('/email-inquiries/:id/response-state', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const data = await setResponseState(req.params.id, responseStateFromBody(req.body));
    if (global.broadcastEvent) global.broadcastEvent('email:updated', data);
    res.json({ data });
  }));

  app.get('/email-inquiries/:id/inline/:contentId', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const row = await getEmailRowById(req.params.id);
    assertZohoEmail(row);
    if (!row.folder_id) return res.status(400).json({ error: 'missing_folder_id' });
    const response = await mailApi.downloadInlineImage(row.message_id, row.folder_id, req.params.contentId);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    response.data.pipe(res);
  }));

  app.get('/email-inquiries/:id/content', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const row = await getEmailRowById(req.params.id);
    assertZohoEmail(row);
    if (!row.folder_id) {
      return res.status(400).json({
        content: null,
        contentType: null,
        unavailableReason: 'missing_folder_id',
      });
    }
    const content = await mailApi.fetchMessageContent(row.message_id, row.folder_id);
    const contentValue = typeof content === 'object' && content !== null ? (content.content || content.html || content.text || '') : content;
    res.json({
      content: contentValue,
      contentType: /<[^>]+>/.test(String(contentValue || '')) ? 'html' : 'text',
      unavailableReason: null,
    });
  }));

  app.get('/email-inquiries/:id/attachments', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const row = await getEmailRowById(req.params.id);
    assertZohoEmail(row);
    if (!row.folder_id) return res.status(400).json({ error: 'missing_folder_id', attachments: [] });
    const attachments = await mailApi.fetchAttachmentInfo(row.message_id, row.folder_id);
    res.json({ attachments, count: attachments.length });
  }));

  app.get('/email-inquiries/:id/attachments/:attachmentId/download', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const row = await getEmailRowById(req.params.id);
    assertZohoEmail(row);
    if (!row.folder_id) return res.status(400).json({ error: 'missing_folder_id' });
    const attachments = await mailApi.fetchAttachmentInfo(row.message_id, row.folder_id);
    const attachment = attachments.find(item => String(item.attachmentId || item.id || item.storeName || item.attachmentName) === String(req.params.attachmentId));
    const filename = attachment?.attachmentName || attachment?.fileName || attachment?.name || attachment?.filename || req.params.attachmentId;
    const response = await mailApi.downloadAttachment(row.message_id, row.folder_id, req.params.attachmentId);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDispositionFilename(filename));
    response.data.pipe(res);
  }));

  app.get('/email-inquiries/:id', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const data = await getEmailDetail(req.params.id);
    if (!data) return res.status(404).json({ error: 'not_found' });
    res.json({ data });
  }));

  app.patch('/email-inquiries/:id', auth.authenticateJWT, asyncHandler(async (req, res) => {
    let data;
    const readState = readStateFromBody(req.body);
    const responseState = responseStateFromBody(req.body);
    if (readState !== undefined) {
      data = await setReadState(req.params.id, readState, { provider: req.body.provider !== false });
    } else if (responseState !== undefined) {
      data = await setResponseState(req.params.id, responseState);
    } else if (req.body.status !== undefined) {
      const readState = req.body.status === 'unread' ? 'unread' : 'read';
      const responseState = req.body.status === 'responded' ? 'responded' : 'pending';
      data = await setReadState(req.params.id, readState, { provider: req.body.provider !== false });
      data = await setResponseState(req.params.id, responseState);
    } else if (req.body.check !== undefined) {
      data = await setReadState(req.params.id, req.body.check ? 'read' : 'unread', { provider: req.body.provider !== false });
    } else {
      return res.status(400).json({ error: 'no_valid_fields' });
    }
    if (global.broadcastEvent) global.broadcastEvent('email:updated', data);
    res.json({ data });
  }));

  app.post('/emails', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await sendNewEmail(req.body || {});
    if (global.broadcastEvent && result.data?.id) global.broadcastEvent('email:created', result.data);
    res.status(201).json(result);
  }));

  app.post('/email-inquiries/:id/reply', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await replyToInquiry(req.params.id, req.body || {});
    if (global.broadcastEvent) {
      if (result.sentEmail?.id) global.broadcastEvent('email:created', result.sentEmail);
      if (result.originalEmail) global.broadcastEvent('email:updated', result.originalEmail);
    }
    res.json(result);
  }));

  app.post('/email-drafts', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.status(201).json({ data: await createDraftRecord(req.body || {}, req.user) });
  }));

  app.get('/email-drafts', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await db.query('SELECT * FROM email_drafts WHERE status = $1 ORDER BY updated_at DESC LIMIT 500', ['draft']);
    const data = result.rows.map(sanitizeDraftRow);
    res.json({ data, count: data.length });
  }));

  app.patch('/email-drafts/:id', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const data = await updateDraftRecord(req.params.id, req.body || {});
    if (!data) return res.status(404).json({ error: 'not_found' });
    res.json({ data });
  }));

  app.delete('/email-drafts/:id', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await db.query('UPDATE email_drafts SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', ['deleted', req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ data: sanitizeDraftRow(result.rows[0]) });
  }));

  app.post('/email-drafts/:id/send', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await sendDraftRecord(req.params.id);
    if (global.broadcastEvent && result.data?.id) global.broadcastEvent('email:created', result.data);
    res.json(result);
  }));

  app.post('/scheduled-emails', auth.authenticateJWT, asyncHandler(async (req, res) => {
    res.status(201).json({ data: await createScheduledRecord(req.body || {}, req.user) });
  }));

  app.get('/scheduled-emails', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await db.query('SELECT * FROM scheduled_emails WHERE status = $1 ORDER BY scheduled_at ASC LIMIT 500', ['scheduled']);
    const data = result.rows.map(sanitizeScheduledRow);
    res.json({ data, count: data.length });
  }));

  app.patch('/scheduled-emails/:id', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const scheduledAt = new Date(req.body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
      return res.status(400).json({ error: 'invalid_scheduled_at' });
    }
    const result = await db.query('UPDATE scheduled_emails SET scheduled_at = $1, updated_at = NOW() WHERE id = $2 AND status = $3 RETURNING *', [scheduledAt, req.params.id, 'scheduled']);
    if (!result.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ data: sanitizeScheduledRow(result.rows[0]) });
  }));

  app.delete('/scheduled-emails/:id', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await db.query('UPDATE scheduled_emails SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', ['cancelled', req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ data: sanitizeScheduledRow(result.rows[0]) });
  }));

  app.post('/scheduled-emails/:id/send-now', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await sendScheduledNow(req.params.id);
    if (global.broadcastEvent && result.data?.id) global.broadcastEvent('email:created', result.data);
    res.json(result);
  }));

  app.post('/email-inquiries/:id/move', auth.authenticateJWT, asyncHandler(async (req, res) => {
    if (!req.body.folderId) return res.status(400).json({ error: 'missing_folder_id' });
    const result = await runProviderMutation(
      req.params.id,
      'move',
      row => mailApi.moveMessage(row.message_id, req.body.folderId),
      () => ({ folder_id: req.body.folderId, folder_name: req.body.folderName || null, folder_type: req.body.folderType || 'custom', trashed_at: null, archived_at: null })
    );
    if (global.broadcastEvent) global.broadcastEvent('email:updated', result.data);
    res.json(result);
  }));

  app.post('/email-inquiries/:id/trash', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await runProviderMutation(req.params.id, 'trash', row => mailApi.trashMessage(row.message_id, row.folder_id), () => ({ trashed_at: new Date(), folder_type: 'trash' }));
    if (global.broadcastEvent) global.broadcastEvent('email:updated', result.data);
    res.json(result);
  }));

  app.post('/email-inquiries/:id/restore', auth.authenticateJWT, asyncHandler(async (req, res) => {
    if (!req.body.folderId) return res.status(400).json({ error: 'missing_folder_id' });
    const result = await runProviderMutation(req.params.id, 'restore', row => mailApi.restoreMessage(row.message_id, req.body.folderId), () => ({ folder_id: req.body.folderId, folder_type: req.body.folderType || 'inbox', trashed_at: null }));
    if (global.broadcastEvent) global.broadcastEvent('email:updated', result.data);
    res.json(result);
  }));

  app.delete('/email-inquiries/:id', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const row = await getEmailRowById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    if (row.source !== 'zoho') {
      const deleted = await deleteLocalEmail(req.params.id);
      if (global.broadcastEvent) global.broadcastEvent('email:deleted', { id: Number(req.params.id) });
      return res.json({ data: deleted, localOnly: true });
    }

    if (req.query.permanent === 'true') {
      const result = await runProviderMutation(
        req.params.id,
        'delete',
        providerRow => mailApi.deleteMessage(providerRow.message_id, providerRow.folder_id),
        () => ({ provider_deleted_at: new Date() }),
        { localOnProviderFailure: false }
      );
      if (global.broadcastEvent) global.broadcastEvent('email:deleted', { id: Number(req.params.id) });
      return res.json(result);
    }

    const result = await runProviderMutation(req.params.id, 'trash', providerRow => mailApi.trashMessage(providerRow.message_id, providerRow.folder_id), () => ({ trashed_at: new Date(), folder_type: 'trash' }));
    if (global.broadcastEvent) global.broadcastEvent('email:updated', result.data);
    res.json(result);
  }));

  app.post('/email-inquiries/:id/archive', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await runProviderMutation(req.params.id, 'archive', row => mailApi.archiveMessage(row.message_id), () => ({ archived_at: new Date(), folder_type: 'archive' }));
    if (global.broadcastEvent) global.broadcastEvent('email:updated', result.data);
    res.json(result);
  }));

  app.post('/email-inquiries/:id/unarchive', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await runProviderMutation(req.params.id, 'unarchive', row => mailApi.unarchiveMessage(row.message_id), row => ({ archived_at: null, folder_type: row.is_outgoing ? 'sent' : 'inbox' }));
    if (global.broadcastEvent) global.broadcastEvent('email:updated', result.data);
    res.json(result);
  }));

  async function handleEmailFlag(req, res) {
    const flagId = req.body.flagId || req.body.flag || (req.body.starred ? 'important' : 'flag_not_set');
    assertEnum(flagId, FLAGS, 'flag_id');
    const result = await runProviderMutation(req.params.id, 'flag', row => mailApi.flagMessage(row.message_id, flagId, { isFolderSpecific: Boolean(row.folder_id), folderId: row.folder_id || undefined }), () => ({ flag_id: flagId, starred: flagId !== 'flag_not_set' }));
    if (global.broadcastEvent) global.broadcastEvent('email:updated', result.data);
    res.json(result);
  }

  app.patch('/email-inquiries/:id/flag', auth.authenticateJWT, asyncHandler(handleEmailFlag));
  app.post('/email-inquiries/:id/flag', auth.authenticateJWT, asyncHandler(handleEmailFlag));

  app.post('/email-inquiries/:id/labels', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await addLabelToEmail(req.params.id, req.body.labelId);
    if (global.broadcastEvent) global.broadcastEvent('email:updated', result.data);
    res.json(result);
  }));

  app.delete('/email-inquiries/:id/labels/:labelId', auth.authenticateJWT, asyncHandler(async (req, res) => {
    const result = await removeLabelFromEmail(req.params.id, req.params.labelId);
    if (global.broadcastEvent) global.broadcastEvent('email:updated', result.data);
    res.json(result);
  }));
}

module.exports = {
  ensureMailClientSchema,
  normalizeEmailRow,
  getEmailDetail,
  listEmails,
  getStats,
  processDueScheduledEmails,
  startScheduledEmailDispatcher,
  registerRoutes,
  handleError,
};
