const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const ALLOWED_FIELDS = new Set(['subject', 'body', 'bodyHtml']);
const RECIPIENT_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
const MAX_BODY_LENGTH = 200000;

function registerRoutes(app, { sendNewEmail, env = process.env, broadcast = (...args) => global.broadcastEvent?.(...args) }) {
  const apiKey = String(env.AUTOMATION_MAIL_API_KEY || '');
  const recipient = String(env.AUTOMATION_MAIL_TO || '').trim();
  const configured = /^[\x21-\x7e]{32,256}$/.test(apiKey)
    && RECIPIENT_PATTERN.test(recipient)
    && env.ZOHO_ENABLED === 'true';
  const keyDigest = crypto.createHash('sha256').update(apiKey).digest();

  function authenticate(req, res, next) {
    res.set('Cache-Control', 'no-store');
    if (!configured) {
      return res.status(503).json({ error: 'automation_mail_not_configured' });
    }
    const authorization = req.get('Authorization') || '';
    const match = /^Bearer ([\x21-\x7e]{32,256})$/i.exec(authorization);
    const suppliedDigest = crypto.createHash('sha256').update(match?.[1] || '').digest();
    if (!match || !crypto.timingSafeEqual(keyDigest, suppliedDigest)) {
      return res.status(401).json({ error: 'invalid_service_key' });
    }
    next();
  }

  // One shared budget for this service credential, even across source IPs.
  const limiter = rateLimit({
    windowMs: 60000,
    limit: 10,
    keyGenerator: () => 'automation-mail',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'automation_mail_rate_limited' },
  });

  app.post('/api/automation/email', authenticate, limiter, async (req, res) => {
    const input = req.body;
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !ALLOWED_FIELDS.has(key))) {
      return res.status(400).json({ error: 'invalid_payload', message: 'Only subject, body and bodyHtml are supported.' });
    }
    if (typeof input.subject !== 'string' || !input.subject.trim()
      || input.subject.length > 500 || /[\r\n]/.test(input.subject)
      || ['body', 'bodyHtml'].some(key => input[key] !== undefined && typeof input[key] !== 'string')) {
      return res.status(400).json({ error: 'invalid_payload', message: 'Provide a subject (1–500 characters) and a text or HTML body.' });
    }
    const body = input.body?.trim() || '';
    const bodyHtml = input.bodyHtml?.trim() || '';
    if (!body && !bodyHtml) {
      return res.status(400).json({ error: 'invalid_payload', message: 'A text or HTML body is required.' });
    }
    if (body.length + bodyHtml.length > MAX_BODY_LENGTH) {
      return res.status(413).json({ error: 'body_too_large', maxCharacters: MAX_BODY_LENGTH });
    }

    let result;
    try {
      result = await sendNewEmail({ to: [recipient], subject: input.subject.trim(), body, bodyHtml });
    } catch (error) {
      const statusCode = Number(error.statusCode);
      if (statusCode >= 400 && statusCode < 500) {
        return res.status(statusCode).json({ error: 'mail_validation_failed' });
      }
      // A lost provider response or an audit failure can happen AFTER sending.
      // Do not invite an automatic retry that might send the report twice.
      console.error('[Automation Mail] Send did not complete cleanly');
      return res.status(502).json({ error: 'mail_send_unconfirmed', deliveryStatus: 'unknown', retrySafe: false });
    }

    if (result.data?.id) {
      try {
        broadcast('email:created', result.data);
      } catch (_error) {
        console.warn('[Automation Mail] Sent email event could not be broadcast');
      }
    }
    // Provider acceptance is distinct from eventual delivery to the recipient.
    res.status(200).json({
      success: true,
      deliveryStatus: 'accepted',
      messageId: result.providerResult.messageId,
      localSaved: !result.localSaveError,
      ...(result.localSaveError ? { warning: 'sent_but_local_save_failed' } : {}),
    });
  });
}

module.exports = { registerRoutes };
