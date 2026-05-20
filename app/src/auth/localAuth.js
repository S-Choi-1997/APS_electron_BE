/**
 * Local Authentication Module - JWT based authentication
 *
 * Replaces Google/Naver OAuth with local email/password login
 *
 * Features:
 * - Email/password login
 * - Automatic session restoration with refresh token
 * - Token management in localStorage
 */

import { buildApiUrl } from '../config/api';

const STORAGE_KEY = 'aps-local-auth-user';
const CURRENT_USER_STORAGE_KEY = 'currentUser';

// Global state for authenticated user
let currentUser = null;
let authStateListeners = [];

const notifyAuthListeners = (user) => {
  authStateListeners.forEach((listener) => listener(user));
};

const persistUser = (user) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
  } catch (err) {
    console.warn('Failed to persist user session', err);
  }
};

const clearCurrentUserStorage = () => {
  try {
    localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear current user session', err);
  }
};

const clearPersistedUser = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear user session', err);
  }
};

function createAuthError(message, response, errorData = {}) {
  const error = new Error(message || '로그인에 실패했습니다.');
  error.status = response?.status;
  error.code = errorData.error;
  return error;
}

const resolveDisplayName = (user) => {
  return user?.displayName || user?.display_name || user?.name || user?.email || '';
};

const syncElectronAuthSession = () => {
  if (typeof window === 'undefined' || !window.electron) {
    return;
  }

  Promise.resolve(window.electron.setAuthSession?.(currentUser))
    .then(() => window.electron.refreshWebSocketAuth?.())
    .catch((err) => {
      console.warn('[Local Auth] Failed to sync Electron auth session', err);
    });
};

const clearCurrentSession = () => {
  currentUser = null;
  clearPersistedUser();
  syncElectronAuthSession();
  notifyAuthListeners(null);
};

const loadPersistedUser = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Failed to load user session', err);
    return null;
  }
};

/**
 * Sign in with email and password
 */
export async function signInWithLocal(email, password) {
  try {
    const response = await fetch(await buildApiUrl('/auth/login'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch (parseError) {
        errorData = {};
      }
      throw createAuthError(errorData.message, response, errorData);
    }

    const data = await response.json();
    const { user, accessToken, refreshToken } = data;
    const displayName = resolveDisplayName(user);

    // Store user with tokens
    currentUser = {
      email: user.email,
      displayName,
      name: displayName,
      role: user.role,
      idToken: accessToken,
      accessToken,
      refreshToken,
      provider: 'local',
    };

    persistUser(currentUser);
    syncElectronAuthSession();
    notifyAuthListeners(currentUser);

    console.log('[Local Auth] Login successful:', currentUser.email);
    return currentUser;
  } catch (error) {
    console.error('[Local Auth] Login failed:', error);
    throw error;
  }
}

/**
 * 🎯 Auto-login: Restore session with refresh token
 *
 * This is the KEY feature that enables auto-login!
 * - Checks for stored refresh token
 * - Calls backend /auth/refresh to get new access token
 * - No user interaction needed (no popup!)
 */
export async function restoreSession() {
  console.log('[Local Auth] Attempting to restore session...');

  const stored = loadPersistedUser() || currentUser;
  if (!stored || !stored.refreshToken) {
    console.log('[Local Auth] No refresh token found');
    clearCurrentSession();
    return null;
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [2000, 4000, 8000]; // 2초, 4초, 8초

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[Local Auth] Retry ${attempt}/${MAX_RETRIES} in ${RETRY_DELAYS[attempt - 1]}ms...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1]));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(await buildApiUrl('/auth/refresh'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        // 서버가 응답함 → 인증 오류 (토큰 만료/무효) → 토큰 삭제 (재시도 불필요)
        console.log('[Local Auth] Refresh token expired or invalid, status:', response.status);
        clearCurrentSession();
        return null;
      }

      const data = await response.json();
      const { accessToken, refreshToken: newRefreshToken, user } = data;
      const displayName = resolveDisplayName(user);

      // Update user with new access token AND new refresh token (rolling refresh)
      currentUser = {
        ...stored,
        email: user.email,
        displayName,
        name: displayName,
        role: user.role,
        idToken: accessToken,
        accessToken,
        refreshToken: newRefreshToken || stored.refreshToken,
        provider: 'local',
      };

      persistUser(currentUser);
      syncElectronAuthSession();
      notifyAuthListeners(currentUser);

      console.log('[Local Auth] Session restored successfully:', currentUser.email);
      return currentUser;
    } catch (error) {
      clearTimeout(timeoutId);

      // 네트워크 오류 → 재시도 (마지막이 아니면)
      if (attempt < MAX_RETRIES) {
        console.warn(`[Local Auth] Network error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error.message);
        continue;
      }

      // 모든 재시도 실패 → 만료 가능성이 있는 access token으로 보호 화면을 통과시키지 않음
      console.warn('[Local Auth] All retries failed, keeping stored refresh token for a later retry');
      currentUser = null;
      clearCurrentUserStorage();
      syncElectronAuthSession();
      notifyAuthListeners(null);
      return null;
    }
  }

  return null;
}

/**
 * Sign out
 */
export async function signOut() {
  const refreshToken = currentUser?.refreshToken || loadPersistedUser()?.refreshToken;

  clearCurrentSession();

  if (refreshToken) {
    // Call backend to revoke refresh token
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const url = await buildApiUrl('/auth/logout');
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal,
      });
    } catch (err) {
      console.warn('[Local Auth] Logout API call failed:', err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  console.log('[Local Auth] Signed out');
}

/**
 * Get current user
 */
export function getCurrentUser() {
  return currentUser;
}

export function clearPersistedSessionOnly() {
  clearPersistedUser();
}

/**
 * Replace the in-memory/persisted local auth session.
 *
 * This is intended for authManager only. localAuth owns token persistence,
 * while authManager owns the public auth facade used by the app.
 */
export function setCurrentUser(user, options = {}) {
  const { persist = true, syncElectron = true } = options;
  currentUser = user || null;

  if (currentUser && persist) {
    persistUser(currentUser);
  } else if (!currentUser && persist) {
    clearPersistedUser();
  }

  if (syncElectron) {
    syncElectronAuthSession();
  }
  notifyAuthListeners(currentUser);
  return currentUser;
}

/**
 * Listen to auth state changes
 * @param {Function} callback - Called with user object or null
 * @returns {Function} Unsubscribe function
 */
export function onAuthStateChanged(callback) {
  authStateListeners.push(callback);

  // Immediately call with current state
  callback(currentUser);

  // Return unsubscribe function
  return () => {
    authStateListeners = authStateListeners.filter((listener) => listener !== callback);
  };
}

// Export auth object that mimics Firebase Auth API for easier migration
export const auth = {
  currentUser: null,
  onAuthStateChanged,
  signOut,
};

// Keep auth.currentUser in sync
onAuthStateChanged((user) => {
  auth.currentUser = user;
});

// Note: Session restoration is handled by authManager.js
// Do not auto-restore here to prevent displayName override issues
