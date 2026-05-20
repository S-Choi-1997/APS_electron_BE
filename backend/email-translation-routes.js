const db = require('./db');
const { translateEmailById } = require('./email-translation-service');

function parsePaginationParam(value, fallback, { min = 0, max = 500 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function mapEmailInquiryRow(row) {
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

function registerRoutes(app, auth, asyncHandler) {
  app.post('/email-inquiries/translations/backfill', auth.authenticateJWT, asyncHandler(async (req, res) => {
    try {
      const limit = parsePaginationParam(req.body?.limit, 25, { min: 1, max: 100 });
      const force = req.body?.force === true;
      const statusFilter = force
        ? ''
        : `AND COALESCE(translation_status, 'not_required') IN ('not_required', 'failed', 'disabled')`;

      const candidates = await db.query(`
        SELECT id
        FROM email_inquiries
        WHERE is_outgoing = false
          ${statusFilter}
        ORDER BY received_at DESC
        LIMIT $1;
      `, [limit]);

      const results = [];
      for (const row of candidates.rows) {
        const translated = await translateEmailById(row.id, { force });
        if (translated) {
          results.push({
            id: translated.id,
            translationStatus: translated.translation_status || 'not_required',
            detectedLanguage: translated.detected_language || null,
            translatedAt: translated.translated_at || null,
            error: translated.translation_error || null,
          });
        }
      }

      res.json({
        count: results.length,
        data: results,
      });
    } catch (error) {
      console.error('[Email Translation] Backfill failed:', error);
      res.status(500).json({
        error: 'translation_backfill_failed',
        message: error.message,
      });
    }
  }));

  app.post('/email-inquiries/:id/translate', auth.authenticateJWT, asyncHandler(async (req, res) => {
    try {
      const translated = await translateEmailById(req.params.id, { force: true });

      if (!translated) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Email inquiry not found',
        });
      }

      const mappedData = mapEmailInquiryRow(translated);

      if (global.broadcastEvent) {
        global.broadcastEvent('email:updated', mappedData);
      }

      res.json({ data: mappedData });
    } catch (error) {
      console.error('[Email Translation] Error translating inquiry:', error);
      res.status(500).json({
        error: 'translation_failed',
        message: error.message,
      });
    }
  }));
}

module.exports = {
  registerRoutes,
};
