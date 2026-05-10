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

// Global state for authenticated user
let currentUser = null;
let authStateListeners = [];

const notifyAuthListeners = (user) => {
  authStateListeners.forEach((listener) => listener(user));
};

const persistUser = (user) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch (err) {
    console.warn('Failed to persist user session', err);
  }
};

const clearPersistedUser = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear user session', err);
  }
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
      const error = await response.json();
      throw new Error(error.message || 'Login failed');
    }

    const data = await response.json();
    const { user, accessToken, refreshToken } = data;

    // Store user with tokens
    currentUser = {
      email: user.email,
      displayName: user.displayName || user.email,
      name: user.displayName || user.email,
      role: user.role,
      idToken: accessToken,
      accessToken,
      refreshToken,
      provider: 'local',
    };

    persistUser(currentUser);
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

  const stored = loadPersistedUser();
  if (!stored || !stored.refreshToken) {
    console.log('[Local Auth] No refresh token found');
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
        clearPersistedUser();
        return null;
      }

      const data = await response.json();
      const { accessToken, refreshToken: newRefreshToken, user } = data;

      // Update user with new access token AND new refresh token (rolling refresh)
      currentUser = {
        ...stored,
        email: user.email,
        displayName: user.displayName || user.email,
        name: user.displayName || user.email,
        role: user.role,
        idToken: accessToken,
        accessToken,
        refreshToken: newRefreshToken || stored.refreshToken,
        provider: 'local',
      };

      persistUser(currentUser);
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

      // 모든 재시도 실패 → 저장된 토큰으로 오프라인 복원 (토큰 삭제하지 않음)
      console.warn('[Local Auth] All retries failed, restoring with stored credentials');
      currentUser = { ...stored, provider: 'local' };
      persistUser(currentUser);
      notifyAuthListeners(currentUser);
      return currentUser;
    }
  }

  return null;
}

/**
 * Sign out
 */
export function signOut() {
  if (currentUser && currentUser.refreshToken) {
    // Call backend to revoke refresh token
    buildApiUrl('/auth/logout')
      .then((url) => fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: currentUser.refreshToken }),
      }))
      .catch((err) => {
        console.warn('[Local Auth] Logout API call failed:', err);
      });
  }

  currentUser = null;
  clearPersistedUser();
  notifyAuthListeners(null);

  console.log('[Local Auth] Signed out');
}

/**
 * Get current user
 */
export function getCurrentUser() {
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
