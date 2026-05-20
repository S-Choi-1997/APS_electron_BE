import { normalizeQueryFilters } from './queryUtils';

export const inquiryQueryKeys = {
  all: ['websiteInquiries'],
  lists: () => [...inquiryQueryKeys.all, 'list'],
  list: (filters = {}) => [...inquiryQueryKeys.lists(), normalizeQueryFilters(filters)],
  allLists: () => [...inquiryQueryKeys.all, 'allList'],
  allList: (filters = {}) => [...inquiryQueryKeys.allLists(), normalizeQueryFilters(filters)],
  pages: () => [...inquiryQueryKeys.all, 'page'],
  page: (filters = {}) => [...inquiryQueryKeys.pages(), normalizeQueryFilters(filters)],
  details: () => [...inquiryQueryKeys.all, 'detail'],
  detail: (id) => [...inquiryQueryKeys.details(), id],
  attachments: (id) => [...inquiryQueryKeys.detail(id), 'attachments'],
  stats: () => [...inquiryQueryKeys.all, 'stats'],
};
