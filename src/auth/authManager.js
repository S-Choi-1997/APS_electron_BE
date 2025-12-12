// Unified Auth Manager - Manages multiple authentication providers

import * as googleAuth from './googleAuth';
import * as naverAuth from './naverAuth';
import { getCurrentUserInfo } from '../services/userService';

// Global state for current user
let currentUser = null;
let authStateListeners = [];

const notifyAuthListeners = (user) => {
  authStateListeners.forEach((listener) => listener(user));
};

/**
 * Initialize all auth providers
 */
export async function initializeAuth() {
  const results = await Promise.allSettled([
    googleAuth.initializeGoogleAuth(),
    naverAuth.initializeNaverAuth(),
  ]);

  // Check if at least one provider initialized successfully
  const hasSuccess = results.some((result) => result.status === 'fulfilled');

  if (!hasSuccess) {
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason.message)
      .join(', ');
    throw new Error(`All auth providers failed to initialize: ${errors}`);
  }

  // Log any initialization failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const provider = index === 0 ? 'Google' : 'Naver';
      console.warn(`${provider} auth initialization failed:`, result.reason.message);
    }
  });
}

/**
 * Sign in with Google
 */
export async function signInWithGoogle() {
  const user = await googleAuth.signInWithGoogle();

  // Fetch user info from backend to get displayName
  try {
    const userInfo = await getCurrentUserInfo({ currentUser: user });
    user.displayName = userInfo.display_name || '';
  } catch (error) {
    console.warn('Failed to fetch user info from backend:', error);
    user.displayName = '';
  }

  currentUser = user;

  // Save to localStorage for Electron IPC access
  localStorage.setItem('currentUser', JSON.stringify(user));

  // Save auto-login preference
  localStorage.setItem('autoLogin', JSON.stringify({
    provider: 'google',
    email: user.email,
  }));

  notifyAuthListeners(user);
  return user;
}

/**
 * Sign in with Naver
 */
export async function signInWithNaver() {
  const user = await naverAuth.signInWithNaver();

  // Fetch user info from backend to get displayName
  try {
    const userInfo = await getCurrentUserInfo({ currentUser: user });
    user.displayName = userInfo.display_name || '';
  } catch (error) {
    console.warn('Failed to fetch user info from backend:', error);
    user.displayName = '';
  }

  currentUser = user;

  // Save to localStorage for Electron IPC access
  localStorage.setItem('currentUser', JSON.stringify(user));

  // Save auto-login preference
  localStorage.setItem('autoLogin', JSON.stringify({
    provider: 'naver',
    email: user.email,
  }));

  notifyAuthListeners(user);
  return user;
}

/**
 * Sign out from current provider
 */
export function signOut() {
  if (currentUser) {
    if (currentUser.provider === 'google') {
      googleAuth.signOut();
    } else if (currentUser.provider === 'naver') {
      naverAuth.signOut();
    }
  }
  // Clear currentUser and auto-login from localStorage
  localStorage.removeItem('currentUser');
  localStorage.removeItem('autoLogin');
  currentUser = null;
  notifyAuthListeners(null);
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
 * Listen to auth state changes from all providers
 * @param {Function} callback - Called with user object or null
 * @returns {Function} Unsubscribe function
 */
export function onAuthStateChanged(callback) {
  authStateListeners.push(callback);

  // Immediately call with current state
  callback(currentUser);

  // Subscribe to both providers
  const unsubscribeGoogle = googleAuth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      notifyAuthListeners(user);
    }
  });

  const unsubscribeNaver = naverAuth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      notifyAuthListeners(user);
    }
  });

  // Return combined unsubscribe function
  return () => {
    authStateListeners = authStateListeners.filter((listener) => listener !== callback);
    unsubscribeGoogle();
    unsubscribeNaver();
  };
}

/**
 * Restore session from localStorage
 * First tries to restore existing token, then falls back to auto-login if enabled
 */
export async function restoreSession() {
  console.log('[Auto-Login] Attempting to restore session...');

  // Step 1: Try to restore from existing tokens
  const [googleUser, naverUser] = await Promise.allSettled([
    googleAuth.restoreSession(),
    naverAuth.restoreSession(),
  ]);

  // Return the first successful restore
  if (googleUser.status === 'fulfilled' && googleUser.value) {
    currentUser = googleUser.value;
    console.log('[Auto-Login] Restored from Google token:', currentUser.email);

    // Fetch user info from backend to get displayName
    try {
      const userInfo = await getCurrentUserInfo({ currentUser });
      currentUser.displayName = userInfo.display_name || '';
    } catch (error) {
      console.warn('Failed to fetch user info from backend:', error);
      currentUser.displayName = '';
    }

    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    notifyAuthListeners(currentUser);
    return currentUser;
  }

  if (naverUser.status === 'fulfilled' && naverUser.value) {
    currentUser = naverUser.value;
    console.log('[Auto-Login] Restored from Naver token:', currentUser.email);

    // Fetch user info from backend to get displayName
    try {
      const userInfo = await getCurrentUserInfo({ currentUser });
      currentUser.displayName = userInfo.display_name || '';
    } catch (error) {
      console.warn('Failed to fetch user info from backend:', error);
      currentUser.displayName = '';
    }

    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    notifyAuthListeners(currentUser);
    return currentUser;
  }

  // Step 2: If no valid token, check auto-login preference
  console.log('[Auto-Login] No valid token found, checking auto-login preference...');
  const autoLoginData = localStorage.getItem('autoLogin');

  if (!autoLoginData) {
    console.log('[Auto-Login] No auto-login preference found');
    return null;
  }

  try {
    const { provider, email } = JSON.parse(autoLoginData);
    console.log(`[Auto-Login] Auto-login enabled for ${email} via ${provider}`);

    // Trigger re-authentication based on provider
    if (provider === 'google') {
      console.log('[Auto-Login] Re-authenticating with Google...');
      return await signInWithGoogle();
    } else if (provider === 'naver') {
      console.log('[Auto-Login] Re-authenticating with Naver...');
      return await signInWithNaver();
    }
  } catch (error) {
    console.error('[Auto-Login] Auto-login failed:', error);
    // Clear invalid auto-login data
    localStorage.removeItem('autoLogin');
  }

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

// Attempt to restore session on module load
restoreSession().catch(() => {
  // silent failure
});
