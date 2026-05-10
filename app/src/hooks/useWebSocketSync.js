import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { emailQueryKeys } from './queries/emailQueryKeys';

const QUERY_KEYS = {
  consultations: ['consultations'],
  memos: ['memos'],
  schedules: ['schedules'],
};

function safeCall(callback, ...args) {
  if (typeof callback !== 'function') return;

  try {
    callback(...args);
  } catch (error) {
    console.error('[WebSocketSync] Callback failed:', error);
  }
}

export function useWebSocketSync({
  enabled = true,
  onConsultationsChanged,
  onStatsChanged,
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
    const invalidate = (queryKey) => {
      queryClient.invalidateQueries({ queryKey });
    };

    const register = (eventName, handler) => {
      const cleanup = window.electron.onWebSocketEvent(eventName, (payload) => {
        console.log(`[WebSocketSync] ${eventName}`, payload);
        handler(payload, eventName);
      });
      if (cleanup) cleanups.push(cleanup);
    };

    const handleConsultationEvent = (payload, eventName) => {
      invalidate(QUERY_KEYS.consultations);
      safeCall(onConsultationsChanged, payload, eventName);
    };

    const handleEmailEvent = (payload, eventName) => {
      invalidate(emailQueryKeys.all);
      safeCall(onStatsChanged, payload, eventName);
    };

    const handleMemoEvent = () => {
      invalidate(QUERY_KEYS.memos);
    };

    const handleScheduleEvent = () => {
      invalidate(QUERY_KEYS.schedules);
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

        invalidate(QUERY_KEYS.consultations);
        invalidate(QUERY_KEYS.memos);
        invalidate(QUERY_KEYS.schedules);
        invalidate(emailQueryKeys.all);
        safeCall(onConsultationsChanged, null, 'websocket:reconnected');
        safeCall(onStatsChanged, null, 'websocket:reconnected');
      });
      if (cleanup) cleanups.push(cleanup);
    }

    return () => {
      console.log('[WebSocketSync] Cleaning up event listeners');
      cleanups.forEach((cleanup) => cleanup?.());
    };
  }, [enabled, onConsultationsChanged, onStatsChanged, queryClient]);
}

export default useWebSocketSync;
