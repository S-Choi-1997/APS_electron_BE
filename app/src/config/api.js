/**
 * api.js - runtime backend configuration and common request helper.
 *
 * Electron main owns AppConfig. The renderer keeps a cached copy and all
 * REST calls resolve their URL from that cache instead of build-time globals.
 */

const FALLBACK_REST_BASE_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_FALLBACK_URL || 'http://localhost:3001';
const FALLBACK_ENVIRONMENT = import.meta.env.VITE_BACKEND_ENVIRONMENT || import.meta.env.VITE_RELAY_ENVIRONMENT || 'production';

function normalizeBaseUrl(url, allowedProtocols, label) {
  const parsedUrl = new URL(url);
  if (!allowedProtocols.includes(parsedUrl.protocol)) {
    throw new Error(`${label} must use ${allowedProtocols.join(', ')} protocol`);
  }

  return parsedUrl.toString().replace(/\/$/, '');
}

function deriveWebSocketUrl(restBaseUrl) {
  const url = new URL(restBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return normalizeBaseUrl(url.toString(), ['ws:', 'wss:'], 'WebSocket URL');
}

function normalizeAppConfig(config = {}, source = 'renderer-fallback') {
  const restBaseUrl = normalizeBaseUrl(
    config.restBaseUrl || config.apiUrl || FALLBACK_REST_BASE_URL,
    ['http:', 'https:'],
    'API URL'
  );
  const wsBaseUrl = normalizeBaseUrl(
    config.wsBaseUrl || config.wsRelayUrl || config.wsUrl || import.meta.env.VITE_WS_URL || import.meta.env.VITE_WS_RELAY_URL || import.meta.env.VITE_WS_FALLBACK_URL || deriveWebSocketUrl(restBaseUrl),
    ['ws:', 'wss:', 'http:', 'https:'],
    'WebSocket URL'
  ).replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

  return {
    version: 1,
    mode: config.mode || 'direct',
    environment: config.environment || FALLBACK_ENVIRONMENT,
    restBaseUrl,
    wsBaseUrl,
    wsDerivedFromRest: !(config.wsBaseUrl || config.wsRelayUrl || config.wsUrl),
    source: config.source || source,
    // Backward-compatible aliases for existing consumers and windows.
    apiUrl: restBaseUrl,
    wsRelayUrl: wsBaseUrl,
  };
}

let runtimeConfig = normalizeAppConfig();
let configPromise = null;

export const API_ENDPOINTS = {
  USERS_ME: '/users/me',
  MEMOS: '/memos',
  MEMO_BY_ID: (id) => `/memos/${id}`,
  SCHEDULES: '/schedules',
  SCHEDULE_BY_ID: (id) => `/schedules/${id}`,
  INQUIRIES: '/inquiries',
  INQUIRY_DETAIL: (id) => `/inquiries/${id}`,
  INQUIRY_UPDATE: (id) => `/inquiries/${id}`,
  INQUIRY_DELETE: (id) => `/inquiries/${id}`,
  ATTACHMENTS: (id) => `/inquiries/${id}/attachments/urls`,
  EMAIL_INQUIRIES: '/email-inquiries',
  EMAIL_INQUIRY_BY_ID: (id) => `/email-inquiries/${id}`,
  EMAIL_INQUIRIES_STATS: '/email-inquiries/stats',
  ZOHO_AUTH_START: '/auth/zoho',
  ZOHO_AUTH_CALLBACK: '/auth/zoho/callback',
  ZOHO_WEBHOOK: '/api/zoho/webhook',
  ZOHO_SYNC: '/api/zoho/sync',
  SMS_SEND: '/sms/send',
  HEALTH: '/',
};

export function getAppConfigSnapshot() {
  return runtimeConfig;
}

export function applyAppConfig(config) {
  runtimeConfig = normalizeAppConfig(config, config?.source || 'renderer');
  return runtimeConfig;
}

export async function initializeAppConfig({ force = false } = {}) {
  if (!force && configPromise) return configPromise;

  configPromise = (async () => {
    try {
      const electronConfig = await window.electron?.getAppConfig?.();
      if (electronConfig) {
        return applyAppConfig(electronConfig);
      }

      const legacyConfig = await window.electron?.getConfig?.();
      if (legacyConfig) {
        return applyAppConfig(legacyConfig);
      }
    } catch (error) {
      console.warn('[API Config] Failed to load Electron AppConfig, using renderer fallback:', error);
    }

    return runtimeConfig;
  })();

  return configPromise;
}

export async function getAppConfig() {
  return initializeAppConfig();
}

export async function getApiBaseUrl() {
  const config = await getAppConfig();
  return config.restBaseUrl;
}

export async function getRelayEnvironment() {
  const config = await getAppConfig();
  return config.environment;
}

export async function buildApiUrl(endpoint) {
  const baseUrl = await getApiBaseUrl();
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${normalizedEndpoint}`;
}

export async function apiRequest(endpoint, options = {}, auth = null) {
  const startTime = Date.now();

  if (!auth || !auth.currentUser) {
    throw new Error('인증 정보가 필요합니다. 로그인해주세요.');
  }

  const { currentUser } = auth;
  const idToken = currentUser.idToken;

  if (!idToken) {
    throw new Error('인증 토큰이 없습니다. 다시 로그인해주세요.');
  }

  const environment = await getRelayEnvironment();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${idToken}`,
    'X-Provider': currentUser.provider,
    'X-Relay-Environment': environment,
    ...options.headers,
  };

  const url = await buildApiUrl(endpoint);

  try {
    console.log(`[API Request] ${options.method || 'GET'} ${endpoint}`);

    const fetchStart = Date.now();
    const response = await fetch(url, {
      ...options,
      headers,
    });
    const fetchTime = Date.now() - fetchStart;

    console.log(`[API Response] ${response.status} (${fetchTime}ms)`);

    if (response.status === 401) {
      console.log('[API] Access token expired, attempting refresh...');

      try {
        const { restoreSession } = await import('../auth/localAuth.js');
        const refreshedUser = await restoreSession();

        if (refreshedUser) {
          console.log('[API] Token refreshed successfully, retrying request...');

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

      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }

    if (!response.ok) {
      let errorMessage = `API 요청 실패: ${response.status}`;

      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (parseError) {
        // Use default message when response is not JSON.
      }

      throw new Error(errorMessage);
    }

    const data = await response.json();
    const totalTime = Date.now() - startTime;

    console.log(`[API Success] Total time: ${totalTime}ms`);

    return data;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[API Error] ${endpoint} (${totalTime}ms):`, error);

    if (error.message === 'Failed to fetch' || error.message.includes('NetworkError')) {
      throw new Error('백엔드 서버에 연결할 수 없습니다. Docker Compose가 실행 중인지 확인해주세요.');
    }

    throw error;
  }
}

export async function checkApiHealth() {
  try {
    const response = await fetch(await buildApiUrl('/'));
    const data = await response.json();
    return data.status === 'ok';
  } catch (error) {
    console.error('[API Health Check] Failed:', error);
    return false;
  }
}
