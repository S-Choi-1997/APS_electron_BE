const test = require('node:test');
const assert = require('node:assert/strict');
const { isBounceMessage, extractBounceDetails, applyBounceToOutgoing } = require('../email-delivery-service');

test('parses Zoho mailer-daemon bounce details', () => {
  const message = {
    from: 'mailer-daemon@mail.zoho.com',
    toEmail: 'admin@apsconsulting.kr',
    subject: 'Undelivered Mail Returned to Sender',
  };
  const content = 'Permanent error: lamnd@vnu.edu, ERROR CODE :512 - 5.4.4 DNS error:NXDOMAIN. Domain not found';
  assert.equal(isBounceMessage(message), true);
  const result = extractBounceDetails(content, message);
  assert.deepEqual(result.recipients, ['lamnd@vnu.edu']);
  assert.equal(result.smtpCode, '512');
  assert.equal(result.enhancedCode, '5.4.4');
});

test('marks a single-recipient outgoing message failed', async () => {
  const outgoing = {
    id: 10,
    to_email: 'wrong@example.com',
    cc_emails: [],
    bcc_emails: [],
    delivery_details: {},
  };
  const query = async (sql, values) => {
    if (sql.includes('SELECT *')) return { rows: [outgoing] };
    assert.equal(values[0], 'failed');
    return { rows: [{ ...outgoing, delivery_status: values[0], delivery_details: JSON.parse(values[1]) }] };
  };
  const updated = await applyBounceToOutgoing({
    query,
    bounceMessage: {
      from: 'mailer-daemon@mail.zoho.com',
      toEmail: 'admin@apsconsulting.kr',
      subject: 'Delivery failure',
      receivedAt: new Date(),
      messageId: 'bounce-1',
    },
    content: 'wrong@example.com ERROR CODE :550 - 5.1.1 User unknown',
  });
  assert.equal(updated[0].delivery_status, 'failed');
  assert.equal(updated[0].delivery_details.failures[0].recipient, 'wrong@example.com');
});
