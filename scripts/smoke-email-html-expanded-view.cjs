const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'app/src/pages/EmailConsultationsPage.jsx'), 'utf8');
const pageCss = fs.readFileSync(path.join(root, 'app/src/pages/EmailConsultationsPage.css'), 'utf8');
const service = fs.readFileSync(path.join(root, 'app/src/services/emailInquiryService.js'), 'utf8');
const htmlFrame = fs.readFileSync(path.join(root, 'app/src/components/email/EmailHtmlFrame.jsx'), 'utf8');
const htmlFrameCss = fs.readFileSync(path.join(root, 'app/src/components/email/EmailHtmlFrame.css'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'app/src/components/Modal.jsx'), 'utf8');
const modalCss = fs.readFileSync(path.join(root, 'app/src/components/css/Modal.css'), 'utf8');

assert.match(service, /email-inquiries\/\$\{emailId\}\/inline\/\$\{encodeURIComponent\(contentId\)\}/);
assert.match(htmlFrame, /value\.toLowerCase\(\)\.startsWith\('cid:'\)/);
assert.match(htmlFrame, /value\.startsWith\('\/mail\/ImageDisplay'\)/);
assert.match(htmlFrame, /sandbox="allow-scripts"/);
assert.match(htmlFrame, /FORBID_TAGS/);
assert.match(htmlFrame, /fetchEmailInlineImage/);
assert.match(htmlFrame, /parent\.postMessage/);
assert.doesNotMatch(page, /dangerouslySetInnerHTML=\{\{ __html: resolvedSelectedHtml \}\}/);
assert.match(page, />\s*크게 보기\s*</);
assert.match(page, /size="viewport"/);
assert.match(page, /formatNamedEmailAddress\(selectedEmail\?\.fromName, selectedEmail\?\.from\)/);
assert.doesNotMatch(page, /formatSender\(/);
assert.match(page, /expandedEmailScrollRef\.current\?\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
assert.match(page, /className="expanded-email-scroll" ref=\{expandedEmailScrollRef\}/);
assert.match(page, /!expandedEmailOpen \? \(/);
assert.match(modal, /size === 'viewport'/);
assert.match(modal, /closeButtonRef\.current\?\.focus\(\)/);
assert.match(modal, /event\.key !== 'Tab'/);
assert.match(modalCss, /\.dash-modal-content\.viewport\s*\{/);
assert.match(htmlFrame, /table\{max-width:100%\}/);
assert.match(htmlFrameCss, /\.email-html-frame\s*\{/);
assert.doesNotMatch(pageCss, /\.message-html table/);
assert.match(pageCss, /\.expanded-email-scroll\s*\{[^}]*overflow-anchor:\s*none/s);

console.log('Zoho inline images, preserved HTML layout, and the expanded email view are wired correctly.');
