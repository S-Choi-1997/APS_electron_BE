import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { emailQueryKeys } from './queries/emailQueryKeys';
import { inquiryQueryKeys } from './queries/inquiryQueryKeys';
import { memoQueryKeys } from './queries/memoQueryKeys';
import { scheduleQueryKeys } from './queries/scheduleQueryKeys';
import { normalizeEmailInquiry } from '../services/emailInquiryService';
import { transformInquiry } from '../services/inquiryService';
import { normalizeMemo } from './queries/useMemos';
import { normalizeSchedule } from './queries/useSchedules';
import { removeItemById, replaceItemById, updateCollectionData } from './queries/queryUtils';

function updateCollectionCaches(queryClient, queryKeyFactories, updater) {
  queryKeyFactories.forEach((queryKey) => {
    queryClient.setQueriesData({ queryKey }, (oldData) => updateCollectionData(oldData, updater));
  });
}

function refreshActiveCollections(queryClient, queryKeys) {
  queryKeys.forEach((queryKey) => {
    queryClient.invalidateQueries({ queryKey, refetchType: 'active' });
  });
}

function includesText(value, search) {
  return String(value || '').toLowerCase().includes(search);
}

function hasEmailLabel(email, labelId) {
  return (email.labels || []).some((label) => (
    String(label.labelId || label.id || label.name || '') === String(labelId)
  ));
}

function matchesMailbox(email, mailbox) {
  const folderType = String(email.folderType || email.mailbox || '').toLowerCase();
  const isTrashed = Boolean(email.trashedAt || email.trashed_at);
  const isArchived = Boolean(email.archivedAt || email.archived_at);
  if (mailbox === 'inbox') {
    return !email.isOutgoing && !isTrashed && !isArchived && !['sent', 'trash', 'archive', 'spam'].includes(folderType);
  }
  if (mailbox === 'sent') return email.isOutgoing || folderType === 'sent';
  if (mailbox === 'trash') return isTrashed || folderType === 'trash';
  if (mailbox === 'archive') return isArchived || folderType === 'archive';
  if (mailbox === 'all') return true;
  return folderType === mailbox;
}

function matchesMailboxQuery(email, queryKey) {
  const mailbox = queryKey?.[2] || 'inbox';
  const filters = queryKey?.[3] || {};
  if (!matchesMailbox(email, mailbox)) return false;
  if (filters.readState && email.readState !== filters.readState) return false;
  if (filters.responseState && email.responseState !== filters.responseState) return false;
  if (filters.hasAttachments !== undefined && Boolean(email.hasAttachments) !== Boolean(filters.hasAttachments)) return false;
  if (filters.starred !== undefined && Boolean(email.starred) !== Boolean(filters.starred)) return false;
  if (filters.labelId && !hasEmailLabel(email, filters.labelId)) return false;

  if (filters.search) {
    const search = String(filters.search).trim().toLowerCase();
    const searchableText = [
      email.fromName,
      email.from,
      email.toEmail,
      ...(email.to || []),
      email.subject,
      email.preview,
      email.body,
      email.bodyText,
      email.bodyHtml,
      email.translatedSubject,
      email.translatedBody,
      email.source,
      email.messageId,
    ].join(' ');
    if (!includesText(searchableText, search)) return false;
  }

  return true;
}

function updateEmailMailboxCaches(queryClient, id, nextEmail) {
  queryClient.getQueriesData({ queryKey: emailQueryKeys.mailboxes() }).forEach(([queryKey, oldData]) => {
    const nextData = updateCollectionData(oldData, (items) => {
      const hasItem = items.some((item) => String(item.id) === String(id));
      if (!hasItem) return items;
      return matchesMailboxQuery(nextEmail, queryKey)
        ? replaceItemById(items, id, nextEmail)
        : removeItemById(items, id);
    });
    queryClient.setQueryData(queryKey, nextData);
  });
}

export function useWebSocketSync({
  enabled = true,
} = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    if (!window.electron?.onWebSocketEvent) {
      console.warn('[WebSocketSync] Electron WebSocket IPC API not available');
      return;
    }

    console.log('[WebSocketSync] Setting up event listeners');

    const cleanups = [];
    const invalidate = (queryKey, options = {}) => {
      queryClient.invalidateQueries({ queryKey, ...options });
    };

    const register = (eventName, handler) => {
      const cleanup = window.electron.onWebSocketEvent(eventName, (payload) => {
        console.log(`[WebSocketSync] ${eventName}`, payload);
        handler(payload, eventName);
      });
      if (cleanup) cleanups.push(cleanup);
    };

    const invalidateDetail = (queryKeyFactory, payload) => {
      if (payload?.id === undefined || !queryKeyFactory?.detail) return;
      invalidate(queryKeyFactory.detail(payload.id));
    };

    const handleConsultationEvent = (payload, eventName) => {
      if (eventName === 'consultation:updated' && payload?.id !== undefined) {
        const nextInquiry = transformInquiry(payload);
        updateCollectionCaches(queryClient, [
          inquiryQueryKeys.lists(),
          inquiryQueryKeys.allLists(),
          inquiryQueryKeys.pages(),
        ], (items) => replaceItemById(items, payload.id, nextInquiry));
        queryClient.setQueryData(inquiryQueryKeys.detail(payload.id), (oldData) => (oldData ? { ...oldData, ...nextInquiry } : oldData));
      } else if (eventName === 'consultation:deleted' && payload?.id !== undefined) {
        updateCollectionCaches(queryClient, [
          inquiryQueryKeys.lists(),
          inquiryQueryKeys.allLists(),
          inquiryQueryKeys.pages(),
        ], (items) => removeItemById(items, payload.id));
        queryClient.removeQueries({ queryKey: inquiryQueryKeys.detail(payload.id) });
      } else {
        refreshActiveCollections(queryClient, [inquiryQueryKeys.lists(), inquiryQueryKeys.allLists(), inquiryQueryKeys.pages()]);
      }
      invalidate(inquiryQueryKeys.stats());
      invalidateDetail(inquiryQueryKeys, payload);
    };

    const handleEmailEvent = (payload, eventName) => {
      const refreshDraftsAndScheduled = () => {
        refreshActiveCollections(queryClient, [
          emailQueryKeys.draftsRoot(),
          emailQueryKeys.scheduledRoot(),
        ]);
      };

      const refreshEmailCore = () => {
        refreshActiveCollections(queryClient, [
          emailQueryKeys.mailboxes(),
          emailQueryKeys.stats(),
        ]);
      };

      if (eventName === 'email:updated' && payload?.id !== undefined) {
        const nextEmail = normalizeEmailInquiry(payload);
        updateEmailMailboxCaches(queryClient, payload.id, nextEmail);
        queryClient.setQueryData(emailQueryKeys.thread(payload.id), (oldData) => (
          Array.isArray(oldData) ? replaceItemById(oldData, payload.id, nextEmail) : oldData
        ));
        invalidate(emailQueryKeys.mailboxes(), { refetchType: 'active' });
        invalidateDetail(emailQueryKeys, payload);
        invalidate(emailQueryKeys.stats(), { refetchType: 'active' });
      } else if (eventName === 'email:deleted' && payload?.id !== undefined) {
        updateCollectionCaches(queryClient, [
          emailQueryKeys.lists(),
          emailQueryKeys.pages(),
        ], (items) => removeItemById(items, payload.id));
        queryClient.removeQueries({ queryKey: emailQueryKeys.detail(payload.id) });
        invalidate(emailQueryKeys.stats(), { refetchType: 'active' });
      } else if (eventName === 'email:sync-completed') {
        refreshActiveCollections(queryClient, [
          emailQueryKeys.mailboxes(),
          emailQueryKeys.stats(),
          emailQueryKeys.folders(),
          emailQueryKeys.labels(),
        ]);
      } else if (eventName === 'email:created') {
        refreshEmailCore();
        if (payload?.realtimeReason === 'draft:sent' || payload?.realtimeReason === 'scheduled:sent') {
          refreshDraftsAndScheduled();
        }
      } else {
        refreshEmailCore();
      }
    };

    const handleMemoEvent = (payload, eventName) => {
      if (eventName === 'memo:updated' && payload?.id !== undefined) {
        const nextMemo = normalizeMemo(payload);
        updateCollectionCaches(queryClient, [
          memoQueryKeys.lists(),
          memoQueryKeys.pages(),
        ], (items) => replaceItemById(items, payload.id, nextMemo));
        queryClient.setQueryData(memoQueryKeys.detail(payload.id), (oldData) => (oldData ? { ...oldData, ...nextMemo } : oldData));
      } else if (eventName === 'memo:deleted' && payload?.id !== undefined) {
        updateCollectionCaches(queryClient, [
          memoQueryKeys.lists(),
          memoQueryKeys.pages(),
        ], (items) => removeItemById(items, payload.id));
        queryClient.removeQueries({ queryKey: memoQueryKeys.detail(payload.id) });
      } else {
        refreshActiveCollections(queryClient, [memoQueryKeys.lists(), memoQueryKeys.pages()]);
      }
      invalidateDetail(memoQueryKeys, payload);
    };

    const handleScheduleEvent = (payload, eventName) => {
      if (eventName === 'schedule:updated' && payload?.id !== undefined) {
        const nextSchedule = normalizeSchedule(payload);
        updateCollectionCaches(queryClient, [
          scheduleQueryKeys.lists(),
          scheduleQueryKeys.pages(),
        ], (items) => replaceItemById(items, payload.id, nextSchedule));
        queryClient.setQueryData(scheduleQueryKeys.detail(payload.id), (oldData) => (oldData ? { ...oldData, ...nextSchedule } : oldData));
      } else if (eventName === 'schedule:deleted' && payload?.id !== undefined) {
        updateCollectionCaches(queryClient, [
          scheduleQueryKeys.lists(),
          scheduleQueryKeys.pages(),
        ], (items) => removeItemById(items, payload.id));
        queryClient.removeQueries({ queryKey: scheduleQueryKeys.detail(payload.id) });
      } else {
        refreshActiveCollections(queryClient, [scheduleQueryKeys.lists(), scheduleQueryKeys.pages()]);
      }
      invalidateDetail(scheduleQueryKeys, payload);
    };

    [
      'consultation:created',
      'consultation:updated',
      'consultation:deleted',
    ].forEach((eventName) => register(eventName, handleConsultationEvent));

    [
      'email:created',
      'email:updated',
      'email:deleted',
      'email:sync-completed',
    ].forEach((eventName) => register(eventName, handleEmailEvent));

    [
      'memo:created',
      'memo:updated',
      'memo:deleted',
    ].forEach((eventName) => register(eventName, handleMemoEvent));

    [
      'schedule:created',
      'schedule:updated',
      'schedule:deleted',
    ].forEach((eventName) => register(eventName, handleScheduleEvent));

    if (window.electron.onWebSocketStatusChanged) {
      const cleanup = window.electron.onWebSocketStatusChanged((status) => {
        console.log('[WebSocketSync] WebSocket status changed:', status);
        if (!status?.connected) return;

        refreshActiveCollections(queryClient, [
          inquiryQueryKeys.lists(),
          inquiryQueryKeys.allLists(),
          inquiryQueryKeys.pages(),
          inquiryQueryKeys.stats(),
          memoQueryKeys.lists(),
          memoQueryKeys.pages(),
          scheduleQueryKeys.lists(),
          scheduleQueryKeys.pages(),
          emailQueryKeys.lists(),
          emailQueryKeys.pages(),
          emailQueryKeys.stats(),
        ]);
      });
      if (cleanup) cleanups.push(cleanup);
    }

    return () => {
      console.log('[WebSocketSync] Cleaning up event listeners');
      cleanups.forEach((cleanup) => cleanup?.());
    };
  }, [enabled, queryClient]);
}

export default useWebSocketSync;
