function registerIntegration(app, auth, asyncHandler, zohoRoutes) {
const PORT = process.env.PORT || 3001;
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

    // Webhook endpoint
    app.post('/api/zoho/webhook', (req, res, next) => {
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
      try {
        console.log('[ZOHO] Checking OAuth tokens before initial sync...');

        // Sync tokens from Firestore to PostgreSQL on startup
        const { getTokensFromFirestore } = require('./zoho/firestore-token-storage');
        const { saveOAuthTokens } = require('./zoho/db-helper');
        const zohoEmail = process.env.ZOHO_ACCOUNT_EMAIL;

        if (zohoEmail) {
          try {
            const firestoreToken = await getTokensFromFirestore(zohoEmail);
            if (firestoreToken) {
              console.log('[ZOHO] Syncing tokens from Firestore to PostgreSQL...');
              await saveOAuthTokens({
                accessToken: firestoreToken.access_token,
                refreshToken: firestoreToken.refresh_token,
                expiresIn: Math.floor((new Date(firestoreToken.expires_at) - Date.now()) / 1000),
                tokenType: firestoreToken.token_type,
                zohoEmail: firestoreToken.zoho_email,
                zohoUserId: firestoreToken.zoho_user_id
              });
              console.log('[ZOHO] Tokens synced successfully, performing initial full sync...');
            } else {
              console.log('[ZOHO] No tokens found in Firestore. Please authorize ZOHO first:');
              console.log(`[ZOHO]   1. Visit: http://localhost:${PORT}/api/zoho/auth/start`);
              console.log('[ZOHO]   2. After authorization, trigger sync via POST /api/zoho/sync');
              return;
            }
          } catch (syncError) {
            console.warn('[ZOHO] Token sync failed:', syncError.message);
            console.log('[ZOHO] Skipping initial sync. Please authorize ZOHO first:');
            console.log(`[ZOHO]   1. Visit: http://localhost:${PORT}/api/zoho/auth/start`);
            console.log('[ZOHO]   2. After authorization, trigger sync via POST /api/zoho/sync');
            return;
          }
        }

        const result = await zoho.performFullSync();
        console.log(`[ZOHO] Initial sync completed: ${result.new} new, ${result.skipped} skipped`);
        console.log('[ZOHO] Webhook mode: Will receive new emails via webhook in real-time');
      } catch (error) {
        console.error('[ZOHO] Initial sync failed:', error.message);
        console.log('[ZOHO] You can manually trigger sync via POST /api/zoho/sync');
      }
    }, 5000); // Wait 5 seconds after server start

    console.log('✓ ZOHO Mail integration enabled (Webhook mode)');
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
