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
const emailResponseRoutes = require("./email-response-routes");
const inquiryRoutes = require("./inquiry-routes");
const memoRoutes = require("./memo-routes");
const scheduleRoutes = require("./schedule-routes");
const smsRoutes = require("./sms-routes");
const webFormInquiryRoutes = require("./web-form-inquiry-routes");
const zohoIntegration = require("./zoho-integration");
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
  'email:sync-completed',
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
inquiryRoutes.registerRoutes(app, auth, { firestoreDb: db, bucket });
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

scheduleRoutes.registerRoutes(app, auth);

// ============================================
// WEB FORM INQUIRIES API (PostgreSQL - Firestore polling)
// ============================================
webFormInquiryRoutes.registerRoutes(app, auth);

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

// Legacy email inquiry routes are provided by email-mail-client-service.js.
emailTranslationRoutes.registerRoutes(app, auth, asyncHandler);

// Send email response
emailResponseRoutes.registerRoutes(app, auth, asyncHandler, zohoRoutes);

console.log('✓ Email Inquiries API endpoints registered');

// ============================================
// ZOHO Mail Integration (Optional Module)
// ============================================
zohoIntegration.registerIntegration(app, auth, asyncHandler, zohoRoutes);

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
