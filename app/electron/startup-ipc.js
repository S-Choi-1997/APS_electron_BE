const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STARTUP_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const STARTUP_APPROVED_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const STARTUP_APPROVED_ENABLED = '020000000000000000000000';

function getStartupExePath(app) {
  return app.getPath('exe');
}

function getStartupIntentPath(app) {
  return path.join(app.getPath('userData'), 'startup-intent.json');
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
    const value = parseRegValueData(result, 'REG_SZ');
    return {
      exists: true,
      raw: result,
      value,
      enabled: Boolean(value),
    };
  } catch (error) {
    return {
      exists: false,
      raw: '',
      value: '',
      enabled: false,
    };
  }
}

function queryStartupApprovedValue(appName) {
  try {
    const result = runReg(['query', STARTUP_APPROVED_REG_KEY, '/v', appName]);
    const value = parseRegValueData(result, 'REG_BINARY');
    const firstByte = value.slice(0, 2).toLowerCase();
    return {
      exists: true,
      raw: result,
      value,
      enabled: firstByte === '02',
      disabled: firstByte === '03',
    };
  } catch (error) {
    return {
      exists: false,
      raw: '',
      value: '',
      enabled: false,
      disabled: false,
    };
  }
}

function parseRegValueData(raw, typeName) {
  const line = raw
    .split(/\r?\n/)
    .find((entry) => entry.includes(typeName));

  if (!line) return '';

  const markerIndex = line.indexOf(typeName);
  if (markerIndex === -1) return '';

  return line.slice(markerIndex + typeName.length).trim();
}

function isRunValueCurrent(runValue, exePath) {
  const normalizedRunValue = String(runValue || '').trim().toLowerCase();
  const normalizedExePath = String(exePath || '').trim().toLowerCase();
  if (!normalizedRunValue || !normalizedExePath) return false;

  const quotedPrefix = `"${normalizedExePath}"`;
  let args = '';

  if (normalizedRunValue.startsWith(quotedPrefix)) {
    args = normalizedRunValue.slice(quotedPrefix.length).trim();
  } else if (normalizedRunValue.startsWith(normalizedExePath)) {
    args = normalizedRunValue.slice(normalizedExePath.length).trim();
  } else {
    return false;
  }

  return /(?:^|\s)--startup(?:\s|$)/i.test(args);
}

function readStartupIntent(app) {
  try {
    const data = JSON.parse(fs.readFileSync(getStartupIntentPath(app), 'utf8'));
    return typeof data.enabled === 'boolean' ? data.enabled : null;
  } catch (error) {
    return null;
  }
}

function writeStartupIntent(app, enabled) {
  try {
    fs.writeFileSync(
      getStartupIntentPath(app),
      JSON.stringify({
        enabled: Boolean(enabled),
        updatedAt: new Date().toISOString(),
      }, null, 2)
    );
  } catch (error) {
    console.warn('[Startup] Failed to persist startup intent:', error.message);
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
    `"${exePath}" --startup`,
    '/f',
  ]);
}

function writeStartupApprovedEnabledValue(appName) {
  runReg([
    'add',
    STARTUP_APPROVED_REG_KEY,
    '/v',
    appName,
    '/t',
    'REG_BINARY',
    '/d',
    STARTUP_APPROVED_ENABLED,
    '/f',
  ]);
}

function applyLoginItemSettings(app, appName, enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    enabled,
    path: getStartupExePath(app),
    args: enabled ? ['--startup'] : [],
    name: appName,
  });
}

function applyStartupEnabled(app, appName) {
  const exePath = getStartupExePath(app);

  writeStartupIntent(app, true);
  applyLoginItemSettings(app, appName, true);
  writeLegacyRunValue(appName, exePath);
  writeStartupApprovedEnabledValue(appName);

  return getStartupState(app, appName);
}

function reconcileStartupRegistration(app, appName) {
  if (process.platform !== 'win32') {
    return { success: true, skipped: true, reason: 'not-windows' };
  }

  try {
    const state = getStartupState(app, appName);
    if (!state.desiredEnabled) {
      return { ...state, success: true, skipped: true, reason: 'startup-not-desired' };
    }

    if (state.blockedByWindows) {
      return { ...state, success: true, skipped: true, reason: 'startup-disabled-by-windows' };
    }

    if (state.effectiveEnabled) {
      return { ...state, success: true, skipped: true, reason: 'startup-registration-current' };
    }

    const restoredState = applyStartupEnabled(app, appName);
    console.log('[Startup] Reconciled startup registration after update:', {
      desiredEnabled: restoredState.desiredEnabled,
      effectiveEnabled: restoredState.effectiveEnabled,
      exePath: restoredState.exePath,
      legacyRunValue: restoredState.legacyRunValue.value,
      startupApprovedValue: restoredState.startupApprovedValue.value,
    });

    return {
      ...restoredState,
      success: restoredState.effectiveEnabled,
      restored: true,
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

function deleteStartupApprovedValue(appName) {
  try {
    runReg(['delete', STARTUP_APPROVED_REG_KEY, '/v', appName, '/f']);
  } catch (error) {
    // Missing value is fine. Desired state is persisted separately.
  }
}

function buildStartupState({
  exePath,
  loginItem,
  legacyRunValue,
  startupApprovedValue,
  runValueCurrent,
  startupIntent,
  warning,
}) {
  const effectiveEnabled = Boolean(
    process.platform === 'win32'
      ? runValueCurrent && startupApprovedValue.enabled
      : loginItem?.openAtLogin
  );
  const desiredEnabled = typeof startupIntent === 'boolean'
    ? startupIntent
    : Boolean(runValueCurrent || loginItem?.openAtLogin);
  const blockedByWindows = Boolean(
    process.platform === 'win32'
      && desiredEnabled
      && runValueCurrent
      && startupApprovedValue.disabled
  );

  return {
    success: true,
    enabled: desiredEnabled,
    desiredEnabled,
    effectiveEnabled,
    blockedByWindows,
    registrationCurrent: effectiveEnabled,
    exePath,
    loginItem,
    legacyRunValue,
    startupApprovedValue,
    runValueCurrent,
    startupIntent,
    warning,
  };
}

function getStartupState(app, appName) {
  const exePath = getStartupExePath(app);
  const startupIntent = readStartupIntent(app);

  try {
    const loginItem = app.getLoginItemSettings({
      path: exePath,
      args: ['--startup'],
    });
    const legacyRunValue = queryLegacyRunValue(appName);
    const startupApprovedValue = queryStartupApprovedValue(appName);
    const runValueCurrent = isRunValueCurrent(legacyRunValue.value, exePath);

    return buildStartupState({
      exePath,
      loginItem,
      legacyRunValue,
      startupApprovedValue,
      runValueCurrent,
      startupIntent,
    });
  } catch (error) {
    const legacyRunValue = queryLegacyRunValue(appName);
    const startupApprovedValue = queryStartupApprovedValue(appName);
    const runValueCurrent = isRunValueCurrent(legacyRunValue.value, exePath);

    return buildStartupState({
      exePath,
      loginItem: null,
      legacyRunValue,
      startupApprovedValue,
      runValueCurrent,
      startupIntent,
      warning: error.message,
    });
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

      let state;
      if (shouldEnable) {
        state = applyStartupEnabled(app, appName);
      } else {
        writeStartupIntent(app, false);
        applyLoginItemSettings(app, appName, false);
        deleteLegacyRunValue(appName);
        deleteStartupApprovedValue(appName);
        state = getStartupState(app, appName);
      }

      const success = shouldEnable
        ? state.desiredEnabled && state.effectiveEnabled
        : !state.desiredEnabled && !state.effectiveEnabled;
      console.log(`[Startup] ${shouldEnable ? 'Enabled' : 'Disabled'} startup:`, {
        success,
        desiredEnabled: state.desiredEnabled,
        effectiveEnabled: state.effectiveEnabled,
        exePath,
        legacyRunValue: state.legacyRunValue.value,
        startupApprovedValue: state.startupApprovedValue.value,
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
  getStartupState,
  reconcileStartupRegistration,
  registerStartupIpcHandlers,
};
