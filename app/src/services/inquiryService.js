import { apiRequest, API_ENDPOINTS } from '../config/api';

/**
 * Inquiry status constants
 */
export const INQUIRY_STATUS = {
  UNREAD: 'unread',
  READ: 'read',
  RESPONDED: 'responded'
};

/**
 * Category mapping: Backend (English) -> Frontend (Korean)
 */
const CATEGORY_MAP = {
  visa: '비자',
  nonprofit: '비영리단체',
  corporate: '기업 인허가',
  civil: '민원 행정',
  etc: '기타',
  other: '기타',
};

export const INQUIRY_CATEGORY_BY_TYPE = {
  비자: 'visa',
  비영리단체: 'nonprofit',
  '기업 인허가': 'corporate',
  '민원 행정': 'civil',
  기타: 'etc',
};

function parseDateOrNull(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Transform backend inquiry data to frontend format
 */
export function transformInquiry(inquiry) {
  return {
    id: inquiry.id,
    number: inquiry.number,
    name: inquiry.name,
    phone: inquiry.phone,
    email: inquiry.email || '',
    type: CATEGORY_MAP[inquiry.category] || inquiry.category || '기타',
    category: inquiry.category,
    nationality: inquiry.nationality,
    company: inquiry.company,
    message: inquiry.message || inquiry.content || '',
    attachments: inquiry.attachments || [],
    createdAt: parseDateOrNull(inquiry.createdAt),
    check: inquiry.check ?? false,
    status: inquiry.status,
    ip: inquiry.ip,
    recaptchaScore: inquiry.recaptchaScore,
  };
}

/**
 * Fetch all inquiries
 * @param {object} auth - Firebase auth object
 * @param {object} filters - Query filters (check, status, category, start_date, end_date, limit, offset)
 * @returns {Promise<Array>}
 */
export async function fetchInquiries(auth, filters = {}) {
  const page = await fetchInquiryPage(auth, filters);
  return page.items;
}

export async function fetchAllInquiries(auth, filters = {}) {
  const pageSize = 500;
  const items = [];
  let offset = Number(filters.offset ?? 0);

  while (true) {
    const page = await fetchInquiryPage(auth, {
      ...filters,
      limit: pageSize,
      offset,
    });

    items.push(...page.items);

    const nextOffset = page.offset + page.count;
    const total = Number(page.total ?? items.length);
    const hasMore = page.hasMore || nextOffset < total;

    if (!hasMore || page.count === 0) {
      break;
    }

    offset = nextOffset;
  }

  return items;
}

export async function fetchInquiryPage(auth, filters = {}) {
  const queryParams = new URLSearchParams();

  if (filters.check !== undefined) {
    queryParams.append('check', filters.check);
  }
  if (filters.status) {
    queryParams.append('status', filters.status);
  }
  if (filters.category) {
    queryParams.append('category', filters.category);
  }
  if (filters.start_date) {
    queryParams.append('start_date', filters.start_date);
  }
  if (filters.end_date) {
    queryParams.append('end_date', filters.end_date);
  }
  if (filters.limit) {
    queryParams.append('limit', filters.limit);
  }
  if (filters.offset) {
    queryParams.append('offset', filters.offset);
  }

  const endpoint = `${API_ENDPOINTS.INQUIRIES}${queryParams.toString() ? `?${queryParams}` : ''}`;
  const response = await apiRequest(endpoint, {}, auth);

  const items = Array.isArray(response.data) ? response.data.map(transformInquiry) : [];

  return {
    items,
    total: Number(response.total ?? response.count ?? items.length),
    count: Number(response.count ?? items.length),
    limit: Number(response.limit ?? filters.limit ?? items.length),
    offset: Number(response.offset ?? filters.offset ?? 0),
    hasMore: Boolean(response.hasMore),
  };
}

/**
 * Fetch single inquiry by ID
 * @param {string} id - Inquiry ID
 * @param {object} auth - Firebase auth object
 * @returns {Promise<object>}
 */
export async function fetchInquiryById(id, auth) {
  const response = await apiRequest(API_ENDPOINTS.INQUIRY_DETAIL(id), {}, auth);
  return transformInquiry(response.data);
}

/**
 * Update inquiry
 * @param {string} id - Inquiry ID
 * @param {object} updates - Fields to update
 * @param {object} auth - Firebase auth object
 * @returns {Promise<object>}
 */
export async function updateInquiry(id, updates, auth) {
  return apiRequest(
    API_ENDPOINTS.INQUIRY_UPDATE(id),
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    },
    auth
  );
}

/**
 * Delete inquiry
 * @param {string} id - Inquiry ID
 * @param {object} auth - Firebase auth object
 * @returns {Promise<object>}
 */
export async function deleteInquiry(id, auth) {
  return apiRequest(
    API_ENDPOINTS.INQUIRY_DELETE(id),
    {
      method: 'DELETE',
    },
    auth
  );
}

/**
 * Get attachment download URLs
 * @param {string} id - Inquiry ID
 * @param {object} auth - Firebase auth object
 * @returns {Promise<Array>}
 */
export async function fetchAttachmentUrls(id, auth) {
  const response = await apiRequest(API_ENDPOINTS.ATTACHMENTS(id), {}, auth);
  console.log('[fetchAttachmentUrls] Response for inquiry', id, ':', response.data);

  // Normalize: backend may return 'url' or 'downloadUrl'
  return response.data.map(file => ({
    ...file,
    downloadUrl: file.downloadUrl || file.url,
  }));
}
