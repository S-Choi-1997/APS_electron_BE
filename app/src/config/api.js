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
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const HEALTH_CHECK_TIMEOUT_MS = 8000;

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
  return error?.message === 'Failed to fetch' || error?.message?.includes('NetworkError');
}

function toNetworkError() {
  return new Error('백엔드에 연결하지 못했습니다. 백엔드가 실행 중이고 접근 가능한지 확인해 주세요.');
}

function toRequestTimeoutError() {
  const error = new Error('요청 시간이 초과되었습니다. 네트워크 상태와 백엔드 응답을 확인해 주세요.');
  error.code = 'APS_REQUEST_TIMEOUT';
  return error;
}

function createTimeoutSignal(timeoutMs, callerSignal) {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return {
      signal: callerSignal,
      cleanup: () => {},
      didTimeout: () => false,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let removeCallerListener = () => {};
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      const abortFromCaller = () => controller.abort(callerSignal.reason);
      callerSignal.addEventListener('abort', abortFromCaller, { once: true });
      removeCallerListener = () => callerSignal.removeEventListener('abort', abortFromCaller);
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      removeCallerListener();
    },
    didTimeout: () => timedOut,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const { signal: callerSignal, ...fetchOptions } = options;
  const timeoutSignal = createTimeoutSignal(timeoutMs, callerSignal);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: timeoutSignal.signal,
    });
    Object.defineProperty(response, '__apsCleanupTimeout', {
      value: timeoutSignal.cleanup,
      configurable: true,
      writable: true,
    });
    ['arrayBuffer', 'blob', 'formData', 'json', 'text'].forEach((method) => {
      if (typeof response[method] !== 'function') return;
      const readBody = response[method].bind(response);
      Object.defineProperty(response, method, {
        value: async (...args) => {
          try {
            return await readBody(...args);
          } catch (error) {
            if (timeoutSignal.didTimeout() && error?.name === 'AbortError') {
              throw toRequestTimeoutError();
            }
            throw error;
          } finally {
            cleanupResponseTimeout(response);
          }
        },
        configurable: true,
      });
    });
    return response;
  } catch (error) {
    timeoutSignal.cleanup();
    if (timeoutSignal.didTimeout() && error?.name === 'AbortError') {
      throw toRequestTimeoutError();
    }
    throw error;
  }
}

function cleanupResponseTimeout(response) {
  if (typeof response?.__apsCleanupTimeout === 'function') {
    response.__apsCleanupTimeout();
    response.__apsCleanupTimeout = null;
  }
}

export async function requestRaw(endpoint, options = {}, auth = null, requestOptions = {}) {
  const startTime = Date.now();
  const { retryOnUnauthorized = true, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = requestOptions;
  const { currentUser, idToken } = requireCurrentUser(auth);
  const url = await buildApiUrl(endpoint);
  const headers = await buildAuthHeaders(currentUser, idToken, options.headers);

  try {
    console.log(`[API Request] ${options.method || 'GET'} ${endpoint}`);

    const fetchStart = Date.now();
    const response = await fetchWithTimeout(url, {
      ...options,
      headers,
    }, timeoutMs);
    const fetchTime = Date.now() - fetchStart;

    console.log(`[API Response] ${response.status} (${fetchTime}ms)`);

    if (response.status !== 401 || !retryOnUnauthorized) {
      return response;
    }

    console.log('[API] Access token expired, attempting refresh...');

    if (!authSessionRestorer) {
      return response;
    }

    let refreshedUser = null;
    try {
      refreshedUser = await authSessionRestorer();
    } catch (error) {
      cleanupResponseTimeout(response);
      throw error;
    }

    if (!refreshedUser) {
      return response;
    }

    const retryToken = refreshedUser.idToken || refreshedUser.accessToken;
    if (!retryToken) {
      return response;
    }

    cleanupResponseTimeout(response);
    console.log('[API] Token refreshed successfully, retrying request...');

    const retryHeaders = await buildAuthHeaders(refreshedUser, retryToken, options.headers);
    const retryResponse = await fetchWithTimeout(url, {
      ...options,
      headers: retryHeaders,
    }, timeoutMs);

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
      cleanupResponseTimeout(response);
      throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    }

    if (!response.ok) {
      let errorMessage = `요청에 실패했습니다. (${response.status})`;

      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch (parseError) {
        if (parseError?.code === 'APS_REQUEST_TIMEOUT') {
          throw parseError;
        }
        // Use default message when response is not JSON.
      } finally {
        cleanupResponseTimeout(response);
      }

      throw new Error(errorMessage);
    }

    let data = null;
    try {
      data = response.status === 204 ? null : await response.json();
    } finally {
      cleanupResponseTimeout(response);
    }
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
    const response = await fetchWithTimeout(url, {}, HEALTH_CHECK_TIMEOUT_MS);
    let data = null;

    try {
      data = await response.json();
    } catch (parseError) {
      if (parseError?.code === 'APS_REQUEST_TIMEOUT') {
        throw parseError;
      }
      data = null;
    } finally {
      cleanupResponseTimeout(response);
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
