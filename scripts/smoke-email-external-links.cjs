const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'app/src/pages/EmailConsultationsPage.jsx'), 'utf8');
const htmlFrame = fs.readFileSync(path.join(root, 'app/src/components/email/EmailHtmlFrame.jsx'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'app/src/components/EmailConsultationModal.jsx'), 'utf8');
const main = fs.readFileSync(path.join(root, 'app/electron/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'app/electron/preload.js'), 'utf8');

assert.match(page, /const handleMessageExternalLink = async \(url\)/);
assert.match(page, /onExternalLink=\{handleMessageExternalLink\}/);
assert.match(htmlFrame, /kind:'link',url:link\.href/);
assert.match(htmlFrame, /event\.source !== frameRef\.current\?\.contentWindow/);
assert.match(page, /window\.electron\?\.openExternal/);
assert.match(modal, /await window\.electron\.openExternal\(url\)/);
assert.match(main, /webContents\.on\('will-navigate'/);
assert.match(main, /if \(sameRendererDocument\) return;/);
assert.match(main, /event\.preventDefault\(\);\s+openExternalUrl\(url, 'Navigation request'\)/);
assert.match(preload, /openExternal: \(url\) => ipcRenderer\.invoke\('open-external-url', url\)/);

console.log('Email links are intercepted in current and legacy views, with main-process navigation defense.');
