/**
 * ZOHO Mail Integration - Route Handlers
 *
 * Extracted route logic that can be called from both:
 * - Express routes (direct HTTP)
 * - WebSocket tunnel handler (relay)
 */

const zoho = require('./sync');

/**
 * Handle ZOHO sync request
 * Can be called from both Express router and WebSocket tunnel
 *
 * @param {Object} user - Authenticated user object from JWT
 * @returns {Object} Response object with status and body
 */
async function handleZohoSync(user) {
  try {
    console.log(`[ZOHO Routes] Sync requested by: ${user?.email || 'unknown'}`);

    const result = await zoho.performFullSync();

    return {
      status: 200,
      body: {
        success: true,
        message: 'Sync completed',
        ...result
      }
    };
  } catch (error) {
    console.error('[ZOHO Routes] Sync failed:', error.message);

    return {
      status: 500,
      body: {
        error: 'Sync failed',
        message: error.message
      }
    };
  }
}

module.exports = {
  handleZohoSync
};
