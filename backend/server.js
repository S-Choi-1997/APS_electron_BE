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
 * - SMS_RELAY_URL: fixed-IP SMS Relay 서버 주소
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
const zohoRoutes = require("./zoho/routes");
const emailMailClient = require("./email-mail-client-service");
const emailTranslationRoutes = require("./email-translation-routes");
const memoRoutes = require("./memo-routes");
const smsRoutes = require("./sms-routes");
const { sendSmsViaRelay } = require("./sms-service");
const {
  ensureEmailTranslationSchema,
} = require("./email-translation-service");

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

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
const SMS_RELAY_URL = process.env.SMS_RELAY_URL || '';
const SMS_RELAY_AUTH_TOKEN = process.env.SMS_RELAY_AUTH_TOKEN || '';

console.log(`- SMS_RELAY_URL: ${SMS_RELAY_URL || '✗ Not set'}`);
console.log(`- SMS_RELAY_AUTH_TOKEN: ${SMS_RELAY_AUTH_TOKEN ? '✓ Set' : 'Not set'}`);
console.log("=".repeat(60));

// Initialize Firebase Admin with service account
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: process.env.STORAGE_BUCKET || "aps-list",
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
    '002_create_zoho_tokens_table.sql',
    '003_add_thread_and_status_fields.sql',
    '004_add_email_translation_fields.sql',
    '005_email_mail_client_backend.sql'
  ];

  console.log("[DB] Migrations disabled - using init-db.sql");
  return;

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
const databaseReadyPromise = db_postgres.testConnection().then(async (success) => {
  if (!success) {
    console.error("⚠️  Warning: PostgreSQL connection failed. Memos and schedules will not work.");
    return false;
  } else {
    // Run migrations after successful connection
    await runMigrations();
    await ensureEmailTranslationSchema();
    await emailMailClient.ensureMailClientSchema();
    return true;
  }
});

const app = express();
const TRUST_PROXY = process.env.TRUST_PROXY || (process.env.NODE_ENV === 'production' ? '1' : 'false');
const trustProxyValue = TRUST_PROXY === 'true'
  ? true
  : TRUST_PROXY === 'false'
    ? false
    : Number.isNaN(Number(TRUST_PROXY)) ? TRUST_PROXY : Number(TRUST_PROXY);

app.set('trust proxy', trustProxyValue);
console.log(`[Server] trust proxy: ${TRUST_PROXY}`);

const server = http.createServer(app);

// CORS configuration
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser origins used by the packaged Electron app.
    if (!origin || origin === "null" || origin.startsWith("file://")) {
      return callback(null, true);
    }

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
// Direct WebSocket Server (Electron App → Backend)
// ============================================
const DIRECT_WS_ENVIRONMENT = process.env.BACKEND_ENVIRONMENT || process.env.RELAY_ENVIRONMENT || 'production';
const directClients = new Map();

const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

function getDirectClientEnvironment(metadata = {}) {
  return metadata.environment || DIRECT_WS_ENVIRONMENT;
}

function getDirectSocketToken(socket) {
  const authToken = socket.handshake.auth?.token;
  if (authToken) {
    return authToken;
  }

  const authHeader = socket.handshake.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

io.use((socket, next) => {
  const token = getDirectSocketToken(socket);

  if (!token) {
    console.warn(`[Direct WebSocket] Rejected unauthenticated client: ${socket.id}`);
    return next(new Error('unauthorized'));
  }

  try {
    socket.data.user = auth.verifyAccessToken(token);
    return next();
  } catch (error) {
    console.warn(`[Direct WebSocket] Rejected invalid token for ${socket.id}: ${error.message}`);
    return next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  console.log(`[Direct WebSocket] Client connected: ${socket.id} (${socket.data.user.email})`);

  socket.on('handshake', (data = {}) => {
    if (data.type && data.type !== 'client') {
      socket.emit('handshake:error', {
        error: 'INVALID_CLIENT_TYPE',
        message: 'Direct backend WebSocket accepts Electron clients only',
      });
      return;
    }

    const metadata = data.metadata || {};
    const environment = getDirectClientEnvironment(metadata);
    const user = socket.data.user;

    directClients.set(socket.id, {
      socket,
      metadata: {
        ...metadata,
        environment,
        email: user.email,
        role: user.role,
        provider: user.provider,
      },
      lastHeartbeat: Date.now(),
    });

    socket.emit('handshake:success', {
      backendId: process.env.BACKEND_INSTANCE_ID || 'backend-direct',
      environment,
      direct: true,
      message: `Connected directly to backend WebSocket (${environment})`,
    });

    console.log(`[Direct WebSocket] Handshake success: ${socket.id} (${environment})`);
  });

  socket.on('heartbeat', () => {
    const client = directClients.get(socket.id);
    if (client) {
      client.lastHeartbeat = Date.now();
    }
  });

  socket.on('disconnect', (reason) => {
    directClients.delete(socket.id);
    console.log(`[Direct WebSocket] Client disconnected: ${socket.id} (${reason})`);
  });
});

function broadcastToDirectClients(eventType, data) {
  let sentCount = 0;

  for (const client of directClients.values()) {
    client.socket.emit(eventType, data);
    sentCount++;
  }

  if (sentCount > 0) {
    console.log(`[Direct WebSocket] Sent event ${eventType} to ${sentCount} clients`);
  }

  return sentCount;
}

// ============================================
// WebSocket Relay Client (Socket.IO Client to GCP4 Relay)
// ============================================
const { io: ioClient } = require('socket.io-client');

const WS_RELAY_URL = process.env.WS_RELAY_URL || 'ws://localhost:8080';
const BACKEND_VERSION = process.env.BACKEND_VERSION || '1.0.0';
const BACKEND_INSTANCE_ID = process.env.BACKEND_INSTANCE_ID || 'backend-local-001';
const RELAY_ENVIRONMENT = process.env.RELAY_ENVIRONMENT || 'production';
const WS_RELAY_ENABLED = process.env.WS_RELAY_ENABLED === 'true';
const APP_SYNC_EVENTS = new Set([
  'consultation:created',
  'consultation:updated',
  'consultation:deleted',
  'email:created',
  'email:updated',
  'email:deleted',
  'memo:created',
  'memo:updated',
  'memo:deleted',
  'schedule:created',
  'schedule:updated',
  'schedule:deleted',
]);

let relaySocket = null;
let isRelayConnected = false;
let isConnecting = false;
const RECONNECT_CHECK_INTERVAL = 30000; // 30초마다 재연결 체크

function connectToRelay() {
  if (!WS_RELAY_ENABLED) {
    console.log('[WebSocket Relay] Disabled by environment');
    return;
  }

  if (isConnecting) {
    console.log('[WebSocket Relay] Already attempting to connect, skipping...');
    return;
  }

  isConnecting = true;
  console.log(`[WebSocket Relay] Connecting to ${WS_RELAY_URL}...`);

  // 기존 소켓이 있으면 정리
  if (relaySocket) {
    relaySocket.removeAllListeners();
    relaySocket.disconnect();
    relaySocket = null;
  }

  relaySocket = ioClient(WS_RELAY_URL, {
    transports: ['websocket', 'polling'],
    reconnection: false, // Socket.IO 자동 재연결 비활성화 (수동으로 관리)
    timeout: 10000
  });

  relaySocket.on('connect', () => {
    console.log('[WebSocket Relay] Connected to relay server');
    isConnecting = false;

    // Send handshake
    relaySocket.emit('handshake', {
      type: 'backend',
      version: BACKEND_VERSION,
      instanceId: BACKEND_INSTANCE_ID,
      metadata: {
        environment: RELAY_ENVIRONMENT,
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
    console.error('[WebSocket Relay] Connection error:', error.message);
    isConnecting = false;
    isRelayConnected = false;
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
          user = auth.verifyAccessToken(token);
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
          user = auth.verifyAccessToken(token);
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

      // Handle attachment download directly (binary files)
      const attachmentDownloadMatch = path.match(/^\/email-inquiries\/(\d+)\/attachments\/(\d+)\/download$/);
      if (method === 'GET' && attachmentDownloadMatch) {
        const { downloadAttachment, fetchAttachmentInfo } = require('./zoho/mail-api');

        const emailId = attachmentDownloadMatch[1];
        const attachmentId = attachmentDownloadMatch[2];

        // Verify JWT token
        const authHeader = headers.authorization || headers.Authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          relaySocket.emit('http:response', {
            requestId,
            statusCode: 401,
            headers: { 'content-type': 'application/json' },
            body: { error: 'unauthorized', message: 'Missing or invalid token' }
          });
          return;
        }

        try {
          auth.verifyAccessToken(authHeader.substring(7));
        } catch (err) {
          relaySocket.emit('http:response', {
            requestId,
            statusCode: 401,
            headers: { 'content-type': 'application/json' },
            body: { error: 'unauthorized', message: 'Invalid or expired token' }
          });
          return;
        }

        // Get email from database
        const sql = `SELECT message_id, folder_id, source FROM email_inquiries WHERE id = $1 LIMIT 1;`;
        const result = await db_postgres.query(sql, [emailId]);

        if (result.rows.length === 0) {
          relaySocket.emit('http:response', {
            requestId,
            statusCode: 404,
            headers: { 'content-type': 'application/json' },
            body: { error: 'Email not found' }
          });
          return;
        }

        const email = result.rows[0];
        if (email.source !== 'zoho' || !email.folder_id) {
          relaySocket.emit('http:response', {
            requestId,
            statusCode: 400,
            headers: { 'content-type': 'application/json' },
            body: { error: 'Attachment download not supported for this email' }
          });
          return;
        }

        // Get attachment info and download
        const attachments = await fetchAttachmentInfo(email.message_id, email.folder_id);
        const attachment = attachments.find(a => a.attachmentId === attachmentId);
        const attachmentName = attachment?.attachmentName || 'download';

        console.log(`[Backend] Downloading attachment: ${attachmentName} (${attachmentId})`);

        const response = await downloadAttachment(email.message_id, email.folder_id, attachmentId);

        // Convert stream to buffer
        const chunks = [];
        for await (const chunk of response.data) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        const base64Data = buffer.toString('base64');

        console.log(`[Backend] Attachment downloaded: ${buffer.length} bytes`);

        relaySocket.emit('http:response', {
          requestId,
          statusCode: 200,
          headers: {
            'content-type': response.headers['content-type'] || 'application/octet-stream',
            'content-disposition': `attachment; filename="${encodeURIComponent(attachmentName)}"`,
            'x-binary-base64': 'true'
          },
          body: base64Data
        });

        console.log(`[Backend] Tunnel response 200 (requestId: ${requestId})`);
        return;
      }

      // For all other routes, use axios to localhost (fallback)
      const axios = require('axios');
      const BASE_URL = `http://localhost:${PORT}`;
      const targetUrl = `${BASE_URL}${fullPath}`;

      console.log(`[Backend] Tunnel forwarding to: ${targetUrl}`);

      const response = await axios({
        method: method.toLowerCase(),
        url: targetUrl,
        headers: {
          ...headers,
          host: undefined,
        },
        data: body,
        validateStatus: () => true,
        maxRedirects: 0,
      });

      console.log(`[Backend] Tunnel got response: ${response.status} from ${targetUrl}`);

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

// 주기적인 재연결 체크 (30초마다)
setInterval(() => {
  if (!WS_RELAY_ENABLED) {
    return;
  }

  if (!relaySocket || !relaySocket.connected) {
    console.log('[WebSocket Relay] Connection lost, attempting to reconnect...');
    connectToRelay();
  }
}, RECONNECT_CHECK_INTERVAL);

// 전역 broadcast 함수 (CRUD 작업에서 사용)
global.broadcastEvent = (eventType, data) => {
  if (!APP_SYNC_EVENTS.has(eventType)) {
    return 0;
  }

  const directCount = broadcastToDirectClients(eventType, data);

  if (!relaySocket || !isRelayConnected) {
    if (WS_RELAY_ENABLED) {
      console.warn(`[WebSocket Relay] Not connected, cannot send event: ${eventType}`);
    }
    if (directCount === 0) {
      console.warn(`[Broadcast] No connected clients for event: ${eventType}`);
    }
    return directCount;
  }

  relaySocket.emit(eventType, data);
  console.log(`[WebSocket Relay] Sent event to relay: ${eventType}`);
  return directCount;
};

// Connect to relay on startup
if (WS_RELAY_ENABLED) {
  connectToRelay();
} else {
  console.log('✓ WebSocket Relay Client disabled; direct WebSocket server is active');
}

console.log('✓ Direct WebSocket server initialized');
if (WS_RELAY_ENABLED) {
  console.log('✓ WebSocket Relay Client initialized');
}

app.use(cors(corsOptions));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "35mb" }));

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
    version: BACKEND_VERSION,
    environment: DIRECT_WS_ENVIRONMENT,
    wsRelayEnabled: WS_RELAY_ENABLED,
    smsRelayConfigured: Boolean(SMS_RELAY_URL),
    directWebSocket: {
      enabled: true,
      connectedClients: directClients.size,
    },
  });
});

// ============================================
// Authentication Routes (JWT)
// ============================================

const LOGIN_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;

function normalizeLoginEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : 'unknown-email';
}

function getLoginRateLimitKey(req) {
  const email = normalizeLoginEmail(req.body?.email);
  const ip = req.ip || req.connection?.remoteAddress || 'unknown-ip';
  return `${email}:${ip}`;
}

// Rate limiter for login endpoint - failed attempts only, scoped by email + IP.
const loginLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  max: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  keyGenerator: getLoginRateLimitKey,
  skipSuccessfulRequests: true,
  message: {
    error: 'too_many_requests',
    message: '너무 많은 로그인 시도입니다. 5분 후 다시 시도하세요.',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    console.warn(`[Security] Login rate limit exceeded for key: ${getLoginRateLimitKey(req)}`);
    res.status(429).json({
      error: 'too_many_requests',
      message: '너무 많은 로그인 시도입니다. 5분 후 다시 시도하세요.',
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
        message: '이메일과 비밀번호를 입력해 주세요.',
      });
    }

    // Get admin from Firestore (avoid shadowing 'admin' module)
    const adminUser = await firestoreAdmin.getAdminByEmail(email);

    if (!adminUser) {
      console.warn(`[Auth] Login attempt for non-existent email: ${email}`);
      return res.status(401).json({
        error: 'unauthorized',
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      });
    }

    // Check if account is active
    if (!adminUser.active) {
      console.warn(`[Auth] Login denied for inactive account: ${email}`);
      return res.status(403).json({
        error: 'forbidden',
        message: '비활성화된 계정입니다.',
      });
    }

    // Verify password
    if (!adminUser.password_hash) {
      return res.status(401).json({
        error: 'unauthorized',
        message: '로컬 로그인이 설정되지 않은 계정입니다.',
      });
    }

    const isValidPassword = await auth.verifyPassword(password, adminUser.password_hash);
    if (!isValidPassword) {
      console.warn(`[Auth] Invalid password for: ${email}`);
      return res.status(401).json({
        error: 'unauthorized',
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      });
    }

    // Upsert user into PostgreSQL users table (for memos/schedules foreign key)
    try {
      await syncAdminUserToPostgres(adminUser);
      console.log(`[Auth] User synced to PostgreSQL: ${email}`);
    } catch (dbError) {
      console.error('[Auth] Failed to sync user to PostgreSQL:', dbError);
      // Continue even if sync fails - login should still work
    }

    // Generate JWT tokens
    const userAgent = req.headers['user-agent'] || null;
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    const { accessToken, refreshToken } = await auth.generateTokens(adminUser, userAgent, ipAddress);

    console.log(`[Auth] Login successful for ${email} (role: ${adminUser.role})`);
    loginLimiter.resetKey(getLoginRateLimitKey(req));

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
      message: '로그인에 실패했습니다.',
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
    const userAgent = req.headers['user-agent'] || null;
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    const { accessToken, refreshToken: newRefreshToken, email } = await auth.refreshAccessToken(refreshToken, userAgent, ipAddress);

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
      await auth.revokeRefreshToken(refreshToken);
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
      displayName || '사용자',
      role
    );

    await syncAdminUserToPostgres(newAdmin);

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

function parsePaginationParam(value, fallback, { min = 0, max = 500 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isAdminRole(role) {
  return ['admin', 'super_admin', 'owner'].includes(String(role || '').toLowerCase());
}

function firestoreValueToISOString(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resolveInquiryStatus(data = {}) {
  return data.status === 'new' ? 'unread' : (data.status || (data.check ? 'responded' : 'unread'));
}

const INQUIRY_STATUS_VALUES = new Set(['unread', 'read', 'responded']);
const EMAIL_STATUS_VALUES = new Set(['unread', 'read', 'responded']);
const EMAIL_LIKE_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function isEmailLike(value) {
  return EMAIL_LIKE_PATTERN.test(String(value || '').trim());
}

function getUserFacingName(candidates = [], fallback = '사용자') {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value && !isEmailLike(value)) {
      return value;
    }
  }

  return fallback;
}

function decorateAuthorName(row) {
  if (!row) return row;
  return {
    ...row,
    author_name: getUserFacingName([row.author_name, row.author]),
  };
}

async function syncAdminUserToPostgres(adminUser) {
  if (!adminUser?.email) return;

  await db_postgres.query(
    `INSERT INTO users (email, display_name, provider, role, active, created_at, updated_at, synced_at, password_hash)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $6)
     ON CONFLICT (email)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       role = EXCLUDED.role,
       active = EXCLUDED.active,
       password_hash = EXCLUDED.password_hash,
       updated_at = CURRENT_TIMESTAMP,
       synced_at = CURRENT_TIMESTAMP`,
    [
      adminUser.email,
      getUserFacingName([adminUser.display_name, adminUser.displayName], '사용자'),
      adminUser.provider || 'local',
      adminUser.role || 'user',
      adminUser.active !== false,
      adminUser.password_hash || null,
    ]
  );
}
function mapInquiryDocument(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: firestoreValueToISOString(data.createdAt),
    updatedAt: firestoreValueToISOString(data.updatedAt),
    status: resolveInquiryStatus(data),
  };
}

function sendApiError(res, error, fallbackStatus = 500) {
  const statusCode = error.statusCode || fallbackStatus;
  res.status(statusCode).json({
    error: error.errorCode || (statusCode >= 500 ? 'internal_error' : 'bad_request'),
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
  });
}
// GET /inquiries - List all inquiries with optional filtering
app.get("/inquiries", async (req, res) => {
  const startTime = Date.now();
  try {
    const { check, status, category, start_date, end_date, limit = "100", offset = "0" } = req.query;
    const limitNum = parsePaginationParam(limit, 100, { min: 1, max: 500 });
    const offsetNum = parsePaginationParam(offset, 0, { min: 0, max: 100000 });

    if (start_date && !isValidDateOnly(start_date)) {
      return res.status(400).json({ error: "bad_request", message: "Invalid start_date" });
    }
    if (end_date && !isValidDateOnly(end_date)) {
      return res.status(400).json({ error: "bad_request", message: "Invalid end_date" });
    }
    if (start_date && end_date && end_date < start_date) {
      return res.status(400).json({ error: "bad_request", message: "end_date must be greater than or equal to start_date" });
    }

    let query = db.collection("inquiries");

    // Apply filters
    if (check !== undefined) {
      query = query.where("check", "==", check === "true");
    }

    if (category) {
      query = query.where("category", "==", category);
    }

    if (start_date) {
      query = query.where("createdAt", ">=", new Date(`${start_date}T00:00:00+09:00`));
    }

    if (end_date) {
      const endExclusive = new Date(`${end_date}T00:00:00+09:00`);
      endExclusive.setDate(endExclusive.getDate() + 1);
      query = query.where("createdAt", "<", endExclusive);
    }

    const queryStartTime = Date.now();
    const snapshot = await query.get();
    const queryDuration = Date.now() - queryStartTime;

    const filteredInquiries = snapshot.docs
      .map(mapInquiryDocument)
      .filter((inquiry) => !status || inquiry.status === status)
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });

    const total = filteredInquiries.length;
    const inquiries = filteredInquiries.slice(offsetNum, offsetNum + limitNum);

    const duration = Date.now() - startTime;
    console.log(`[Firestore] Query completed in ${queryDuration}ms, total ${duration}ms, returned ${inquiries.length}/${total} items`);

    res.json({
      status: "ok",
      data: inquiries,
      count: inquiries.length,
      total,
      limit: limitNum,
      offset: offsetNum,
      hasMore: offsetNum + inquiries.length < total,
    });
  } catch (error) {
    console.error("Error fetching inquiries:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// GET /inquiries/stats - Get inquiry statistics by status
app.get("/inquiries/stats", async (req, res) => {
  try {
    // Fetch all inquiries to count by status
    const snapshot = await db.collection("inquiries").get();

    let unreadCount = 0;
    let readCount = 0;
    let respondedCount = 0;

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const status = resolveInquiryStatus(data); // Fallback for old data + 'new' → 'unread' migration

      if (status === 'unread') unreadCount++;
      else if (status === 'read') readCount++;
      else if (status === 'responded') respondedCount++;
    });

    const total = snapshot.size;

    res.json({
      status: "ok",
      data: {
        total,
        unread: unreadCount,
        read: readCount,
        responded: respondedCount,
        // Backward compatibility
        website: unreadCount,
        email: 0
      }
    });
  } catch (error) {
    console.error("Error fetching inquiry stats:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// GET /inquiries/all - Get all unchecked inquiries (unified view)
app.get("/inquiries/all", async (req, res) => {
  try {
    const { limit = "100", offset = "0" } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);
    const fetchLimit = limitNum + offsetNum;

    const toISOString = (value) => {
      if (!value) return null;
      if (typeof value.toDate === 'function') return value.toDate().toISOString();
      if (value instanceof Date) return value.toISOString();
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };

    const websiteSnapshot = await db.collection("inquiries").get();
    const websiteRows = websiteSnapshot.docs
      .map((doc) => {
        const data = doc.data();
        const status = data.status === 'new' ? 'unread' : (data.status || (data.check ? 'responded' : 'unread'));

        return {
          inquiry_type: 'web_form',
          id: doc.id,
          customer_name: data.name || data.customerName || data.company || null,
          customer_email: data.email || null,
          phone: data.phone || data.phoneNumber || null,
          title: data.consultation_type || data.type || data.category || data.subject || 'Website inquiry',
          content: data.content || data.message || data.memo || null,
          inquiry_date: toISOString(data.createdAt || data.updatedAt),
          checked: status !== 'unread',
          checked_by: data.checkedBy || data.updatedBy || null,
          checked_at: toISOString(data.checkedAt),
          status,
        };
      })
      .filter((row) => row.status === 'unread');

    const emailResult = await db_postgres.query(`
      SELECT
        id,
        from_name,
        from_email,
        subject,
        body_text,
        received_at,
        "check",
        status,
        source,
        updated_at
      FROM email_inquiries
      WHERE is_outgoing = false
        AND (status = 'unread' OR ("check" = false AND (status IS NULL OR status = 'unread')))
      ORDER BY received_at DESC
      LIMIT $1 OFFSET 0
    `, [
      fetchLimit,
    ]);
    const emailRows = emailResult.rows.map((row) => ({
      inquiry_type: 'email',
      id: row.id,
      customer_name: row.from_name || null,
      customer_email: row.from_email || null,
      phone: null,
      title: row.subject || 'Email inquiry',
      content: row.body_text || null,
      inquiry_date: toISOString(row.received_at || row.updated_at),
      checked: row.check,
      checked_by: null,
      checked_at: null,
      status: row.status || (row.check ? 'read' : 'unread'),
      source: row.source,
    }));

    const rows = [...websiteRows, ...emailRows]
      .sort((a, b) => new Date(b.inquiry_date || 0) - new Date(a.inquiry_date || 0))
      .slice(offsetNum, offsetNum + limitNum);

    res.json({
      status: "ok",
      data: rows,
      count: rows.length,
    });
  } catch (error) {
    console.error("Error fetching all inquiries:", error);
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
        status: resolveInquiryStatus(data),
        createdAt: firestoreValueToISOString(data.createdAt),
        updatedAt: firestoreValueToISOString(data.updatedAt),
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

    if (updates.status !== undefined && !INQUIRY_STATUS_VALUES.has(updates.status)) {
      return res.status(400).json({
        error: "invalid_status",
        message: "Invalid inquiry status",
        allowed: [...INQUIRY_STATUS_VALUES],
      });
    }

    if (updates.check !== undefined && typeof updates.check !== 'boolean') {
      return res.status(400).json({
        error: "invalid_check",
        message: "check must be a boolean",
      });
    }

    if (
      updates.status !== undefined &&
      updates.check !== undefined &&
      updates.check !== (updates.status !== 'unread')
    ) {
      return res.status(400).json({
        error: "inconsistent_status",
        message: "status and check values are inconsistent",
      });
    }

    // Sync status and check fields for backward compatibility
    if (updates.status !== undefined && updates.check === undefined) {
      // status 업데이트 시 check도 자동 동기화
      updates.check = (updates.status !== 'unread');
    } else if (updates.check !== undefined && updates.status === undefined) {
      // check 업데이트 시 status도 자동 동기화
      updates.status = updates.check ? 'responded' : 'unread';
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

    if (global.broadcastEvent) {
      const broadcastUpdates = {
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      global.broadcastEvent('consultation:updated', {
        id,
        ...doc.data(),
        ...broadcastUpdates,
      });
    }

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

// POST /inquiries/:id/respond-sms - Send SMS response and mark inquiry responded after provider success
app.post("/inquiries/:id/respond-sms", async (req, res) => {
  try {
    const { id } = req.params;
    const { message, phone, msg_type, title, testmode_yn } = req.body;

    const docRef = db.collection("inquiries").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    const inquiry = doc.data();
    const currentStatus = resolveInquiryStatus(inquiry);
    if (currentStatus === 'responded') {
      return res.status(409).json({
        error: "already_responded",
        message: "Inquiry has already been responded to",
      });
    }

    const receiver = phone || inquiry.phone || inquiry.phoneNumber;
    const smsResult = await sendSmsViaRelay({
      receiver,
      msg: message,
      msg_type,
      title,
      testmode_yn,
    }, req.user.email);

    const updates = {
      status: 'responded',
      check: true,
      respondedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.email,
    };

    await docRef.update(updates);

    if (global.broadcastEvent) {
      const broadcastUpdates = {
        ...updates,
        updatedAt: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
      };
      global.broadcastEvent('consultation:updated', {
        id,
        ...inquiry,
        ...broadcastUpdates,
      });
    }

    res.json({
      status: "ok",
      data: {
        inquiryId: id,
        previousStatus: currentStatus,
        updated: {
          status: 'responded',
          check: true,
        },
        sms: smsResult,
      },
    });
  } catch (error) {
    console.error("Inquiry SMS response failed:", error);
    sendApiError(res, error);
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
        // Explicitly exclude content-type from signed headers to avoid CORS issues
        const [url] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 60 * 60 * 1000, // 1 hour
          extensionHeaders: {}, // Prevent content-type from being added to signature
        });

        console.log('[DEBUG] Generated signed URL:', url);
        console.log('[DEBUG] URL contains X-Goog-SignedHeaders:', url.includes('X-Goog-SignedHeaders'));

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

    if (global.broadcastEvent) {
      global.broadcastEvent('consultation:deleted', { id });
    }

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
        message: "이름을 입력해 주세요."
      });
    }

    // Update admin in Firestore
    const updatedAdmin = await firestoreAdmin.updateAdmin(req.user.email, {
      display_name: displayName
    });

    if (!updatedAdmin) {
      return res.status(404).json({ error: "not_found", message: "사용자를 찾을 수 없습니다." });
    }

    await syncAdminUserToPostgres(updatedAdmin);

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
    res.status(500).json({ error: "internal_error", message: "서버 오류가 발생했습니다." });
  }
});

// GET /users/me - Get current user info
app.get("/users/me", auth.authenticateJWT, async (req, res) => {
  try {
    // Get admin info from Firestore (avoid shadowing 'admin' module)
    const adminUser = await firestoreAdmin.getAdminByEmail(req.user.email);

    if (!adminUser) {
      return res.status(404).json({ error: "not_found", message: "사용자를 찾을 수 없습니다." });
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
    res.status(500).json({ error: "internal_error", message: "서버 오류가 발생했습니다." });
  }
});

// ============================================
// MEMOS API (PostgreSQL)
// ============================================
memoRoutes.registerRoutes(app, auth);

// ============================================
// SCHEDULES API (PostgreSQL)
// ============================================

function normalizeScheduleType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'company' || normalized === '회사') return 'company';
  if (normalized === 'personal' || normalized === '개인') return 'personal';
  return null;
}

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidScheduleTime(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function canModifySchedule(user, schedule) {
  if (isAdminRole(user?.role)) return true;
  if (schedule.type === 'company') return true;
  return schedule.author === user?.email;
}

function canModifyPersonalScheduleTarget(user, schedule, targetType) {
  if (targetType !== 'personal') return true;
  return isAdminRole(user?.role) || schedule.author === user?.email;
}

// GET /schedules - List schedules with filtering
app.get("/schedules", auth.authenticateJWT, async (req, res) => {
  try {
    const { start_date, end_date, type, author, limit = "100", offset = "0" } = req.query;
    const limitNum = parsePaginationParam(limit, 100, { min: 1, max: 500 });
    const offsetNum = parsePaginationParam(offset, 0, { min: 0, max: 100000 });

    if (start_date && !isValidDateOnly(start_date)) {
      return res.status(400).json({ error: "bad_request", message: "시작일 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요." });
    }
    if (end_date && !isValidDateOnly(end_date)) {
      return res.status(400).json({ error: "bad_request", message: "종료일 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요." });
    }
    if (start_date && end_date && end_date < start_date) {
      return res.status(400).json({ error: "bad_request", message: "종료일은 시작일과 같거나 이후여야 합니다." });
    }

    const normalizedType = type ? normalizeScheduleType(type) : null;
    if (type && !normalizedType) {
      return res.status(400).json({ error: "bad_request", message: "일정 유형이 올바르지 않습니다." });
    }

    const selectClause = `
      SELECT s.id, s.title, s.time, s.start_date, s.end_date, s.type, s.author,
             s.created_at, s.updated_at,
             COALESCE(u.display_name, s.author) as author_name
    `;
    let fromClause = `
      FROM active_schedules s
      LEFT JOIN users u ON s.author = u.email
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // Date range filter
    if (start_date) {
      fromClause += ` AND s.end_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      fromClause += ` AND s.start_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    // Type filter
    if (normalizedType) {
      fromClause += ` AND s.type = $${paramIndex}`;
      params.push(normalizedType);
      paramIndex++;
    }

    // Author filter
    if (author) {
      fromClause += ` AND s.author = $${paramIndex}`;
      params.push(author);
      paramIndex++;
    }

    const countQuery = `SELECT COUNT(*)::int AS total ${fromClause}`;
    const countResult = await db_postgres.query(countQuery, params);
    const total = countResult.rows[0]?.total || 0;

    // Order by start date
    let query = `${selectClause} ${fromClause} ORDER BY s.start_date ASC, s.time NULLS LAST, s.created_at DESC`;

    // Pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offsetNum);

    const result = await db_postgres.query(query, params);

    res.json({
      status: "ok",
      data: result.rows.map(decorateAuthorName),
      count: result.rows.length,
      total,
      limit: limitNum,
      offset: offsetNum,
      hasMore: offsetNum + result.rows.length < total,
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
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    const normalizedType = normalizeScheduleType(type);

    if (!trimmedTitle || !start_date || !end_date || !type) {
      return res.status(400).json({
        error: "bad_request",
        message: "제목, 시작일, 종료일, 일정 유형을 입력해 주세요."
      });
    }
    if (!isValidDateOnly(start_date) || !isValidDateOnly(end_date)) {
      return res.status(400).json({ error: "bad_request", message: "날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요." });
    }
    if (end_date < start_date) {
      return res.status(400).json({ error: "bad_request", message: "종료일은 시작일과 같거나 이후여야 합니다." });
    }
    if (!normalizedType) {
      return res.status(400).json({ error: "bad_request", message: "일정 유형이 올바르지 않습니다." });
    }
    if (!isValidScheduleTime(time)) {
      return res.status(400).json({ error: "bad_request", message: "시간 형식이 올바르지 않습니다. HH:mm 형식으로 입력해 주세요." });
    }

    const insertQuery = `
      INSERT INTO schedules (title, time, start_date, end_date, type, author)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, title, time, start_date, end_date, type, author, created_at, updated_at
    `;

    const result = await db_postgres.query(insertQuery, [
      trimmedTitle,
      time || null,
      start_date,
      end_date,
      normalizedType,
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

    const createdSchedule = decorateAuthorName(scheduleWithAuthor.rows[0]);

    if (global.broadcastEvent) {
      global.broadcastEvent('schedule:created', createdSchedule);
    }

    res.json({
      status: "ok",
      data: createdSchedule,
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

    const existingResult = await db_postgres.query(
      `SELECT id, title, time, start_date, end_date, type, author FROM schedules WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "not_found", message: "일정을 찾을 수 없습니다." });
    }

    const existingSchedule = existingResult.rows[0];
    if (!canModifySchedule(req.user, existingSchedule)) {
      return res.status(403).json({ error: "forbidden", message: "이 일정을 수정할 권한이 없습니다." });
    }

    const nextStartDate = start_date !== undefined ? start_date : existingSchedule.start_date.toISOString?.().slice(0, 10) || String(existingSchedule.start_date).slice(0, 10);
    const nextEndDate = end_date !== undefined ? end_date : existingSchedule.end_date.toISOString?.().slice(0, 10) || String(existingSchedule.end_date).slice(0, 10);
    const nextType = type !== undefined ? normalizeScheduleType(type) : existingSchedule.type;

    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
      return res.status(400).json({ error: "bad_request", message: "일정 제목을 입력해 주세요." });
    }
    if (start_date !== undefined && !isValidDateOnly(start_date)) {
      return res.status(400).json({ error: "bad_request", message: "시작일 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요." });
    }
    if (end_date !== undefined && !isValidDateOnly(end_date)) {
      return res.status(400).json({ error: "bad_request", message: "종료일 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요." });
    }
    if (nextEndDate < nextStartDate) {
      return res.status(400).json({ error: "bad_request", message: "종료일은 시작일과 같거나 이후여야 합니다." });
    }
    if (type !== undefined && !nextType) {
      return res.status(400).json({ error: "bad_request", message: "일정 유형이 올바르지 않습니다." });
    }
    if (time !== undefined && !isValidScheduleTime(time)) {
      return res.status(400).json({ error: "bad_request", message: "시간 형식이 올바르지 않습니다. HH:mm 형식으로 입력해 주세요." });
    }
    if (!canModifyPersonalScheduleTarget(req.user, existingSchedule, nextType)) {
      return res.status(403).json({ error: "forbidden", message: "공유 일정을 개인 일정으로 바꾸려면 작성자 또는 관리자 권한이 필요합니다." });
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      params.push(title.trim());
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
      params.push(nextType);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "bad_request", message: "수정할 내용이 없습니다." });
    }

    params.push(id);
    const query = `
      UPDATE schedules
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex} AND deleted_at IS NULL
      RETURNING id, title, time, start_date, end_date, type, author, created_at, updated_at
    `;

    const result = await db_postgres.query(query, params);

    const selectQuery = `
      SELECT s.*, COALESCE(u.display_name, s.author) as author_name
      FROM schedules s
      LEFT JOIN users u ON s.author = u.email
      WHERE s.id = $1
    `;
    const scheduleWithAuthor = await db_postgres.query(selectQuery, [result.rows[0].id]);
    const updatedSchedule = decorateAuthorName(scheduleWithAuthor.rows[0]);

    if (global.broadcastEvent) {
      global.broadcastEvent('schedule:updated', updatedSchedule);
    }

    res.json({
      status: "ok",
      data: updatedSchedule,
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

    const existingResult = await db_postgres.query(
      `SELECT id, type, author FROM schedules WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "not_found", message: "일정을 찾을 수 없습니다." });
    }

    if (!canModifySchedule(req.user, existingResult.rows[0])) {
      return res.status(403).json({ error: "forbidden", message: "이 일정을 삭제할 권한이 없습니다." });
    }

    const query = `
      UPDATE schedules
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await db_postgres.query(query, [id]);

    if (global.broadcastEvent) {
      global.broadcastEvent('schedule:deleted', { id: result.rows[0].id });
    }

    res.json({
      status: "ok",
      message: "일정을 삭제했습니다.",
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

// POST /sms/send - Send SMS via Aligo API (through GCP3 relay)
smsRoutes.registerRoutes(app, auth);
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
        console.log(`[Firestore] Inquiry modified: ${change.doc.id}`);
        if (global.broadcastEvent) {
          global.broadcastEvent('consultation:updated', inquiryData);
        }
        // 상담 확인 (check: true), 메모 수정 등
        console.log(`[Firestore] Inquiry modified: ${change.doc.id}`);
        break;

      case 'removed':
        if (global.broadcastEvent) {
          global.broadcastEvent('consultation:deleted', { id: change.doc.id });
        }
        // 상담 삭제 (DELETE API 또는 외부 삭제)
        console.log(`[Firestore] Inquiry removed: ${change.doc.id}`);
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
emailMailClient.registerRoutes(app, auth, asyncHandler);

function mapEmailInquiryRow(row) {
  return {
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
    status: row.status || (row.check ? 'read' : 'unread'),
    inReplyTo: row.in_reply_to,
    references: row.references,
    threadId: row.thread_id,
    isOutgoing: row.is_outgoing || false,
    translationStatus: row.translation_status || 'not_required',
    detectedLanguage: row.detected_language || null,
    translatedSubject: row.translated_subject || null,
    translatedBody: row.translated_body_text || null,
    translationModel: row.translation_model || null,
    translationError: row.translation_error || null,
    translatedAt: row.translated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Get all email inquiries
app.get('/email-inquiries', auth.authenticateJWT, async (req, res) => {
  try {
    const { source, check, status, search, limit = 50, offset = 0, includeOutgoing } = req.query;
    const limitNum = parsePaginationParam(limit, 50, { min: 1, max: 500 });
    const offsetNum = parsePaginationParam(offset, 0, { min: 0, max: 100000 });

    // By default, only fetch incoming emails (is_outgoing = false)
    // Set includeOutgoing=true to fetch all emails (for thread view)
    let whereClause = includeOutgoing === 'true'
      ? 'WHERE 1=1'
      : 'WHERE is_outgoing = false';
    const values = [];
    let paramIndex = 1;

    // Filter by source
    if (source) {
      whereClause += ` AND source = $${paramIndex++}`;
      values.push(source);
    }

    // Filter by status (takes priority over check)
    if (status !== undefined) {
      whereClause += ` AND status = $${paramIndex++}`;
      values.push(status);
    }
    // Filter by check status (legacy support)
    else if (check !== undefined) {
      whereClause += ` AND "check" = $${paramIndex++}`;
      values.push(check === 'true');
    }

    if (search) {
      const searchValue = `%${String(search).trim().toLowerCase()}%`;
      whereClause += ` AND (
        LOWER(COALESCE(from_name, '')) LIKE $${paramIndex}
        OR LOWER(COALESCE(from_email, '')) LIKE $${paramIndex}
        OR LOWER(COALESCE(to_email, '')) LIKE $${paramIndex}
        OR LOWER(COALESCE(subject, '')) LIKE $${paramIndex}
        OR LOWER(COALESCE(body_text, '')) LIKE $${paramIndex}
        OR LOWER(COALESCE(body_html, '')) LIKE $${paramIndex}
        OR LOWER(COALESCE(translated_subject, '')) LIKE $${paramIndex}
        OR LOWER(COALESCE(translated_body_text, '')) LIKE $${paramIndex}
        OR LOWER(COALESCE(source, '')) LIKE $${paramIndex}
        OR LOWER(COALESCE(message_id, '')) LIKE $${paramIndex}
      )`;
      values.push(searchValue);
      paramIndex++;
    }

    const countSql = `SELECT COUNT(*)::int AS total FROM email_inquiries ${whereClause}`;
    const countResult = await db_postgres.query(countSql, values);
    const total = countResult.rows[0]?.total || 0;

    // Order and pagination
    const sql = `SELECT * FROM email_inquiries ${whereClause} ORDER BY received_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    values.push(limitNum, offsetNum);

    const result = await db_postgres.query(sql, values);

    console.log(`[Email Inquiries] Query returned ${result.rows.length}/${total} rows (includeOutgoing=${includeOutgoing}, status=${status}, check=${check}, search=${search || ''})`);
    console.log(`[Email Inquiries] SQL: ${sql}`);
    console.log(`[Email Inquiries] Values:`, values);

    // Map DB column names to frontend-friendly names
    const mappedData = result.rows.map(mapEmailInquiryRow);

    res.json({
      data: mappedData,
      count: mappedData.length,
      total,
      limit: limitNum,
      offset: offsetNum,
      hasMore: offsetNum + mappedData.length < total,
    });
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
        COUNT(*) FILTER (WHERE is_outgoing = false) as total_count,
        COUNT(*) FILTER (WHERE is_outgoing = false AND status = 'unread') as unread_count,
        COUNT(*) FILTER (WHERE is_outgoing = false AND status = 'read') as read_count,
        COUNT(*) FILTER (WHERE is_outgoing = false AND status = 'responded') as responded_count,
        COUNT(*) FILTER (WHERE source = 'zoho' AND is_outgoing = false) as zoho_count,
        COUNT(*) FILTER (WHERE source = 'gmail' AND is_outgoing = false) as gmail_count
      FROM email_inquiries;
    `;

    const result = await db_postgres.query(sql);
    const stats = result.rows[0];

    res.json({
      data: {
        total: parseInt(stats.total_count) || 0,
        unread: parseInt(stats.unread_count) || 0,
        read: parseInt(stats.read_count) || 0,
        responded: parseInt(stats.responded_count) || 0,
        gmail: parseInt(stats.gmail_count) || 0,
        zoho: parseInt(stats.zoho_count) || 0
      }
    });
  } catch (error) {
    console.error('[Email Inquiries] Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch email stats' });
  }
});

// Get thread-related emails for one email inquiry
app.get('/email-inquiries/:id/thread', auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const currentEmail = await db_postgres.query(
      'SELECT id FROM email_inquiries WHERE id = $1 LIMIT 1',
      [id]
    );

    if (currentEmail.rows.length === 0) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Email inquiry not found',
      });
    }

    const sql = `
      WITH current_email AS (
        SELECT *
        FROM email_inquiries
        WHERE id = $1
        LIMIT 1
      )
      SELECT e.*
      FROM email_inquiries e
      CROSS JOIN current_email c
      WHERE e.id <> c.id
        AND (
          (c.thread_id IS NOT NULL AND e.thread_id = c.thread_id)
          OR (c.message_id IS NOT NULL AND e.in_reply_to = c.message_id)
          OR (c.in_reply_to IS NOT NULL AND e.message_id = c.in_reply_to)
          OR (c.in_reply_to IS NOT NULL AND e.in_reply_to = c.in_reply_to)
          OR (c.message_id = ANY(COALESCE(e."references", ARRAY[]::text[])))
          OR (e.message_id = ANY(COALESCE(c."references", ARRAY[]::text[])))
        )
      ORDER BY e.received_at ASC
      LIMIT 500;
    `;

    const result = await db_postgres.query(sql, [id]);

    const mappedData = result.rows.map(mapEmailInquiryRow);

    res.json({ data: mappedData, count: mappedData.length });
  } catch (error) {
    console.error('[Email Inquiries] Error fetching thread:', error);
    res.status(500).json({ error: 'Failed to fetch email thread' });
  }
});

// Update email inquiry (mark as checked/unchecked or update status)
app.patch('/email-inquiries/:id', auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { check, status } = req.body;

    let updates = {};

    if (status !== undefined && !EMAIL_STATUS_VALUES.has(status)) {
      return res.status(400).json({
        error: 'invalid_status',
        message: 'Invalid email inquiry status',
        allowed: [...EMAIL_STATUS_VALUES],
      });
    }

    if (check !== undefined && typeof check !== 'boolean') {
      return res.status(400).json({
        error: 'invalid_check',
        message: 'check must be a boolean',
      });
    }

    if (
      status !== undefined &&
      check !== undefined &&
      check !== (status !== 'unread')
    ) {
      return res.status(400).json({
        error: 'inconsistent_status',
        message: 'status and check values are inconsistent',
      });
    }

    // Handle new status field (takes priority)
    if (status !== undefined) {
      updates.status = status;
      // Sync check field for backward compatibility
      updates.check = (status === 'read' || status === 'responded');
    }
    // Handle legacy check field
    else if (check !== undefined) {
      updates.check = check;
      updates.status = check ? 'read' : 'unread';
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Build dynamic UPDATE query
    const setClause = [];
    const values = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      setClause.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.check !== undefined) {
      setClause.push(`"check" = $${paramIndex++}`);
      values.push(updates.check);
    }
    setClause.push(`updated_at = NOW()`);
    values.push(id);

    const sql = `
      UPDATE email_inquiries
      SET ${setClause.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *;
    `;

    const result = await db_postgres.query(sql, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email inquiry not found' });
    }

    const mappedData = mapEmailInquiryRow(result.rows[0]);

    if (global.broadcastEvent) {
      global.broadcastEvent('email:updated', mappedData);
    }

    res.json({ data: mappedData });
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

    if (global.broadcastEvent) {
      global.broadcastEvent('email:deleted', { id: result.rows[0].id });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('[Email Inquiries] Error deleting inquiry:', error);
    res.status(500).json({ error: 'Failed to delete email inquiry' });
  }
});

emailTranslationRoutes.registerRoutes(app, auth, asyncHandler);
// Get full email content (not truncated)
app.get('/email-inquiries/:id/content', auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;

    // Get email from database
    const sql = `SELECT message_id, folder_id, source FROM email_inquiries WHERE id = $1 LIMIT 1;`;
    const result = await db_postgres.query(sql, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const email = result.rows[0];

    // Only ZOHO emails support full content fetch
    if (email.source !== 'zoho') {
      return res.status(400).json({ error: 'Full content fetch only supported for ZOHO emails' });
    }

    if (!email.folder_id) {
      return res.status(400).json({ error: 'Folder ID not available for this email' });
    }

    // Fetch full content from ZOHO API
    const { fetchMessageContent } = require('./zoho/mail-api');
    const content = await fetchMessageContent(email.message_id, email.folder_id);

    res.json({ content });
  } catch (error) {
    console.error('[Email Inquiries] Error fetching email content:', error);
    res.status(500).json({ error: 'Failed to fetch email content' });
  }
});

// Get email attachments info
app.get('/email-inquiries/:id/attachments', auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;

    // Get email from database
    const sql = `SELECT message_id, folder_id, source FROM email_inquiries WHERE id = $1 LIMIT 1;`;
    const result = await db_postgres.query(sql, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const email = result.rows[0];

    // Only ZOHO emails support attachment fetch
    if (email.source !== 'zoho') {
      return res.status(400).json({ error: 'Attachments fetch only supported for ZOHO emails' });
    }

    if (!email.folder_id) {
      return res.status(400).json({ error: 'Folder ID not available for this email' });
    }

    // Fetch attachment info from ZOHO API
    const { fetchAttachmentInfo } = require('./zoho/mail-api');
    const attachments = await fetchAttachmentInfo(email.message_id, email.folder_id);

    res.json({ attachments });
  } catch (error) {
    console.error('[Email Inquiries] Error fetching attachments:', error);
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

// Download email attachment
app.get('/email-inquiries/:id/attachments/:attachmentId/download', auth.authenticateJWT, async (req, res) => {
  try {
    const { id, attachmentId } = req.params;

    // Get email from database
    const sql = `SELECT message_id, folder_id, source FROM email_inquiries WHERE id = $1 LIMIT 1;`;
    const result = await db_postgres.query(sql, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const email = result.rows[0];

    // Only ZOHO emails support attachment download
    if (email.source !== 'zoho') {
      return res.status(400).json({ error: 'Attachment download only supported for ZOHO emails' });
    }

    if (!email.folder_id) {
      return res.status(400).json({ error: 'Folder ID not available for this email' });
    }

    // Download attachment from ZOHO API
    const { downloadAttachment, fetchAttachmentInfo } = require('./zoho/mail-api');

    // Get attachment name first
    const attachments = await fetchAttachmentInfo(email.message_id, email.folder_id);
    const attachment = attachments.find(a => a.attachmentId === attachmentId);
    const attachmentName = attachment?.attachmentName || 'download';

    // Download and stream the attachment
    const response = await downloadAttachment(email.message_id, email.folder_id, attachmentId);

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachmentName)}"`);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');

    // Pipe the stream to response
    response.data.pipe(res);
  } catch (error) {
    console.error('[Email Inquiries] Error downloading attachment:', error);
    res.status(500).json({ error: 'Failed to download attachment' });
  }
});

// Send email response
app.post('/api/email-response', auth.authenticateJWT, asyncHandler(async (req, res) => {
  const result = await zohoRoutes.handleEmailResponse(req.user, req.body);
  res.status(result.status).json(result.body);
}));

console.log('✓ Email Inquiries API endpoints registered');

// ============================================
// ZOHO Mail Integration (Optional Module)
// ============================================
if (process.env.ZOHO_CLIENT_ID && process.env.ZOHO_ENABLED === 'true') {
  try {
    const zoho = require('./zoho');

    // OAuth endpoints
    app.get('/auth/zoho', zoho.handleAuthStart);
    app.get('/api/zoho/auth/start', zoho.handleAuthStart);
    app.get('/auth/zoho/callback', zoho.handleAuthCallback);
    app.get('/api/zoho/auth/callback', zoho.handleAuthCallback);

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
    app.post('/api/zoho/sync', auth.authenticateJWT, asyncHandler(async (req, res) => {
      const result = await zohoRoutes.handleZohoSync(req.user);
      res.status(result.status).json(result.body);
    }));

    // Perform initial full sync on server start (only once)
    setTimeout(async () => {
      try {
        console.log('[ZOHO] Checking OAuth tokens before initial sync...');

        // Sync tokens from Firestore to PostgreSQL on startup
        const { getTokensFromFirestore } = require('./zoho/firestore-token-storage');
        const { saveOAuthTokens } = require('./zoho/db-helper');
        const zohoEmail = process.env.ZOHO_ACCOUNT_EMAIL;

        if (zohoEmail) {
          try {
            const firestoreToken = await getTokensFromFirestore(zohoEmail);
            if (firestoreToken) {
              console.log('[ZOHO] Syncing tokens from Firestore to PostgreSQL...');
              await saveOAuthTokens({
                accessToken: firestoreToken.access_token,
                refreshToken: firestoreToken.refresh_token,
                expiresIn: Math.floor((new Date(firestoreToken.expires_at) - Date.now()) / 1000),
                tokenType: firestoreToken.token_type,
                zohoEmail: firestoreToken.zoho_email,
                zohoUserId: firestoreToken.zoho_user_id
              });
              console.log('[ZOHO] Tokens synced successfully, performing initial full sync...');
            } else {
              console.log('[ZOHO] No tokens found in Firestore. Please authorize ZOHO first:');
              console.log(`[ZOHO]   1. Visit: http://localhost:${PORT}/api/zoho/auth/start`);
              console.log('[ZOHO]   2. After authorization, trigger sync via POST /api/zoho/sync');
              return;
            }
          } catch (syncError) {
            console.warn('[ZOHO] Token sync failed:', syncError.message);
            console.log('[ZOHO] Skipping initial sync. Please authorize ZOHO first:');
            console.log(`[ZOHO]   1. Visit: http://localhost:${PORT}/api/zoho/auth/start`);
            console.log('[ZOHO]   2. After authorization, trigger sync via POST /api/zoho/sync');
            return;
          }
        }

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

// Express 4 does not automatically forward rejected async handlers.
app.use((error, req, res, next) => {
  console.error(`[API Error] ${req.method} ${req.path}:`, error);

  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode || error.status || 500;
  res.status(statusCode).json({
    error: statusCode >= 500 ? 'internal_server_error' : 'request_error',
    message: statusCode >= 500 ? 'Internal server error' : error.message,
  });
});

// ============================================
// Start Server
// ============================================
const PORT = process.env.PORT || 3001;
databaseReadyPromise.then(() => {
  server.listen(PORT, '0.0.0.0', () => {
  console.log("=".repeat(60));
  console.log(`✓ APS Admin Local Backend Server running on port ${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/`);
  console.log(`✓ WebSocket (Socket.IO) ready on same port`);
  console.log("=".repeat(60));
  emailMailClient.startScheduledEmailDispatcher();
  });
}).catch((error) => {
  console.error('[DB] Startup schema preparation failed:', error.message);
  process.exit(1);
});
