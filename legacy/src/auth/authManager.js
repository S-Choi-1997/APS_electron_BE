// Unified Auth Manager - Manages multiple authentication providers

import * as googleAuth from './googleAuth';
import * as naverAuth from './naverAuth';

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
  currentUser = user;
  notifyAuthListeners(user);
  return user;
}

/**
 * Sign in with Naver
 */
export async function signInWithNaver() {
  const user = await naverAuth.signInWithNaver();
  currentUser = user;
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
  currentUser = null;
  notifyAuthListeners(null);
}

/**
 * Get current user
 */
export function getCurrentUser() {
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
 * Tries to restore from both providers
 */
export async function restoreSession() {
  // Try to restore from both providers
  const [googleUser, naverUser] = await Promise.allSettled([
    googleAuth.restoreSession(),
    naverAuth.restoreSession(),
  ]);

  // Return the first successful restore
  if (googleUser.status === 'fulfilled' && googleUser.value) {
    currentUser = googleUser.value;
    notifyAuthListeners(googleUser.value);
    return googleUser.value;
  }

  if (naverUser.status === 'fulfilled' && naverUser.value) {
    currentUser = naverUser.value;
    notifyAuthListeners(naverUser.value);
    return naverUser.value;
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
