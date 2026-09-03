const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRecipientSuggestions } = require('../email-recipient-suggestions');

test('recent suggestions prefer successful outgoing contacts and exclude unsafe addresses', () => {
  const suggestions = buildRecipientSuggestions({
    ownAddresses: ['shared@aps.test'],
    emailRows: [
      {
        is_outgoing: true,
        to_email: 'Recent <recent@example.com>, failed@example.com',
        cc_emails: ['cc@example.com'],
        bcc_emails: ['secret@example.com'],
        received_at: '2026-08-11T00:00:00Z',
        delivery_status: 'partial',
        delivery_details: { failures: [{ recipient: 'failed@example.com' }] },
      },
      {
        is_outgoing: true,
        to_email: 'older@example.com, shared@aps.test, postmaster@example.com',
        received_at: '2026-08-10T00:00:00Z',
        delivery_status: 'accepted',
      },
    ],
  });

  assert.deepEqual(suggestions.map(item => item.email), [
    'cc@example.com',
    'recent@example.com',
    'older@example.com',
  ]);
  assert.equal(suggestions.some(item => item.email === 'failed@example.com'), false);
  assert.equal(suggestions.some(item => item.email === 'secret@example.com'), false);
});

test('a failed message without per-recipient details contributes no suggestions', () => {
  const suggestions = buildRecipientSuggestions({
    emailRows: [{
      is_outgoing: true,
      to_email: 'first@example.com, second@example.com',
      received_at: '2026-08-11T00:00:00Z',
      delivery_status: 'failed',
      delivery_details: {},
    }],
  });

  assert.deepEqual(suggestions, []);
});

test('typed name search includes incoming history and trusts active user names', () => {
  const suggestions = buildRecipientSuggestions({
    query: '홍길',
    emailRows: [{
      is_outgoing: false,
      from_email: 'staff@aps.test',
      from_name: 'Spoofed Name',
      received_at: '2026-08-11T00:00:00Z',
    }],
    userRows: [{ email: 'STAFF@aps.test', display_name: '홍길동' }],
  });

  assert.equal(suggestions.length, 1);
  assert.deepEqual(suggestions[0], {
    email: 'staff@aps.test',
    name: '홍길동',
    source: 'internal',
    lastContactAt: '2026-08-11T00:00:00.000Z',
    lastOutgoingAt: null,
    frequency: 1,
  });
});

test('contacts are deduplicated case-insensitively and searchable by partial email', () => {
  const suggestions = buildRecipientSuggestions({
    query: 'client@',
    emailRows: [
      { is_outgoing: false, from_email: 'CLIENT@example.com', received_at: '2026-08-10T00:00:00Z' },
      { is_outgoing: true, to_email: 'client@example.com', received_at: '2026-08-11T00:00:00Z', delivery_status: 'accepted' },
    ],
  });

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].email, 'client@example.com');
  assert.equal(suggestions[0].frequency, 2);
});
