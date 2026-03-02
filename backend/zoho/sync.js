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
    const { limit = 100 } = options;

    console.log('[ZOHO Sync] Starting full sync...');
    const startTime = Date.now();

    let totalNewCount = 0;
    let totalSkipCount = 0;
    let totalErrorCount = 0;
    let totalMessages = 0;

    // Sync both Inbox and Sent folders
    const folders = ['Inbox', 'Sent'];

    for (const folder of folders) {
      console.log(`[ZOHO Sync] Syncing ${folder} folder...`);

      // Fetch messages from ZOHO Mail API
      const messages = await fetchMessages({ limit, folder });
      totalMessages += messages.length;

      // Process each message
      for (const message of messages) {
        try {
          // Parse message to inquiry format
          const inquiry = parseMessageToInquiry(message, folder === 'Sent');

          // Save to database (will skip if already exists)
          const saved = await saveEmailInquiry(inquiry);

          if (saved) {
            totalNewCount++;
            // Emit WebSocket event for real-time updates
            if (global.broadcastEvent) {
              global.broadcastEvent('email:created', saved);
            }
          } else {
            totalSkipCount++;
          }
        } catch (error) {
          console.error('[ZOHO Sync] Error processing message:', error.message);
          totalErrorCount++;
        }
      }

      console.log(`[ZOHO Sync] ${folder} sync: ${messages.length} fetched`);
    }

    // Update last sync time
    lastSyncTime = new Date();

    const duration = Date.now() - startTime;
    console.log(`[ZOHO Sync] Full sync completed in ${duration}ms`);
    console.log(`[ZOHO Sync] Stats: ${totalNewCount} new, ${totalSkipCount} skipped, ${totalErrorCount} errors`);

    return {
      success: true,
      total: totalMessages,
      new: totalNewCount,
      skipped: totalSkipCount,
      errors: totalErrorCount,
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
    const { limit = 50 } = options;

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

    let totalNewCount = 0;
    let totalSkipCount = 0;
    let totalErrorCount = 0;

    // Sync both Inbox and Sent folders
    const folders = ['Inbox', 'Sent'];

    for (const folder of folders) {
      console.log(`[ZOHO Sync] Syncing ${folder} folder...`);

      // Fetch recent messages (most recent first)
      const messages = await fetchMessages({ limit, folder, sortOrder: 'desc' });

      // Process messages until we hit one we've seen before or processed all
      for (const message of messages) {
        try {
          // Parse message to inquiry format
          const inquiry = parseMessageToInquiry(message, folder === 'Sent');

          // If we have a last sync time and this message is older, skip remaining
          if (lastSyncTime && inquiry.receivedAt <= lastSyncTime) {
            totalSkipCount++;
            continue;
          }

          // Save to database (will skip duplicates automatically via ON CONFLICT)
          const saved = await saveEmailInquiry(inquiry);

          if (saved) {
            totalNewCount++;
            // Emit WebSocket event for real-time updates
            if (global.broadcastEvent) {
              global.broadcastEvent('email:created', saved);
            }
          } else {
            totalSkipCount++;
          }
        } catch (error) {
          console.error('[ZOHO Sync] Error processing message:', error.message);
          totalErrorCount++;
        }
      }
    }

    // Update last sync time
    lastSyncTime = new Date();

    const duration = Date.now() - startTime;
    console.log(`[ZOHO Sync] Incremental sync completed in ${duration}ms`);
    console.log(`[ZOHO Sync] Stats: ${totalNewCount} new, ${totalSkipCount} skipped, ${totalErrorCount} errors`);

    return {
      success: true,
      new: totalNewCount,
      skipped: totalSkipCount,
      errors: totalErrorCount,
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
