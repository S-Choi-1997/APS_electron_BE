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
        check,
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

module.exports = {
  saveOAuthTokens,
  getOAuthTokens,
  updateOAuthTokens,
  saveEmailInquiry,
  getEmailInquiriesBySource,
  getEmailStats
};
