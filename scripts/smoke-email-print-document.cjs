const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const utilPath = path.join(root, 'app', 'src', 'utils', 'emailPrintDocument.js');
const pagePath = path.join(root, 'app', 'src', 'pages', 'EmailConsultationsPage.jsx');

const source = fs.readFileSync(utilPath, 'utf8');
const transformed = source
  .replace('export function buildEmailPrintDocument', 'function buildEmailPrintDocument')
  .replace(
    /\nexport \{ escapeHtml as escapeEmailPrintHtml \};\s*$/,
    '\nmodule.exports = { buildEmailPrintDocument, escapeEmailPrintHtml: escapeHtml };',
  );

const moduleSandbox = { exports: {} };
vm.runInNewContext(transformed, { module: moduleSandbox, exports: moduleSandbox.exports }, { filename: utilPath });

const { buildEmailPrintDocument, escapeEmailPrintHtml } = moduleSandbox.exports;
assert.equal(typeof buildEmailPrintDocument, 'function', 'print document builder must be exported');
assert.equal(typeof escapeEmailPrintHtml, 'function', 'HTML escape helper must be exported');

const html = buildEmailPrintDocument({
  email: {
    fromName: '홍길동',
    from: 'sender@example.com',
    to: ['receiver@example.com'],
    cc: ['team@example.com'],
    source: 'zoho',
    labels: [{ id: 'confirmed', name: '확인' }],
  },
  subject: '상담 문의',
  sanitizedBodyHtml: '<p><strong>본문</strong></p><table><tr><td>견적</td></tr></table>',
  statusLabel: '확인',
  dateText: '2026. 05. 23. 오후 03:20',
  printedAtText: '2026. 05. 23. 오후 03:25',
  attachments: [{ filename: 'quote.pdf', size: 12000 }],
});

assert.match(html, /^<!doctype html>/, 'print document should be standalone HTML');
assert.match(html, /<html lang="ko">/, 'print document should declare Korean language');
assert.match(html, /<strong>보낸사람<\/strong>/, 'sender heading should be prominent');
assert.match(html, /홍길동 &lt;sender@example\.com&gt;/, 'sender address should be escaped and visible');
assert.match(html, /받는사람/, 'recipient metadata should be visible');
assert.match(html, /상담 문의/, 'subject should be visible');
assert.match(html, /<strong>본문<\/strong>/, 'sanitized original HTML body should be preserved');
assert.match(html, /첨부파일 1개/, 'attachment count should be visible');
assert.match(html, /quote\.pdf/, 'attachment filename should be visible');
assert.match(html, /출력 생성: 2026\. 05\. 23\. 오후 03:25/, 'print generation time should be visible');

const translatedHtml = buildEmailPrintDocument({
  email: { from: 'sender@example.com', to: ['receiver@example.com'] },
  subject: '<script>alert(1)</script>',
  bodyText: '<b>번역 본문</b>',
  isTranslated: true,
  translatedAtText: '2026. 05. 23. 오후 03:21',
});

assert(!translatedHtml.includes('<script>alert(1)</script>'), 'subject must be escaped');
assert(translatedHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped subject should remain readable');
assert(translatedHtml.includes('&lt;b&gt;번역 본문&lt;/b&gt;'), 'translated/plain body must be escaped');
assert(translatedHtml.includes('번역 본문 (2026. 05. 23. 오후 03:21)'), 'translated print metadata should include translated time');
assert.equal(escapeEmailPrintHtml('"&<>\''), '&quot;&amp;&lt;&gt;&#39;', 'escape helper should cover HTML special chars');

const pageSource = fs.readFileSync(pagePath, 'utf8');
assert(pageSource.includes("import { buildEmailPrintDocument } from '../utils/emailPrintDocument';"), 'email page must import print document builder');
assert(pageSource.includes('function printHtmlDocument(html)'), 'email page must own the iframe print path');
assert(pageSource.includes('const handlePrintSelectedEmail = async () =>'), 'email page must wire selected-mail print handler');
assert(pageSource.includes('className="secondary-button print-button"'), 'print button should use the shared secondary button style');
assert(pageSource.includes('aria-label="선택한 메일 출력"'), 'print button should expose an accessible label');
assert(pageSource.includes('sanitizedBodyHtml: printingTranslation ? \'\': sanitizedSelectedHtml') || pageSource.includes("sanitizedBodyHtml: printingTranslation ? '' : sanitizedSelectedHtml"), 'original print should use sanitized HTML while translation uses text');

console.log('EMAIL_PRINT_DOCUMENT_SMOKE_OK');
