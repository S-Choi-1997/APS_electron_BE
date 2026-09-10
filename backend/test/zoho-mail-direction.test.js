const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../zoho/config');
const { parseMessageToInquiry } = require('../zoho/mail-api');

test('self-addressed Inbox copy remains incoming', () => {
  const previous = config.accountEmail;
  config.accountEmail = 'contact@example.com';
  try {
    const email = parseMessageToInquiry({
      messageId: 'inbox-copy',
      folderName: 'Inbox',
      fromAddress: 'contact@example.com',
      toAddress: 'contact@example.com',
      subject: 'Report',
      receivedTime: String(Date.now()),
    }, false, { folderType: 'inbox' });
    assert.equal(email.isOutgoing, false);
    assert.equal(email.folderType, 'inbox');
    assert.equal(email.responseState, 'pending');
  } finally {
    config.accountEmail = previous;
  }
});

test('Sent folder remains outgoing regardless of sender metadata', () => {
  const email = parseMessageToInquiry({
    messageId: 'sent-copy',
    folderName: 'Sent',
    fromAddress: '',
    toAddress: 'recipient@example.com',
    subject: 'Report',
    receivedTime: String(Date.now()),
  }, true, { folderType: 'sent' });
  assert.equal(email.isOutgoing, true);
  assert.equal(email.folderType, 'sent');
  assert.equal(email.responseState, 'responded');
});

test('webhook without an authoritative folder can infer own-account outgoing mail', () => {
  const previous = config.accountEmail;
  config.accountEmail = 'contact@example.com';
  try {
    const email = parseMessageToInquiry({
      messageId: 'webhook-copy',
      fromAddress: 'contact@example.com',
      toAddress: 'recipient@example.com',
      subject: 'Report',
    });
    assert.equal(email.isOutgoing, true);
  } finally {
    config.accountEmail = previous;
  }
});
