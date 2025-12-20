/**
 * useWebSocketSync.js - WebSocket 실시간 동기화 Custom Hook
 *
 * AppRouter.jsx와 Dashboard.jsx에 중복되어 있던
 * WebSocket 이벤트 리스너 로직을 통합한 Hook
 *
 * 기능:
 * - WebSocket 연결 관리
 * - 메모/일정/상담 실시간 동기화
 * - Toast 알림 표시
 * - 재연결 처리
 *
 * @param {Object} user - 현재 로그인 사용자
 * @param {Object} handlers - 이벤트 핸들러 함수들
 * @param {Function} handlers.onConsultationCreated - 신규 상담 생성 시
 * @param {Function} handlers.onConsultationUpdated - 상담 업데이트 시
 * @param {Function} handlers.onConsultationDeleted - 상담 삭제 시
 * @param {Function} handlers.onMemoCreated - 메모 생성 시
 * @param {Function} handlers.onMemoDeleted - 메모 삭제 시
 * @param {Function} handlers.onScheduleCreated - 일정 생성 시
 * @param {Function} handlers.onScheduleUpdated - 일정 업데이트 시
 * @param {Function} handlers.onScheduleDeleted - 일정 삭제 시
 * @param {Function} handlers.loadStats - 통계 새로고침 (선택)
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectWebSocket, disconnectWebSocket, getSocket } from '../services/websocketService';
import { showToastNotification } from '../utils/notificationHelper';

function useWebSocketSync(user, handlers = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) {
      disconnectWebSocket();
      return;
    }

    const socket = connectWebSocket();
    if (!socket) return;

    // ========== 상담 관련 이벤트 ==========

    // 신규 상담 생성
    if (handlers.onConsultationCreated) {
      socket.on('consultation:created', (newConsultation) => {
        console.log('[WebSocket] New consultation received:', newConsultation);
        handlers.onConsultationCreated(newConsultation);

        // 통계 갱신
        if (handlers.loadStats) {
          handlers.loadStats();
        }

        // Toast 알림
        showToastNotification('consultation', `신규 문의: ${newConsultation.name}님`);
      });
    }

    // 상담 업데이트
    if (handlers.onConsultationUpdated) {
      socket.on('consultation:updated', (data) => {
        console.log('[WebSocket] Consultation updated:', data);
        handlers.onConsultationUpdated(data);

        // 통계 갱신
        if (handlers.loadStats) {
          handlers.loadStats();
        }

        // Toast 알림 (확인 처리된 경우)
        if (data.updates.check === true) {
          showToastNotification('consultation', `${data.updates.name}님 문의가 확인되었습니다.`);
        }
      });
    }

    // 상담 삭제
    if (handlers.onConsultationDeleted) {
      socket.on('consultation:deleted', (data) => {
        console.log('[WebSocket] Consultation deleted:', data.id);
        handlers.onConsultationDeleted(data);

        // 통계 갱신
        if (handlers.loadStats) {
          handlers.loadStats();
        }
      });
    }

    // ========== 메모 관련 이벤트 ==========

    // 메모 생성
    if (handlers.onMemoCreated) {
      socket.on('memo:created', (newMemo) => {
        console.log('[WebSocket] Memo created:', newMemo);
        handlers.onMemoCreated(newMemo);

        // 알림 메시지: 제목 + 내용(50자) + 작성자
        const memoContent = newMemo.content.length > 50
          ? newMemo.content.substring(0, 50) + '...'
          : newMemo.content;

        showToastNotification('memo',
          `${newMemo.title}\n${memoContent}\n\n${newMemo.author_name || '사용자'}`
        );
      });
    }

    // 메모 삭제
    if (handlers.onMemoDeleted) {
      socket.on('memo:deleted', (data) => {
        console.log('[WebSocket] Memo deleted:', data.id);
        handlers.onMemoDeleted(data);
      });
    }

    // ========== 일정 관련 이벤트 ==========

    // 일정 생성
    if (handlers.onScheduleCreated) {
      socket.on('schedule:created', (newSchedule) => {
        console.log('[WebSocket] Schedule created:', newSchedule);
        handlers.onScheduleCreated(newSchedule);

        const isPersonal = newSchedule.type === 'personal';

        // 알림 메시지: 제목 + 날짜+시간 + 작성자(개인 일정만)
        const timeInfo = newSchedule.time || '시간 미정';
        const dateInfo = new Date(newSchedule.start_date).toLocaleDateString('ko-KR', {
          month: 'long',
          day: 'numeric'
        });

        const authorInfo = isPersonal
          ? newSchedule.author_name || '사용자'
          : '';

        showToastNotification(
          isPersonal ? 'personalSchedule' : 'teamSchedule',
          authorInfo
            ? `${newSchedule.title}\n${dateInfo} ${timeInfo}\n\n${authorInfo}`
            : `${newSchedule.title}\n${dateInfo} ${timeInfo}`
        );
      });
    }

    // 일정 수정
    if (handlers.onScheduleUpdated) {
      socket.on('schedule:updated', (data) => {
        console.log('[WebSocket] Schedule updated:', data);
        handlers.onScheduleUpdated(data);
      });
    }

    // 일정 삭제
    if (handlers.onScheduleDeleted) {
      socket.on('schedule:deleted', (data) => {
        console.log('[WebSocket] Schedule deleted:', data.id);
        handlers.onScheduleDeleted(data);
      });
    }

    // ========== 이메일 관련 이벤트 ==========

    // 신규 이메일 생성 (ZOHO Webhook 또는 수동 동기화)
    socket.on('email:created', (newEmail) => {
      console.log('[WebSocket] New email received:', newEmail);

      // React Query 캐시 무효화 → 자동 refetch
      queryClient.invalidateQueries({ queryKey: ['emailInquiries'] });
      queryClient.invalidateQueries({ queryKey: ['emailStats'] });

      // Toast 알림
      const fromName = newEmail.from_name || newEmail.from_email || '발신자';
      const subject = newEmail.subject || '(제목 없음)';
      showToastNotification('email', `새 이메일: ${fromName}\n${subject}`);

      // 커스텀 핸들러 호출 (옵션)
      if (handlers.onEmailCreated) {
        handlers.onEmailCreated(newEmail);
      }
    });

    // 이메일 업데이트 (읽음 처리 등)
    socket.on('email:updated', (data) => {
      console.log('[WebSocket] Email updated:', data);

      // React Query 캐시 무효화
      queryClient.invalidateQueries({ queryKey: ['emailInquiries'] });
      queryClient.invalidateQueries({ queryKey: ['emailStats'] });

      // 커스텀 핸들러 호출 (옵션)
      if (handlers.onEmailUpdated) {
        handlers.onEmailUpdated(data);
      }
    });

    // 이메일 삭제
    socket.on('email:deleted', (data) => {
      console.log('[WebSocket] Email deleted:', data.id);

      // React Query 캐시 무효화
      queryClient.invalidateQueries({ queryKey: ['emailInquiries'] });
      queryClient.invalidateQueries({ queryKey: ['emailStats'] });

      // 커스텀 핸들러 호출 (옵션)
      if (handlers.onEmailDeleted) {
        handlers.onEmailDeleted(data);
      }
    });

    // ========== 재연결 처리 ==========

    socket.on('connect', async () => {
      console.log('[WebSocket] Connected/Reconnected');

      // 재연결 시 데이터 동기화 (핸들러가 있는 경우)
      if (handlers.onReconnect) {
        handlers.onReconnect();
      }
    });

    // ========== Cleanup ==========

    return () => {
      socket.off('consultation:created');
      socket.off('consultation:updated');
      socket.off('consultation:deleted');
      socket.off('memo:created');
      socket.off('memo:deleted');
      socket.off('schedule:created');
      socket.off('schedule:updated');
      socket.off('schedule:deleted');
      socket.off('email:created');
      socket.off('email:updated');
      socket.off('email:deleted');
      socket.off('connect');
    };
  }, [user, handlers, queryClient]);
}

export default useWebSocketSync;
