/**
 * api.js - runtime backend configuration and common request helpers.
 *
 * Electron main owns AppConfig. The renderer keeps a cached copy and all
 * REST calls resolve their URL from that cache instead of build-time globals.
 */

const BUILT_IN_FALLBACK_REST_BASE_URL = import.meta.env.DEV
  ? 'http://localhost:3001'
  : 'https://backend.apsconsulting.kr';
const FALLBACK_REST_BASE_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_FALLBACK_URL || BUILT_IN_FALLBACK_REST_BASE_URL;
const FALLBACK_ENVIRONMENT = import.meta.env.VITE_BACKEND_ENVIRONMENT || 'production';

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
    config.restBaseUrl || FALLBACK_REST_BASE_URL,
    ['http:', 'https:'],
    'API URL'
  );
  const wsBaseUrl = normalizeBaseUrl(
    config.wsBaseUrl || import.meta.env.VITE_WS_URL || deriveWebSocketUrl(restBaseUrl),
    ['ws:', 'wss:', 'http:', 'https:'],
    'WebSocket URL'
  ).replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

  return {
    version: 1,
    mode: config.mode || 'direct',
    environment: config.environment || FALLBACK_ENVIRONMENT,
    restBaseUrl,
    wsBaseUrl,
    wsDerivedFromRest: !config.wsBaseUrl,
    source: config.source || source,
  };
}

let runtimeConfig = normalizeAppConfig();
let configPromise = null;
let authSessionRestorer = null;

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
  INQUIRY_RESPOND_SMS: (id) => `/inquiries/${id}/respond-sms`,
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
  configPromise = Promise.resolve(runtimeConfig);
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

export async function getBackendEnvironment() {
  const config = await getAppConfig();
  return config.environment;
}

export async function buildApiUrl(endpoint) {
  const baseUrl = await getApiBaseUrl();
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${normalizedEndpoint}`;
}

export function setAuthSessionRestorer(restorer) {
  authSessionRestorer = typeof restorer === 'function' ? restorer : null;
}

function requireCurrentUser(auth) {
  if (!auth?.currentUser) {
    throw new Error('인증이 필요합니다. 다시 로그인해 주세요.');
  }

  const currentUser = auth.currentUser;
  const idToken = currentUser.idToken || currentUser.accessToken;

  if (!idToken) {
    throw new Error('인증 토큰이 없습니다. 다시 로그인해 주세요.');
  }

  return { currentUser, idToken };
}

async function buildAuthHeaders(currentUser, idToken, optionHeaders = {}) {
  const environment = await getBackendEnvironment();

  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${idToken}`,
    'X-Provider': currentUser.provider || 'local',
    'X-Backend-Environment': environment,
    ...optionHeaders,
  };
}

function isNetworkError(error) {
  return error.message === 'Failed to fetch' || error.message.includes('NetworkError');
}

function toNetworkError() {
  return new Error('백엔드에 연결하지 못했습니다. 백엔드가 실행 중이고 접근 가능한지 확인해 주세요.');
}

export async function requestRaw(endpoint, options = {}, auth = null, requestOptions = {}) {
  const startTime = Date.now();
  const { retryOnUnauthorized = true } = requestOptions;
  const { currentUser, idToken } = requireCurrentUser(auth);
  const url = await buildApiUrl(endpoint);
  const headers = await buildAuthHeaders(currentUser, idToken, options.headers);

  try {
    console.log(`[API Request] ${options.method || 'GET'} ${endpoint}`);

    const fetchStart = Date.now();
    const response = await fetch(url, {
      ...options,
      headers,
    });
    const fetchTime = Date.now() - fetchStart;

    console.log(`[API Response] ${response.status} (${fetchTime}ms)`);

    if (response.status !== 401 || !retryOnUnauthorized) {
      return response;
    }

    console.log('[API] Access token expired, attempting refresh...');

    if (!authSessionRestorer) {
      return response;
    }

    const refreshedUser = await authSessionRestorer();

    if (!refreshedUser) {
      return response;
    }

    const retryToken = refreshedUser.idToken || refreshedUser.accessToken;
    if (!retryToken) {
      return response;
    }

    console.log('[API] Token refreshed successfully, retrying request...');

    const retryHeaders = await buildAuthHeaders(refreshedUser, retryToken, options.headers);
    const retryResponse = await fetch(url, {
      ...options,
      headers: retryHeaders,
    });

    console.log(`[API Retry Response] ${retryResponse.status}`);
    return retryResponse;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[API Error] ${endpoint} (${totalTime}ms):`, error);

    if (isNetworkError(error)) {
      throw toNetworkError();
    }

    throw error;
  }
}

export async function apiFetch(endpoint, options = {}, auth = null) {
  return requestRaw(endpoint, options, auth);
}

export async function apiRequest(endpoint, options = {}, auth = null) {
  const startTime = Date.now();

  try {
    const response = await requestRaw(endpoint, options, auth);

    if (response.status === 401) {
      throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    }

    if (!response.ok) {
      let errorMessage = `요청에 실패했습니다. (${response.status})`;

      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch (parseError) {
        // Use default message when response is not JSON.
      }

      throw new Error(errorMessage);
    }

    const data = response.status === 204 ? null : await response.json();
    const totalTime = Date.now() - startTime;

    console.log(`[API Success] Total time: ${totalTime}ms`);

    return data;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[API Error] ${endpoint} (${totalTime}ms):`, error);

    if (isNetworkError(error)) {
      throw toNetworkError();
    }

    throw error;
  }
}

export async function getApiHealthDetails() {
  const url = await buildApiUrl('/');
  const startedAt = Date.now();

  try {
    const response = await fetch(url);
    let data = null;

    try {
      data = await response.json();
    } catch (parseError) {
      data = null;
    }

    return {
      ok: response.ok && data?.status === 'ok',
      httpStatus: response.status,
      elapsedMs: Date.now() - startedAt,
      url,
      data,
    };
  } catch (error) {
    console.error('[API Health Check] Failed:', error);
    return {
      ok: false,
      httpStatus: null,
      elapsedMs: Date.now() - startedAt,
      url,
      error: error.message,
    };
  }
}

export async function checkApiHealth() {
  const details = await getApiHealthDetails();
  return details.ok;
}
