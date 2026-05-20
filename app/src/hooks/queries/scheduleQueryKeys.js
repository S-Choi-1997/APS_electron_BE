import { normalizeQueryFilters } from './queryUtils';

export const scheduleQueryKeys = {
  all: ['schedules'],
  lists: () => [...scheduleQueryKeys.all, 'list'],
  list: (filters = {}) => [...scheduleQueryKeys.lists(), normalizeQueryFilters(filters)],
  pages: () => [...scheduleQueryKeys.all, 'page'],
  page: (filters = {}) => [...scheduleQueryKeys.pages(), normalizeQueryFilters(filters)],
  details: () => [...scheduleQueryKeys.all, 'detail'],
  detail: (id) => [...scheduleQueryKeys.details(), id],
};
