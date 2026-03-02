/**
 * ZOHO Mail Integration - Main Module
 *
 * Exports all ZOHO Mail integration functionality
 * This module is designed to be completely isolated and optional
 */

const config = require('./config');
const oauth = require('./oauth');
const mailApi = require('./mail-api');
const webhookHandler = require('./webhook-handler');
const dbHelper = require('./db-helper');
const sync = require('./sync');

// Log module initialization
if (config.isConfigured()) {
  console.log('[ZOHO] Module loaded and configured');
} else {
  console.log('[ZOHO] Module loaded but not configured (missing credentials or disabled)');
}

module.exports = {
  // Configuration
  config,

  // OAuth handlers
  handleAuthStart: oauth.handleAuthStart,
  handleAuthCallback: oauth.handleAuthCallback,
  refreshAccessToken: oauth.refreshAccessToken,
  getValidAccessToken: oauth.getValidAccessToken,

  // Mail API
  fetchMessages: mailApi.fetchMessages,
  fetchMessageDetails: mailApi.fetchMessageDetails,
  fetchFolders: mailApi.fetchFolders,
  searchMessages: mailApi.searchMessages,

  // Webhook handler
  handleWebhook: webhookHandler.handleWebhook,
  verifyWebhookSignature: webhookHandler.verifyWebhookSignature,
  processNewMessage: webhookHandler.processNewMessage,

  // Database helpers
  saveOAuthTokens: dbHelper.saveOAuthTokens,
  getOAuthTokens: dbHelper.getOAuthTokens,
  updateOAuthTokens: dbHelper.updateOAuthTokens,
  saveEmailInquiry: dbHelper.saveEmailInquiry,
  getEmailInquiriesBySource: dbHelper.getEmailInquiriesBySource,
  getEmailStats: dbHelper.getEmailStats,

  // Sync manager
  performFullSync: sync.performFullSync,
  performIncrementalSync: sync.performIncrementalSync,
  startPeriodicSync: sync.startPeriodicSync,
  stopPeriodicSync: sync.stopPeriodicSync
};
