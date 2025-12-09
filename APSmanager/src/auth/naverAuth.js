// Naver OAuth Configuration

/**
 * Naver OAuth Client ID from Naver Developers
 * Get this from: https://developers.naver.com/apps
 * Note: CLIENT_SECRET is NOT exposed to frontend - handled by backend
 */
const NAVER_CLIENT_ID = import.meta.env.VITE_NAVER_CLIENT_ID || '';
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://inquiryapi-759991718457.us-central1.run.app';

// Auto-detect redirect URI based on environment
// Development: http://localhost:5173/naver-callback.html
// Production: https://s-choi-1997.github.io/APSmanager/naver-callback.html
const getRedirectUri = () => {
  // Use environment variable if set
  if (import.meta.env.VITE_NAVER_REDIRECT_URI) {
    return import.meta.env.VITE_NAVER_REDIRECT_URI;
  }

  // Auto-detect based on current origin
  const origin = window.location.origin;
  const pathname = window.location.pathname;

  // If in production (GitHub Pages), include base path
  if (origin.includes('github.io')) {
    const basePath = pathname.split('/')[1]; // Extract 'APSmanager' from '/APSmanager/...'
    return `${origin}/${basePath}/naver-callback.html`;
  }

  // Development or other environments
  return `${origin}/naver-callback.html`;
};

const NAVER_REDIRECT_URI = getRedirectUri();
const STORAGE_KEY = 'aps-naver-auth-user';

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
 * Initialize Naver Auth (no script loading needed)
 */
export function initializeNaverAuth() {
  return new Promise((resolve, reject) => {
    if (!NAVER_CLIENT_ID) {
      reject(new Error('VITE_NAVER_CLIENT_ID environment variable is not set'));
      return;
    }
    resolve();
  });
}

/**
 * Generate random state for CSRF protection
 */
function generateState() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Sign in with Naver popup
 */
export function signInWithNaver() {
  return new Promise((resolve, reject) => {
    if (!NAVER_CLIENT_ID) {
      reject(new Error('VITE_NAVER_CLIENT_ID environment variable is not set'));
      return;
    }

    const state = generateState();
    sessionStorage.setItem('naver_oauth_state', state);

    // Build Naver OAuth URL
    const authUrl = new URL('https://nid.naver.com/oauth2.0/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', NAVER_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', NAVER_REDIRECT_URI);
    authUrl.searchParams.set('state', state);

    // Open popup
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      authUrl.toString(),
      'naver_login',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    if (!popup) {
      reject(new Error('팝업이 차단되었습니다. 팝업 차단을 해제해주세요.'));
      return;
    }

    // Listen for callback message from popup
    const messageHandler = async (event) => {
      // Security: Check origin
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data.type === 'naver_oauth_callback') {
        clearInterval(checkClosed);
        window.removeEventListener('message', messageHandler);
        popup.close();

        const { code, state: returnedState, error } = event.data;

        if (error) {
          reject(new Error(error));
          return;
        }

        // Verify state
        const savedState = sessionStorage.getItem('naver_oauth_state');
        sessionStorage.removeItem('naver_oauth_state');

        if (!savedState || savedState !== returnedState) {
          reject(new Error('State mismatch - possible CSRF attack'));
          return;
        }

        try {
          // Exchange code for access token via backend (secure - no CLIENT_SECRET exposed)
          const tokenResponse = await fetch(`${API_BASE_URL}/auth/naver/token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              code: code,
              state: returnedState,
            }),
          });

          if (!tokenResponse.ok) {
            const errorData = await tokenResponse.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to exchange code for token');
          }

          const responseData = await tokenResponse.json();

          if (responseData.error) {
            throw new Error(responseData.message || responseData.error);
          }

          const { user, accessToken, refreshToken } = responseData;

          currentUser = {
            email: user.email,
            name: user.name,
            picture: user.picture,
            accessToken: accessToken,
            refreshToken: refreshToken,
            idToken: accessToken, // Use access token as ID token for consistency
            provider: 'naver',
          };

          persistUser(currentUser);
          notifyAuthListeners(currentUser);
          resolve(currentUser);
        } catch (error) {
          reject(error);
        }
      }
    };

    // Check if popup was closed
    let checkClosed;
    checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        window.removeEventListener('message', messageHandler);
        reject(new Error('로그인 팝업이 닫혔습니다.'));
      }
    }, 500);

    window.addEventListener('message', messageHandler);
  });
}

/**
 * Sign out
 */
export function signOut() {
  currentUser = null;
  clearPersistedUser();
  notifyAuthListeners(null);
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

/**
 * Restore session from localStorage
 * Token validation will happen on actual API calls
 */
export async function restoreSession() {
  const stored = loadPersistedUser();
  if (!stored || !stored.accessToken) {
    return null;
  }

  // Restore user from localStorage without validation
  // If token is expired, it will fail on actual API calls
  currentUser = {
    ...stored,
    provider: 'naver',
  };

  notifyAuthListeners(currentUser);
  return currentUser;
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

export { NAVER_CLIENT_ID };

// Attempt to restore session on module load
restoreSession().catch(() => {
  // silent failure; listener already notified in restoreSession on failure
});
