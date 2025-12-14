/**
 * api.js - API 설정 및 공통 요청 헬퍼
 *
 * 백엔드 API와 통신하는 공통 설정 및 함수
 */

// API 기본 URL (로컬 Docker Compose 백엔드)
const API_BASE_URL = 'http://localhost:3001';

// Export for use in auth modules
export const API_URL = API_BASE_URL;

/**
 * API 엔드포인트 상수
 */
export const API_ENDPOINTS = {
  // Users
  USERS_ME: '/users/me',

  // Memos
  MEMOS: '/memos',
  MEMO_BY_ID: (id) => `/memos/${id}`,

  // Schedules
  SCHEDULES: '/schedules',
  SCHEDULE_BY_ID: (id) => `/schedules/${id}`,

  // Inquiries (Consultations)
  INQUIRIES: '/inquiries',
  INQUIRY_DETAIL: (id) => `/inquiries/${id}`,
  INQUIRY_UPDATE: (id) => `/inquiries/${id}`,
  INQUIRY_DELETE: (id) => `/inquiries/${id}`,
  ATTACHMENTS: (id) => `/inquiries/${id}/attachments`,

  // SMS
  SMS_SEND: '/sms/send',

  // Health Check
  HEALTH: '/',
};

/**
 * 인증된 API 요청 헬퍼
 * @param {string} endpoint - API 엔드포인트 (예: '/memos', '/schedules')
 * @param {Object} options - fetch 옵션 { method, body, headers }
 * @param {Object} auth - 인증 정보 { currentUser }
 * @returns {Promise<Object>} API 응답
 * @throws {Error} 인증 실패 또는 네트워크 오류
 */
export async function apiRequest(endpoint, options = {}, auth = null) {
  const startTime = Date.now();

  // 인증 정보 확인
  if (!auth || !auth.currentUser) {
    throw new Error('인증 정보가 필요합니다. 로그인해주세요.');
  }

  const { currentUser } = auth;

  // ID 토큰 가져오기 (Google/Naver 모두 idToken 필드 사용)
  const idToken = currentUser.idToken;

  if (!idToken) {
    throw new Error('인증 토큰이 없습니다. 다시 로그인해주세요.');
  }

  // 요청 헤더 구성
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${idToken}`,
    'X-Provider': currentUser.provider, // 'google' | 'naver'
    ...options.headers,
  };

  // 요청 URL 구성
  const url = `${API_BASE_URL}${endpoint}`;

  try {
    console.log(`[API Request] ${options.method || 'GET'} ${endpoint}`);

    const fetchStart = Date.now();
    const response = await fetch(url, {
      ...options,
      headers,
    });
    const fetchTime = Date.now() - fetchStart;

    console.log(`[API Response] ${response.status} (${fetchTime}ms)`);

    // 401 Unauthorized - 토큰 만료, 자동 갱신 시도
    if (response.status === 401) {
      console.log('[API] Access token expired, attempting refresh...');

      try {
        // localAuth의 restoreSession을 사용하여 토큰 갱신
        const { restoreSession } = await import('../auth/localAuth.js');
        const refreshedUser = await restoreSession();

        if (refreshedUser) {
          console.log('[API] Token refreshed successfully, retrying request...');

          // 갱신된 토큰으로 재시도
          const retryHeaders = {
            ...headers,
            'Authorization': `Bearer ${refreshedUser.idToken}`,
          };

          const retryResponse = await fetch(url, {
            ...options,
            headers: retryHeaders,
          });

          if (retryResponse.ok) {
            const data = await retryResponse.json();
            console.log('[API] Retry successful after token refresh');
            return data;
          }
        }
      } catch (refreshError) {
        console.error('[API] Token refresh failed:', refreshError);
      }

      // 갱신 실패 시 로그인 페이지로 리다이렉트
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }

    // 기타 에러 응답 처리
    if (!response.ok) {
      let errorMessage = `API 요청 실패: ${response.status}`;

      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (parseError) {
        // JSON 파싱 실패 시 기본 메시지 사용
      }

      throw new Error(errorMessage);
    }

    // 성공 응답 파싱
    const data = await response.json();
    const totalTime = Date.now() - startTime;

    console.log(`[API Success] Total time: ${totalTime}ms`);

    return data;

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[API Error] ${endpoint} (${totalTime}ms):`, error);

    // 네트워크 오류 처리
    if (error.message === 'Failed to fetch' || error.message.includes('NetworkError')) {
      throw new Error('백엔드 서버에 연결할 수 없습니다. Docker Compose가 실행 중인지 확인해주세요.');
    }

    throw error;
  }
}

/**
 * API 서버 상태 확인
 * @returns {Promise<boolean>} 서버 정상 여부
 */
export async function checkApiHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/`);
    const data = await response.json();
    return data.status === 'ok';
  } catch (error) {
    console.error('[API Health Check] Failed:', error);
    return false;
  }
}
