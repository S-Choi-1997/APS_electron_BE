/**
 * Email Query Keys
 * 계층적 구조로 캐시 무효화 최적화
 */
export const emailQueryKeys = {
  all: ['emailInquiries'],
  lists: () => [...emailQueryKeys.all, 'list'],
  list: (filters) => [...emailQueryKeys.lists(), filters],
  details: () => [...emailQueryKeys.all, 'detail'],
  detail: (id) => [...emailQueryKeys.details(), id],
  stats: () => [...emailQueryKeys.all, 'stats'],
};
