/**
 * Unified Auth Manager - Now uses local JWT authentication only
 *
 * Replaces OAuth (Google/Naver) with local email/password login
 * Implements automatic session restoration with refresh tokens
 */

import * as localAuth from './localAuth';
import { getCurrentUserInfo } from '../services/userService';

// Global state for current user
let currentUser = null;
let authStateListeners = [];

const notifyAuthListeners = (user) => {
  authStateListeners.forEach((listener) => listener(user));
};

/**
 * Sign in with email and password (local JWT auth)
 */
export async function signInWithLocal(email, password) {
  const user = await localAuth.signInWithLocal(email, password);

  // Fetch user info from backend to get displayName
  try {
    const userInfo = await getCurrentUserInfo({ currentUser: user });
    user.displayName = userInfo.display_name || '';
  } catch (error) {
    console.warn('[AuthManager] Failed to fetch user info from backend:', error);
    user.displayName = user.displayName || user.email;
  }

  currentUser = user;

  // Save to localStorage for Electron IPC access
  localStorage.setItem('currentUser', JSON.stringify(user));

  notifyAuthListeners(user);
  return user;
}

/**
 * Sign out from current provider
 */
export function signOut() {
  if (currentUser && currentUser.provider === 'local') {
    localAuth.signOut();
  }

  // Clear currentUser from localStorage
  localStorage.removeItem('currentUser');
  currentUser = null;
  notifyAuthListeners(null);

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
    throw new Error('No user is currently signed in');
  }

  const trimmedName = displayName.trim();

  // Update current user object
  currentUser = {
    ...currentUser,
    displayName: trimmedName,
  };

  // Update currentUser in localStorage for Electron IPC access
  localStorage.setItem('currentUser', JSON.stringify(currentUser));

  // Notify listeners
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

  // Subscribe to local auth
  const unsubscribeLocal = localAuth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      notifyAuthListeners(user);
    }
  });

  // Return combined unsubscribe function
  return () => {
    authStateListeners = authStateListeners.filter((listener) => listener !== callback);
    unsubscribeLocal();
  };
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
  console.log('[AuthManager] Attempting to restore session...');

  // Try to restore session with refresh token
  const user = await localAuth.restoreSession();

  if (user) {
    currentUser = user;
    console.log('[AuthManager] Session restored:', currentUser.email);

    // Fetch user info from backend to get displayName
    try {
      const userInfo = await getCurrentUserInfo({ currentUser });
      currentUser.displayName = userInfo.display_name || '';
    } catch (error) {
      console.warn('[AuthManager] Failed to fetch user info from backend:', error);
      currentUser.displayName = currentUser.displayName || currentUser.email;
    }

    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    notifyAuthListeners(currentUser);
    return currentUser;
  }

  // No valid session - redirect to login
  console.log('[AuthManager] No valid session, redirecting to login...');
  return null;
}

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

// 🎯 Attempt to restore session on module load (AUTO-LOGIN!)
// This runs when the app starts, enabling automatic login
// Only if the user has enabled auto-login
const autoLoginEnabled = localStorage.getItem('aps-auto-login') === 'true';
if (autoLoginEnabled) {
  restoreSession().catch(() => {
    // silent failure - user will see login page
  });
}
