const { execFileSync } = require('child_process');

const STARTUP_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const STARTUP_APPROVED_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

function getStartupExePath(app) {
  return app.getPath('exe');
}

function runReg(args) {
  return execFileSync('reg', args, {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function queryLegacyRunValue(appName) {
  try {
    const result = runReg(['query', STARTUP_REG_KEY, '/v', appName]);
    return {
      exists: true,
      raw: result,
      enabled: result.includes(appName),
    };
  } catch (error) {
    return {
      exists: false,
      raw: '',
      enabled: false,
    };
  }
}

function queryStartupApprovedValue(appName) {
  try {
    const result = runReg(['query', STARTUP_APPROVED_REG_KEY, '/v', appName]);
    return {
      exists: true,
      raw: result,
    };
  } catch (error) {
    return {
      exists: false,
      raw: '',
    };
  }
}

function writeLegacyRunValue(appName, exePath) {
  runReg([
    'add',
    STARTUP_REG_KEY,
    '/v',
    appName,
    '/t',
    'REG_SZ',
    '/d',
    `"${exePath}"`,
    '/f',
  ]);
}

function applyLoginItemSettings(app, appName, enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    enabled,
    path: getStartupExePath(app),
    args: [],
    name: appName,
  });
}

function reconcileStartupRegistration(app, appName) {
  if (process.platform !== 'win32') {
    return { success: true, skipped: true, reason: 'not-windows' };
  }

  try {
    const legacyRunValue = queryLegacyRunValue(appName);
    if (!legacyRunValue.exists) {
      return { success: true, skipped: true, reason: 'startup-not-enabled' };
    }

    const startupApprovedValue = queryStartupApprovedValue(appName);
    if (startupApprovedValue.exists) {
      return { success: true, skipped: true, reason: 'already-approved-state-present' };
    }

    applyLoginItemSettings(app, appName, true);
    const state = getStartupState(app, appName);
    console.log('[Startup] Reconciled startup registration after update:', {
      enabled: state.enabled,
      exePath: state.exePath,
    });

    return {
      ...state,
      success: state.enabled,
      migrated: true,
    };
  } catch (error) {
    console.error('[Startup] Failed to reconcile startup registration:', error);
    return { success: false, error: error.message };
  }
}

function deleteLegacyRunValue(appName) {
  try {
    runReg(['delete', STARTUP_REG_KEY, '/v', appName, '/f']);
  } catch (error) {
    // Missing value is fine. Electron's login item API is the source of truth.
  }
}

function getStartupState(app, appName) {
  const exePath = getStartupExePath(app);

  try {
    const loginItem = app.getLoginItemSettings({
      path: exePath,
      args: [],
    });
    const legacyRunValue = queryLegacyRunValue(appName);
    const startupApprovedValue = queryStartupApprovedValue(appName);
    const enabled = Boolean(
      process.platform === 'win32'
        ? loginItem.executableWillLaunchAtLogin
        : loginItem.openAtLogin
    );

    return {
      success: true,
      enabled,
      exePath,
      loginItem,
      legacyRunValue,
      startupApprovedValue,
    };
  } catch (error) {
    const legacyRunValue = queryLegacyRunValue(appName);
    const startupApprovedValue = queryStartupApprovedValue(appName);

    return {
      success: true,
      enabled: legacyRunValue.enabled,
      exePath,
      loginItem: null,
      legacyRunValue,
      startupApprovedValue,
      warning: error.message,
    };
  }
}

function registerStartupIpcHandlers({ app, appName, ipcMain }) {
  ipcMain.handle('get-startup-enabled', async () => {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: 'Startup registration is only supported on Windows.' };
      }

      return getStartupState(app, appName);
    } catch (error) {
      return { success: false, enabled: false, error: error.message };
    }
  });

  ipcMain.handle('set-startup-enabled', async (_event, enabled) => {
    try {
      if (process.platform !== 'win32') {
        return { success: false, error: 'Startup registration is only supported on Windows.' };
      }

      const exePath = getStartupExePath(app);
      const shouldEnable = Boolean(enabled);

      applyLoginItemSettings(app, appName, shouldEnable);

      let state = getStartupState(app, appName);

      if (shouldEnable && !state.enabled) {
        writeLegacyRunValue(appName, exePath);
        state = getStartupState(app, appName);
      }

      if (!shouldEnable) {
        deleteLegacyRunValue(appName);
        state = getStartupState(app, appName);
      }

      const success = state.enabled === shouldEnable;
      console.log(`[Startup] ${shouldEnable ? 'Enabled' : 'Disabled'} startup:`, {
        success,
        enabled: state.enabled,
        exePath,
      });

      return {
        ...state,
        success,
        error: success ? undefined : 'Windows did not apply the startup setting.',
      };
    } catch (error) {
      console.error('[Startup] Failed to set startup:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  reconcileStartupRegistration,
  registerStartupIpcHandlers,
};
