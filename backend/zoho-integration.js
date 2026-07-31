function registerIntegration(app, auth, asyncHandler, zohoRoutes) {
const PORT = process.env.PORT || 3001;
const ZOHO_WEBHOOK_PATH = '/api/zoho/webhook';
const DEFAULT_PERIODIC_SYNC_MINUTES = 5;

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveNumberEnv(value, fallback, { min = 1, max = 1440 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isMissingZohoAuthorization(error) {
  return /no oauth tokens|authorize the application|zoho_account_email not configured/i.test(error?.message || '');
}

function getPeriodicSyncIntervalMinutes() {
  return parsePositiveNumberEnv(
    process.env.ZOHO_SYNC_INTERVAL_MINUTES,
    DEFAULT_PERIODIC_SYNC_MINUTES,
    { min: 1, max: 1440 }
  );
}

function logWebhookConfiguration(config) {
  if (!config.webhookUrl) {
    console.warn('[ZOHO] ZOHO_WEBHOOK_URL is not set. Webhook delivery must be configured in Zoho Mail admin.');
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(config.webhookUrl);
  } catch (error) {
    console.warn(`[ZOHO] ZOHO_WEBHOOK_URL is invalid: ${config.webhookUrl}`);
    return;
  }

  console.log(`[ZOHO] Configured webhook URL: ${parsedUrl.toString()}`);

  if (!parsedUrl.pathname.endsWith(ZOHO_WEBHOOK_PATH)) {
    console.warn(`[ZOHO] Webhook URL path should end with ${ZOHO_WEBHOOK_PATH}`);
  }

  if (process.env.NODE_ENV === 'production' && parsedUrl.protocol !== 'https:') {
    console.warn('[ZOHO] Production webhook URL should use HTTPS so Zoho can reach the backend reliably.');
  }

  if (parsedUrl.hostname === '136.113.67.193' && parsedUrl.port === '3001') {
    console.warn('[ZOHO] ZOHO_WEBHOOK_URL points to 136.113.67.193:3001, which is the power-state service, not the APS backend. Use https://backend.apsconsulting.kr/api/zoho/webhook.');
  }
}

function startPeriodicSyncFallback(zoho, { runImmediately = false } = {}) {
  const enabled = parseBooleanEnv(process.env.ZOHO_PERIODIC_SYNC_ENABLED, true);
  if (!enabled) {
    console.log('[ZOHO] Periodic incremental sync fallback disabled by ZOHO_PERIODIC_SYNC_ENABLED=false');
    return;
  }

  const intervalMinutes = getPeriodicSyncIntervalMinutes();
  zoho.startPeriodicSync(intervalMinutes, { runImmediately });
  console.log(`[ZOHO] Periodic incremental sync fallback enabled (every ${intervalMinutes} minutes)`);
}

// ============================================
// ZOHO Mail Integration (Optional Module)
// ============================================
if (process.env.ZOHO_CLIENT_ID && process.env.ZOHO_ENABLED === 'true') {
  try {
    const zoho = require('./zoho');

    // OAuth endpoints
    app.get('/auth/zoho', zoho.handleAuthStart);
    app.get('/api/zoho/auth/start', zoho.handleAuthStart);
    app.get('/auth/zoho/callback', zoho.handleAuthCallback);
    app.get('/api/zoho/auth/callback', zoho.handleAuthCallback);

    logWebhookConfiguration(zoho.config);

    // Webhook endpoint
    app.post(ZOHO_WEBHOOK_PATH, (req, res, next) => {
      console.log('[ZOHO Webhook] ========================================');
      console.log('[ZOHO Webhook] Received request');
      console.log('[ZOHO Webhook] Headers:', JSON.stringify(req.headers, null, 2));
      console.log('[ZOHO Webhook] Body:', JSON.stringify(req.body, null, 2));
      console.log('[ZOHO Webhook] ========================================');
      next();
    }, zoho.handleWebhook);

    // API endpoints for manual sync (optional)
    app.post('/api/zoho/sync', auth.authenticateJWT, asyncHandler(async (req, res) => {
      const result = await zohoRoutes.handleZohoSync(req.user);
      res.status(result.status).json(result.body);
    }));

    // Perform initial full sync on server start (only once)
    setTimeout(async () => {
      let canRunPeriodicFallback = true;
      try {
        console.log('[ZOHO] Checking OAuth tokens before initial sync...');

        await zoho.getValidAccessToken();
        console.log('[ZOHO] OAuth token ready, performing initial full sync...');
        const result = await zoho.performFullSync();
        console.log(`[ZOHO] Initial sync completed: ${result.new} new, ${result.skipped} skipped`);
        console.log('[ZOHO] Webhook mode: Will receive new emails via webhook in real-time, with periodic sync as fallback');
      } catch (error) {
        console.error('[ZOHO] Initial sync failed:', error.message);
        if (isMissingZohoAuthorization(error)) {
          canRunPeriodicFallback = false;
          console.log('[ZOHO] Please authorize ZOHO before sync can run:');
          console.log(`[ZOHO]   1. Visit: http://localhost:${PORT}/api/zoho/auth/start`);
          console.log('[ZOHO]   2. After authorization, trigger sync via POST /api/zoho/sync');
        } else {
          console.log('[ZOHO] Periodic sync fallback will keep retrying. You can also manually trigger sync via POST /api/zoho/sync');
        }
      } finally {
        if (canRunPeriodicFallback) {
          startPeriodicSyncFallback(zoho, { runImmediately: false });
        }
      }
    }, 5000); // Wait 5 seconds after server start

    console.log('✓ ZOHO Mail integration enabled (Webhook + periodic fallback mode)');
  } catch (error) {
    console.warn('[ZOHO] Failed to load ZOHO module:', error.message);
    console.log('[ZOHO] Continuing without ZOHO integration');
  }
} else {
  console.log('[ZOHO] Integration disabled (set ZOHO_ENABLED=true and configure credentials to enable)');
}


}

module.exports = {
  registerIntegration,
};
