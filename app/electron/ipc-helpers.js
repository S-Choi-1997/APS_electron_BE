const { BrowserWindow } = require('electron');

function getSenderWindow(event) {
  if (!event?.sender) return null;
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow.isDestroyed()) return null;
  return senderWindow;
}

function registerIpcHandler(ipcMain, channel, handler, options = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const senderWindow = getSenderWindow(event);
      if (options.requireSenderWindow && !senderWindow) {
        return { success: false, error: '요청한 창을 찾지 못했습니다.' };
      }

      return await handler({ event, senderWindow }, ...args);
    } catch (error) {
      console.error(`[IPC] ${channel} failed:`, error);
      return { success: false, error: error.message };
    }
  });
}

function normalizeExternalUrl(url) {
  const parsedUrl = new URL(String(url || '').trim());
  const allowedProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:']);
  if (!allowedProtocols.has(parsedUrl.protocol)) {
    throw new Error('허용되지 않은 외부 URL 프로토콜입니다.');
  }
  return parsedUrl.toString();
}

function normalizeDownloadUrl(url) {
  const parsedUrl = new URL(String(url || '').trim());
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('다운로드 URL은 http 또는 https만 사용할 수 있습니다.');
  }
  return parsedUrl.toString();
}

module.exports = {
  getSenderWindow,
  normalizeDownloadUrl,
  normalizeExternalUrl,
  registerIpcHandler,
};
