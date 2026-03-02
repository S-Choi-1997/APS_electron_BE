/**
 * useWebSocketSync.js - WebSocket 실시간 동기화 Custom Hook
 *
 * Main Process에서 전달되는 WebSocket 이벤트를 React Query 캐시와 동기화
 *
 * 리팩토링 날짜: 2026-01-20
 * 변경사항:
 * - WebSocket 직접 연결 제거
 * - IPC 이벤트 리스너로 전환 (window.electron.onWebSocketEvent)
 * - React Query 기반 상태 관리 유지
 * - Optimistic Updates 패턴 유지
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useWebSocketSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!window.electron) {
      console.warn('[WebSocketSync] Electron context not available');
      return;
    }

    console.log('[WebSocketSync] Setting up event listeners');

    const cleanups = [];

    // ============================================
    // 상담 이벤트
    // ============================================
    cleanups.push(
      window.electron.onWebSocketEvent('consultation:created', (newConsultation) => {
        console.log('[WebSocketSync] Consultation created:', newConsultation.id);

        // 캐시 무효화
        queryClient.invalidateQueries({ queryKey: ['consultations'] });
        queryClient.invalidateQueries({ queryKey: ['stats'] });
      })
    );

    cleanups.push(
      window.electron.onWebSocketEvent('consultation:updated', (updatedConsultation) => {
        console.log('[WebSocketSync] Consultation updated:', updatedConsultation.id);

        // Optimistic update
        queryClient.setQueryData(['consultations'], (oldData) => {
          if (!oldData?.pages) return oldData;

          return {
            ...oldData,
            pages: oldData.pages.map(page => ({
              ...page,
              data: page.data.map(c =>
                c.id === updatedConsultation.id ? { ...c, ...updatedConsultation } : c
              )
            }))
          };
        });

        // 통계 갱신
        queryClient.invalidateQueries({ queryKey: ['stats'] });
      })
    );

    cleanups.push(
      window.electron.onWebSocketEvent('consultation:deleted', (deletedConsultation) => {
        console.log('[WebSocketSync] Consultation deleted:', deletedConsultation.id);

        // 캐시에서 제거
        queryClient.setQueryData(['consultations'], (oldData) => {
          if (!oldData?.pages) return oldData;

          return {
            ...oldData,
            pages: oldData.pages.map(page => ({
              ...page,
              data: page.data.filter(c => c.id !== deletedConsultation.id)
            }))
          };
        });

        queryClient.invalidateQueries({ queryKey: ['stats'] });
      })
    );

    // ============================================
    // 메모 이벤트
    // ============================================
    cleanups.push(
      window.electron.onWebSocketEvent('memo:created', (newMemo) => {
        console.log('[WebSocketSync] Memo created:', newMemo.id);
        queryClient.invalidateQueries({ queryKey: ['memos'] });
      })
    );

    cleanups.push(
      window.electron.onWebSocketEvent('memo:deleted', (deletedMemo) => {
        console.log('[WebSocketSync] Memo deleted:', deletedMemo.id);
        queryClient.invalidateQueries({ queryKey: ['memos'] });
      })
    );

    // ============================================
    // 일정 이벤트
    // ============================================
    cleanups.push(
      window.electron.onWebSocketEvent('schedule:created', () => {
        console.log('[WebSocketSync] Schedule created');
        queryClient.invalidateQueries({ queryKey: ['schedules'] });
      })
    );

    cleanups.push(
      window.electron.onWebSocketEvent('schedule:updated', () => {
        console.log('[WebSocketSync] Schedule updated');
        queryClient.invalidateQueries({ queryKey: ['schedules'] });
      })
    );

    cleanups.push(
      window.electron.onWebSocketEvent('schedule:deleted', () => {
        console.log('[WebSocketSync] Schedule deleted');
        queryClient.invalidateQueries({ queryKey: ['schedules'] });
      })
    );

    // ============================================
    // 이메일 이벤트
    // ============================================
    cleanups.push(
      window.electron.onWebSocketEvent('email:created', (newEmail) => {
        console.log('[WebSocketSync] Email created:', newEmail.id);

        // 이메일 캐시에 추가
        queryClient.setQueryData(['emails'], (oldData) => {
          if (!oldData) return { data: [newEmail] };
          return { ...oldData, data: [newEmail, ...oldData.data] };
        });

        // 통계 갱신
        queryClient.invalidateQueries({ queryKey: ['stats'] });
      })
    );

    cleanups.push(
      window.electron.onWebSocketEvent('email:updated', (updatedEmail) => {
        console.log('[WebSocketSync] Email updated:', updatedEmail.id);

        queryClient.setQueryData(['emails'], (oldData) => {
          if (!oldData?.data) return oldData;

          return {
            ...oldData,
            data: oldData.data.map(e =>
              e.id === updatedEmail.id ? { ...e, ...updatedEmail } : e
            )
          };
        });

        queryClient.invalidateQueries({ queryKey: ['stats'] });
      })
    );

    cleanups.push(
      window.electron.onWebSocketEvent('email:deleted', (deletedEmail) => {
        console.log('[WebSocketSync] Email deleted:', deletedEmail.id);

        queryClient.setQueryData(['emails'], (oldData) => {
          if (!oldData?.data) return oldData;

          return {
            ...oldData,
            data: oldData.data.filter(e => e.id !== deletedEmail.id)
          };
        });

        queryClient.invalidateQueries({ queryKey: ['stats'] });
      })
    );

    // ============================================
    // WebSocket 연결 상태 모니터링
    // ============================================
    cleanups.push(
      window.electron.onWebSocketStatusChanged((status) => {
        console.log('[WebSocketSync] WebSocket status changed:', status);

        // status 객체 null 체크
        if (!status) {
          console.warn('[WebSocketSync] Received null status');
          return;
        }

        if (status.connected) {
          console.log(`[WebSocketSync] Connected to ${status.environment || 'unknown'} environment`);

          // 재연결 시 모든 캐시 갱신
          try {
            queryClient.invalidateQueries();
          } catch (error) {
            console.error('[WebSocketSync] Failed to invalidate queries:', error);
          }
        } else {
          console.warn('[WebSocketSync] Disconnected from relay server');
        }
      })
    );

    return () => {
      console.log('[WebSocketSync] Cleaning up event listeners');
      cleanups.forEach(cleanup => cleanup?.());
    };
  }, [queryClient]);
}

export default useWebSocketSync;
