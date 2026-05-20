import { normalizeQueryFilters } from './queryUtils';

export const memoQueryKeys = {
  all: ['memos'],
  lists: () => [...memoQueryKeys.all, 'list'],
  list: (filters = {}) => [...memoQueryKeys.lists(), normalizeQueryFilters(filters)],
  pages: () => [...memoQueryKeys.all, 'page'],
  page: (filters = {}) => [...memoQueryKeys.pages(), normalizeQueryFilters(filters)],
  activeList: (filters = {}) => [...memoQueryKeys.lists(), 'active', normalizeQueryFilters(filters)],
  details: () => [...memoQueryKeys.all, 'detail'],
  detail: (id) => [...memoQueryKeys.details(), id],
};
