const { execSync } = require('child_process');

const STARTUP_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

function registerStartupIpcHandlers({ app, appName, ipcMain }) {
  ipcMain.handle('get-startup-enabled', async () => {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: 'Windows에서만 사용할 수 있는 기능입니다.' };
      }

      const result = execSync(`reg query "${STARTUP_REG_KEY}" /v "${appName}" 2>nul`, {
        encoding: 'utf8',
        windowsHide: true,
      });

      return { success: true, enabled: result.includes(appName) };
    } catch (error) {
      return { success: true, enabled: false };
    }
  });

  ipcMain.handle('set-startup-enabled', async (_event, enabled) => {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: 'Windows에서만 사용할 수 있는 기능입니다.' };
      }

      const exePath = app.getPath('exe');
      const shouldEnable = Boolean(enabled);

      if (shouldEnable) {
        execSync(`reg add "${STARTUP_REG_KEY}" /v "${appName}" /t REG_SZ /d "\\"${exePath}\\"" /f`, {
          encoding: 'utf8',
          windowsHide: true,
        });
        console.log('[Startup] Added to startup');
      } else {
        execSync(`reg delete "${STARTUP_REG_KEY}" /v "${appName}" /f 2>nul`, {
          encoding: 'utf8',
          windowsHide: true,
        });
        console.log('[Startup] Removed from startup');
      }

      return { success: true, enabled: shouldEnable };
    } catch (error) {
      console.error('[Startup] Failed to set startup:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerStartupIpcHandlers,
};
