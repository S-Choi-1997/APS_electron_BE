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

      // 보낸 메일은 목록에 추가하지 않음 (스레드에서만 표시)
      if (newEmail.isOutgoing) {
        console.log('[WebSocket] Outgoing email - skip adding to list');

        // 통계만 갱신 (보낸 메일도 responded 상태로 카운트)
        queryClient.invalidateQueries({ queryKey: ['emailInquiries', 'stats'] });

        // 스레드 데이터는 갱신 (모달에서 보낸 메일 보기 위해)
        queryClient.invalidateQueries({
          queryKey: ['emailInquiries', 'list', { includeOutgoing: true }]
        });

        return;  // 여기서 종료
      }

      // 받은 메일만 캐시에 추가
      // Optimistic Update: 캐시에 직접 추가 (순서 유지)
      queryClient.setQueryData(['emailInquiries', 'list', {}], (oldData) => {
        if (!oldData) return [newEmail];
        // 최신 이메일을 맨 앞에 추가
        return [newEmail, ...oldData];
      });

      // 통계 업데이트
      queryClient.setQueryData(['emailInquiries', 'stats'], (oldStats) => {
        if (!oldStats) return oldStats;
        return {
          ...oldStats,
          total: oldStats.total + 1,
          unread: oldStats.unread + 1,
          [newEmail.source]: (oldStats[newEmail.source] || 0) + 1
        };
      });

      // Toast 알림 (받은 메일만)
      const fromName = newEmail.fromName || newEmail.from || '발신자';
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

      // NOTE: 목록만 업데이트하고 통계는 업데이트하지 않음
      // 이유: useUpdateEmailInquiry의 Optimistic Update가 이미 통계를 업데이트했기 때문
      // WebSocket은 다른 클라이언트에게 변경사항을 전파하기 위한 용도로만 사용

      const listQueryKey = ['emailInquiries', 'list', {}];

      // 캐시에서 해당 항목 수정 (순서 유지)
      queryClient.setQueryData(listQueryKey, (oldData) => {
        if (!oldData) return oldData;
        return oldData.map(item =>
          item.id === data.id ? { ...item, ...data.updates } : item
        );
      });

      // 커스텀 핸들러 호출 (옵션)
      if (handlers.onEmailUpdated) {
        handlers.onEmailUpdated(data);
      }
    });

    // 이메일 삭제
    socket.on('email:deleted', (data) => {
      console.log('[WebSocket] Email deleted:', data.id);

      // Optimistic Update: 캐시에서 제거 (순서 유지)
      queryClient.setQueryData(['emailInquiries', 'list', {}], (oldData) => {
        if (!oldData) return oldData;
        const deleted = oldData.find(item => item.id === data.id);
        const newData = oldData.filter(item => item.id !== data.id);

        // 통계 업데이트
        if (deleted) {
          queryClient.setQueryData(['emailInquiries', 'stats'], (oldStats) => {
            if (!oldStats) return oldStats;
            return {
              ...oldStats,
              total: oldStats.total - 1,
              unread: deleted.check ? oldStats.unread : oldStats.unread - 1,
              [deleted.source]: (oldStats[deleted.source] || 1) - 1
            };
          });
        }

        return newData;
      });

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
