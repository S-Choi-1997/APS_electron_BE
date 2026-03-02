import { apiRequest, API_ENDPOINTS } from '../config/api';

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

/**
 * Transform backend inquiry data to frontend format
 */
function transformInquiry(inquiry) {
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
    createdAt: inquiry.createdAt ? new Date(inquiry.createdAt) : new Date(),
    check: inquiry.check ?? false,
    status: inquiry.status,
    ip: inquiry.ip,
    recaptchaScore: inquiry.recaptchaScore,
  };
}

/**
 * Fetch all inquiries
 * @param {object} auth - Firebase auth object
 * @param {object} filters - Query filters (check, status, category, limit, offset)
 * @returns {Promise<Array>}
 */
export async function fetchInquiries(auth, filters = {}) {
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
  if (filters.limit) {
    queryParams.append('limit', filters.limit);
  }
  if (filters.offset) {
    queryParams.append('offset', filters.offset);
  }

  const endpoint = `${API_ENDPOINTS.INQUIRIES}${queryParams.toString() ? `?${queryParams}` : ''}`;
  const response = await apiRequest(endpoint, {}, auth);

  return response.data.map(transformInquiry);
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
  return response.data;
}
