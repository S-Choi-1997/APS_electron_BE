const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  cleanupOldAttachmentTempFiles,
  isAttachmentSafeToOpen,
  registerFileIpcHandlers,
  sanitizeDownloadFilename,
  writeAttachmentFile,
} = require('../app/electron/file-ipc');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-attachment-smoke-'));
const downloads = path.join(root, 'Downloads');
const temp = path.join(root, 'Temp');
const handlers = new Map();
const pageSource = fs.readFileSync(path.join(__dirname, '../app/src/pages/EmailConsultationsPage.jsx'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '../app/electron/preload.js'), 'utf8');

try {
  assert.strictEqual(sanitizeDownloadFilename('../견적서?.pdf'), '견적서_.pdf');
  assert.strictEqual(isAttachmentSafeToOpen('견적서.pdf'), true);
  assert.strictEqual(isAttachmentSafeToOpen('견적서.pdf.exe'), false);
  assert.strictEqual(isAttachmentSafeToOpen('script.PS1'), false);
  assert.match(pageSource, /handleAttachmentAction\(attachment, 'open'\)/);
  assert.match(pageSource, /handleAttachmentAction\(attachment, 'save'\)/);
  assert.match(preloadSource, /openAttachment:.*\n\s*ipcRenderer\.invoke\('open-attachment'/);
  assert.match(preloadSource, /saveAttachment:.*\n\s*ipcRenderer\.invoke\('save-attachment'/);

  const first = writeAttachmentFile(downloads, '견적서.pdf', Buffer.from('first'));
  const second = writeAttachmentFile(downloads, '견적서.pdf', Buffer.from('second'));
  assert.strictEqual(path.basename(first), '견적서.pdf');
  assert.strictEqual(path.basename(second), '견적서 (1).pdf');

  const oldTempDirectory = path.join(temp, 'aps-admin-attachments');
  fs.mkdirSync(oldTempDirectory, { recursive: true });
  const oldFile = path.join(oldTempDirectory, 'old.pdf');
  fs.writeFileSync(oldFile, 'old');
  fs.utimesSync(oldFile, new Date(0), new Date(0));
  cleanupOldAttachmentTempFiles(oldTempDirectory, Date.now());
  assert.strictEqual(fs.existsSync(oldFile), false);

  let openedPath = null;
  registerFileIpcHandlers({
    app: { getPath: name => (name === 'downloads' ? downloads : temp) },
    dialog: {},
    getMainWindow: () => null,
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    normalizeDownloadUrl: value => value,
    registerIpcHandler: (ipcMain, channel, handler) => ipcMain.handle(channel, (_event, payload) => handler({}, payload)),
    shell: {
      openPath: async filePath => {
        openedPath = filePath;
        return '';
      },
    },
  });

  Promise.resolve()
    .then(async () => {
      const saveResult = await handlers.get('save-attachment')({}, {
        buffer: Uint8Array.from([65, 80, 83]).buffer,
        filename: '자료.txt',
      });
      assert.strictEqual(saveResult.success, true);
      assert.strictEqual(path.dirname(saveResult.filePath), downloads);
      assert.strictEqual(fs.readFileSync(saveResult.filePath, 'utf8'), 'APS');

      const openResult = await handlers.get('open-attachment')({}, {
        buffer: Uint8Array.from([80, 68, 70]).buffer,
        filename: '자료.pdf',
      });
      assert.strictEqual(openResult.success, true);
      assert.strictEqual(openResult.opened, true);
      assert.strictEqual(openedPath, openResult.filePath);
      assert.strictEqual(path.dirname(openResult.filePath), oldTempDirectory);

      const blockedResult = await handlers.get('open-attachment')({}, {
        buffer: Uint8Array.from([1]).buffer,
        filename: 'invoice.pdf.exe',
      });
      assert.strictEqual(blockedResult.success, false);
      assert.strictEqual(blockedResult.blocked, true);
      console.log('Email attachment action smoke passed.');
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => fs.rmSync(root, { recursive: true, force: true }));
} catch (error) {
  fs.rmSync(root, { recursive: true, force: true });
  throw error;
}
