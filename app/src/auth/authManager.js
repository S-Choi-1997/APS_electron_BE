/**
 * Unified Auth Manager - Now uses local JWT authentication only
 *
 * Replaces OAuth (Google/Naver) with local email/password login
 * Implements automatic session restoration with refresh tokens
 */

import * as localAuth from './localAuth';
import { setAuthSessionRestorer } from '../config/api';
import { getCurrentUserInfo } from '../services/userService';

// Global state for current user
let currentUser = null;
let authStateListeners = [];
let restoreSessionPromise = null;

const notifyAuthListeners = (user) => {
  authStateListeners.forEach((listener) => listener(user));
};

const resolveDisplayName = (userInfo, fallback = '') => {
  return userInfo?.displayName || userInfo?.display_name || userInfo?.name || fallback;
};

/**
 * Sign in with email and password (local JWT auth)
 */
export async function signInWithLocal(email, password) {
  const user = await localAuth.signInWithLocal(email, password);

  // Fetch user info from backend to get displayName
  try {
    const userInfo = await getCurrentUserInfo({ currentUser: user });
    user.displayName = resolveDisplayName(userInfo, user.displayName || user.email);
    user.name = user.displayName;
  } catch (error) {
    console.warn('[AuthManager] Failed to fetch user info from backend:', error);
    user.displayName = user.displayName || user.email;
    user.name = user.displayName;
  }

  currentUser = user;

  localAuth.setCurrentUser(currentUser);

  // Update last login email (if email saving feature was ever used)
  if (localStorage.getItem('aps-saved-email') !== null) {
    localStorage.setItem('aps-saved-email', user.email);
  }

  notifyAuthListeners(user);
  return user;
}

/**
 * Sign out from current provider
 */
export async function signOut() {
  const localSignOutPromise = localAuth.signOut();

  // Clear auth data from localStorage
  localStorage.removeItem('currentUser');
  // Note: aps-auto-login and aps-saved-email are kept (user preferences)

  currentUser = null;
  notifyAuthListeners(null);

  // Close all sticky windows on logout
  if (window.electron && window.electron.closeAllStickyWindows) {
    window.electron.closeAllStickyWindows();
  }

  await localSignOutPromise;

  console.log('[AuthManager] Signed out');
}

/**
 * Logout alias for signOut
 */
export const logout = signOut;

/**
 * Get current user
 */
export function getCurrentUser() {
  return currentUser;
}

/**
 * Update user display name
 * @param {string} displayName - New display name
 */
export function updateDisplayName(displayName) {
  if (!currentUser) {
    throw new Error('현재 로그인된 사용자가 없습니다.');
  }

  const trimmedName = displayName.trim();

  // Update current user object
  currentUser = {
    ...currentUser,
    displayName: trimmedName,
  };

  localAuth.setCurrentUser(currentUser);

  // Notify listeners
  notifyAuthListeners(currentUser);

  return currentUser;
}

export function setExternalAuthSession(user, options = {}) {
  const { persist = false, syncElectron = false } = options;

  if (!user) {
    currentUser = null;
    localAuth.setCurrentUser(null, { persist, syncElectron });
    notifyAuthListeners(null);
    return null;
  }

  const displayName = resolveDisplayName(user, user.email);
  currentUser = {
    ...user,
    displayName,
    name: displayName,
    provider: user.provider || 'local',
    idToken: user.idToken || user.accessToken,
    accessToken: user.accessToken || user.idToken,
  };

  localAuth.setCurrentUser(currentUser, { persist, syncElectron });
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

  return () => {
    authStateListeners = authStateListeners.filter((listener) => listener !== callback);
  };
}

export function isAutoLoginEnabled() {
  return localStorage.getItem('aps-auto-login') === 'true';
}

export function setAutoLoginPreference(enabled) {
  const normalizedEnabled = Boolean(enabled);
  localStorage.setItem('aps-auto-login', normalizedEnabled.toString());

  if (normalizedEnabled) {
    if (currentUser) {
      localAuth.setCurrentUser(currentUser, { persist: true, syncElectron: false });
    }
  } else {
    localAuth.clearPersistedSessionOnly();
  }

  return normalizedEnabled;
}

/**
 * 🎯 Restore session from localStorage
 *
 * This is the KEY function that enables AUTO-LOGIN!
 * - Calls localAuth.restoreSession() which uses refresh token
 * - No user interaction needed (no OAuth popup!)
 * - Runs automatically on app startup
 */
export async function restoreSession() {
  if (restoreSessionPromise) {
    return restoreSessionPromise;
  }

  restoreSessionPromise = restoreSessionInternal().finally(() => {
    restoreSessionPromise = null;
  });

  return restoreSessionPromise;
}

async function restoreSessionInternal() {
  console.log('[AuthManager] Attempting to restore session...');

  // Try to restore session with refresh token
  const user = await localAuth.restoreSession();

  if (user) {
    currentUser = user;
    console.log('[AuthManager] Session restored:', currentUser.email, 'displayName:', currentUser.displayName);

    // displayName is already included in the refresh token response from backend
    // No need to fetch again - it's already set by localAuth.restoreSession()

    localAuth.setCurrentUser(currentUser);

    // Update last login email (if email saving feature was ever used)
    if (localStorage.getItem('aps-saved-email') !== null) {
      localStorage.setItem('aps-saved-email', currentUser.email);
    }

    notifyAuthListeners(currentUser);
    return currentUser;
  }

  // No valid session - redirect to login
  console.log('[AuthManager] No valid session, redirecting to login...');
  currentUser = null;
  localStorage.removeItem('currentUser');
  notifyAuthListeners(null);
  return null;
}

export async function initializeAuthSession() {
  if (currentUser) {
    return currentUser;
  }

  if (!isAutoLoginEnabled()) {
    return null;
  }

  return restoreSession();
}

setAuthSessionRestorer(restoreSession);

// Export unified auth object
export const auth = {
  currentUser: null,
  onAuthStateChanged,
  signOut,
};

// Keep auth.currentUser in sync
onAuthStateChanged((user) => {
  auth.currentUser = user;
});

// Session restoration is started by AppRouter after runtime backend config is ready.
