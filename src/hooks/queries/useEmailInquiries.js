import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchEmailInquiries,
  fetchEmailStats,
  updateEmailInquiry,
  deleteEmailInquiry,
  triggerZohoSync,
  sendEmailResponse
} from '../../services/emailInquiryService';
import { emailQueryKeys } from './emailQueryKeys';

/**
 * 이메일 목록 조회
 */
export function useEmailInquiries(options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.list(options),
    queryFn: () => fetchEmailInquiries(options),
    staleTime: 5 * 60 * 1000,  // 5분
  });
}

/**
 * 이메일 통계 조회
 */
export function useEmailStats() {
  return useQuery({
    queryKey: emailQueryKeys.stats(),
    queryFn: fetchEmailStats,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 이메일 업데이트 (읽음 처리)
 */
export function useUpdateEmailInquiry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }) => updateEmailInquiry(id, updates),

    onMutate: async ({ id, updates }) => {
      // Optimistic Update: 즉시 UI 반영

      // 1. 진행 중인 refetch 취소
      await queryClient.cancelQueries({ queryKey: emailQueryKeys.all });

      // 2. 이전 데이터 백업 (롤백용)
      const listQueryKey = emailQueryKeys.list({});
      const previousInquiries = queryClient.getQueryData(listQueryKey);
      const previousStats = queryClient.getQueryData(emailQueryKeys.stats());

      // 3. Optimistic 업데이트: 목록에서 해당 항목 수정
      if (previousInquiries) {
        queryClient.setQueryData(listQueryKey, (oldData) => {
          if (!oldData) return oldData;
          return oldData.map(item =>
            item.id === id ? { ...item, ...updates } : item
          );
        });
      }

      // 4. Optimistic 업데이트: 통계 수정 (check 변경 시)
      if (updates.check !== undefined && previousStats) {
        queryClient.setQueryData(emailQueryKeys.stats(), (oldStats) => {
          if (!oldStats) return oldStats;
          const delta = updates.check ? -1 : 1;
          return { ...oldStats, unread: oldStats.unread + delta };
        });
      }

      // 5. 롤백용 데이터 반환
      return { previousInquiries, previousStats, listQueryKey };
    },

    onError: (err, variables, context) => {
      // 에러 시 롤백
      if (context?.previousInquiries && context?.listQueryKey) {
        queryClient.setQueryData(context.listQueryKey, context.previousInquiries);
      }
      if (context?.previousStats) {
        queryClient.setQueryData(emailQueryKeys.stats(), context.previousStats);
      }
      console.error('[Mutation Error] Failed to update email:', err);
    },

    onSuccess: () => {
      // 성공 시 최신 데이터로 refetch
      queryClient.invalidateQueries({ queryKey: emailQueryKeys.all });
    }
  });
}

/**
 * 이메일 삭제
 */
export function useDeleteEmailInquiry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => deleteEmailInquiry(id),

    onMutate: async (id) => {
      // Optimistic Update
      await queryClient.cancelQueries({ queryKey: emailQueryKeys.all });

      const listQueryKey = emailQueryKeys.list({});
      const previousInquiries = queryClient.getQueryData(listQueryKey);
      const previousStats = queryClient.getQueryData(emailQueryKeys.stats());

      // 목록에서 제거
      if (previousInquiries) {
        const deleted = previousInquiries.find(item => item.id === id);
        const newData = previousInquiries.filter(item => item.id !== id);

        queryClient.setQueryData(listQueryKey, newData);

        // 통계 업데이트
        if (deleted && previousStats) {
          queryClient.setQueryData(emailQueryKeys.stats(), (oldStats) => {
            if (!oldStats) return oldStats;
            return {
              ...oldStats,
              total: oldStats.total - 1,
              unread: deleted.check ? oldStats.unread : oldStats.unread - 1,
              [deleted.source]: (oldStats[deleted.source] || 1) - 1
            };
          });
        }
      }

      return { previousInquiries, previousStats, listQueryKey };
    },

    onError: (err, id, context) => {
      // 롤백
      if (context?.previousInquiries && context?.listQueryKey) {
        queryClient.setQueryData(context.listQueryKey, context.previousInquiries);
      }
      if (context?.previousStats) {
        queryClient.setQueryData(emailQueryKeys.stats(), context.previousStats);
      }
      console.error('[Mutation Error] Failed to delete email:', err);
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: emailQueryKeys.all });
    }
  });
}

/**
 * ZOHO 수동 동기화
 */
export function useTriggerZohoSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: triggerZohoSync,
    onSuccess: (result) => {
      console.log(`[ZOHO Sync] 새로운 이메일: ${result.new || 0}개, 스킵: ${result.skipped || 0}개`);
      // 동기화 완료 후 데이터 갱신
      queryClient.invalidateQueries({ queryKey: emailQueryKeys.all });
    },
    onError: (err) => {
      console.error('[ZOHO Sync] Failed:', err);
    }
  });
}

/**
 * 이메일 응답 전송
 */
export function useSendEmailResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ emailId, responseText, originalEmail }) =>
      sendEmailResponse(emailId, responseText, originalEmail),
    onSuccess: () => {
      // 응답 전송 후 목록 갱신 (필요 시)
      queryClient.invalidateQueries({ queryKey: emailQueryKeys.all });
    },
    onError: (err) => {
      console.error('[Email Response] Failed:', err);
      throw err;
    }
  });
}
