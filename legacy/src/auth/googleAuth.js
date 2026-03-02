// Google OAuth Configuration - Pure Google Identity Services (No Firebase)

/**
 * Google OAuth Client ID from GCP Console
 * Get this from: https://console.cloud.google.com/apis/credentials?project=apsconsulting
 */
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const STORAGE_KEY = 'aps-google-auth-user';

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
 * Initialize Google Identity Services
 */
export function initializeGoogleAuth() {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) {
      reject(new Error('VITE_GOOGLE_CLIENT_ID environment variable is not set'));
      return;
    }

    // Load Google Identity Services library
    if (window.google) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

/**
 * Sign in with Google popup
 */
export function signInWithGoogle() {
  return new Promise((resolve, reject) => {
    if (!window.google) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'openid email profile',
      callback: async (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }

        try {
          // Get user info using the access token
          const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: {
              Authorization: `Bearer ${response.access_token}`,
            },
          }).then((res) => res.json());

          currentUser = {
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture,
            accessToken: response.access_token,
            // Store ID token for backend authentication
            idToken: await getIdToken(response.access_token),
            provider: 'google',
          };

          persistUser(currentUser);

          // Notify all listeners
          notifyAuthListeners(currentUser);

          resolve(currentUser);
        } catch (error) {
          reject(error);
        }
      },
    });

    client.requestAccessToken();
  });
}

/**
 * Get ID token for backend authentication
 * We need to use the tokeninfo endpoint to exchange access token for ID token
 */
async function getIdToken(accessToken) {
  // For backend authentication, we'll use the access token directly
  // The backend will verify it using Google's tokeninfo endpoint
  return accessToken;
}

/**
 * Sign out
 */
export function signOut() {
  if (window.google && currentUser) {
    window.google.accounts.oauth2.revoke(currentUser.accessToken, () => {
      console.log('Access token revoked');
    });
  }

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
    provider: 'google',
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

export { GOOGLE_CLIENT_ID };

// Attempt to restore session on module load
restoreSession().catch(() => {
  // silent failure; listener already notified in restoreSession on failure
});
