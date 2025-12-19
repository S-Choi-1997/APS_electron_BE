/**
 * ZOHO Mail Integration - Configuration
 *
 * Centralized configuration for ZOHO Mail OAuth and API settings
 */

module.exports = {
  // OAuth 2.0 credentials
  clientId: process.env.ZOHO_CLIENT_ID || '',
  clientSecret: process.env.ZOHO_CLIENT_SECRET || '',
  redirectUri: process.env.ZOHO_REDIRECT_URI || 'http://localhost:3001/auth/zoho/callback',

  // ZOHO API endpoints
  authUrl: 'https://accounts.zoho.com/oauth/v2/auth',
  tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
  apiBaseUrl: 'https://mail.zoho.com/api',

  // Webhook configuration
  webhookUrl: process.env.ZOHO_WEBHOOK_URL || '',
  webhookSecret: process.env.ZOHO_WEBHOOK_SECRET || '',

  // Feature flag
  enabled: process.env.ZOHO_ENABLED === 'true',

  // Account to monitor
  accountEmail: process.env.ZOHO_ACCOUNT_EMAIL || '',

  // Scopes required for mail access
  scopes: [
    'ZohoMail.messages.READ',
    'ZohoMail.folders.READ',
    'ZohoMail.accounts.READ'
  ].join(','),

  // Validation
  isConfigured() {
    return !!(this.clientId && this.clientSecret && this.enabled);
  }
};
