/**
 * APS Admin Local Backend Server
 *
 * 로컬 Docker 환경에서 실행되는 백엔드 API 서버
 * GCP2 Cloud Run 코드를 로컬 환경용으로 수정
 *
 * 주요 기능:
 * - JWT 토큰 기반 인증 (로컬 이메일/비밀번호 로그인)
 * - 문의 목록 조회/상세/업데이트/삭제 (GCP Firestore)
 * - 메모/일정 관리 (PostgreSQL)
 * - 첨부파일 서명된 URL 발급 (GCP Storage)
 * - SMS 발송 (Aligo API via GCP3 Relay 서버)
 * - WebSocket 실시간 동기화 (Socket.IO)
 *
 * 환경변수:
 * - PORT: 서버 포트 (기본값: 3001)
 * - JWT_SECRET: JWT 토큰 서명 키
 * - ALLOWED_ORIGINS: CORS 허용 도메인
 * - ALLOWED_EMAILS: 접근 허용 이메일 목록
 * - STORAGE_BUCKET: GCP Storage 버킷
 * - GOOGLE_APPLICATION_CREDENTIALS: GCP 서비스 계정 JSON 경로
 * - ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER_PHONE: Aligo SMS
 * - RELAY_URL: GCP3 SMS Relay 서버 주소
 * - POSTGRES_*: PostgreSQL 연결 정보
 */

// Load environment variables from .env file
require('dotenv').config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const admin = require("firebase-admin");
const db_postgres = require("./db"); // PostgreSQL connection
const auth = require("./auth"); // JWT authentication module
const firestoreAdmin = require("./firestore-admin"); // Firestore admin management

// 환경변수 로드 확인
console.log("=".repeat(60));
console.log("🏠 APS Admin LOCAL Backend Server Starting...");
console.log("=".repeat(60));
console.log("Environment Configuration:");
console.log(`- PORT: ${process.env.PORT || 3001}`);
console.log(`- STORAGE_BUCKET: ${process.env.STORAGE_BUCKET || 'Not set'}`);
console.log(`- GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'Not set'}`);
console.log(`- ALLOWED_ORIGINS: ${process.env.ALLOWED_ORIGINS || 'Not set'}`);
console.log(`- ALLOWED_EMAILS: ${process.env.ALLOWED_EMAILS ? '✓ Set' : '✗ Not set'}`);
console.log(`- NAVER_CLIENT_ID: ${process.env.NAVER_CLIENT_ID ? '✓ Set' : '✗ Not set'}`);
console.log(`- RELAY_URL (GCP3): ${process.env.RELAY_URL || 'http://136.113.67.193:3000'}`);
console.log("=".repeat(60));

// Initialize Firebase Admin with service account
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: process.env.STORAGE_BUCKET || "aps-list.appspot.com",
  });
  console.log("✓ Firebase Admin initialized successfully");
} catch (error) {
  console.error("✗ Failed to initialize Firebase Admin:", error.message);
  console.error("Make sure GOOGLE_APPLICATION_CREDENTIALS is set correctly");
  process.exit(1);
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Run database migrations on startup
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');

  // Check if migrations directory exists
  if (!fs.existsSync(migrationsDir)) {
    console.log('[DB] No migrations directory found, skipping...');
    return;
  }

  const migrations = [
    '000_create_email_inquiries_table.sql',
    '001_add_source_column.sql',
    '002_create_zoho_tokens_table.sql'
  ];

  console.log('[DB] Running migrations...');

  for (const migration of migrations) {
    const filePath = path.join(migrationsDir, migration);

    if (!fs.existsSync(filePath)) {
      console.log(`[DB] ⚠️  Migration not found: ${migration}, skipping...`);
      continue;
    }

    try {
      const sql = fs.readFileSync(filePath, 'utf8');
      await db_postgres.query(sql);
      console.log(`[DB] ✓ ${migration}`);
    } catch (error) {
      // Ignore common migration errors (already exists, duplicate column, etc.)
      const ignorableErrors = [
        'already exists',
        'duplicate key',
        'duplicate column',
        'column "source" does not exist'  // Temporary: for transition from old schema
      ];

      const shouldIgnore = ignorableErrors.some(msg =>
        error.message && error.message.includes(msg)
      );

      if (shouldIgnore) {
        console.log(`[DB] ⚠️  ${migration} (skipping, already applied or schema mismatch)`);
      } else {
        console.error(`[DB] ✗ Error running ${migration}:`, error.message);
      }
    }
  }

  console.log('[DB] Migrations completed');
}

// Test PostgreSQL connection and run migrations on startup
db_postgres.testConnection().then(async (success) => {
  if (!success) {
    console.error("⚠️  Warning: PostgreSQL connection failed. Memos and schedules will not work.");
  } else {
    // Run migrations after successful connection
    await runMigrations();
  }
});

const app = express();
const server = http.createServer(app);

// CORS configuration
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

// ============================================
// WebSocket Relay Client (Socket.IO Client to GCP4 Relay)
// ============================================
const { io: ioClient } = require('socket.io-client');

const RELAY_WS_URL = process.env.RELAY_WS_URL || 'ws://localhost:8080';
const BACKEND_VERSION = process.env.BACKEND_VERSION || '1.0.0';
const BACKEND_INSTANCE_ID = process.env.BACKEND_INSTANCE_ID || 'backend-local-001';

let relaySocket = null;
let isRelayConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

function connectToRelay() {
  console.log(`[WebSocket Relay] Connecting to ${RELAY_WS_URL}...`);

  relaySocket = ioClient(RELAY_WS_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    timeout: 10000
  });

  relaySocket.on('connect', () => {
    console.log('[WebSocket Relay] Connected to relay server');
    reconnectAttempts = 0;

    // Send handshake
    relaySocket.emit('handshake', {
      type: 'backend',
      version: BACKEND_VERSION,
      instanceId: BACKEND_INSTANCE_ID,
      metadata: {
        hostname: require('os').hostname(),
        pid: process.pid,
        startTime: new Date().toISOString()
      }
    });
  });

  relaySocket.on('handshake:success', (data) => {
    console.log('[WebSocket Relay] Handshake successful:', data);
    isRelayConnected = true;
  });

  relaySocket.on('handshake:error', (error) => {
    console.error('[WebSocket Relay] Handshake failed:', error);
    isRelayConnected = false;
  });

  relaySocket.on('active:changed', (data) => {
    console.log(`[WebSocket Relay] Active status: ${data.active ? 'ACTIVE' : 'INACTIVE'}`);
  });

  relaySocket.on('disconnect', (reason) => {
    console.log(`[WebSocket Relay] Disconnected: ${reason}`);
    isRelayConnected = false;
  });

  relaySocket.on('connect_error', (error) => {
    reconnectAttempts++;
    console.error(`[WebSocket Relay] Connection error (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}):`, error.message);

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[WebSocket Relay] Max reconnection attempts reached. Giving up.');
    }
  });

  // ============================================
  // HTTP-over-WebSocket Tunnel Handler
  // ============================================
  relaySocket.on('http:request', async (request) => {
    const { requestId, method, path, query, headers, body } = request;

    // Build full URL with query parameters
    let fullPath = path;
    if (query && Object.keys(query).length > 0) {
      const queryString = new URLSearchParams(query).toString();
      fullPath = `${path}?${queryString}`;
    }

    console.log(`[Backend] Tunnel HTTP ${method} ${fullPath} (requestId: ${requestId})`);

    try {
      // Handle ZOHO-specific routes directly without HTTP roundtrip
      if (method === 'POST' && path === '/api/zoho/sync') {
        const jwt = require('jsonwebtoken');
        const zohoRoutes = require('./zoho/routes');

        // Verify JWT token from headers
        const authHeader = headers.authorization || headers.Authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          relaySocket.emit('http:response', {
            requestId,
            statusCode: 401,
            headers: { 'content-type': 'application/json' },
            body: { error: 'unauthorized', message: 'Missing or invalid token' }
          });
          console.log(`[Backend] Tunnel response 401 (requestId: ${requestId})`);
          return;
        }

        const token = authHeader.substring(7);
        let user;

        try {
          user = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
          relaySocket.emit('http:response', {
            requestId,
            statusCode: 401,
            headers: { 'content-type': 'application/json' },
            body: { error: 'unauthorized', message: 'Invalid or expired token' }
          });
          console.log(`[Backend] Tunnel response 401 (requestId: ${requestId})`);
          return;
        }

        // Call route handler directly
        const result = await zohoRoutes.handleZohoSync(user);

        relaySocket.emit('http:response', {
          requestId,
          statusCode: result.status,
          headers: { 'content-type': 'application/json' },
          body: result.body
        });

        console.log(`[Backend] Tunnel response ${result.status} (requestId: ${requestId})`);
        return;
      }

      // Handle ZOHO webhook route directly (no auth required)
      if (method === 'POST' && path === '/api/zoho/webhook') {
        const zoho = require('./zoho');

        try {
          // Call webhook handler directly
          const mockReq = {
            body: body,
            headers: headers
          };
          const mockRes = {
            status: function(code) {
              this.statusCode = code;
              return this;
            },
            json: function(data) {
              this.body = data;
              return this;
            },
            statusCode: 200,
            body: {}
          };

          await zoho.handleWebhook(mockReq, mockRes);

          relaySocket.emit('http:response', {
            requestId,
            statusCode: mockRes.statusCode,
            headers: { 'content-type': 'application/json' },
            body: mockRes.body
          });

          console.log(`[Backend] Tunnel response ${mockRes.statusCode} (requestId: ${requestId})`);
          return;
        } catch (error) {
          console.error('[Backend] ZOHO webhook handler error:', error);
          relaySocket.emit('http:response', {
            requestId,
            statusCode: 500,
            headers: { 'content-type': 'application/json' },
            body: { error: 'webhook_error', message: error.message }
          });
          console.log(`[Backend] Tunnel response 500 (requestId: ${requestId})`);
          return;
        }
      }

      // Handle email response route directly
      if (method === 'POST' && path === '/api/email-response') {
        const jwt = require('jsonwebtoken');
        const zohoRoutes = require('./zoho/routes');

        // Verify JWT token from headers
        const authHeader = headers.authorization || headers.Authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          relaySocket.emit('http:response', {
            requestId,
            statusCode: 401,
            headers: { 'content-type': 'application/json' },
            body: { error: 'unauthorized', message: 'Missing or invalid token' }
          });
          console.log(`[Backend] Tunnel response 401 (requestId: ${requestId})`);
          return;
        }

        const token = authHeader.substring(7);
        let user;

        try {
          user = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
          relaySocket.emit('http:response', {
            requestId,
            statusCode: 401,
            headers: { 'content-type': 'application/json' },
            body: { error: 'unauthorized', message: 'Invalid or expired token' }
          });
          console.log(`[Backend] Tunnel response 401 (requestId: ${requestId})`);
          return;
        }

        // Call route handler directly
        const result = await zohoRoutes.handleEmailResponse(user, body);

        relaySocket.emit('http:response', {
          requestId,
          statusCode: result.status,
          headers: { 'content-type': 'application/json' },
          body: result.body
        });

        console.log(`[Backend] Tunnel response ${result.status} (requestId: ${requestId})`);
        return;
      }

      // For all other routes, use axios to localhost (fallback)
      const axios = require('axios');
      const BASE_URL = `http://localhost:${PORT}`;

      const response = await axios({
        method: method.toLowerCase(),
        url: `${BASE_URL}${fullPath}`,
        headers: {
          ...headers,
          host: undefined,
        },
        data: body,
        validateStatus: () => true,
        maxRedirects: 0,
      });

      relaySocket.emit('http:response', {
        requestId,
        statusCode: response.status,
        headers: response.headers,
        body: response.data,
      });

      console.log(`[Backend] Tunnel response ${response.status} (requestId: ${requestId})`);
    } catch (error) {
      console.error(`[Backend] Tunnel error (requestId: ${requestId}):`, error.message);

      relaySocket.emit('http:response', {
        requestId,
        statusCode: 500,
        headers: { 'content-type': 'application/json' },
        body: {
          error: 'tunnel_error',
          message: error.message,
        },
      });
    }
  });

  // Heartbeat
  setInterval(() => {
    if (relaySocket && relaySocket.connected) {
      relaySocket.emit('heartbeat');
    }
  }, 30000);
}

// 전역 broadcast 함수 (CRUD 작업에서 사용)
global.broadcastEvent = (eventType, data) => {
  if (!relaySocket || !isRelayConnected) {
    console.warn(`[WebSocket Relay] Not connected, cannot send event: ${eventType}`);
    return;
  }

  relaySocket.emit(eventType, data);
  console.log(`[WebSocket Relay] Sent event to relay: ${eventType}`);
};

// Connect to relay on startup
connectToRelay();

console.log('✓ WebSocket Relay Client initialized');

app.use(cors(corsOptions));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const emoji = res.statusCode >= 200 && res.statusCode < 300 ? '✓' : '✗';
    console.log(`${emoji} ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Health check endpoint (no auth required)
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "aps-admin-local-backend",
    version: "1.0.0",
    environment: "local",
  });
});

// ============================================
// Authentication Routes (JWT)
// ============================================

// Rate limiter for login endpoint - 5 attempts per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: 'too_many_requests',
    message: '너무 많은 로그인 시도입니다. 15분 후 다시 시도하세요.',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    console.warn(`[Security] Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'too_many_requests',
      message: '너무 많은 로그인 시도입니다. 15분 후 다시 시도하세요.',
    });
  },
});

// POST /auth/login - Login with email/password
app.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Email and password are required',
      });
    }

    // Get admin from Firestore (avoid shadowing 'admin' module)
    const adminUser = await firestoreAdmin.getAdminByEmail(email);

    if (!adminUser) {
      console.warn(`[Auth] Login attempt for non-existent email: ${email}`);
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Check if account is active
    if (!adminUser.active) {
      console.warn(`[Auth] Login denied for inactive account: ${email}`);
      return res.status(403).json({
        error: 'forbidden',
        message: 'Account is inactive',
      });
    }

    // Verify password
    if (!adminUser.password_hash) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Account not configured for local login',
      });
    }

    const isValidPassword = await auth.verifyPassword(password, adminUser.password_hash);
    if (!isValidPassword) {
      console.warn(`[Auth] Invalid password for: ${email}`);
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Upsert user into PostgreSQL users table (for memos/schedules foreign key)
    try {
      await db_postgres.query(
        `INSERT INTO users (email, display_name, provider, role, active, created_at, updated_at, synced_at, password_hash)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $6)
         ON CONFLICT (email)
         DO UPDATE SET
           display_name = EXCLUDED.display_name,
           role = EXCLUDED.role,
           active = EXCLUDED.active,
           updated_at = CURRENT_TIMESTAMP`,
        [
          adminUser.email,
          adminUser.display_name,
          adminUser.provider || 'local',
          adminUser.role,
          adminUser.active,
          adminUser.password_hash
        ]
      );
      console.log(`[Auth] User synced to PostgreSQL: ${email}`);
    } catch (dbError) {
      console.error('[Auth] Failed to sync user to PostgreSQL:', dbError);
      // Continue even if sync fails - login should still work
    }

    // Generate JWT tokens
    const { accessToken, refreshToken } = auth.generateTokens(adminUser);

    console.log(`[Auth] Login successful for ${email} (role: ${adminUser.role})`);

    res.json({
      user: {
        email: adminUser.email,
        displayName: adminUser.display_name,
        role: adminUser.role,
        provider: 'local',
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Login failed',
    });
  }
});

// POST /auth/refresh - Refresh access token
app.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Refresh token is required',
      });
    }

    // Verify refresh token and generate new access token + new refresh token (rolling)
    const { accessToken, refreshToken: newRefreshToken, email } = await auth.refreshAccessToken(refreshToken);

    // Get admin info from Firestore (avoid shadowing 'admin' module)
    const adminUser = await firestoreAdmin.getAdminByEmail(email);

    if (!adminUser || !adminUser.active) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'User not found or inactive',
      });
    }

    console.log(`[Auth] Token refreshed for ${email} (rolling refresh)`);

    res.json({
      accessToken,
      refreshToken: newRefreshToken, // New refresh token included (rolling refresh)
      user: {
        email: adminUser.email,
        displayName: adminUser.display_name,
        role: adminUser.role,
        provider: 'local',
      },
    });
  } catch (error) {
    console.error('[Auth] Token refresh error:', error.message);
    res.status(401).json({
      error: 'unauthorized',
      message: error.message,
    });
  }
});

// POST /auth/logout - Logout (revoke refresh token)
app.post('/auth/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      auth.revokeRefreshToken(refreshToken);
    }

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('[Auth] Logout error:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Logout failed',
    });
  }
});

// POST /auth/register - Register new user (admin only)
app.post('/auth/register', auth.authenticateJWT, async (req, res) => {
  try {
    // Check if requester is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Admin access required',
      });
    }

    const { email, password, displayName, role = 'user' } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Email and password are required',
      });
    }

    // Validate role
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Role must be "admin" or "user"',
      });
    }

    // Check if admin already exists in Firestore
    const existingAdmin = await firestoreAdmin.getAdminByEmail(email);

    if (existingAdmin) {
      return res.status(409).json({
        error: 'conflict',
        message: 'User already exists',
      });
    }

    // Create admin in Firestore
    const newAdmin = await firestoreAdmin.createAdmin(
      email,
      password,
      displayName || email,
      role
    );

    console.log(`[Auth] New user registered: ${email} (role: ${role})`);

    res.status(201).json({
      success: true,
      user: {
        email: newAdmin.email,
        displayName: newAdmin.display_name,
        role: newAdmin.role,
        active: newAdmin.active,
      },
    });
  } catch (error) {
    console.error('[Auth] Registration error:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Registration failed',
    });
  }
});

// ============================================
// Legacy OAuth routes (will be removed)
// ============================================

// Apply authentication to all /inquiries routes
app.use("/inquiries", auth.authenticateJWT);

// GET /inquiries - List all inquiries with optional filtering
app.get("/inquiries", async (req, res) => {
  const startTime = Date.now();
  try {
    const { check, status, category, limit = "100", offset = "0" } = req.query;

    let query = db.collection("inquiries");

    // Apply filters
    if (check !== undefined) {
      query = query.where("check", "==", check === "true");
    }

    if (status) {
      query = query.where("status", "==", status);
    }

    if (category) {
      query = query.where("category", "==", category);
    }

    // Order by creation date (newest first)
    query = query.orderBy("createdAt", "desc");

    // Apply pagination
    const limitNum = parseInt(limit, 10);
    const offsetNum = parseInt(offset, 10);

    if (offsetNum > 0) {
      const offsetSnapshot = await query.limit(offsetNum).get();
      if (!offsetSnapshot.empty) {
        const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
        query = query.startAfter(lastDoc);
      }
    }

    query = query.limit(limitNum);

    const queryStartTime = Date.now();
    const snapshot = await query.get();
    const queryDuration = Date.now() - queryStartTime;

    const inquiries = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      // Convert Firestore Timestamp to ISO string
      createdAt: doc.data().createdAt?.toDate().toISOString(),
      updatedAt: doc.data().updatedAt?.toDate().toISOString(),
    }));

    const duration = Date.now() - startTime;
    console.log(`[Firestore] Query completed in ${queryDuration}ms, total ${duration}ms, returned ${inquiries.length} items`);

    res.json({
      status: "ok",
      data: inquiries,
      count: inquiries.length,
    });
  } catch (error) {
    console.error("Error fetching inquiries:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// GET /inquiries/stats - Get unchecked inquiry statistics
app.get("/inquiries/stats", async (req, res) => {
  try {
    const snapshot = await db.collection("inquiries")
      .where("check", "==", false)
      .get();

    const websiteCount = snapshot.docs.length;
    const emailCount = 0; // 이메일 로직 없음, 일단 0

    res.json({
      status: "ok",
      data: {
        website: websiteCount,
        email: emailCount,
        total: websiteCount + emailCount
      }
    });
  } catch (error) {
    console.error("Error fetching inquiry stats:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// GET /inquiries/:id - Get single inquiry by ID
app.get("/inquiries/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const doc = await db.collection("inquiries").doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    const data = doc.data();

    res.json({
      status: "ok",
      data: {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate().toISOString(),
        updatedAt: data.updatedAt?.toDate().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching inquiry:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// PATCH /inquiries/:id - Update inquiry (check status, notes, etc.)
app.patch("/inquiries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};

    // Only allow specific fields to be updated
    const allowedFields = ["check", "status", "notes", "assignedTo"];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "bad_request", message: "No valid fields to update" });
    }

    // Add updated timestamp
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    updates.updatedBy = req.user.email; // Track who updated (email from JWT)

    const docRef = db.collection("inquiries").doc(id);

    // Check if document exists
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    await docRef.update(updates);

    // Broadcast inquiry update event via WebSocket Relay
    global.broadcastEvent('consultation:updated', {
      id: id,
      ...updates,
      timestamp: new Date().toISOString(),
    });

    res.json({
      status: "ok",
      message: "Inquiry updated successfully",
      updated: updates,
    });
  } catch (error) {
    console.error("Error updating inquiry:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// GET /inquiries/:id/attachments/urls - Get signed download URLs for all attachments
app.get("/inquiries/:id/attachments/urls", async (req, res) => {
  try {
    const { id } = req.params;

    // Get inquiry document
    const doc = await db.collection("inquiries").doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    const data = doc.data();
    const attachments = data.attachments || [];

    if (attachments.length === 0) {
      return res.json({
        status: "ok",
        data: [],
      });
    }

    // Generate signed URLs for all attachments
    const urlPromises = attachments.map(async (attachment) => {
      try {
        // Use path or filename from attachment
        const filePath = attachment.path || attachment.filename;

        if (!filePath) {
          return {
            ...attachment,
            downloadUrl: null,
            error: "No file path",
          };
        }

        const file = bucket.file(filePath);

        // Check if file exists
        const [exists] = await file.exists();

        if (!exists) {
          return {
            ...attachment,
            downloadUrl: null,
            error: "File not found in storage",
          };
        }

        // Generate signed URL (valid for 1 hour)
        const expiresDate = new Date();
        expiresDate.setHours(expiresDate.getHours() + 1);

        const [url] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires: expiresDate,
        });

        return {
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          downloadUrl: url,
        };
      } catch (error) {
        console.error(`Error generating URL for ${attachment.name}:`, error);
        return {
          ...attachment,
          downloadUrl: null,
          error: error.message,
        };
      }
    });

    const results = await Promise.all(urlPromises);

    res.json({
      status: "ok",
      data: results,
    });
  } catch (error) {
    console.error("Error generating download URLs:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// DELETE /inquiries/:id - Delete inquiry
app.delete("/inquiries/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const docRef = db.collection("inquiries").doc(id);

    // Check if document exists
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    const data = doc.data();
    const attachments = Array.isArray(data.attachments) ? data.attachments : [];

    // Delete attachments from Cloud Storage (best-effort; continue on individual errors)
    const attachmentResults = [];
    for (const attachment of attachments) {
      const filePath = attachment.path || attachment.filename;
      if (!filePath) {
        attachmentResults.push({
          name: attachment.name,
          path: null,
          status: "skipped",
          reason: "No file path on attachment",
        });
        continue;
      }

      try {
        await bucket.file(filePath).delete({ ignoreNotFound: true });
        attachmentResults.push({
          name: attachment.name || filePath,
          path: filePath,
          status: "deleted",
        });
      } catch (err) {
        console.error(`Error deleting attachment ${filePath}:`, err);
        attachmentResults.push({
          name: attachment.name || filePath,
          path: filePath,
          status: "error",
          error: err.message,
        });
      }
    }

    await docRef.delete();

    console.log(`[Delete] Inquiry ${id} deleted by ${req.user.email}`);

    res.json({
      status: "ok",
      message: "Inquiry and attachments deleted",
      attachments: attachmentResults,
    });
  } catch (error) {
    console.error("Error deleting inquiry:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// ============================================
// USERS API (PostgreSQL)
// ============================================

// PATCH /users/me - Update current user's displayName
app.patch("/users/me", auth.authenticateJWT, async (req, res) => {
  try {
    const { displayName } = req.body;

    if (displayName === undefined) {
      return res.status(400).json({
        error: "bad_request",
        message: "Missing displayName field"
      });
    }

    // Update admin in Firestore
    const updatedAdmin = await firestoreAdmin.updateAdmin(req.user.email, {
      display_name: displayName
    });

    if (!updatedAdmin) {
      return res.status(404).json({ error: "not_found", message: "User not found" });
    }

    // Convert Firestore timestamps to ISO strings for JSON serialization
    res.json({
      status: "ok",
      data: {
        email: updatedAdmin.email,
        displayName: updatedAdmin.display_name,  // Consistent camelCase
        provider: updatedAdmin.provider,
        role: updatedAdmin.role,
        active: updatedAdmin.active,
        createdAt: updatedAdmin.created_at?.toDate?.().toISOString() || null,
        updatedAt: updatedAdmin.updated_at?.toDate?.().toISOString() || null,
      },
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

// GET /users/me - Get current user info
app.get("/users/me", auth.authenticateJWT, async (req, res) => {
  try {
    // Get admin info from Firestore (avoid shadowing 'admin' module)
    const adminUser = await firestoreAdmin.getAdminByEmail(req.user.email);

    if (!adminUser) {
      return res.status(404).json({ error: "not_found", message: "User not found" });
    }

    // Convert Firestore timestamps to ISO strings for JSON serialization
    res.json({
      status: "ok",
      data: {
        email: adminUser.email,
        displayName: adminUser.display_name,  // Consistent camelCase
        provider: adminUser.provider,
        role: adminUser.role,
        active: adminUser.active,
        createdAt: adminUser.created_at?.toDate?.().toISOString() || null,
        updatedAt: adminUser.updated_at?.toDate?.().toISOString() || null,
      },
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

// ============================================
// MEMOS API (PostgreSQL)
// ============================================

// GET /memos - List memos with search and pagination
app.get("/memos", auth.authenticateJWT, async (req, res) => {
  try {
    const { search, author, important, limit = "50", offset = "0" } = req.query;

    let query = `
      SELECT m.id, m.title, m.content, m.important, m.author,
             m.created_at, m.updated_at, m.expire_date,
             COALESCE(u.display_name, m.author) as author_name
      FROM active_memos m
      LEFT JOIN users u ON m.author = u.email
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // Search filter (title or content)
    if (search) {
      query += ` AND (m.title ILIKE $${paramIndex} OR m.content ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Author filter
    if (author) {
      query += ` AND m.author = $${paramIndex}`;
      params.push(author);
      paramIndex++;
    }

    // Important filter
    if (important !== undefined) {
      query += ` AND m.important = $${paramIndex}`;
      params.push(important === 'true');
      paramIndex++;
    }

    // Order by creation date (newest first)
    query += ` ORDER BY m.created_at DESC`;

    // Pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await db_postgres.query(query, params);

    res.json({
      status: "ok",
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Error fetching memos:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// POST /memos - Create new memo
app.post("/memos", auth.authenticateJWT, async (req, res) => {
  try {
    const { title, content, important = false, expire_date } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        error: "bad_request",
        message: "Missing required fields: title, content"
      });
    }

    const insertQuery = `
      INSERT INTO memos (title, content, important, author, expire_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, content, important, author, created_at, updated_at, expire_date
    `;

    const expireDate = expire_date || new Date().toISOString().split('T')[0]; // Default: today
    const result = await db_postgres.query(insertQuery, [
      title,
      content,
      important,
      req.user.email,
      expireDate,
    ]);

    // Get author_name from users table
    const selectQuery = `
      SELECT m.*, COALESCE(u.display_name, m.author) as author_name
      FROM memos m
      LEFT JOIN users u ON m.author = u.email
      WHERE m.id = $1
    `;
    const memoWithAuthor = await db_postgres.query(selectQuery, [result.rows[0].id]);

    // WebSocket broadcast
    if (global.broadcastEvent) {
      global.broadcastEvent('memo:created', memoWithAuthor.rows[0]);
    }

    res.json({
      status: "ok",
      data: memoWithAuthor.rows[0],
    });
  } catch (error) {
    console.error("Error creating memo:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// PATCH /memos/:id - Update memo
app.patch("/memos/:id", auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, important, expire_date } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      params.push(title);
    }
    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      params.push(content);
    }
    if (important !== undefined) {
      updates.push(`important = $${paramIndex++}`);
      params.push(important);
    }
    if (expire_date !== undefined) {
      updates.push(`expire_date = $${paramIndex++}`);
      params.push(expire_date);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "bad_request", message: "No fields to update" });
    }

    params.push(id);
    const query = `
      UPDATE memos
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex} AND deleted_at IS NULL
      RETURNING id, title, content, important, author, created_at, updated_at, expire_date
    `;

    const result = await db_postgres.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "not_found", message: "Memo not found" });
    }

    res.json({
      status: "ok",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating memo:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// DELETE /memos/:id - Soft delete memo
app.delete("/memos/:id", auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      UPDATE memos
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await db_postgres.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "not_found", message: "Memo not found" });
    }

    // WebSocket broadcast
    if (global.broadcastEvent) {
      global.broadcastEvent('memo:deleted', { id: parseInt(id) });
    }

    res.json({
      status: "ok",
      message: "Memo deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting memo:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// ============================================
// SCHEDULES API (PostgreSQL)
// ============================================

// GET /schedules - List schedules with filtering
app.get("/schedules", auth.authenticateJWT, async (req, res) => {
  try {
    const { start_date, end_date, type, author, limit = "100", offset = "0" } = req.query;

    let query = `
      SELECT s.id, s.title, s.time, s.start_date, s.end_date, s.type, s.author,
             s.created_at, s.updated_at,
             COALESCE(u.display_name, s.author) as author_name
      FROM active_schedules s
      LEFT JOIN users u ON s.author = u.email
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // Date range filter
    if (start_date) {
      query += ` AND s.end_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      query += ` AND s.start_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    // Type filter
    if (type) {
      query += ` AND s.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    // Author filter
    if (author) {
      query += ` AND s.author = $${paramIndex}`;
      params.push(author);
      paramIndex++;
    }

    // Order by start date
    query += ` ORDER BY s.start_date DESC, s.time`;

    // Pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await db_postgres.query(query, params);

    res.json({
      status: "ok",
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Error fetching schedules:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// POST /schedules - Create new schedule
app.post("/schedules", auth.authenticateJWT, async (req, res) => {
  try {
    const { title, time, start_date, end_date, type } = req.body;

    if (!title || !start_date || !end_date || !type) {
      return res.status(400).json({
        error: "bad_request",
        message: "Missing required fields: title, start_date, end_date, type"
      });
    }

    const insertQuery = `
      INSERT INTO schedules (title, time, start_date, end_date, type, author)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, title, time, start_date, end_date, type, author, created_at, updated_at
    `;

    const result = await db_postgres.query(insertQuery, [
      title,
      time || null,
      start_date,
      end_date,
      type,
      req.user.email,
    ]);

    // Get author_name from users table
    const selectQuery = `
      SELECT s.*, COALESCE(u.display_name, s.author) as author_name
      FROM schedules s
      LEFT JOIN users u ON s.author = u.email
      WHERE s.id = $1
    `;
    const scheduleWithAuthor = await db_postgres.query(selectQuery, [result.rows[0].id]);

    // WebSocket broadcast
    if (global.broadcastEvent) {
      global.broadcastEvent('schedule:created', scheduleWithAuthor.rows[0]);
    }

    res.json({
      status: "ok",
      data: scheduleWithAuthor.rows[0],
    });
  } catch (error) {
    console.error("Error creating schedule:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// PATCH /schedules/:id - Update schedule
app.patch("/schedules/:id", auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, time, start_date, end_date, type } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      params.push(title);
    }
    if (time !== undefined) {
      updates.push(`time = $${paramIndex++}`);
      params.push(time);
    }
    if (start_date !== undefined) {
      updates.push(`start_date = $${paramIndex++}`);
      params.push(start_date);
    }
    if (end_date !== undefined) {
      updates.push(`end_date = $${paramIndex++}`);
      params.push(end_date);
    }
    if (type !== undefined) {
      updates.push(`type = $${paramIndex++}`);
      params.push(type);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "bad_request", message: "No fields to update" });
    }

    params.push(id);
    const query = `
      UPDATE schedules
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex} AND deleted_at IS NULL
      RETURNING id, title, time, start_date, end_date, type, author, created_at, updated_at
    `;

    const result = await db_postgres.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "not_found", message: "Schedule not found" });
    }

    // WebSocket broadcast
    if (global.broadcastEvent) {
      global.broadcastEvent('schedule:updated', result.rows[0]);
    }

    res.json({
      status: "ok",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating schedule:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// DELETE /schedules/:id - Soft delete schedule
app.delete("/schedules/:id", auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      UPDATE schedules
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await db_postgres.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "not_found", message: "Schedule not found" });
    }

    // WebSocket broadcast
    if (global.broadcastEvent) {
      global.broadcastEvent('schedule:deleted', { id: parseInt(id) });
    }

    res.json({
      status: "ok",
      message: "Schedule deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting schedule:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// ============================================
// WEB FORM INQUIRIES API (PostgreSQL - Firestore polling)
// ============================================

// GET /web-form-inquiries - List web form inquiries
app.get("/web-form-inquiries", auth.authenticateJWT, async (req, res) => {
  try {
    const { checked, consultation_type, limit = "100", offset = "0" } = req.query;

    let query = `
      SELECT id, name, email, phone, consultation_type, content,
             preferred_contact, consent_privacy, created_at, synced_at,
             checked, checked_by, checked_at, notes, ip_address, user_agent
      FROM web_form_inquiries
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (checked !== undefined) {
      query += ` AND checked = $${paramIndex}`;
      params.push(checked === 'true');
      paramIndex++;
    }

    if (consultation_type) {
      query += ` AND consultation_type = $${paramIndex}`;
      params.push(consultation_type);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await db_postgres.query(query, params);

    res.json({
      status: "ok",
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Error fetching web form inquiries:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// PATCH /web-form-inquiries/:id - Update web form inquiry (mark as checked)
app.patch("/web-form-inquiries/:id", auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { checked, notes } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (checked !== undefined) {
      updates.push(`checked = $${paramIndex++}`);
      params.push(checked);

      if (checked) {
        updates.push(`checked_by = $${paramIndex++}`);
        params.push(req.user.email);
        updates.push(`checked_at = CURRENT_TIMESTAMP`);
      }
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      params.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "bad_request", message: "No fields to update" });
    }

    params.push(id);
    const query = `
      UPDATE web_form_inquiries
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await db_postgres.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "not_found", message: "Web form inquiry not found" });
    }

    res.json({
      status: "ok",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating web form inquiry:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// ============================================
// UNIFIED INQUIRIES VIEW
// ============================================

// GET /inquiries/all - Get all unchecked inquiries (unified view)
app.get("/inquiries/all", auth.authenticateJWT, async (req, res) => {
  try {
    const { limit = "100", offset = "0" } = req.query;

    const query = `
      SELECT * FROM all_unchecked_inquiries
      LIMIT $1 OFFSET $2
    `;

    const result = await db_postgres.query(query, [
      parseInt(limit, 10),
      parseInt(offset, 10),
    ]);

    res.json({
      status: "ok",
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Error fetching all inquiries:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// POST /sms/send - Send SMS via Aligo API (through GCP3 relay)
app.post("/sms/send", auth.authenticateJWT, async (req, res) => {
  try {
    const { receiver, msg, msg_type, title, testmode_yn } = req.body;

    // Validate required fields
    if (!receiver || !msg) {
      return res.status(400).json({
        error: "bad_request",
        message: "Missing required fields: receiver, msg"
      });
    }

    // Validate environment variables
    const ALIGO_API_KEY = process.env.ALIGO_API_KEY;
    const ALIGO_USER_ID = process.env.ALIGO_USER_ID;
    const ALIGO_SENDER = process.env.ALIGO_SENDER_PHONE;

    if (!ALIGO_API_KEY || !ALIGO_USER_ID || !ALIGO_SENDER) {
      console.error("Aligo SMS credentials not configured");
      return res.status(500).json({
        error: "server_config_error",
        message: "SMS service not configured"
      });
    }

    // Call GCP3 SMS relay server (VM with fixed IP)
    const RELAY_URL = process.env.RELAY_URL || 'http://136.113.67.193:3000';
    console.log(`[SMS] Sending via GCP3 relay: ${RELAY_URL}/sms/send`);

    const relayPayload = {
      key: ALIGO_API_KEY,
      user_id: ALIGO_USER_ID,
      sender: ALIGO_SENDER,
      receiver: receiver,
      msg: msg,
    };

    // Add optional parameters
    if (msg_type) relayPayload.msg_type = msg_type;
    if (title) relayPayload.title = title;
    if (testmode_yn) relayPayload.testmode_yn = testmode_yn;

    const aligoResponse = await fetch(`${RELAY_URL}/sms/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(relayPayload),
    });

    if (!aligoResponse.ok) {
      const errorText = await aligoResponse.text();
      console.error("Aligo API request failed:", errorText);
      return res.status(500).json({
        error: "sms_provider_error",
        message: "Failed to send SMS"
      });
    }

    const aligoResult = await aligoResponse.json();

    // Check Aligo API result
    if (aligoResult.result_code < 0) {
      console.error("Aligo API error:", aligoResult.message);
      return res.status(500).json({
        error: "sms_failed",
        message: aligoResult.message || "SMS send failed"
      });
    }

    // Log SMS send activity
    console.log(`[SMS] Sent by ${req.user.email}: ${aligoResult.success_cnt} success, ${aligoResult.error_cnt} failed`);

    res.json({
      status: "ok",
      data: {
        msg_id: aligoResult.msg_id,
        success_cnt: aligoResult.success_cnt,
        error_cnt: aligoResult.error_cnt,
        msg_type: aligoResult.msg_type,
      },
    });
  } catch (error) {
    console.error("SMS send error:", error);
    return res.status(500).json({
      error: "internal_error",
      message: error.message
    });
  }
});

// ============================================
// Firestore Real-time Listener
// ============================================
// 초기 로드 완료 플래그 (중복 알림 방지)
let firestoreInitialized = false;

db.collection('inquiries').onSnapshot(snapshot => {
  // 첫 로드 시 기존 데이터는 무시 (added 이벤트 중복 방지)
  if (!firestoreInitialized) {
    firestoreInitialized = true;
    console.log('[Firestore] Initial snapshot loaded, skipping existing documents');
    return;
  }

  snapshot.docChanges().forEach(change => {
    const inquiryData = { id: change.doc.id, ...change.doc.data() };

    switch (change.type) {
      case 'added':
        // 신규 상담 생성 (웹 폼 제출)
        console.log(`[Firestore] New inquiry created: ${change.doc.id}`);
        if (global.broadcastEvent) {
          global.broadcastEvent('consultation:created', inquiryData);
        }
        break;

      case 'modified':
        // 상담 확인 (check: true), 메모 수정 등
        console.log(`[Firestore] Inquiry modified: ${change.doc.id}`);
        if (global.broadcastEvent) {
          global.broadcastEvent('consultation:updated', {
            id: change.doc.id,
            updates: inquiryData
          });
        }
        break;

      case 'removed':
        // 상담 삭제 (DELETE API 또는 외부 삭제)
        console.log(`[Firestore] Inquiry removed: ${change.doc.id}`);
        if (global.broadcastEvent) {
          global.broadcastEvent('consultation:deleted', {
            id: change.doc.id
          });
        }
        break;
    }
  });
}, error => {
  console.error('[Firestore] Snapshot listener error:', error);
});

console.log('✓ Firestore real-time listener registered for inquiries collection');

// ============================================
// Email Inquiries API (Gmail + ZOHO)
// ============================================

// Get all email inquiries
app.get('/email-inquiries', auth.authenticateJWT, async (req, res) => {
  try {
    const { source, check, limit = 50, offset = 0 } = req.query;

    let sql = 'SELECT * FROM email_inquiries WHERE 1=1';
    const values = [];
    let paramIndex = 1;

    // Filter by source
    if (source) {
      sql += ` AND source = $${paramIndex++}`;
      values.push(source);
    }

    // Filter by check status
    if (check !== undefined) {
      sql += ` AND "check" = $${paramIndex++}`;
      values.push(check === 'true');
    }

    // Order and pagination
    sql += ` ORDER BY received_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    values.push(parseInt(limit), parseInt(offset));

    const result = await db_postgres.query(sql, values);

    // Map DB column names to frontend-friendly names
    const mappedData = result.rows.map(row => ({
      id: row.id,
      messageId: row.message_id,
      source: row.source,
      from: row.from_email,
      fromName: row.from_name,
      to: row.to_email,
      cc: row.cc_emails,
      subject: row.subject,
      body: row.body_text,
      bodyHtml: row.body_html,
      hasAttachments: row.has_attachments,
      receivedAt: row.received_at,
      check: row.check,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    res.json({ data: mappedData });
  } catch (error) {
    console.error('[Email Inquiries] Error fetching inquiries:', error);
    res.status(500).json({ error: 'Failed to fetch email inquiries' });
  }
});

// Get email inquiry statistics
app.get('/email-inquiries/stats', auth.authenticateJWT, async (req, res) => {
  try {
    const sql = `
      SELECT
        COUNT(*) FILTER (WHERE source = 'zoho') as zoho_count,
        COUNT(*) FILTER (WHERE source = 'gmail') as gmail_count,
        COUNT(*) FILTER (WHERE "check" = false) as unread_count,
        COUNT(*) as total_count
      FROM email_inquiries;
    `;

    const result = await db_postgres.query(sql);
    const stats = result.rows[0];

    res.json({
      data: {
        total: parseInt(stats.total_count) || 0,
        unread: parseInt(stats.unread_count) || 0,
        gmail: parseInt(stats.gmail_count) || 0,
        zoho: parseInt(stats.zoho_count) || 0
      }
    });
  } catch (error) {
    console.error('[Email Inquiries] Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch email stats' });
  }
});

// Update email inquiry (mark as checked/unchecked)
app.patch('/email-inquiries/:id', auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { check } = req.body;

    const sql = `
      UPDATE email_inquiries
      SET "check" = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;

    const result = await db_postgres.query(sql, [check, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email inquiry not found' });
    }

    // Broadcast WebSocket event for real-time updates
    if (global.broadcastEvent) {
      global.broadcastEvent('email:updated', {
        id: parseInt(id),
        updates: { check }
      });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('[Email Inquiries] Error updating inquiry:', error);
    res.status(500).json({ error: 'Failed to update email inquiry' });
  }
});

// Delete email inquiry
app.delete('/email-inquiries/:id', auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `DELETE FROM email_inquiries WHERE id = $1 RETURNING *;`;
    const result = await db_postgres.query(sql, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email inquiry not found' });
    }

    // Broadcast WebSocket event for real-time updates
    if (global.broadcastEvent) {
      global.broadcastEvent('email:deleted', { id: parseInt(id) });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('[Email Inquiries] Error deleting inquiry:', error);
    res.status(500).json({ error: 'Failed to delete email inquiry' });
  }
});

// Send email response
app.post('/api/email-response', auth.authenticateJWT, async (req, res) => {
  const result = await zohoRoutes.handleEmailResponse(req.user, req.body);
  res.status(result.status).json(result.body);
});

console.log('✓ Email Inquiries API endpoints registered');

// ============================================
// ZOHO Mail Integration (Optional Module)
// ============================================
if (process.env.ZOHO_CLIENT_ID && process.env.ZOHO_ENABLED === 'true') {
  try {
    const zoho = require('./zoho');

    // OAuth endpoints
    app.get('/auth/zoho', zoho.handleAuthStart);
    app.get('/auth/zoho/callback', zoho.handleAuthCallback);

    // Webhook endpoint
    app.post('/api/zoho/webhook', (req, res, next) => {
      console.log('[ZOHO Webhook] ========================================');
      console.log('[ZOHO Webhook] Received request');
      console.log('[ZOHO Webhook] Headers:', JSON.stringify(req.headers, null, 2));
      console.log('[ZOHO Webhook] Body:', JSON.stringify(req.body, null, 2));
      console.log('[ZOHO Webhook] ========================================');
      next();
    }, zoho.handleWebhook);

    // API endpoints for manual sync (optional)
    const zohoRoutes = require('./zoho/routes');
    app.post('/api/zoho/sync', auth.authenticateJWT, async (req, res) => {
      const result = await zohoRoutes.handleZohoSync(req.user);
      res.status(result.status).json(result.body);
    });

    // Perform initial full sync on server start (only once)
    setTimeout(async () => {
      try {
        console.log('[ZOHO] Performing initial full sync...');
        const result = await zoho.performFullSync();
        console.log(`[ZOHO] Initial sync completed: ${result.new} new, ${result.skipped} skipped`);
        console.log('[ZOHO] Webhook mode: Will receive new emails via webhook in real-time');
      } catch (error) {
        console.error('[ZOHO] Initial sync failed:', error.message);
        console.log('[ZOHO] You can manually trigger sync via POST /api/zoho/sync');
      }
    }, 5000); // Wait 5 seconds after server start

    console.log('✓ ZOHO Mail integration enabled (Webhook mode)');
  } catch (error) {
    console.warn('[ZOHO] Failed to load ZOHO module:', error.message);
    console.log('[ZOHO] Continuing without ZOHO integration');
  }
} else {
  console.log('[ZOHO] Integration disabled (set ZOHO_ENABLED=true and configure credentials to enable)');
}

// ============================================
// Start Server
// ============================================
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log("=".repeat(60));
  console.log(`✓ APS Admin Local Backend Server running on port ${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/`);
  console.log(`✓ WebSocket (Socket.IO) ready on same port`);
  console.log("=".repeat(60));
});
