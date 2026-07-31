const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const emailPagePath = path.join(repoRoot, 'app', 'src', 'pages', 'EmailConsultationsPage.jsx');
const emailCssPath = path.join(repoRoot, 'app', 'src', 'pages', 'EmailConsultationsPage.css');
const mailApi = require(path.join(repoRoot, 'backend', 'zoho', 'mail-api'));

const emailPage = fs.readFileSync(emailPagePath, 'utf8');
const emailCss = fs.readFileSync(emailCssPath, 'utf8');

function assertIncludes(source, expected, message) {
  assert(source.includes(expected), message);
}

assertIncludes(emailPage, 'function RecipientInput', 'composer should use a token recipient input component');
assertIncludes(emailPage, "['Enter', ',', ';', 'Tab', ' ']", 'recipient input should commit on enter, comma, semicolon, tab, and address-ending space');
assertIncludes(emailPage, 'onClick={() => editRecipient(index)}', 'recipient chips should support editing');
assertIncludes(emailPage, 'onClick={() => removeRecipient(index)}', 'recipient chips should support deletion');
assertIncludes(emailPage, 'onBlur={() => commitDraft()}', 'recipient draft text should be committed on blur');
assertIncludes(emailPage, 'to: splitRecipients(composer.to)', 'send payload should preserve multiple To recipients');
assertIncludes(emailPage, 'cc: splitRecipients(composer.cc)', 'send payload should preserve multiple Cc recipients');
assertIncludes(emailPage, 'bcc: splitRecipients(composer.bcc)', 'send payload should preserve multiple Bcc recipients');
assertIncludes(emailCss, '.recipient-input', 'recipient token input should have dedicated layout CSS');
assertIncludes(emailCss, '.recipient-chip', 'recipient token chips should have dedicated layout CSS');

const parsed = mailApi.parseMessageToInquiry({
  messageId: 'recipient-smoke-1',
  folderName: 'Inbox',
  fromAddress: '"Donghyun Ko" <donghyunko@vnu.edu.vn>',
  sender: 'Donghyun Ko',
  toAddress: '"lamnd Nguyễn Đức Lâm"<lamnd@vnu.edu.vn>,"조영상"<joys401@naver.com>,<contact@apsconsulting.kr>',
  ccAddress: '"APS Team" <team@apsconsulting.kr>, audit@example.com',
  subject: 'Recipient parsing smoke',
  summary: 'body',
  receivedTime: '1781736843320',
});

assert.equal(parsed.from, 'donghyunko@vnu.edu.vn');
assert.equal(parsed.toEmail, 'lamnd@vnu.edu.vn, joys401@naver.com, contact@apsconsulting.kr');
assert.deepEqual(parsed.ccEmails, ['team@apsconsulting.kr', 'audit@example.com']);
assert.equal(parsed.folderType, 'inbox');
assert.equal(parsed.isOutgoing, false);

console.log('EMAIL_RECIPIENT_PARSING_SMOKE_OK');
