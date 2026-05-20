import { normalizeQueryFilters } from './queryUtils';

export const emailQueryKeys = {
  all: ['emailInquiries'],
  mailboxes: () => [...emailQueryKeys.all, 'mailbox'],
  mailbox: (mailbox = 'inbox', filters = {}, page = {}) => [
    ...emailQueryKeys.mailboxes(),
    mailbox,
    normalizeQueryFilters(filters),
    normalizeQueryFilters(page),
  ],
  search: (params = {}) => [...emailQueryKeys.all, 'search', normalizeQueryFilters(params)],
  details: () => [...emailQueryKeys.all, 'detail'],
  detail: (id) => [...emailQueryKeys.details(), id],
  thread: (id, order = 'asc') => [...emailQueryKeys.detail(id), 'thread', order],
  content: (id) => [...emailQueryKeys.detail(id), 'content'],
  attachments: (id) => [...emailQueryKeys.detail(id), 'attachments'],
  folders: () => [...emailQueryKeys.all, 'folders'],
  labels: () => [...emailQueryKeys.all, 'labels'],
  drafts: (filters = {}) => [...emailQueryKeys.all, 'drafts', normalizeQueryFilters(filters)],
  draft: (id) => [...emailQueryKeys.all, 'draft', id],
  scheduled: (filters = {}) => [...emailQueryKeys.all, 'scheduled', normalizeQueryFilters(filters)],
  scheduledItem: (id) => [...emailQueryKeys.all, 'scheduledItem', id],
  stats: () => [...emailQueryKeys.all, 'stats'],

  // Compatibility aliases used by existing websocket and dashboard code.
  lists: () => emailQueryKeys.mailboxes(),
  list: (filters = {}) => emailQueryKeys.mailbox(filters.mailbox || 'inbox', filters, {}),
  pages: () => emailQueryKeys.mailboxes(),
  page: (filters = {}) => emailQueryKeys.mailbox(filters.mailbox || 'inbox', filters, {
    limit: filters.limit,
    offset: filters.offset,
  }),
};
