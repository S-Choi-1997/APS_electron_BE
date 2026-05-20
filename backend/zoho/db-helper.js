/**
 * ZOHO Mail Integration - Database Helper
 *
 * Handles database operations for ZOHO Mail data
 */

const { query } = require('../db');
const { scheduleEmailTranslation } = require('../email-translation-service');

/**
 * Save OAuth tokens to database
 */
async function saveOAuthTokens(tokenData) {
  try {
    const {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType = 'Bearer',
      zohoEmail,
      zohoUserId
    } = tokenData;

    // Calculate expires_at timestamp (expiresIn is in seconds)
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Upsert tokens into zoho_oauth_tokens table
    const sql = `
      INSERT INTO zoho_oauth_tokens (
        access_token,
        refresh_token,
        token_type,
        expires_at,
        zoho_email,
        zoho_user_id,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (zoho_email)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_type = EXCLUDED.token_type,
        expires_at = EXCLUDED.expires_at,
        zoho_user_id = EXCLUDED.zoho_user_id,
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [accessToken, refreshToken, tokenType, expiresAt, zohoEmail, zohoUserId];
    const result = await query(sql, values);

    console.log('[ZOHO DB] OAuth tokens saved for:', zohoEmail);
    return result.rows[0];
  } catch (error) {
    console.error('[ZOHO DB] Error saving OAuth tokens:', error);
    throw error;
  }
}

/**
 * Get OAuth tokens from database
 */
async function getOAuthTokens(zohoEmail) {
  try {
    const sql = `
      SELECT * FROM zoho_oauth_tokens
      WHERE zoho_email = $1
      LIMIT 1;
    `;

    const result = await query(sql, [zohoEmail]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('[ZOHO DB] Error getting OAuth tokens:', error);
    throw error;
  }
}

/**
 * Update OAuth tokens in database
 */
async function updateOAuthTokens(zohoEmail, updates) {
  try {
    const { accessToken, refreshToken, expiresIn } = updates;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    const sql = `
      UPDATE zoho_oauth_tokens
      SET
        access_token = $1,
        refresh_token = COALESCE($2, refresh_token),
        expires_at = $3,
        updated_at = NOW()
      WHERE zoho_email = $4
      RETURNING *;
    `;

    const result = await query(sql, [accessToken, refreshToken, expiresAt, zohoEmail]);

    if (result.rows.length === 0) {
      throw new Error('Token not found for email: ' + zohoEmail);
    }

    console.log('[ZOHO DB] OAuth tokens updated for:', zohoEmail);
    return result.rows[0];
  } catch (error) {
    console.error('[ZOHO DB] Error updating OAuth tokens:', error);
    throw error;
  }
}

/**
 * Save email inquiry from ZOHO Mail to database
 */
async function saveEmailInquiry(inquiryData) {
  try {
    const {
      messageId,
      folderId,
      from,
      fromName,
      subject,
      body,
      bodyHtml,
      receivedAt,
      toEmail,
      ccEmails = [],
      hasAttachments = false,
      isOutgoing = false,
      inReplyTo = null,
      references = [],
      threadId = null,
      folderName = null,
      folderType = null,
      readState = null,
      responseState = null,
      flagId = null,
      starred = false,
      labels = [],
      providerRaw = null
    } = inquiryData;

    let resolvedThreadId = threadId || messageId;
    let resolvedReferences = Array.isArray(references) ? references.filter(Boolean) : [];

    if (inReplyTo) {
      const originalSql = `
        SELECT thread_id, "references", message_id
        FROM email_inquiries
        WHERE message_id = $1
        LIMIT 1;
      `;
      const originalResult = await query(originalSql, [inReplyTo]);

      if (originalResult.rows.length > 0) {
        const original = originalResult.rows[0];
        resolvedThreadId = original.thread_id || original.message_id;
        const originalReferences = Array.isArray(original.references) ? original.references : [];
        resolvedReferences = [...new Set([...originalReferences, inReplyTo, ...resolvedReferences])];
      } else {
        resolvedThreadId = threadId || inReplyTo;
        resolvedReferences = [...new Set([inReplyTo, ...resolvedReferences])];
      }
    }

    // Insert into email_inquiries table with source='zoho'
    // Use ON CONFLICT to skip duplicates based on messageId
    const sql = `
      INSERT INTO email_inquiries (
        message_id,
        folder_id,
        source,
        from_email,
        from_name,
        to_email,
        cc_emails,
        subject,
        body_text,
        body_html,
        has_attachments,
        is_outgoing,
        in_reply_to,
        "references",
        thread_id,
        received_at,
        "check",
        status,
        folder_name,
        folder_type,
        read_state,
        response_state,
        flag_id,
        starred,
        labels,
        provider_raw,
        last_provider_sync_at,
        created_at,
        updated_at
      ) VALUES ($1, $2, 'zoho', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb, $25::jsonb, NOW(), NOW(), NOW())
      ON CONFLICT (message_id) DO UPDATE SET
        folder_id = COALESCE(EXCLUDED.folder_id, email_inquiries.folder_id),
        folder_name = COALESCE(EXCLUDED.folder_name, email_inquiries.folder_name),
        folder_type = COALESCE(EXCLUDED.folder_type, email_inquiries.folder_type),
        read_state = COALESCE(EXCLUDED.read_state, email_inquiries.read_state),
        response_state = COALESCE(email_inquiries.response_state, EXCLUDED.response_state),
        flag_id = COALESCE(EXCLUDED.flag_id, email_inquiries.flag_id),
        starred = EXCLUDED.starred,
        labels = COALESCE(EXCLUDED.labels, email_inquiries.labels, '[]'::jsonb),
        provider_raw = COALESCE(EXCLUDED.provider_raw, email_inquiries.provider_raw, '{}'::jsonb),
        last_provider_sync_at = NOW(),
        in_reply_to = COALESCE(email_inquiries.in_reply_to, EXCLUDED.in_reply_to),
        "references" = CASE
          WHEN email_inquiries."references" IS NULL OR array_length(email_inquiries."references", 1) IS NULL
          THEN EXCLUDED."references"
          ELSE email_inquiries."references"
        END,
        thread_id = COALESCE(email_inquiries.thread_id, EXCLUDED.thread_id),
        updated_at = NOW()
      RETURNING *, (xmax = 0) AS inserted;
    `;

    const values = [
      messageId,
      folderId,
      from,
      fromName || from,
      toEmail,
      ccEmails,
      subject,
      body,
      bodyHtml || body,
      hasAttachments,
      isOutgoing,
      inReplyTo,
      resolvedReferences,
      resolvedThreadId,
      receivedAt,
      isOutgoing, // check
      isOutgoing ? 'responded' : 'unread', // status: outgoing emails are already "responded"
      folderName || (isOutgoing ? 'Sent' : 'Inbox'),
      folderType || (isOutgoing ? 'sent' : 'inbox'),
      readState || (isOutgoing ? 'read' : 'unread'),
      responseState || (isOutgoing ? 'responded' : 'pending'),
      flagId,
      Boolean(starred),
      JSON.stringify(labels || []),
      JSON.stringify(providerRaw || inquiryData)
    ];

    const result = await query(sql, values);

    if (result.rows.length > 0) {
      scheduleEmailTranslation(result.rows[0].id);
    }

    if (result.rows.length > 0 && result.rows[0].inserted) {
      console.log('[ZOHO DB] Email inquiry saved:', messageId);
      return result.rows[0];
    } else if (result.rows.length > 0) {
      console.log('[ZOHO DB] Email inquiry already exists; metadata backfilled if missing:', messageId);
      return null;
    } else {
      console.log('[ZOHO DB] Email inquiry already exists (skipped):', messageId);
      return null;
    }
  } catch (error) {
    console.error('[ZOHO DB] Error saving email inquiry:', error);
    throw error;
  }
}

/**
 * Get email inquiries by source
 */
async function getEmailInquiriesBySource(source = 'zoho', options = {}) {
  try {
    const { limit = 50, offset = 0, orderBy = 'received_at DESC', checkStatus } = options;

    let sql = `
      SELECT * FROM email_inquiries
      WHERE source = $1
    `;

    const values = [source];

    // Add check status filter if provided
    if (checkStatus !== undefined) {
      sql += ` AND "check" = $${values.length + 1}`;
      values.push(checkStatus);
    }

    sql += ` ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2};`;
    values.push(limit, offset);

    const result = await query(sql, values);
    return result.rows;
  } catch (error) {
    console.error('[ZOHO DB] Error getting email inquiries:', error);
    throw error;
  }
}

/**
 * Get email inquiry statistics
 */
async function getEmailStats() {
  try {
    const sql = `
      SELECT
        COUNT(*) FILTER (WHERE source = 'zoho') as zoho_count,
        COUNT(*) FILTER (WHERE source = 'gmail') as gmail_count,
        COUNT(*) FILTER (WHERE "check" = false) as unread_count,
        COUNT(*) as total_count
      FROM email_inquiries;
    `;

    const result = await query(sql);
    const stats = result.rows[0];

    return {
      total: parseInt(stats.total_count) || 0,
      unread: parseInt(stats.unread_count) || 0,
      gmail: parseInt(stats.gmail_count) || 0,
      zoho: parseInt(stats.zoho_count) || 0
    };
  } catch (error) {
    console.error('[ZOHO DB] Error getting email stats:', error);
    throw error;
  }
}

/**
 * Save outgoing email (response) to database
 * @param {Object} emailData - Outgoing email data
 * @param {string} emailData.messageId - ZOHO message ID of the sent email
 * @param {string} emailData.inReplyTo - Original message ID this email is replying to
 * @param {string} emailData.to - Recipient email address
 * @param {Array<string>} [emailData.cc] - CC email addresses
 * @param {Array<string>} [emailData.bcc] - BCC email addresses
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.body - Email body (plain text)
 * @param {string} [emailData.bodyHtml] - Email body (HTML)
 * @param {string} emailData.fromEmail - Sender email (our email)
 * @param {string} [emailData.fromName] - Sender name
 * @param {boolean} [emailData.hasAttachments] - Whether the sent email included attachments
 * @param {Date} emailData.sentAt - Sent timestamp
 * @returns {Promise<Object>} Saved email record
 */
async function saveOutgoingEmail(emailData) {
  try {
    const {
      messageId,
      inReplyTo,
      to,
      cc = [],
      bcc = [],
      subject,
      body,
      bodyHtml,
      fromEmail,
      fromName,
      hasAttachments = false,
      sentAt
    } = emailData;

    console.log('[ZOHO DB] Saving outgoing email:', messageId);

    // Get thread_id and references from the original email
    let threadId = inReplyTo; // Default: use inReplyTo as thread_id
    let references = inReplyTo ? [inReplyTo] : [];

    if (inReplyTo) {
      // Query original email to get its thread_id and references
      const originalSql = `
        SELECT thread_id, "references", message_id
        FROM email_inquiries
        WHERE message_id = $1;
      `;
      const originalResult = await query(originalSql, [inReplyTo]);

      if (originalResult.rows.length > 0) {
        const original = originalResult.rows[0];
        // Use original's thread_id if it exists, otherwise use original's message_id
        threadId = original.thread_id || original.message_id;

        // Build references chain (safe NULL handling)
        if (Array.isArray(original.references) && original.references.length > 0) {
          references = [...original.references, inReplyTo];
        } else {
          // If no previous references, start chain with inReplyTo
          references = [inReplyTo];
        }
      }
    }

    const sql = `
      INSERT INTO email_inquiries (
        message_id,
        source,
        from_email,
        from_name,
        to_email,
        cc_emails,
        bcc_emails,
        subject,
        body_text,
        body_html,
        has_attachments,
        in_reply_to,
        "references",
        thread_id,
        is_outgoing,
        status,
        "check",
        folder_name,
        folder_type,
        read_state,
        response_state,
        labels,
        provider_raw,
        last_provider_sync_at,
        received_at,
        created_at,
        updated_at
      ) VALUES ($1, 'zoho', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, 'responded', true, 'Sent', 'sent', 'read', 'responded', '[]'::jsonb, $14::jsonb, NOW(), $15, NOW(), NOW())
      RETURNING *;
    `;

    const values = [
      messageId,
      fromEmail,
      fromName || 'APS Admin',
      to,
      Array.isArray(cc) ? cc : [],
      Array.isArray(bcc) ? bcc : [],
      subject,
      body,
      bodyHtml || body,
      Boolean(hasAttachments),
      inReplyTo,
      references,
      threadId,
      JSON.stringify(emailData.providerRaw || {}),
      sentAt || new Date()
    ];

    const result = await query(sql, values);

    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log('[ZOHO DB] Outgoing email saved successfully:', messageId);

      // Map DB column names to frontend-friendly names (consistent with GET endpoint)
      const mappedEmail = {
        id: row.id,
        messageId: row.message_id,
        source: row.source,
        from: row.from_email,
        fromName: row.from_name,
        to: row.to_email,
        cc: row.cc_emails,
        bcc: row.bcc_emails,
        subject: row.subject,
        body: row.body_text,
        bodyHtml: row.body_html,
        hasAttachments: row.has_attachments,
        receivedAt: row.received_at,
        check: row.check,
        status: row.status || (row.check ? 'read' : 'unread'),
        inReplyTo: row.in_reply_to,
        references: row.references,
        threadId: row.thread_id,
        isOutgoing: row.is_outgoing || false,
        translationStatus: row.translation_status || 'not_required',
        detectedLanguage: row.detected_language || null,
        translatedSubject: row.translated_subject || null,
        translatedBody: row.translated_body_text || null,
        translationModel: row.translation_model || null,
        translationError: row.translation_error || null,
        translatedAt: row.translated_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      return mappedEmail;
    }

    return null;
  } catch (error) {
    console.error('[ZOHO DB] Error saving outgoing email:', error);
    throw error;
  }
}

/**
 * Update email inquiry status
 * @param {number} emailId - Email inquiry ID
 * @param {string} status - New status ('unread', 'read', 'responded')
 * @returns {Promise<Object>} Updated email record
 */
async function updateEmailStatus(emailId, status) {
  try {
    console.log(`[ZOHO DB] Updating email ID=${emailId} status to: ${status}`);

    const sql = `
      UPDATE email_inquiries
      SET status = $1,
          "check" = $2,
          read_state = $3,
          response_state = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING *;
    `;

    // Sync check field with status for backward compatibility
    const checkValue = (status === 'read' || status === 'responded');

    const readState = status === 'unread' ? 'unread' : 'read';
    const responseState = status === 'responded' ? 'responded' : 'pending';

    const result = await query(sql, [status, checkValue, readState, responseState, emailId]);

    if (result.rows.length === 0) {
      console.log(`[ZOHO DB] ERROR: Email ID ${emailId} not found!`);
      throw new Error(`Email inquiry ${emailId} not found`);
    }

    console.log(`[ZOHO DB] Email ID ${emailId} status updated to '${status}' successfully`);
    return result.rows[0];
  } catch (error) {
    console.error('[ZOHO DB] Error updating email status:', error);
    throw error;
  }
}

/**
 * Update email inquiry status by message ID (for webhook handling)
 * Used when a reply is detected via webhook to mark the original email as responded
 * @param {string} messageId - Original message ID
 * @param {string} status - New status ('responded')
 * @returns {Promise<Object|null>} Updated email record or null if not found
 */
async function updateEmailStatusByMessageId(messageId, status) {
  try {
    console.log(`[ZOHO DB] Updating email with messageId ${messageId} status to: ${status}`);

    const sql = `
      UPDATE email_inquiries
      SET status = $1,
          "check" = $2,
          read_state = $3,
          response_state = $4,
          updated_at = NOW()
      WHERE message_id = $5 AND is_outgoing = false
      RETURNING *;
    `;

    // Sync check field with status for backward compatibility
    const checkValue = (status === 'read' || status === 'responded');

    const readState = status === 'unread' ? 'unread' : 'read';
    const responseState = status === 'responded' ? 'responded' : 'pending';

    const result = await query(sql, [status, checkValue, readState, responseState, messageId]);

    if (result.rows.length === 0) {
      console.log(`[ZOHO DB] No email found with messageId: ${messageId}`);
      return null;
    }

    console.log(`[ZOHO DB] Email status updated successfully by messageId`);
    return result.rows[0];
  } catch (error) {
    console.error('[ZOHO DB] Error updating email status by messageId:', error);
    throw error;
  }
}

function mapEmailInquiryRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    messageId: row.message_id,
    source: row.source,
    from: row.from_email,
    fromName: row.from_name,
    to: row.to_email,
    cc: row.cc_emails,
    subject: row.subject,
    body: row.body_text,
    bodyHtml: row.body_html,
    hasAttachments: row.has_attachments,
    receivedAt: row.received_at,
    check: row.check,
    status: row.status || (row.check ? 'read' : 'unread'),
    inReplyTo: row.in_reply_to,
    references: row.references,
    threadId: row.thread_id,
    isOutgoing: row.is_outgoing || false,
    folderId: row.folder_id,
    folderName: row.folder_name || (row.is_outgoing ? 'Sent' : 'Inbox'),
    folderType: row.folder_type || (row.is_outgoing ? 'sent' : 'inbox'),
    readState: row.read_state || (row.status === 'unread' ? 'unread' : 'read'),
    responseState: row.response_state || (row.status === 'responded' ? 'responded' : 'pending'),
    starred: Boolean(row.starred),
    flagId: row.flag_id || null,
    labels: row.labels || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get email inquiry by ID
 * @param {number} emailId - Email inquiry ID
 * @returns {Promise<Object|null>} Email record or null if not found
 */
async function getEmailById(emailId) {
  try {
    const sql = `SELECT * FROM email_inquiries WHERE id = $1 LIMIT 1;`;
    const result = await query(sql, [emailId]);
    return mapEmailInquiryRow(result.rows[0]);
  } catch (error) {
    console.error('[ZOHO DB] Error getting email by ID:', error);
    throw error;
  }
}

module.exports = {
  saveOAuthTokens,
  getOAuthTokens,
  updateOAuthTokens,
  saveEmailInquiry,
  getEmailInquiriesBySource,
  getEmailStats,
  saveOutgoingEmail,
  updateEmailStatus,
  updateEmailStatusByMessageId,
  getEmailById
};
