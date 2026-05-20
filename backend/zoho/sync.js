/**
 * ZOHO Mail Integration - Sync Manager
 *
 * Handles periodic synchronization of ZOHO Mail messages
 */

const { fetchMessages, parseMessageToInquiry, fetchFolders, fetchLabels } = require('./mail-api');
const { saveEmailInquiry, getEmailInquiriesBySource } = require('./db-helper');
const { query } = require('../db');

// Store last sync timestamp
let lastSyncTime = null;

// Store interval ID for periodic sync
let syncIntervalId = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
  return /status 429|rate limit|too many requests/i.test(error.message || '');
}

async function fetchMessagesWithRetry(options, { maxRetries = Number(process.env.ZOHO_SYNC_MAX_RETRIES || 3) } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fetchMessages(options);
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= maxRetries) throw error;
      const delayMs = Math.min(30000, 1000 * (2 ** attempt));
      console.warn(`[ZOHO Sync] Rate limited, retrying in ${delayMs}ms`);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

async function fetchFolderMessages(folder, { pageSize = 100, stopAtDate = null, maxPages = Number(process.env.ZOHO_SYNC_MAX_PAGES || 50) } = {}) {
  const pageLimit = Number.isFinite(maxPages) && maxPages > 0 ? maxPages : 50;
  const messages = [];
  let start = 0;
  let pagesFetched = 0;

  while (true) {
    if (pagesFetched >= pageLimit) {
      console.warn(`[ZOHO Sync] Stopped ${folder} sync after ${pageLimit} pages`);
      break;
    }

    const page = await fetchMessagesWithRetry({ limit: pageSize, start, folder });
    pagesFetched += 1;
    if (page.length === 0) break;

    messages.push(...page);

    if (stopAtDate) {
      const reachedKnownMessage = page.some((message) => {
        const inquiry = parseMessageToInquiry(message, folder === 'Sent');
        return inquiry.receivedAt <= stopAtDate;
      });

      if (reachedKnownMessage) break;
    }

    if (page.length < pageSize) break;
    start += pageSize;
  }

  return messages;
}

function normalizeFolderType(folder) {
  const name = String(folder.folderName || '').toLowerCase();
  if (name.includes('inbox')) return 'inbox';
  if (name.includes('sent')) return 'sent';
  if (name.includes('draft')) return 'drafts';
  if (name.includes('trash') || name.includes('deleted')) return 'trash';
  if (name.includes('archive')) return 'archive';
  if (name.includes('spam') || name.includes('junk')) return 'spam';
  if (name.includes('outbox')) return 'outbox';
  return 'custom';
}

async function syncFolderCache() {
  const folders = await fetchFolders();
  const activeFolderIds = [];
  for (const folder of folders) {
    const folderId = String(folder.folderId || folder.id || folder.folderName);
    activeFolderIds.push(folderId);
    await query(`
      INSERT INTO email_folders (
        folder_id, folder_name, folder_type, path, unread_count, total_count,
        provider_raw, last_synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW(), NOW())
      ON CONFLICT (folder_id) DO UPDATE SET
        folder_name = EXCLUDED.folder_name,
        folder_type = EXCLUDED.folder_type,
        path = EXCLUDED.path,
        unread_count = EXCLUDED.unread_count,
        total_count = EXCLUDED.total_count,
        provider_raw = EXCLUDED.provider_raw,
        last_synced_at = NOW(),
        updated_at = NOW();
    `, [
      folderId,
      folder.folderName || folder.name || folderId,
      normalizeFolderType(folder),
      folder.path || folder.folderName || folderId,
      Number(folder.unreadCount || folder.unReadCount || 0),
      Number(folder.count || folder.totalCount || 0),
      JSON.stringify(folder),
    ]);
  }
  await query('DELETE FROM email_folders WHERE NOT (folder_id = ANY($1::text[]))', [activeFolderIds]);
  return folders;
}

async function syncLabelCache() {
  const labels = await fetchLabels();
  const activeLabelIds = [];
  for (const label of labels) {
    const labelId = String(label.labelId || label.tagId || label.id);
    activeLabelIds.push(labelId);
    await query(`
      INSERT INTO email_labels (
        label_id, label_name, color, provider_raw, last_synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW(), NOW())
      ON CONFLICT (label_id) DO UPDATE SET
        label_name = EXCLUDED.label_name,
        color = EXCLUDED.color,
        provider_raw = EXCLUDED.provider_raw,
        last_synced_at = NOW(),
        updated_at = NOW();
    `, [labelId, label.displayName || label.name || labelId, label.color || null, JSON.stringify(label)]);
  }
  await query('DELETE FROM email_labels WHERE NOT (label_id = ANY($1::text[]))', [activeLabelIds]);
  return labels;
}

async function syncLabelCacheBestEffort() {
  try {
    return await syncLabelCache();
  } catch (error) {
    console.warn('[ZOHO Sync] Label sync failed; continuing mail sync with cached labels:', error.message);
    return [];
  }
}

async function syncSingleFolder(folderName, { pageSize = 100 } = {}) {
  let totalNewCount = 0;
  let totalSkipCount = 0;
  let totalErrorCount = 0;
  const messages = await fetchFolderMessages(folderName, { pageSize });

  for (const message of messages) {
    try {
      const inquiry = parseMessageToInquiry(message, normalizeFolderType({ folderName }) === 'sent');
      inquiry.folderName = folderName;
      inquiry.folderType = normalizeFolderType({ folderName });
      const saved = await saveEmailInquiry(inquiry);
      if (saved) {
        totalNewCount++;
        if (global.broadcastEvent) global.broadcastEvent('email:created', saved);
      } else {
        totalSkipCount++;
      }
    } catch (error) {
      console.error('[ZOHO Sync] Error processing message:', error.message);
      totalErrorCount++;
    }
  }

  return {
    success: true,
    folder: folderName,
    total: messages.length,
    new: totalNewCount,
    skipped: totalSkipCount,
    errors: totalErrorCount,
  };
}

/**
 * Perform full sync of ZOHO Mail messages
 */
async function performFullSync(options = {}) {
  try {
    const { pageSize = 100 } = options;

    console.log('[ZOHO Sync] Starting full sync...');
    const startTime = Date.now();
    await syncFolderCache();
    await syncLabelCacheBestEffort();

    let totalNewCount = 0;
    let totalSkipCount = 0;
    let totalErrorCount = 0;
    let totalMessages = 0;

    // Sync both Inbox and Sent folders
    const folderRows = await query(`
      SELECT folder_name FROM email_folders
      WHERE folder_type IN ('inbox', 'sent', 'drafts', 'trash', 'archive', 'custom')
      ORDER BY CASE folder_type WHEN 'inbox' THEN 1 WHEN 'sent' THEN 2 ELSE 9 END;
    `);
    const folders = folderRows.rows.length > 0
      ? folderRows.rows.map(row => row.folder_name)
      : ['Inbox', 'Sent'];

    for (const folder of folders) {
      console.log(`[ZOHO Sync] Syncing ${folder} folder...`);

      // Fetch messages from ZOHO Mail API across every available page.
      const messages = await fetchFolderMessages(folder, { pageSize });
      totalMessages += messages.length;

      // Process each message
      for (const message of messages) {
        try {
          // Parse message to inquiry format
          const folderType = normalizeFolderType({ folderName: folder });
          const inquiry = parseMessageToInquiry(message, folderType === 'sent');
          inquiry.folderName = folder;
          inquiry.folderType = folderType;

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
    const { pageSize = 100 } = options;

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

    await syncFolderCache();
    await syncLabelCacheBestEffort();

    const folderRows = await query(`
      SELECT folder_name FROM email_folders
      WHERE folder_type IN ('inbox', 'sent', 'drafts', 'trash', 'archive', 'custom')
      ORDER BY CASE folder_type WHEN 'inbox' THEN 1 WHEN 'sent' THEN 2 ELSE 9 END;
    `);
    const folders = folderRows.rows.length > 0
      ? folderRows.rows.map(row => row.folder_name)
      : ['Inbox', 'Sent'];

    for (const folder of folders) {
      console.log(`[ZOHO Sync] Syncing ${folder} folder...`);

      // Fetch recent messages page-by-page until known data is reached.
      const messages = await fetchFolderMessages(folder, { pageSize, stopAtDate: lastSyncTime });

      // Process messages until we hit one we've seen before or processed all
      for (const message of messages) {
        try {
          // Parse message to inquiry format
          const folderType = normalizeFolderType({ folderName: folder });
          const inquiry = parseMessageToInquiry(message, folderType === 'sent');
          inquiry.folderName = folder;
          inquiry.folderType = folderType;

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
  syncSingleFolder,
  syncFolderCache,
  syncLabelCache,
  startPeriodicSync,
  stopPeriodicSync
};
