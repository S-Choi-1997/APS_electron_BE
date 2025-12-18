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
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const admin = require('firebase-admin');
const firestoreAdmin = require('./firestore-admin');

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-this-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-this-too';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const BCRYPT_ROUNDS = 12;

// Refresh token storage (in-memory, production should use Redis)
const refreshTokens = new Map();

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
 * Generate JWT tokens (access + refresh)
 */
function generateTokens(user) {
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

  // Store refresh token (in-memory)
  refreshTokens.set(refreshToken, {
    email: user.email,
    createdAt: new Date(),
  });

  return { accessToken, refreshToken };
}

/**
 * Verify refresh token and generate new access token + new refresh token
 * Rolling refresh token strategy: extends login duration as long as user is active
 */
function refreshAccessToken(oldRefreshToken) {
  return new Promise((resolve, reject) => {
    // Check if refresh token exists in storage
    if (!refreshTokens.has(oldRefreshToken)) {
      return reject(new Error('Invalid refresh token'));
    }

    // Verify refresh token
    jwt.verify(oldRefreshToken, JWT_REFRESH_SECRET, (err, decoded) => {
      if (err) {
        refreshTokens.delete(oldRefreshToken);
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

      // Remove old refresh token
      refreshTokens.delete(oldRefreshToken);

      // Store new refresh token
      refreshTokens.set(newRefreshToken, {
        email: decoded.email,
        createdAt: new Date(),
      });

      console.log(`[Auth] Rolling refresh token issued for ${decoded.email}`);

      resolve({ accessToken, refreshToken: newRefreshToken, email: decoded.email });
    });
  });
}

/**
 * Revoke refresh token (logout)
 */
function revokeRefreshToken(refreshToken) {
  refreshTokens.delete(refreshToken);
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

module.exports = {
  getAdminByEmail,
  generateTokens,
  refreshAccessToken,
  revokeRefreshToken,
  hashPassword,
  verifyPassword,
  authenticateJWT,
};
