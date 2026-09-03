const EMAIL_EXTRACT_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const AUTOMATED_LOCAL_PARTS = new Set(['mailer-daemon', 'postmaster', 'no-reply', 'noreply']);

function normalizeEmail(value) {
  const match = String(value || '').match(EMAIL_EXTRACT_PATTERN);
  return match?.[0]?.trim().toLowerCase() || '';
}

function parseEmailList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  const seen = new Set();
  return values
    .flatMap(item => String(item || '').match(EMAIL_EXTRACT_PATTERN) || [])
    .map(normalizeEmail)
    .filter(Boolean)
    .filter((email) => {
      if (seen.has(email)) return false;
      seen.add(email);
      return true;
    });
}

function parseDeliveryDetails(value) {
  if (!value || typeof value === 'object') return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function isAutomatedAddress(email) {
  const localPart = normalizeEmail(email).split('@')[0];
  return AUTOMATED_LOCAL_PARTS.has(localPart);
}

function meaningfulName(value, email) {
  const name = String(value || '').trim();
  if (!name) return '';
  if (normalizeEmail(name) === normalizeEmail(email)) return '';
  return name;
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value) {
  const parsed = timestamp(value);
  return parsed ? new Date(parsed).toISOString() : null;
}

function matchRank(contact, query) {
  if (!query) return 0;
  const email = contact.email.toLowerCase();
  const name = String(contact.name || '').toLowerCase();
  if (email === query || name === query) return 0;
  if (email.startsWith(query) || name.startsWith(query)) return 1;
  if (email.includes(query) || name.includes(query)) return 2;
  return null;
}

function buildRecipientSuggestions({
  emailRows = [],
  userRows = [],
  query = '',
  limit = 10,
  ownAddresses = [],
} = {}) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const excluded = new Set(parseEmailList(ownAddresses));
  const contacts = new Map();

  const ensureContact = (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized || excluded.has(normalized) || isAutomatedAddress(normalized)) return null;
    if (!contacts.has(normalized)) {
      contacts.set(normalized, {
        email: normalized,
        name: '',
        source: 'mail_history',
        incomingCount: 0,
        outgoingCount: 0,
        lastContactAt: null,
        lastOutgoingAt: null,
        _nameAt: 0,
      });
    }
    return contacts.get(normalized);
  };

  const updateLastContact = (contact, occurredAt) => {
    if (timestamp(occurredAt) > timestamp(contact.lastContactAt)) {
      contact.lastContactAt = isoDate(occurredAt);
    }
  };

  emailRows.forEach((row) => {
    const occurredAt = row.received_at || row.receivedAt || row.sent_at || row.sentAt || row.created_at || row.createdAt;
    const isOutgoing = row.is_outgoing === true || row.isOutgoing === true || row.is_outgoing === 'true';

    if (!isOutgoing) {
      const email = normalizeEmail(row.from_email || row.fromEmail || row.from);
      const contact = ensureContact(email);
      if (!contact) return;
      contact.incomingCount += 1;
      updateLastContact(contact, occurredAt);
      const name = meaningfulName(row.from_name || row.fromName, email);
      if (name && timestamp(occurredAt) >= contact._nameAt) {
        contact.name = name;
        contact._nameAt = timestamp(occurredAt);
      }
      return;
    }

    const recipients = parseEmailList([
      row.to_email || row.toEmail || row.to,
      row.cc_emails || row.ccEmails || row.cc,
    ]);
    const details = parseDeliveryDetails(row.delivery_details || row.deliveryDetails);
    const failedRecipients = new Set(
      (Array.isArray(details.failures) ? details.failures : [])
        .map(failure => normalizeEmail(failure?.recipient || failure?.email))
        .filter(Boolean),
    );
    const wholeMessageFailed = String(row.delivery_status || row.deliveryStatus || '').toLowerCase() === 'failed'
      && failedRecipients.size === 0;

    recipients.forEach((email) => {
      if (wholeMessageFailed || failedRecipients.has(email)) return;
      const contact = ensureContact(email);
      if (!contact) return;
      contact.outgoingCount += 1;
      updateLastContact(contact, occurredAt);
      if (timestamp(occurredAt) > timestamp(contact.lastOutgoingAt)) {
        contact.lastOutgoingAt = isoDate(occurredAt);
      }
    });
  });

  if (normalizedQuery) {
    userRows.forEach((user) => {
      const contact = ensureContact(user.email);
      if (!contact) return;
      const internalName = meaningfulName(user.display_name || user.displayName || user.name, contact.email);
      if (internalName) contact.name = internalName;
      contact.source = 'internal';
    });
  }

  return [...contacts.values()]
    .map((contact) => ({ ...contact, _matchRank: matchRank(contact, normalizedQuery) }))
    .filter(contact => contact._matchRank !== null)
    .filter(contact => normalizedQuery || contact.outgoingCount > 0 || contact.incomingCount > 0)
    .sort((left, right) => {
      if (normalizedQuery && left._matchRank !== right._matchRank) return left._matchRank - right._matchRank;
      if (normalizedQuery && left.source !== right.source) return left.source === 'internal' ? -1 : 1;
      if (!normalizedQuery && Boolean(left.lastOutgoingAt) !== Boolean(right.lastOutgoingAt)) {
        return left.lastOutgoingAt ? -1 : 1;
      }
      const recentOutgoing = timestamp(right.lastOutgoingAt) - timestamp(left.lastOutgoingAt);
      if (recentOutgoing) return recentOutgoing;
      const recentContact = timestamp(right.lastContactAt) - timestamp(left.lastContactAt);
      if (recentContact) return recentContact;
      const frequency = (right.incomingCount + right.outgoingCount) - (left.incomingCount + left.outgoingCount);
      if (frequency) return frequency;
      return left.email.localeCompare(right.email);
    })
    .slice(0, Math.max(1, Number(limit) || 10))
    .map(({ _matchRank, _nameAt, incomingCount, outgoingCount, ...contact }) => ({
      ...contact,
      frequency: incomingCount + outgoingCount,
    }));
}

module.exports = {
  buildRecipientSuggestions,
  isAutomatedAddress,
  normalizeEmail,
  parseEmailList,
};
