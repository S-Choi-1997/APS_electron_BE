const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ATTACHMENT_TEMP_DIRECTORY = 'aps-admin-attachments';
const ATTACHMENT_TEMP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BLOCKED_OPEN_EXTENSIONS = new Set([
  '.appref-ms', '.bat', '.cmd', '.com', '.cpl', '.exe', '.hta', '.inf', '.ins',
  '.iso', '.jar', '.js', '.jse', '.lnk', '.msc', '.msi', '.msp', '.mst', '.pif',
  '.ps1', '.ps1xml', '.ps2', '.ps2xml', '.psc1', '.psc2', '.reg', '.scr', '.sct',
  '.shb', '.sys', '.url', '.vb', '.vbe', '.vbs', '.ws', '.wsc', '.wsf', '.wsh',
]);

function sanitizeDownloadFilename(filename) {
  const fallback = 'download';
  const baseName = path.basename(String(filename || fallback));
  const cleaned = baseName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function getUniqueFilePath(directoryPath, filename) {
  const parsed = path.parse(filename);
  let candidate = path.join(directoryPath, filename);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directoryPath, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }

  return candidate;
}

function isAttachmentSafeToOpen(filename) {
  return !BLOCKED_OPEN_EXTENSIONS.has(path.extname(String(filename || '')).toLowerCase());
}

function cleanupOldAttachmentTempFiles(directoryPath, now = Date.now()) {
  if (!fs.existsSync(directoryPath)) return;
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(directoryPath, entry.name);
    try {
      if (now - fs.statSync(filePath).mtimeMs > ATTACHMENT_TEMP_MAX_AGE_MS) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn(`[Main] Failed to clean temporary attachment: ${filePath}`, error.message);
    }
  }
}

function writeAttachmentFile(directoryPath, filename, buffer) {
  fs.mkdirSync(directoryPath, { recursive: true });
  const safeFilename = sanitizeDownloadFilename(filename);
  const filePath = getUniqueFilePath(directoryPath, safeFilename);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
}

function downloadWithRedirect({ downloadUrl, filePath, normalizeDownloadUrl, maxRedirects = 5 }) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const protocol = downloadUrl.startsWith('https') ? https : http;

    protocol.get(downloadUrl, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = normalizeDownloadUrl(new URL(response.headers.location, downloadUrl).toString());
        console.log(`[Main] Redirecting to: ${redirectUrl}`);
        downloadWithRedirect({
          downloadUrl: redirectUrl,
          filePath,
          normalizeDownloadUrl,
          maxRedirects: maxRedirects - 1,
        })
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(filePath);
      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`[Main] File downloaded successfully: ${filePath}`);
        resolve({ success: true, filePath });
      });

      file.on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    }).on('error', (error) => {
      fs.unlink(filePath, () => {});
      reject(error);
    });
  });
}

function registerFileIpcHandlers({
  app,
  dialog,
  getMainWindow,
  ipcMain,
  normalizeDownloadUrl,
  registerIpcHandler,
  shell,
}) {
  registerIpcHandler(ipcMain, 'save-attachment', async (_context, { buffer, filename }) => {
    try {
      const filePath = writeAttachmentFile(app.getPath('downloads'), filename, buffer);
      console.log(`[Main] Attachment saved: ${filePath}`);
      return { success: true, filePath };
    } catch (error) {
      console.error('[Main] Failed to save attachment:', error);
      return { success: false, error: error.message };
    }
  });

  registerIpcHandler(ipcMain, 'open-attachment', async (_context, { buffer, filename }) => {
    try {
      const safeFilename = sanitizeDownloadFilename(filename);
      if (!isAttachmentSafeToOpen(safeFilename)) {
        return { success: false, blocked: true, error: '실행 파일이나 스크립트 첨부파일은 앱에서 바로 열 수 없습니다. 먼저 저장한 뒤 확인하세요.' };
      }

      const tempDirectory = path.join(app.getPath('temp'), ATTACHMENT_TEMP_DIRECTORY);
      fs.mkdirSync(tempDirectory, { recursive: true });
      cleanupOldAttachmentTempFiles(tempDirectory);
      const filePath = writeAttachmentFile(tempDirectory, safeFilename, buffer);
      const openError = await shell.openPath(filePath);
      if (openError) {
        return { success: false, filePath, error: openError };
      }
      console.log(`[Main] Attachment opened: ${filePath}`);
      return { success: true, filePath, opened: true };
    } catch (error) {
      console.error('[Main] Failed to open attachment:', error);
      return { success: false, error: error.message };
    }
  });

  registerIpcHandler(ipcMain, 'download-file', async (_context, { url, filename }) => {
    try {
      const safeUrl = normalizeDownloadUrl(url);
      console.log(`[Main] Downloading file: ${filename} from ${safeUrl}`);

      const { filePath, canceled } = await dialog.showSaveDialog(getMainWindow(), {
        defaultPath: filename,
        filters: [{ name: 'All Files', extensions: ['*'] }],
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      return await downloadWithRedirect({
        downloadUrl: safeUrl,
        filePath,
        normalizeDownloadUrl,
      });
    } catch (error) {
      console.error('[Main] Failed to download file:', error);
      return { success: false, error: error.message };
    }
  });

  registerIpcHandler(ipcMain, 'save-file', async (_context, { buffer, filename }) => {
    try {
      console.log(`[Main] Saving file: ${filename}`);

      const { filePath, canceled } = await dialog.showSaveDialog(getMainWindow(), {
        defaultPath: filename,
        filters: [{ name: 'All Files', extensions: ['*'] }],
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      fs.writeFileSync(filePath, Buffer.from(buffer));
      console.log(`[Main] File saved successfully: ${filePath}`);
      return { success: true, filePath };
    } catch (error) {
      console.error('[Main] Failed to save file:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('select-directory', async () => {
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog(getMainWindow(), {
        title: '저장할 폴더 선택',
        properties: ['openDirectory', 'createDirectory'],
      });

      if (canceled || !filePaths?.[0]) {
        return { success: false, canceled: true };
      }

      return { success: true, directoryPath: filePaths[0] };
    } catch (error) {
      console.error('[Main] Failed to select directory:', error);
      return { success: false, error: error.message };
    }
  });

  registerIpcHandler(ipcMain, 'save-file-to-directory', async (_context, { buffer, directoryPath, filename }) => {
    try {
      const resolvedDirectory = path.resolve(directoryPath || '');
      const stats = fs.statSync(resolvedDirectory);

      if (!stats.isDirectory()) {
        throw new Error('선택한 경로가 폴더가 아닙니다.');
      }

      const safeFilename = sanitizeDownloadFilename(filename);
      const filePath = getUniqueFilePath(resolvedDirectory, safeFilename);
      const resolvedFilePath = path.resolve(filePath);
      const relativePath = path.relative(resolvedDirectory, resolvedFilePath);

      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error('저장 경로가 올바르지 않습니다.');
      }

      fs.writeFileSync(resolvedFilePath, Buffer.from(buffer));
      console.log(`[Main] File saved successfully: ${resolvedFilePath}`);
      return { success: true, filePath: resolvedFilePath };
    } catch (error) {
      console.error('[Main] Failed to save file to directory:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  cleanupOldAttachmentTempFiles,
  isAttachmentSafeToOpen,
  registerFileIpcHandlers,
  sanitizeDownloadFilename,
  writeAttachmentFile,
};
