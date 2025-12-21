/**
 * ZOHO Mail Integration - OAuth 2.0 Handler
 *
 * Handles OAuth 2.0 authentication flow with ZOHO Mail API
 */

const crypto = require('crypto');
const axios = require('axios');
const config = require('./config');
const { saveOAuthTokens, getOAuthTokens, updateOAuthTokens } = require('./db-helper');
const {
  saveTokensToFirestore,
  getTokensFromFirestore,
  updateAccessTokenInFirestore
} = require('./firestore-token-storage');

// Store state parameters temporarily (in production, use Redis or database)
const stateStore = new Map();

/**
 * Start OAuth flow - redirect user to ZOHO authorization page
 */
async function handleAuthStart(req, res) {
  try {
    // Generate state parameter for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    stateStore.set(state, { timestamp: Date.now() });

    // Clean up old states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, value] of stateStore.entries()) {
      if (value.timestamp < tenMinutesAgo) {
        stateStore.delete(key);
      }
    }

    // Build authorization URL
    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.append('client_id', config.clientId);
    authUrl.searchParams.append('redirect_uri', config.redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', config.scopes);
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('access_type', 'offline'); // Get refresh token
    authUrl.searchParams.append('prompt', 'consent'); // Force consent screen

    console.log('[ZOHO OAuth] Starting OAuth flow, redirecting to:', authUrl.origin);
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('[ZOHO OAuth] Error starting auth:', error);
    res.status(500).json({ error: 'Failed to start OAuth flow' });
  }
}

/**
 * Handle OAuth callback - exchange authorization code for tokens
 */
async function handleAuthCallback(req, res) {
  try {
    const { code, state, error } = req.query;

    // Handle OAuth error
    if (error) {
      console.error('[ZOHO OAuth] Authorization error:', error);
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>❌ Authorization Failed</h1>
            <p>Error: ${error}</p>
            <p><a href="/">Go back to home</a></p>
          </body>
        </html>
      `);
    }

    // Validate code
    if (!code) {
      return res.status(400).json({ error: 'Missing code parameter' });
    }

    // Validate state parameter (CSRF protection) - optional for initial setup
    if (state) {
      if (!stateStore.has(state)) {
        console.warn('[ZOHO OAuth] Invalid state parameter, but proceeding for initial setup');
        // return res.status(400).json({ error: 'Invalid state parameter' });
      } else {
        stateStore.delete(state);
      }
    } else {
      console.warn('[ZOHO OAuth] No state parameter provided - CSRF protection disabled for this request');
    }

    // Exchange authorization code for access token and refresh token
    const tokenResponse = await axios.post(config.tokenUrl, new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code'
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const {
      access_token,
      refresh_token,
      expires_in,
      token_type
    } = tokenResponse.data;

    // Get user info to get email
    const userInfoResponse = await axios.get('https://mail.zoho.com/api/accounts', {
      headers: {
        'Authorization': `${token_type} ${access_token}`
      }
    });

    // Use config email as primary, ZOHO accountName might not be full email
    const userEmail = config.accountEmail || userInfoResponse.data.data[0]?.accountName;
    const userId = userInfoResponse.data.data[0]?.accountId;

    const tokenData = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      tokenType: token_type,
      zohoEmail: userEmail,
      zohoUserId: userId
    };

    // Save tokens to Firestore (primary storage)
    await saveTokensToFirestore(tokenData);

    // Also save to PostgreSQL for backward compatibility (optional)
    try {
      await saveOAuthTokens(tokenData);
    } catch (dbError) {
      console.warn('[ZOHO OAuth] Failed to save to PostgreSQL (non-critical):', dbError.message);
    }

    console.log('[ZOHO OAuth] Authorization successful for:', userEmail);

    // Redirect to success page
    res.send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>✅ Authorization Successful</h1>
          <p>ZOHO Mail integration is now active for: <strong>${userEmail}</strong></p>
          <p>You can close this window and return to the application.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('[ZOHO OAuth] Error in callback:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>❌ Authorization Failed</h1>
          <p>Error: ${error.message}</p>
          <pre style="text-align: left; background: #f5f5f5; padding: 20px; border-radius: 8px;">${error.stack}</pre>
        </body>
      </html>
    `);
  }
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(refreshToken, zohoEmail) {
  try {
    console.log('[ZOHO OAuth] Refreshing access token for:', zohoEmail);

    // Call ZOHO token endpoint with refresh_token grant type
    const tokenResponse = await axios.post(config.tokenUrl, new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token'
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const {
      access_token,
      expires_in
    } = tokenResponse.data;

    // Update tokens in Firestore (primary storage)
    await updateAccessTokenInFirestore(zohoEmail, access_token, expires_in);

    // Also update PostgreSQL for backward compatibility (optional)
    try {
      await updateOAuthTokens(zohoEmail, {
        accessToken: access_token,
        expiresIn: expires_in
      });
    } catch (dbError) {
      console.warn('[ZOHO OAuth] Failed to update PostgreSQL (non-critical):', dbError.message);
    }

    console.log('[ZOHO OAuth] Access token refreshed for:', zohoEmail);
    return access_token;
  } catch (error) {
    console.error('[ZOHO OAuth] Error refreshing token:', error);
    throw error;
  }
}

/**
 * Get valid access token (refresh if expired)
 */
async function getValidAccessToken() {
  try {
    const zohoEmail = config.accountEmail;

    if (!zohoEmail) {
      throw new Error('ZOHO_ACCOUNT_EMAIL not configured');
    }

    // Fetch token from Firestore (primary storage)
    let tokenRecord = await getTokensFromFirestore(zohoEmail);

    // Fallback to PostgreSQL if not found in Firestore
    if (!tokenRecord) {
      console.log('[ZOHO OAuth] Token not found in Firestore, checking PostgreSQL...');
      try {
        const pgTokenRecord = await getOAuthTokens(zohoEmail);
        if (pgTokenRecord) {
          console.log('[ZOHO OAuth] Found token in PostgreSQL, migrating to Firestore...');
          // Migrate to Firestore
          await saveTokensToFirestore({
            accessToken: pgTokenRecord.access_token,
            refreshToken: pgTokenRecord.refresh_token,
            expiresIn: Math.floor((new Date(pgTokenRecord.expires_at) - Date.now()) / 1000),
            tokenType: pgTokenRecord.token_type || 'Bearer',
            zohoEmail: pgTokenRecord.zoho_email,
            zohoUserId: pgTokenRecord.zoho_user_id
          });
          tokenRecord = pgTokenRecord;
        }
      } catch (pgError) {
        console.warn('[ZOHO OAuth] PostgreSQL lookup failed (non-critical):', pgError.message);
      }
    }

    if (!tokenRecord) {
      throw new Error('No OAuth tokens found. Please authorize the application first.');
    }

    // Check if expired (with 5-minute buffer)
    const expiresAt = new Date(tokenRecord.expires_at);
    const now = new Date();
    const bufferMs = 5 * 60 * 1000; // 5 minutes

    if (expiresAt.getTime() - now.getTime() < bufferMs) {
      console.log('[ZOHO OAuth] Token expired or expiring soon, refreshing...');
      // Token expired or expiring soon, refresh it
      const newAccessToken = await refreshAccessToken(tokenRecord.refresh_token, zohoEmail);
      return newAccessToken;
    }

    // Token is still valid
    return tokenRecord.access_token;
  } catch (error) {
    console.error('[ZOHO OAuth] Error getting valid token:', error);
    throw error;
  }
}

module.exports = {
  handleAuthStart,
  handleAuthCallback,
  refreshAccessToken,
  getValidAccessToken
};
