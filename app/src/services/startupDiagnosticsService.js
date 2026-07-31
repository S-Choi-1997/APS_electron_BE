import { apiRequest, API_ENDPOINTS } from '../config/api.js';

let uploadPromise = null;
let lastUploadedBatchId = null;

function canUseStartupDiagnosticsIpc() {
  return Boolean(
    window.electron?.getStartupDiagnosticsBatch
      && window.electron?.markStartupDiagnosticsUploaded
  );
}

async function uploadPendingStartupDiagnosticsInternal(auth) {
  if (!auth?.currentUser || !canUseStartupDiagnosticsIpc()) {
    return { success: true, skipped: true, reason: 'not-ready' };
  }

  const batchResult = await window.electron.getStartupDiagnosticsBatch();
  if (!batchResult?.success) {
    return { success: false, error: batchResult?.error || 'Failed to read startup diagnostics.' };
  }

  const batch = batchResult.batch;
  if (!batch?.batchId || !Array.isArray(batch.events) || batch.events.length === 0) {
    return { success: true, skipped: true, reason: 'empty' };
  }

  if (batch.batchId === lastUploadedBatchId) {
    return { success: true, skipped: true, reason: 'already-uploaded' };
  }

  const response = await apiRequest(API_ENDPOINTS.STARTUP_DIAGNOSTICS, {
    method: 'POST',
    body: JSON.stringify(batch),
  }, auth);

  const markResult = await window.electron.markStartupDiagnosticsUploaded(batch.batchId);
  if (!markResult?.success) {
    throw new Error(markResult?.error || 'Failed to mark startup diagnostics as uploaded.');
  }

  lastUploadedBatchId = batch.batchId;

  return {
    success: true,
    batchId: batch.batchId,
    reportId: response?.data?.id,
    eventCount: batch.events.length,
  };
}

export function uploadPendingStartupDiagnostics(auth) {
  if (uploadPromise) return uploadPromise;

  uploadPromise = uploadPendingStartupDiagnosticsInternal(auth)
    .catch((error) => {
      console.warn('[StartupDiagnostics] Upload failed:', error);
      return { success: false, error: error?.message || String(error) };
    })
    .finally(() => {
      uploadPromise = null;
    });

  return uploadPromise;
}
