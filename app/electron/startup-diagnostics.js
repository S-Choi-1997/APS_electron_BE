const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIAGNOSTICS_DIR_NAME = 'startup-diagnostics';
const EVENTS_FILE_NAME = 'startup-events.jsonl';
const MAX_EVENTS_PER_BATCH = 300;
const MAX_EVENTS_RETAINED = 1000;
const MAX_STRING_LENGTH = 1200;
const MAX_DATA_DEPTH = 5;
const REDACT_KEY_PATTERN = /(authorization|cookie|password|refresh|secret|token)/i;

function createHash(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex');
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

function getSafeAppPath(app, name) {
  try {
    return app.getPath(name);
  } catch (error) {
    return '';
  }
}

function getSafeAppVersion(app) {
  try {
    return app.getVersion();
  } catch (error) {
    return '';
  }
}

function getSafeIsPackaged(app) {
  try {
    return Boolean(app.isPackaged);
  } catch (error) {
    return false;
  }
}

function sanitizePath(value) {
  let result = String(value || '');
  const homeDir = os.homedir();
  if (homeDir) {
    result = result.replaceAll(homeDir, '%USERPROFILE%');
  }
  return result;
}

function sanitizeString(value) {
  const sanitized = sanitizePath(value);
  return sanitized.length > MAX_STRING_LENGTH
    ? `${sanitized.slice(0, MAX_STRING_LENGTH)}...[truncated]`
    : sanitized;
}

function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: sanitizeString(value.name),
      message: sanitizeString(value.message),
      stack: sanitizeString(value.stack || ''),
    };
  }
  if (depth >= MAX_DATA_DEPTH) return '[max-depth]';

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeValue(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
      if (REDACT_KEY_PATTERN.test(key)) {
        sanitized[key] = '[redacted]';
        continue;
      }
      sanitized[key] = sanitizeValue(entry, depth + 1);
    }
    return sanitized;
  }

  return sanitizeString(value);
}

function resolveDiagnosticsDir(app, appName) {
  const userDataPath = getSafeAppPath(app, 'userData');
  if (userDataPath) {
    return path.join(userDataPath, DIAGNOSTICS_DIR_NAME);
  }

  const appDataPath = process.env.APPDATA || process.env.LOCALAPPDATA || os.tmpdir();
  return path.join(appDataPath, appName || 'APS Admin', DIAGNOSTICS_DIR_NAME);
}

function readEventLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
}

function parseEventLine(line) {
  try {
    return JSON.parse(line);
  } catch (error) {
    return null;
  }
}

function writeEventLines(filePath, lines) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  fs.renameSync(tempPath, filePath);
}

function sanitizeStartupState(state) {
  const sanitized = sanitizeValue(state || {});
  if (sanitized?.legacyRunValue) {
    delete sanitized.legacyRunValue.raw;
  }
  if (sanitized?.startupApprovedValue) {
    delete sanitized.startupApprovedValue.raw;
  }
  return sanitized;
}

function createStartupDiagnostics({ app, appName, getStartupState }) {
  const launchId = createId('launch');
  const processStartedAt = Date.now();
  const bootTimeApprox = new Date(Date.now() - (os.uptime() * 1000)).toISOString();
  const machineIdHash = createHash(`aps-admin-startup:${os.hostname()}`);
  let sequence = 0;
  let pendingBatch = null;
  let cachedEventsPath = null;
  let diagnosticsDirReady = false;

  function getEventsPath() {
    if (!cachedEventsPath) {
      cachedEventsPath = path.join(resolveDiagnosticsDir(app, appName), EVENTS_FILE_NAME);
    }
    return cachedEventsPath;
  }

  function ensureDiagnosticsDir() {
    if (diagnosticsDirReady) return;
    fs.mkdirSync(path.dirname(getEventsPath()), { recursive: true });
    diagnosticsDirReady = true;
  }

  function pruneEventFile() {
    const eventsPath = getEventsPath();
    const lines = readEventLines(eventsPath);
    if (lines.length <= MAX_EVENTS_RETAINED) return;
    writeEventLines(eventsPath, lines.slice(-MAX_EVENTS_RETAINED));
  }

  function getSnapshot() {
    let startupState = null;
    let startupStateError = null;

    if (typeof getStartupState === 'function') {
      try {
        startupState = sanitizeStartupState(getStartupState());
      } catch (error) {
        startupStateError = error.message;
      }
    }

    return sanitizeValue({
      appName,
      appVersion: getSafeAppVersion(app),
      isPackaged: getSafeIsPackaged(app),
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      pid: process.pid,
      ppid: process.ppid,
      launchId,
      machineIdHash,
      processStartedAt: new Date(processStartedAt).toISOString(),
      bootTimeApprox,
      startupLaunch: process.argv.includes('--startup'),
      argv: process.argv,
      exePath: getSafeAppPath(app, 'exe'),
      userDataPath: getSafeAppPath(app, 'userData'),
      startupState,
      startupStateError,
    });
  }

  function record(eventName, data = {}) {
    const event = sanitizeValue({
      id: `${launchId}-${++sequence}`,
      launchId,
      sequence,
      event: String(eventName || 'unknown'),
      timestamp: new Date().toISOString(),
      msSinceProcessStart: Date.now() - processStartedAt,
      pid: process.pid,
      appVersion: getSafeAppVersion(app),
      startupLaunch: process.argv.includes('--startup'),
      data,
    });

    try {
      ensureDiagnosticsDir();
      fs.appendFileSync(getEventsPath(), `${JSON.stringify(event)}\n`, 'utf8');
      if (sequence % 25 === 0) {
        pruneEventFile();
      }
    } catch (error) {
      console.warn('[StartupDiagnostics] Failed to record event:', error.message);
    }

    return event;
  }

  function getPendingBatch() {
    try {
      ensureDiagnosticsDir();
      pruneEventFile();
      const eventsPath = getEventsPath();
      const lines = readEventLines(eventsPath);
      const events = lines.map(parseEventLine).filter(Boolean);
      if (events.length === 0) {
        return { success: true, batch: null };
      }

      const selectedEvents = events.slice(-MAX_EVENTS_PER_BATCH);
      const eventIds = selectedEvents.map((event) => event.id).filter(Boolean);
      const batchId = createHash(`${eventsPath}:${eventIds.join('|')}:${selectedEvents.length}`).slice(0, 32);
      pendingBatch = {
        batchId,
        eventIds,
      };

      return {
        success: true,
        batch: {
          batchId,
          generatedAt: new Date().toISOString(),
          launchId,
          appVersion: getSafeAppVersion(app),
          machineIdHash,
          totalEvents: events.length,
          eventCount: selectedEvents.length,
          truncated: events.length > selectedEvents.length,
          snapshot: getSnapshot(),
          events: selectedEvents,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  function markUploaded(batchId) {
    try {
      if (!pendingBatch || pendingBatch.batchId !== batchId) {
        return { success: false, error: 'Unknown startup diagnostics batch.' };
      }

      const uploadedIds = new Set(pendingBatch.eventIds);
      const eventsPath = getEventsPath();
      const remainingLines = readEventLines(eventsPath).filter((line) => {
        const event = parseEventLine(line);
        return !event?.id || !uploadedIds.has(event.id);
      });

      writeEventLines(eventsPath, remainingLines);
      pendingBatch = null;
      return { success: true, remainingEvents: remainingLines.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  function registerIpcHandlers(ipcMain) {
    ipcMain.handle('get-startup-diagnostics-batch', async () => getPendingBatch());
    ipcMain.handle('mark-startup-diagnostics-uploaded', async (_event, batchId) => markUploaded(batchId));
    ipcMain.handle('record-startup-diagnostic-event', async (_event, eventName, data = {}) => {
      record(eventName, data);
      return { success: true };
    });
  }

  return {
    getPendingBatch,
    getSnapshot,
    launchId,
    markUploaded,
    record,
    registerIpcHandlers,
  };
}

module.exports = {
  createStartupDiagnostics,
};
