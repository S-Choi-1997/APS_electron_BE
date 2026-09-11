const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'app/src/pages/EmailConsultationsPage.jsx'), 'utf8');
const pageCss = fs.readFileSync(path.join(root, 'app/src/pages/EmailConsultationsPage.css'), 'utf8');
const service = fs.readFileSync(path.join(root, 'app/src/services/emailInquiryService.js'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'app/src/components/Modal.jsx'), 'utf8');
const modalCss = fs.readFileSync(path.join(root, 'app/src/components/css/Modal.css'), 'utf8');

assert.match(service, /email-inquiries\/\$\{emailId\}\/inline\/\$\{encodeURIComponent\(contentId\)\}/);
assert.match(page, /source\.toLowerCase\(\)\.startsWith\('cid:'\)/);
assert.match(page, /source\.startsWith\('\/mail\/ImageDisplay'\)/);
assert.match(page, /URL\.createObjectURL\(blob\)/);
assert.match(page, /URL\.revokeObjectURL\(url\)/);
assert.match(page, />\s*크게 보기\s*</);
assert.match(page, /size="viewport"/);
assert.match(page, /formatNamedEmailAddress\(selectedEmail\?\.fromName, selectedEmail\?\.from\)/);
assert.doesNotMatch(page, /formatSender\(/);
assert.match(modal, /size === 'viewport'/);
assert.match(modalCss, /\.dash-modal-content\.viewport\s*\{/);
assert.match(pageCss, /\.message-html table\s*\{[^}]*max-width:\s*100%/s);
assert.doesNotMatch(pageCss, /\.message-html table\s*\{[^}]*min-width:\s*100%/s);

console.log('Zoho inline images, preserved HTML layout, and the expanded email view are wired correctly.');
