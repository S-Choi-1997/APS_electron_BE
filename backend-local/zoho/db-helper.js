/**
 * ZOHO Mail Integration - Database Helper
 *
 * Handles database operations for ZOHO Mail data
 */

const { query } = require('../db');

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
      from,
      fromName,
      subject,
      body,
      bodyHtml,
      receivedAt,
      toEmail,
      ccEmails = [],
      hasAttachments = false
    } = inquiryData;

    // Insert into email_inquiries table with source='zoho'
    // Use ON CONFLICT to skip duplicates based on messageId
    const sql = `
      INSERT INTO email_inquiries (
        message_id,
        source,
        from_email,
        from_name,
        to_email,
        cc_emails,
        subject,
        body_text,
        body_html,
        has_attachments,
        received_at,
        "check",
        created_at,
        updated_at
      ) VALUES ($1, 'zoho', $2, $3, $4, $5, $6, $7, $8, $9, $10, false, NOW(), NOW())
      ON CONFLICT (message_id) DO NOTHING
      RETURNING *;
    `;

    const values = [
      messageId,
      from,
      fromName || from,
      toEmail,
      ccEmails,
      subject,
      body,
      bodyHtml || body,
      hasAttachments,
      receivedAt
    ];

    const result = await query(sql, values);

    if (result.rows.length > 0) {
      console.log('[ZOHO DB] Email inquiry saved:', messageId);
      return result.rows[0];
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
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.body - Email body (plain text)
 * @param {string} [emailData.bodyHtml] - Email body (HTML)
 * @param {string} emailData.fromEmail - Sender email (our email)
 * @param {string} [emailData.fromName] - Sender name
 * @param {Date} emailData.sentAt - Sent timestamp
 * @returns {Promise<Object>} Saved email record
 */
async function saveOutgoingEmail(emailData) {
  try {
    const {
      messageId,
      inReplyTo,
      to,
      subject,
      body,
      bodyHtml,
      fromEmail,
      fromName,
      sentAt
    } = emailData;

    console.log('[ZOHO DB] Saving outgoing email:', messageId);

    // Get thread_id and references from the original email
    let threadId = inReplyTo; // Default: use inReplyTo as thread_id
    let references = inReplyTo ? [inReplyTo] : [];

    if (inReplyTo) {
      // Query original email to get its thread_id and references
      const originalSql = `
        SELECT thread_id, references, message_id
        FROM email_inquiries
        WHERE message_id = $1;
      `;
      const originalResult = await db_postgres.query(originalSql, [inReplyTo]);

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
        subject,
        body_text,
        body_html,
        in_reply_to,
        references,
        thread_id,
        is_outgoing,
        status,
        "check",
        received_at,
        created_at,
        updated_at
      ) VALUES ($1, 'zoho', $2, $3, $4, $5, $6, $7, $8, $9, $10, true, 'responded', true, $11, NOW(), NOW())
      RETURNING *;
    `;

    const values = [
      messageId,
      fromEmail,
      fromName || 'APS Admin',
      to,
      subject,
      body,
      bodyHtml || body,
      inReplyTo,
      references,
      threadId,
      sentAt || new Date()
    ];

    const result = await db_postgres.query(sql, values);

    console.log('[ZOHO DB] Outgoing email saved successfully:', messageId);
    return result.rows[0];
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
    console.log(`[ZOHO DB] Updating email ${emailId} status to: ${status}`);

    const sql = `
      UPDATE email_inquiries
      SET status = $1,
          "check" = $2,
          updated_at = NOW()
      WHERE id = $3
      RETURNING *;
    `;

    // Sync check field with status for backward compatibility
    const checkValue = (status === 'read' || status === 'responded');

    const result = await db_postgres.query(sql, [status, checkValue, emailId]);

    if (result.rows.length === 0) {
      throw new Error(`Email inquiry ${emailId} not found`);
    }

    console.log(`[ZOHO DB] Email status updated successfully`);
    return result.rows[0];
  } catch (error) {
    console.error('[ZOHO DB] Error updating email status:', error);
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
  updateEmailStatus
};
