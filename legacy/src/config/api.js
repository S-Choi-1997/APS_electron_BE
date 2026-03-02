// API Configuration
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://inquiryapi-mbi34yrklq-uc.a.run.app';

// API endpoints
export const API_ENDPOINTS = {
  INQUIRIES: '/inquiries',
  INQUIRY_DETAIL: (id) => `/inquiries/${id}`,
  INQUIRY_UPDATE: (id) => `/inquiries/${id}`,
  INQUIRY_DELETE: (id) => `/inquiries/${id}`,
  ATTACHMENTS: (id) => `/inquiries/${id}/attachments/urls`,
  SMS_SEND: '/sms/send',
};

/**
 * Make an authenticated API request
 * @param {string} endpoint - API endpoint
 * @param {object} options - Fetch options
 * @param {object} auth - Google auth object
 * @returns {Promise<any>}
 */
export async function apiRequest(endpoint, options = {}, auth) {
  const startTime = performance.now();
  const url = `${API_BASE_URL}${endpoint}`;

  // Get Google OAuth token
  let token = null;
  if (auth && auth.currentUser) {
    try {
      token = auth.currentUser.idToken;
      console.log('Google OAuth Token obtained:', token ? 'Yes' : 'No');
      console.log('User email:', auth.currentUser.email);
    } catch (error) {
      console.error('Failed to get token:', error);
      throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
    }
  } else {
    console.warn('No authenticated user found');
    throw new Error('로그인이 필요합니다.');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add X-Provider header for provider-based token verification
  if (auth && auth.currentUser && auth.currentUser.provider) {
    headers['X-Provider'] = auth.currentUser.provider;
  }

  const fetchStartTime = performance.now();
  console.log(`[Frontend Performance] Starting fetch to ${endpoint}`);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const fetchEndTime = performance.now();
  console.log(`[Frontend Performance] Fetch completed in ${(fetchEndTime - fetchStartTime).toFixed(0)}ms`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'unknown_error' }));
    throw new Error(error.message || `API Error: ${response.status}`);
  }

  const result = await response.json();
  const totalTime = performance.now() - startTime;
  console.log(`[Frontend Performance] Total apiRequest time: ${totalTime.toFixed(0)}ms`);

  return result;
}
