function createAutoUpdaterManager({
  app,
  getUpdateLogPath,
  sendToMainWindow,
  updateCheckIntervalMs = 30 * 60 * 1000,
}) {
  const autoUpdateEnabled = app.isPackaged
    ? process.env.APS_DISABLE_AUTO_UPDATE !== 'true'
    : process.env.APS_ENABLE_AUTO_UPDATE === 'true';

  let autoUpdater = null;
  let isUpdateDownloading = false;
  let updateCheckInterval = null;
  let latestUpdateState = {
    status: 'idle',
    info: null,
    progress: null,
    errorMessage: null,
    isDownloaded: false,
    isDownloading: false,
    checkedAt: null,
  };

  function logUpdate(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log('[AutoUpdater]', message);
    try {
      require('fs').appendFileSync(getUpdateLogPath(), logMessage);
    } catch (e) {
      console.error('Failed to write update log:', e);
    }
  }

  function setLatestUpdateState(partialState) {
    latestUpdateState = {
      ...latestUpdateState,
      ...partialState,
      checkedAt: new Date().toISOString(),
    };
    return latestUpdateState;
  }

  function init() {
    logUpdate(`initAutoUpdater called. app.isPackaged: ${app.isPackaged}`);

    if (!autoUpdateEnabled) {
      logUpdate('AutoUpdater disabled. App releases are distributed manually.');
      return;
    }

    if (!app.isPackaged) {
      logUpdate('Skipping in development mode');
      return;
    }

    try {
      logUpdate('Loading electron-updater...');
      autoUpdater = require('electron-updater').autoUpdater;
      logUpdate('electron-updater loaded successfully');
    } catch (e) {
      logUpdate(`Failed to load electron-updater: ${e.message}\n${e.stack}`);
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('checking-for-update', () => {
      logUpdate('Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
      const version = info?.version || 'unknown';
      logUpdate(`Update available: ${version}`);
      const payload = { version, releaseNotes: info?.releaseNotes || '' };

      setLatestUpdateState({
        status: 'available',
        info: payload,
        progress: null,
        errorMessage: null,
        isDownloaded: false,
        isDownloading: false,
      });
      sendToMainWindow('update-available', payload);
    });

    autoUpdater.on('update-not-available', () => {
      const currentVersion = app.getVersion();
      logUpdate(`No update available. Current version: ${currentVersion} is latest.`);
      const payload = { currentVersion };

      setLatestUpdateState({
        status: 'not-available',
        info: null,
        progress: null,
        errorMessage: null,
        isDownloaded: false,
        isDownloading: false,
      });
      sendToMainWindow('update-not-available', payload);
    });

    autoUpdater.on('error', (error) => {
      logUpdate(`Update error: ${error.message}`);
      isUpdateDownloading = false;
      const payload = { message: error.message };

      setLatestUpdateState({
        status: 'error',
        progress: null,
        errorMessage: error.message,
        isDownloaded: false,
        isDownloading: false,
      });
      sendToMainWindow('update-error', payload);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      logUpdate(`Download progress: ${progressObj.percent.toFixed(1)}%`);
      const payload = {
        percent: progressObj.percent,
        bytesPerSecond: progressObj.bytesPerSecond,
        transferred: progressObj.transferred,
        total: progressObj.total,
      };

      setLatestUpdateState({
        status: 'downloading',
        progress: payload,
        errorMessage: null,
        isDownloaded: false,
        isDownloading: true,
      });
      sendToMainWindow('update-download-progress', payload);
    });

    autoUpdater.on('update-downloaded', (info) => {
      const version = info?.version || 'unknown';
      logUpdate(`Update downloaded: ${version}`);
      isUpdateDownloading = false;
      const payload = { version };

      setLatestUpdateState({
        status: 'downloaded',
        info: latestUpdateState.info || payload,
        progress: { percent: 100, transferred: 0, total: 0 },
        errorMessage: null,
        isDownloaded: true,
        isDownloading: false,
      });
      sendToMainWindow('update-downloaded', payload);
    });

    console.log('[AutoUpdater] Initialized successfully');
  }

  function checkForUpdatesSafely(reason = 'manual') {
    if (!autoUpdater) return;
    if (isUpdateDownloading) {
      logUpdate(`Skipping update check (${reason}) because download is already in progress`);
      return;
    }

    logUpdate(`Checking for updates (${reason})...`);
    autoUpdater.checkForUpdates().catch((error) => {
      logUpdate(`Update check failed (${reason}): ${error.message}`);
    });
  }

  function scheduleChecks() {
    if (!autoUpdater) return;

    setTimeout(() => {
      checkForUpdatesSafely('startup');
    }, 3000);

    if (updateCheckInterval) {
      clearInterval(updateCheckInterval);
    }

    updateCheckInterval = setInterval(() => {
      checkForUpdatesSafely('30-minute interval');
    }, updateCheckIntervalMs);

    updateCheckInterval.unref?.();
  }

  async function checkForUpdates() {
    if (!autoUpdater) {
      return {
        success: false,
        disabled: !autoUpdateEnabled,
        error: autoUpdateEnabled ? '개발 모드에서는 자동 업데이트를 사용할 수 없습니다.' : '수동 배포 모드에서는 자동 업데이트가 비활성화되어 있습니다.',
      };
    }
    logUpdate('Manual update check triggered');
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, result };
    } catch (err) {
      logUpdate(`Manual update check error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  function installUpdate() {
    if (!autoUpdater) {
      return { success: false, error: '자동 업데이트를 사용할 수 없습니다.' };
    }

    logUpdate('User requested update installation');
    app.isQuitting = true;

    setTimeout(() => {
      autoUpdater.quitAndInstall(true, true);
    }, 500);

    return { success: true };
  }

  async function downloadUpdate() {
    if (!autoUpdater) {
      return { success: false, error: '자동 업데이트를 사용할 수 없습니다.' };
    }

    if (isUpdateDownloading) {
      logUpdate('Download already in progress, ignoring duplicate request');
      return { success: false, error: '이미 업데이트를 다운로드하고 있습니다.' };
    }

    logUpdate('Manual download triggered by user');
    isUpdateDownloading = true;

    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      isUpdateDownloading = false;
      logUpdate(`Download error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  function shutdown() {
    if (updateCheckInterval) {
      clearInterval(updateCheckInterval);
      updateCheckInterval = null;
      console.log('[Shutdown] Update check interval cleared');
    }
  }

  function registerIpcHandlers(ipcMain) {
    ipcMain.handle('get-app-version', async () => {
      return app.getVersion();
    });

    ipcMain.handle('get-auto-update-enabled', async () => {
      return autoUpdateEnabled && Boolean(autoUpdater);
    });

    ipcMain.handle('get-update-state', async () => {
      return latestUpdateState;
    });

    ipcMain.handle('check-for-updates', async () => {
      return checkForUpdates();
    });

    ipcMain.handle('install-update', async () => {
      return installUpdate();
    });

    ipcMain.handle('download-update', async () => {
      return downloadUpdate();
    });
  }

  return {
    downloadUpdate,
    checkForUpdates,
    getEnabled: () => autoUpdateEnabled && Boolean(autoUpdater),
    getState: () => latestUpdateState,
    init,
    installUpdate,
    registerIpcHandlers,
    scheduleChecks,
    shutdown,
  };
}

module.exports = {
  createAutoUpdaterManager,
};
