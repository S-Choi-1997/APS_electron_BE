const db = require('./db');

const MAX_EVENTS_PER_REPORT = 500;
const MAX_PAYLOAD_BYTES = 512 * 1024;
const MAX_STRING_LENGTH = 1200;
const MAX_QUERY_LIMIT = 200;
const REDACT_KEY_PATTERN = /(authorization|cookie|password|refresh|secret|token)/i;

async function ensureStartupDiagnosticsSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS startup_diagnostic_reports (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      app_version TEXT,
      machine_id_hash TEXT,
      launch_id TEXT,
      batch_id TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      truncated BOOLEAN NOT NULL DEFAULT FALSE,
      client_created_at TIMESTAMPTZ,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_startup_diagnostic_reports_user_created
    ON startup_diagnostic_reports (user_email, created_at DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_startup_diagnostic_reports_machine_created
    ON startup_diagnostic_reports (machine_id_hash, created_at DESC)
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_startup_diagnostic_reports_user_batch
    ON startup_diagnostic_reports (user_email, batch_id)
  `);
}

function parseClientDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parsePositiveInt(value, fallback, max = MAX_QUERY_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function isAdminRole(role) {
  return ['admin', 'super_admin', 'owner'].includes(String(role || '').toLowerCase());
}

function requireAdmin(req, res) {
  if (isAdminRole(req.user?.role)) return true;
  res.status(403).json({ error: 'forbidden', message: 'Admin role is required.' });
  return false;
}

function sanitizeString(value) {
  let sanitized = String(value || '');
  sanitized = sanitized.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
  sanitized = sanitized.replace(/([?&](?:access_token|auth|authorization|key|password|refresh_token|secret|token)=)[^&\s]+/gi, '$1[redacted]');
  return sanitized.length > MAX_STRING_LENGTH
    ? `${sanitized.slice(0, MAX_STRING_LENGTH)}...[truncated]`
    : sanitized;
}

function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 5) return '[max-depth]';

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

function pickObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeEvent(event) {
  const source = pickObject(event);
  return {
    id: sanitizeValue(source.id),
    launchId: sanitizeValue(source.launchId),
    sequence: sanitizeValue(source.sequence),
    event: sanitizeValue(source.event),
    timestamp: sanitizeValue(source.timestamp),
    msSinceProcessStart: sanitizeValue(source.msSinceProcessStart),
    pid: sanitizeValue(source.pid),
    appVersion: sanitizeValue(source.appVersion),
    startupLaunch: sanitizeValue(source.startupLaunch),
    data: sanitizeValue(pickObject(source.data)),
  };
}

function sanitizeReportPayload(payload) {
  const source = pickObject(payload);
  const snapshot = sanitizeValue(pickObject(source.snapshot));
  const events = Array.isArray(source.events) ? source.events.map(sanitizeEvent) : [];

  return {
    batchId: sanitizeValue(source.batchId),
    generatedAt: sanitizeValue(source.generatedAt),
    launchId: sanitizeValue(source.launchId),
    appVersion: sanitizeValue(source.appVersion),
    machineIdHash: sanitizeValue(source.machineIdHash),
    totalEvents: sanitizeValue(source.totalEvents),
    eventCount: events.length,
    truncated: Boolean(source.truncated),
    snapshot,
    events,
  };
}

function validateReportPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Request body must be a diagnostics report object.';
  }

  if (!payload.batchId || typeof payload.batchId !== 'string') {
    return 'batchId is required.';
  }

  if (!Array.isArray(payload.events)) {
    return 'events must be an array.';
  }

  if (payload.events.length === 0) {
    return 'events must not be empty.';
  }

  if (payload.events.length > MAX_EVENTS_PER_REPORT) {
    return `events must contain ${MAX_EVENTS_PER_REPORT} or fewer entries.`;
  }

  const byteLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (byteLength > MAX_PAYLOAD_BYTES) {
    return `diagnostics report exceeds ${MAX_PAYLOAD_BYTES} bytes.`;
  }

  return null;
}

function registerRoutes(app, auth) {
  app.post('/diagnostics/startup-events', auth.authenticateJWT, async (req, res) => {
    try {
      const validationError = validateReportPayload(req.body);
      if (validationError) {
        return res.status(400).json({
          error: 'bad_request',
          message: validationError,
        });
      }

      const report = sanitizeReportPayload(req.body);
      const snapshot = report.snapshot && typeof report.snapshot === 'object'
        ? report.snapshot
        : {};
      const eventCount = report.events.length;
      const clientCreatedAt = parseClientDate(report.generatedAt);

      const result = await db.query(
        `INSERT INTO startup_diagnostic_reports (
           user_email,
           app_version,
           machine_id_hash,
           launch_id,
           batch_id,
           event_count,
           truncated,
           client_created_at,
           payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (user_email, batch_id)
         DO UPDATE SET
           app_version = EXCLUDED.app_version,
           machine_id_hash = EXCLUDED.machine_id_hash,
           launch_id = EXCLUDED.launch_id,
           event_count = EXCLUDED.event_count,
           truncated = EXCLUDED.truncated,
           client_created_at = EXCLUDED.client_created_at,
           payload = EXCLUDED.payload
         RETURNING id, created_at`,
        [
          req.user.email,
          report.appVersion || snapshot.appVersion || null,
          report.machineIdHash || snapshot.machineIdHash || null,
          report.launchId || snapshot.launchId || null,
          report.batchId,
          eventCount,
          Boolean(report.truncated),
          clientCreatedAt,
          JSON.stringify(report),
        ]
      );

      res.json({
        status: 'ok',
        data: {
          id: result.rows[0].id,
          createdAt: result.rows[0].created_at,
          eventCount,
        },
      });
    } catch (error) {
      console.error('[StartupDiagnostics] Failed to store report:', error);
      res.status(500).json({ error: 'internal_error', message: error.message });
    }
  });

  app.get('/diagnostics/startup-events', auth.authenticateJWT, async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const limit = parsePositiveInt(req.query.limit, 50);
      const offset = parsePositiveInt(req.query.offset, 0, 100000);
      const filters = [];
      const params = [];

      function addFilter(sql, value) {
        if (value === undefined || value === null || String(value).trim() === '') return;
        params.push(String(value).trim());
        filters.push(sql.replace('?', `$${params.length}`));
      }

      addFilter('user_email = ?', req.query.user || req.query.userEmail);
      addFilter('machine_id_hash = ?', req.query.machine || req.query.machineIdHash);
      addFilter('launch_id = ?', req.query.launchId);

      const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      params.push(limit, offset);

      const result = await db.query(
        `SELECT
           id,
           user_email,
           app_version,
           machine_id_hash,
           launch_id,
           batch_id,
           event_count,
           truncated,
           client_created_at,
           created_at,
           payload
         FROM startup_diagnostic_reports
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      res.json({
        status: 'ok',
        data: result.rows,
        count: result.rows.length,
        limit,
        offset,
      });
    } catch (error) {
      console.error('[StartupDiagnostics] Failed to fetch reports:', error);
      res.status(500).json({ error: 'internal_error', message: error.message });
    }
  });
}

module.exports = {
  ensureStartupDiagnosticsSchema,
  registerRoutes,
  sanitizeReportPayload,
};
