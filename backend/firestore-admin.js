/**
 * Firestore Admin User Management Module
 *
 * Handles all admin user operations in Firestore 'admins' collection.
 * Replaces PostgreSQL users table for authentication.
 */

const admin = require('firebase-admin');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 12;
const ADMINS_COLLECTION = 'admins';

/**
 * Get Firestore instance
 */
function getFirestore() {
  return admin.firestore();
}

/**
 * Get admin user by email
 * @param {string} email - User email (document ID)
 * @returns {Promise<Object|null>} Admin object or null if not found
 */
async function getAdminByEmail(email) {
  try {
    const db = getFirestore();
    const doc = await db.collection(ADMINS_COLLECTION).doc(email).get();

    if (!doc.exists) {
      return null;
    }

    return {
      email: doc.id,
      ...doc.data()
    };
  } catch (error) {
    console.error('[FirestoreAdmin] Error fetching admin:', error);
    throw error;
  }
}

/**
 * Create new admin user
 * @param {string} email - User email
 * @param {string} password - Plain text password (will be hashed)
 * @param {string} displayName - Display name
 * @param {string} role - User role ('admin' or 'user')
 * @returns {Promise<Object>} Created admin object
 */
async function createAdmin(email, password, displayName, role = 'user') {
  try {
    // Validate inputs
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    if (!['admin', 'user'].includes(role)) {
      throw new Error('Role must be "admin" or "user"');
    }

    // Check if admin already exists
    const existing = await getAdminByEmail(email);
    if (existing) {
      throw new Error(`Admin with email ${email} already exists`);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create admin document
    const db = getFirestore();
    const adminData = {
      email,
      display_name: displayName || email,
      password_hash: passwordHash,
      role,
      active: true,
      provider: 'local',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection(ADMINS_COLLECTION).doc(email).set(adminData);

    console.log(`[FirestoreAdmin] Created admin: ${email} (role: ${role})`);

    return {
      email,
      display_name: adminData.display_name,
      role: adminData.role,
      active: adminData.active,
      provider: adminData.provider
    };
  } catch (error) {
    console.error('[FirestoreAdmin] Error creating admin:', error);
    throw error;
  }
}

/**
 * Update admin user fields
 * @param {string} email - User email
 * @param {Object} updates - Fields to update (display_name, role, active, etc.)
 * @returns {Promise<Object>} Updated admin object
 */
async function updateAdmin(email, updates) {
  try {
    const db = getFirestore();
    const docRef = db.collection(ADMINS_COLLECTION).doc(email);

    // Check if admin exists
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error(`Admin with email ${email} not found`);
    }

    // Validate updates
    const allowedFields = ['display_name', 'role', 'active'];
    const sanitizedUpdates = {};

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        sanitizedUpdates[key] = value;
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      throw new Error('No valid fields to update');
    }

    // Add updated_at timestamp
    sanitizedUpdates.updated_at = admin.firestore.FieldValue.serverTimestamp();

    await docRef.update(sanitizedUpdates);

    console.log(`[FirestoreAdmin] Updated admin: ${email}`);

    return await getAdminByEmail(email);
  } catch (error) {
    console.error('[FirestoreAdmin] Error updating admin:', error);
    throw error;
  }
}

/**
 * Soft delete admin user (set active = false)
 * @param {string} email - User email
 * @returns {Promise<void>}
 */
async function deleteAdmin(email) {
  try {
    await updateAdmin(email, { active: false });
    console.log(`[FirestoreAdmin] Deactivated admin: ${email}`);
  } catch (error) {
    console.error('[FirestoreAdmin] Error deleting admin:', error);
    throw error;
  }
}

/**
 * List all admin users
 * @param {boolean} activeOnly - Return only active admins
 * @returns {Promise<Array>} Array of admin objects
 */
async function listAdmins(activeOnly = false) {
  try {
    const db = getFirestore();
    let query = db.collection(ADMINS_COLLECTION);

    if (activeOnly) {
      query = query.where('active', '==', true);
    }

    const snapshot = await query.get();
    const admins = [];

    snapshot.forEach(doc => {
      admins.push({
        email: doc.id,
        ...doc.data()
      });
    });

    return admins;
  } catch (error) {
    console.error('[FirestoreAdmin] Error listing admins:', error);
    throw error;
  }
}

/**
 * Verify admin password
 * @param {string} email - User email
 * @param {string} password - Plain text password to verify
 * @returns {Promise<boolean>} True if password matches
 */
async function verifyAdminPassword(email, password) {
  try {
    const admin = await getAdminByEmail(email);

    if (!admin || !admin.password_hash) {
      return false;
    }

    return await bcrypt.compare(password, admin.password_hash);
  } catch (error) {
    console.error('[FirestoreAdmin] Error verifying password:', error);
    return false;
  }
}

module.exports = {
  getAdminByEmail,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  listAdmins,
  verifyAdminPassword
};
