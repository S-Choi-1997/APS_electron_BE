/**
 * ZOHO OAuth Token Storage in Firestore
 *
 * Stores encrypted ZOHO OAuth tokens in Firestore for persistence
 * Independent of PostgreSQL schema changes
 */

const admin = require('firebase-admin');
const { encrypt, decrypt } = require('../crypto-helper');

const TOKENS_COLLECTION = 'zoho_tokens';

/**
 * Get Firestore instance
 */
function getFirestore() {
  return admin.firestore();
}

/**
 * Save ZOHO OAuth tokens to Firestore (encrypted)
 * @param {Object} tokenData - Token data
 * @param {string} tokenData.accessToken - Access token
 * @param {string} tokenData.refreshToken - Refresh token
 * @param {number} tokenData.expiresIn - Expires in seconds
 * @param {string} tokenData.tokenType - Token type (usually "Bearer")
 * @param {string} tokenData.zohoEmail - ZOHO account email
 * @param {string} tokenData.zohoUserId - ZOHO user ID
 */
async function saveTokensToFirestore(tokenData) {
  try {
    const db = getFirestore();
    const { accessToken, refreshToken, expiresIn, tokenType, zohoEmail, zohoUserId } = tokenData;

    // Calculate expiration timestamp
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Encrypt sensitive tokens
    const encryptedAccessToken = encrypt(accessToken);
    const encryptedRefreshToken = encrypt(refreshToken);

    // Save to Firestore
    await db.collection(TOKENS_COLLECTION).doc(zohoEmail).set({
      access_token_encrypted: encryptedAccessToken,
      refresh_token_encrypted: encryptedRefreshToken,
      token_type: tokenType,
      expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
      zoho_email: zohoEmail,
      zoho_user_id: zohoUserId,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[Firestore Token Storage] Saved tokens for: ${zohoEmail}`);
  } catch (error) {
    console.error('[Firestore Token Storage] Error saving tokens:', error);
    throw error;
  }
}

/**
 * Get ZOHO OAuth tokens from Firestore (decrypted)
 * @param {string} zohoEmail - ZOHO account email
 * @returns {Promise<Object|null>} Token data or null if not found
 */
async function getTokensFromFirestore(zohoEmail) {
  try {
    const db = getFirestore();
    const doc = await db.collection(TOKENS_COLLECTION).doc(zohoEmail).get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data();

    // Decrypt tokens
    const accessToken = decrypt(data.access_token_encrypted);
    const refreshToken = decrypt(data.refresh_token_encrypted);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: data.token_type,
      expires_at: data.expires_at.toDate(),
      zoho_email: data.zoho_email,
      zoho_user_id: data.zoho_user_id
    };
  } catch (error) {
    console.error('[Firestore Token Storage] Error getting tokens:', error);
    throw error;
  }
}

/**
 * Update access token in Firestore (after refresh)
 * @param {string} zohoEmail - ZOHO account email
 * @param {string} newAccessToken - New access token
 * @param {number} expiresIn - Expires in seconds
 */
async function updateAccessTokenInFirestore(zohoEmail, newAccessToken, expiresIn) {
  try {
    const db = getFirestore();

    // Calculate new expiration timestamp
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Encrypt new access token
    const encryptedAccessToken = encrypt(newAccessToken);

    // Update Firestore
    await db.collection(TOKENS_COLLECTION).doc(zohoEmail).update({
      access_token_encrypted: encryptedAccessToken,
      expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[Firestore Token Storage] Updated access token for: ${zohoEmail}`);
  } catch (error) {
    console.error('[Firestore Token Storage] Error updating access token:', error);
    throw error;
  }
}

/**
 * Delete tokens from Firestore
 * @param {string} zohoEmail - ZOHO account email
 */
async function deleteTokensFromFirestore(zohoEmail) {
  try {
    const db = getFirestore();
    await db.collection(TOKENS_COLLECTION).doc(zohoEmail).delete();
    console.log(`[Firestore Token Storage] Deleted tokens for: ${zohoEmail}`);
  } catch (error) {
    console.error('[Firestore Token Storage] Error deleting tokens:', error);
    throw error;
  }
}

/**
 * Check if tokens exist in Firestore
 * @param {string} zohoEmail - ZOHO account email
 * @returns {Promise<boolean>} True if tokens exist
 */
async function hasTokensInFirestore(zohoEmail) {
  try {
    const db = getFirestore();
    const doc = await db.collection(TOKENS_COLLECTION).doc(zohoEmail).get();
    return doc.exists;
  } catch (error) {
    console.error('[Firestore Token Storage] Error checking tokens:', error);
    return false;
  }
}

module.exports = {
  saveTokensToFirestore,
  getTokensFromFirestore,
  updateAccessTokenInFirestore,
  deleteTokensFromFirestore,
  hasTokensInFirestore
};
