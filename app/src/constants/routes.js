export const ROUTES = {
  DASHBOARD: '/',
  WEBSITE_CONSULTATIONS: '/consultations/website',
  WEBSITE_INQUIRIES: '/consultations/website',
  EMAIL_CONSULTATIONS: '/consultations/email',
  EMAIL: '/consultations/email',
  MEMO: '/memo',
  SETTINGS: '/settings',
};

export const WINDOW_ROUTES = {
  TOAST: '/window/toast',
  MEMO_NEW: '/window/memo/new',
  memoDetail: (id) => `/window/memo/${encodeURIComponent(id)}`,
  sticky: (type = 'dashboard') => `/window/sticky/${encodeURIComponent(type)}`,
};
