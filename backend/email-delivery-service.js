const MAILER_DAEMON_PATTERN = /(?:mailer-daemon|mail delivery subsystem|postmaster)/i;
const BOUNCE_SUBJECT_PATTERN = /(?:undeliver(?:ed|able)|delivery (?:status notification|failure|failed)|returned mail|mail delivery failed|failure notice)/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function isBounceMessage(message = {}) {
  const sender = `${message.from || message.from_email || ''} ${message.fromName || message.from_name || ''}`;
  const subject = String(message.subject || '');
  return MAILER_DAEMON_PATTERN.test(sender) || BOUNCE_SUBJECT_PATTERN.test(subject);
}

function extractBounceDetails(content, message = {}) {
  const text = String(content || message.body || message.body_text || '').replace(/<[^>]*>/g, ' ');
  const ownAddress = String(message.toEmail || message.to_email || '').toLowerCase();
  const senderAddress = String(message.from || message.from_email || '').toLowerCase();
  const recipients = [...new Set((text.match(EMAIL_PATTERN) || []).map(value => value.toLowerCase()))]
    .filter(address => address !== ownAddress && address !== senderAddress && !MAILER_DAEMON_PATTERN.test(address));
  const enhancedCode = text.match(/\b([245]\.\d{1,3}\.\d{1,3})\b/)?.[1] || null;
  const smtpCode = text.match(/(?:ERROR CODE\s*:\s*|\b)([245]\d{2})(?:\s|-)/i)?.[1] || null;
  const diagnostic = text.match(/(?:ERROR CODE\s*:\s*[^\r\n]*|Diagnostic-Code\s*:[^\r\n]*)/i)?.[0]?.trim()
    || text.replace(/\s+/g, ' ').trim().slice(0, 500)
    || '수신 서버가 메일을 반송했습니다.';
  return { recipients, enhancedCode, smtpCode, diagnostic };
}

async function findOutgoingForRecipient(query, recipient, bouncedAt) {
  const result = await query(`
    SELECT *
    FROM email_inquiries
    WHERE is_outgoing = true
      AND received_at <= $2
      AND received_at >= $2::timestamp - INTERVAL '14 days'
      AND (
        EXISTS (
          SELECT 1
          FROM unnest(regexp_split_to_array(COALESCE(to_email, ''), '\\s*,\\s*')) value
          WHERE lower(trim(value)) = lower($1)
        )
        OR EXISTS (SELECT 1 FROM unnest(COALESCE(cc_emails, ARRAY[]::text[])) value WHERE lower(value) = lower($1))
        OR EXISTS (SELECT 1 FROM unnest(COALESCE(bcc_emails, ARRAY[]::text[])) value WHERE lower(value) = lower($1))
      )
    ORDER BY received_at DESC
    LIMIT 1;
  `, [recipient, bouncedAt]);
  return result.rows[0] || null;
}

function outgoingRecipients(row) {
  const values = [row.to_email, ...(row.cc_emails || []), ...(row.bcc_emails || [])];
  return [...new Set(values.flatMap(value => String(value || '').match(EMAIL_PATTERN) || []).map(value => value.toLowerCase()))];
}

async function applyBounceToOutgoing({ query, bounceMessage, content }) {
  if (!isBounceMessage(bounceMessage)) return [];
  const details = extractBounceDetails(content, bounceMessage);
  const bouncedAt = bounceMessage.receivedAt || bounceMessage.received_at || new Date();
  const updated = new Map();

  for (const recipient of details.recipients) {
    const outgoing = await findOutgoingForRecipient(query, recipient, bouncedAt);
    if (!outgoing) continue;
    const existing = outgoing.delivery_details && typeof outgoing.delivery_details === 'object'
      ? outgoing.delivery_details
      : {};
    const failures = Array.isArray(existing.failures) ? existing.failures : [];
    const bounceMessageId = bounceMessage.messageId || bounceMessage.message_id || null;
    if (failures.some(item => String(item.recipient || '').toLowerCase() === recipient && item.bounceMessageId === bounceMessageId)) {
      continue;
    }
    const nextFailures = [
      ...failures.filter(item => String(item.recipient || '').toLowerCase() !== recipient),
      {
        recipient,
        diagnostic: details.diagnostic,
        smtpCode: details.smtpCode,
        enhancedCode: details.enhancedCode,
        bounceMessageId,
        bouncedAt: new Date(bouncedAt).toISOString(),
      },
    ];
    const allRecipients = outgoingRecipients(outgoing);
    const status = nextFailures.length >= allRecipients.length ? 'failed' : 'partial';
    const result = await query(`
      UPDATE email_inquiries
      SET delivery_status = $1,
          delivery_details = $2::jsonb,
          delivery_updated_at = NOW(),
          updated_at = NOW()
      WHERE id = $3
      RETURNING *;
    `, [status, JSON.stringify({ failures: nextFailures }), outgoing.id]);
    if (result.rows[0]) updated.set(outgoing.id, result.rows[0]);
  }

  return [...updated.values()];
}

async function reprocessStoredBounces(query, { days = 30 } = {}) {
  const result = await query(`
    SELECT *
    FROM email_inquiries
    WHERE is_outgoing = false
      AND received_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND (
        lower(from_email) LIKE '%mailer-daemon%'
        OR lower(from_email) LIKE '%postmaster%'
        OR subject ~* '(undeliver|delivery (failure|failed|status notification)|returned mail|failure notice)'
      )
    ORDER BY received_at ASC;
  `, [days]);
  let updatedCount = 0;
  for (const bounce of result.rows) {
    const updated = await applyBounceToOutgoing({
      query,
      bounceMessage: bounce,
      content: bounce.body_html || bounce.body_text || '',
    });
    updatedCount += updated.length;
  }
  return { scanned: result.rows.length, updated: updatedCount };
}

module.exports = {
  isBounceMessage,
  extractBounceDetails,
  applyBounceToOutgoing,
  reprocessStoredBounces,
};
