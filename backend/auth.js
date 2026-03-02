/**
 * Authentication Module - JWT based authentication
 *
 * Replaces OAuth (Google/Naver) with local JWT authentication
 *
 * Features:
 * - JWT token generation (accessToken + refreshToken)
 * - Token verification middleware
 * - Firestore admins collection for user management
 * - Password hashing with bcrypt
 * - PostgreSQL persistent refresh token storage
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const admin = require('firebase-admin');
const firestoreAdmin = require('./firestore-admin');
const db = require('./db'); // PostgreSQL connection

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-this-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-this-too';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const BCRYPT_ROUNDS = 12;

/**
 * Get admin user by email from Firestore
 * Replaces whitelist + PostgreSQL users table
 */
async function getAdminByEmail(email) {
  try {
    return await firestoreAdmin.getAdminByEmail(email);
  } catch (error) {
    console.error('[Auth] Failed to fetch admin:', error);
    return null;
  }
}

/**
 * Store refresh token in PostgreSQL
 */
async function storeRefreshToken(token, email, userAgent = null, ipAddress = null) {
  try {
    // Calculate expiration date (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db.query(
      `INSERT INTO refresh_tokens (token, email, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [token, email, expiresAt, userAgent, ipAddress]
    );

    console.log(`[Auth] Refresh token stored in DB for ${email}`);
  } catch (error) {
    console.error('[Auth] Failed to store refresh token:', error);
    throw error;
  }
}

/**
 * Verify refresh token exists in PostgreSQL
 */
async function verifyRefreshTokenInDB(token) {
  try {
    const result = await db.query(
      `SELECT email, expires_at
       FROM refresh_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return null;
    }

    // Update last_used_at
    await db.query(
      `UPDATE refresh_tokens
       SET last_used_at = NOW()
       WHERE token = $1`,
      [token]
    );

    return result.rows[0];
  } catch (error) {
    console.error('[Auth] Failed to verify refresh token in DB:', error);
    return null;
  }
}

/**
 * Delete refresh token from PostgreSQL
 */
async function deleteRefreshToken(token) {
  try {
    await db.query(
      `DELETE FROM refresh_tokens WHERE token = $1`,
      [token]
    );
    console.log('[Auth] Refresh token deleted from DB');
  } catch (error) {
    console.error('[Auth] Failed to delete refresh token:', error);
  }
}

/**
 * Clean up expired tokens (should be called periodically)
 */
async function cleanupExpiredTokens() {
  try {
    const result = await db.query(
      `DELETE FROM refresh_tokens WHERE expires_at <= NOW()`
    );
    if (result.rowCount > 0) {
      console.log(`[Auth] Cleaned up ${result.rowCount} expired refresh tokens`);
    }
  } catch (error) {
    console.error('[Auth] Failed to cleanup expired tokens:', error);
  }
}

/**
 * Generate JWT tokens (access + refresh)
 */
async function generateTokens(user, userAgent = null, ipAddress = null) {
  const payload = {
    email: user.email,
    role: user.role || 'user',
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

  const refreshToken = jwt.sign(
    { email: user.email, role: user.role || 'user' },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );

  // Store refresh token in PostgreSQL
  await storeRefreshToken(refreshToken, user.email, userAgent, ipAddress);

  return { accessToken, refreshToken };
}

/**
 * Verify refresh token and generate new access token + new refresh token
 * Rolling refresh token strategy: extends login duration as long as user is active
 */
async function refreshAccessToken(oldRefreshToken, userAgent = null, ipAddress = null) {
  // Check if refresh token exists in PostgreSQL
  const tokenData = await verifyRefreshTokenInDB(oldRefreshToken);

  if (!tokenData) {
    throw new Error('Invalid refresh token');
  }

  // Verify JWT signature
  return new Promise((resolve, reject) => {
    jwt.verify(oldRefreshToken, JWT_REFRESH_SECRET, async (err, decoded) => {
      if (err) {
        // Delete invalid token from DB
        await deleteRefreshToken(oldRefreshToken);
        return reject(new Error('Expired or invalid refresh token'));
      }

      // Generate new access token
      const accessToken = jwt.sign(
        { email: decoded.email, role: decoded.role || 'user' },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      // 🎯 Generate NEW refresh token (rolling refresh)
      const newRefreshToken = jwt.sign(
        { email: decoded.email, role: decoded.role || 'user' },
        JWT_REFRESH_SECRET,
        { expiresIn: JWT_REFRESH_EXPIRES_IN }
      );

      // Remove old refresh token from DB
      await deleteRefreshToken(oldRefreshToken);

      // Store new refresh token in DB
      await storeRefreshToken(newRefreshToken, decoded.email, userAgent, ipAddress);

      console.log(`[Auth] Rolling refresh token issued for ${decoded.email}`);

      resolve({ accessToken, refreshToken: newRefreshToken, email: decoded.email });
    });
  });
}

/**
 * Revoke refresh token (logout)
 */
async function revokeRefreshToken(refreshToken) {
  await deleteRefreshToken(refreshToken);
}

/**
 * Hash password with bcrypt
 */
async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify password with bcrypt
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * JWT Authentication Middleware
 * Replaces OAuth authenticate middleware
 */
const authenticateJWT = async (req, res, next) => {
  const authStartTime = Date.now();

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Missing or invalid authorization header',
      });
    }

    const token = authHeader.split('Bearer ')[1];

    // Verify JWT token
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        console.error('[Auth] JWT verification failed:', err.message);
        return res.status(401).json({
          error: 'unauthorized',
          message: 'Invalid or expired token',
        });
      }

      // Set user info in request
      req.user = {
        email: decoded.email,
        role: decoded.role || 'user',
        provider: 'local',
      };

      const authDuration = Date.now() - authStartTime;
      console.log(`[Auth] JWT authentication successful for ${decoded.email} (${authDuration}ms)`);

      next();
    });
  } catch (error) {
    console.error('[Auth] Authentication error:', error);
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Authentication failed',
    });
  }
};

// Cleanup expired tokens every hour
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

// Initial cleanup on startup
cleanupExpiredTokens();

module.exports = {
  getAdminByEmail,
  generateTokens,
  refreshAccessToken,
  revokeRefreshToken,
  hashPassword,
  verifyPassword,
  authenticateJWT,
  cleanupExpiredTokens,
};
