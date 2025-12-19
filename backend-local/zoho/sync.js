/**
 * ZOHO Mail Integration - Sync Manager
 *
 * Handles periodic synchronization of ZOHO Mail messages
 */

const { fetchMessages, parseMessageToInquiry } = require('./mail-api');
const { saveEmailInquiry, getEmailInquiriesBySource } = require('./db-helper');

// Store last sync timestamp
let lastSyncTime = null;

// Store interval ID for periodic sync
let syncIntervalId = null;

/**
 * Perform full sync of ZOHO Mail messages
 */
async function performFullSync(options = {}) {
  try {
    const { limit = 100, folder = 'Inbox' } = options;

    console.log('[ZOHO Sync] Starting full sync...');
    const startTime = Date.now();

    // Fetch messages from ZOHO Mail API
    const messages = await fetchMessages({ limit, folder });

    let newCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    // Process each message
    for (const message of messages) {
      try {
        // Parse message to inquiry format
        const inquiry = parseMessageToInquiry(message);

        // Save to database (will skip if already exists)
        const saved = await saveEmailInquiry(inquiry);

        if (saved) {
          newCount++;
          // Emit WebSocket event for real-time updates
          if (global.broadcastEvent) {
            global.broadcastEvent('email:created', saved);
          }
        } else {
          skipCount++;
        }
      } catch (error) {
        console.error('[ZOHO Sync] Error processing message:', error.message);
        errorCount++;
      }
    }

    // Update last sync time
    lastSyncTime = new Date();

    const duration = Date.now() - startTime;
    console.log(`[ZOHO Sync] Full sync completed in ${duration}ms`);
    console.log(`[ZOHO Sync] Stats: ${newCount} new, ${skipCount} skipped, ${errorCount} errors`);

    return {
      success: true,
      total: messages.length,
      new: newCount,
      skipped: skipCount,
      errors: errorCount,
      duration
    };
  } catch (error) {
    console.error('[ZOHO Sync] Error during full sync:', error);
    throw error;
  }
}

/**
 * Perform incremental sync (fetch only new messages)
 */
async function performIncrementalSync(options = {}) {
  try {
    const { limit = 50, folder = 'Inbox' } = options;

    console.log('[ZOHO Sync] Starting incremental sync...');
    const startTime = Date.now();

    // If this is the first sync, get the last inquiry date from database
    if (!lastSyncTime) {
      try {
        const existingInquiries = await getEmailInquiriesBySource('zoho', { limit: 1, orderBy: 'received_at DESC' });
        if (existingInquiries.length > 0) {
          lastSyncTime = new Date(existingInquiries[0].received_at);
          console.log('[ZOHO Sync] Last sync time from database:', lastSyncTime);
        }
      } catch (error) {
        console.warn('[ZOHO Sync] Could not get last sync time from database:', error.message);
      }
    }

    // Fetch recent messages (most recent first)
    const messages = await fetchMessages({ limit, folder, sortOrder: 'desc' });

    let newCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    // Process messages until we hit one we've seen before or processed all
    for (const message of messages) {
      try {
        // Parse message to inquiry format
        const inquiry = parseMessageToInquiry(message);

        // If we have a last sync time and this message is older, skip remaining
        if (lastSyncTime && inquiry.receivedAt <= lastSyncTime) {
          skipCount++;
          continue;
        }

        // Save to database
        const saved = await saveEmailInquiry(inquiry);

        if (saved) {
          newCount++;
          // Emit WebSocket event for real-time updates
          if (global.broadcastEvent) {
            global.broadcastEvent('email:created', saved);
          }
        } else {
          skipCount++;
        }
      } catch (error) {
        console.error('[ZOHO Sync] Error processing message:', error.message);
        errorCount++;
      }
    }

    // Update last sync time
    lastSyncTime = new Date();

    const duration = Date.now() - startTime;
    console.log(`[ZOHO Sync] Incremental sync completed in ${duration}ms`);
    console.log(`[ZOHO Sync] Stats: ${newCount} new, ${skipCount} skipped, ${errorCount} errors`);

    return {
      success: true,
      total: messages.length,
      new: newCount,
      skipped: skipCount,
      errors: errorCount,
      duration
    };
  } catch (error) {
    console.error('[ZOHO Sync] Error during incremental sync:', error);
    throw error;
  }
}

/**
 * Start periodic sync job
 */
function startPeriodicSync(intervalMinutes = 15) {
  try {
    // Stop existing interval if any
    if (syncIntervalId) {
      stopPeriodicSync();
    }

    console.log(`[ZOHO Sync] Starting periodic sync (every ${intervalMinutes} minutes)...`);

    // Run initial sync
    performIncrementalSync().catch(error => {
      console.error('[ZOHO Sync] Initial sync failed:', error);
    });

    // Set up interval for periodic sync
    const intervalMs = intervalMinutes * 60 * 1000;
    syncIntervalId = setInterval(async () => {
      try {
        await performIncrementalSync();
      } catch (error) {
        console.error('[ZOHO Sync] Periodic sync failed:', error);
        // Continue running despite errors
      }
    }, intervalMs);

    console.log('[ZOHO Sync] Periodic sync started successfully');
    return syncIntervalId;
  } catch (error) {
    console.error('[ZOHO Sync] Error starting periodic sync:', error);
    throw error;
  }
}

/**
 * Stop periodic sync job
 */
function stopPeriodicSync() {
  try {
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
      console.log('[ZOHO Sync] Periodic sync stopped');
    } else {
      console.log('[ZOHO Sync] No periodic sync to stop');
    }
  } catch (error) {
    console.error('[ZOHO Sync] Error stopping periodic sync:', error);
  }
}

module.exports = {
  performFullSync,
  performIncrementalSync,
  startPeriodicSync,
  stopPeriodicSync
};
