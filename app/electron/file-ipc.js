const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

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
  dialog,
  getMainWindow,
  ipcMain,
  normalizeDownloadUrl,
  registerIpcHandler,
}) {
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
  registerFileIpcHandlers,
};
