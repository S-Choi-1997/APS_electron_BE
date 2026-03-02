/**
 * Encryption/Decryption Helper Module
 *
 * Uses AES-256-GCM for authenticated encryption of sensitive data
 * Stores encrypted tokens in Firestore
 */

const crypto = require('crypto');

// Algorithm configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits authentication tag
const KEY_LENGTH = 32; // 256 bits for AES-256

/**
 * Get encryption key from environment variable
 * @returns {Buffer} 32-byte encryption key
 */
function getEncryptionKey() {
  const keyHex = process.env.ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error('ENCRYPTION_KEY not found in environment variables');
  }

  const key = Buffer.from(keyHex, 'hex');

  if (key.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex characters)`);
  }

  return key;
}

/**
 * Generate a new random encryption key (for initial setup)
 * @returns {string} Hex-encoded 32-byte key
 */
function generateEncryptionKey() {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Encrypt text using AES-256-GCM
 * @param {string} plaintext - Text to encrypt
 * @returns {string} Encrypted data in format: iv:authTag:ciphertext (all hex-encoded)
 */
function encrypt(plaintext) {
  try {
    const key = getEncryptionKey();

    // Generate random IV
    const iv = crypto.randomBytes(IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Return format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('[Crypto] Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt text using AES-256-GCM
 * @param {string} encryptedData - Encrypted data in format: iv:authTag:ciphertext
 * @returns {string} Decrypted plaintext
 */
function decrypt(encryptedData) {
  try {
    const key = getEncryptionKey();

    // Parse encrypted data
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('[Crypto] Decryption error:', error);
    throw new Error('Failed to decrypt data - data may be corrupted or key is incorrect');
  }
}

/**
 * Encrypt an object (converts to JSON first)
 * @param {Object} obj - Object to encrypt
 * @returns {string} Encrypted JSON
 */
function encryptObject(obj) {
  const json = JSON.stringify(obj);
  return encrypt(json);
}

/**
 * Decrypt to an object (parses JSON after decryption)
 * @param {string} encryptedData - Encrypted JSON data
 * @returns {Object} Decrypted object
 */
function decryptObject(encryptedData) {
  const json = decrypt(encryptedData);
  return JSON.parse(json);
}

module.exports = {
  generateEncryptionKey,
  encrypt,
  decrypt,
  encryptObject,
  decryptObject
};
