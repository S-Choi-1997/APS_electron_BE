/**
 * APS WebSocket Relay Server
 *
 * Purpose: WebSocket 중계 서버 - 백엔드와 클라이언트 사이의 실시간 이벤트 중계
 *
 * Architecture:
 *   Backend Server (Socket.IO Client) → Relay Server → Electron App (Socket.IO Client)
 *
 * Key Features:
 *   - 백엔드/클라이언트 연결 관리 (아웃바운드 연결)
 *   - 활성 백엔드 선택 (대시보드 기반)
 *   - 핸드쉐이크 및 버전 체크
 *   - 하트비트 모니터링
 *   - 8개 이벤트 중계 (memo/schedule/consultation CRUD)
 */

require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const fs = require('fs');

// ============================================
// Configuration
// ============================================
const PORT = process.env.PORT || 8080;
const MIN_BACKEND_VERSION = process.env.MIN_BACKEND_VERSION || '1.0.0';
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL) || 30000; // 30초
const CONNECTION_TIMEOUT = parseInt(process.env.CONNECTION_TIMEOUT) || 90000; // 90초
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'aps-relay-2025'; // 기본 비밀번호
const SESSION_SECRET = process.env.SESSION_SECRET || 'aps-relay-session-secret-change-this';

// ============================================
// Logging Configuration
// ============================================
const LOG_DIR = '/app/logs';
const LOG_FILE = path.join(LOG_DIR, 'relay.log');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB (파일 로그용)

// 로그 디렉토리 생성
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 로그 파일에 기록하는 함수
function writeLog(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  try {
    // 파일 크기 체크 (로테이션)
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_FILE_SIZE) {
        // 기존 로그를 .old로 백업
        fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
      }
    }

    // 로그 추가
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (error) {
    console.error('Failed to write log:', error);
  }
}

// console.log 오버라이드 (파일과 콘솔 동시 출력)
const originalConsoleLog = console.log;
console.log = function(...args) {
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');

  originalConsoleLog.apply(console, args); // 콘솔 출력
  writeLog(message); // 파일 출력
};

// ============================================
// Express App Setup
// ============================================
const app = express();
const httpServer = createServer(app);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS 설정 (HTTP 프록시용)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'app://aps-admin'
  ];

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Provider');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24시간
    sameSite: 'lax', // strict에서 lax로 변경 (리다이렉트 시 쿠키 전송 허용)
    secure: false // HTTP 환경에서도 작동 (개발/테스트용)
  }
}));

// Authentication middleware
function requireAuth(req, res, next) {
  console.log('[Auth] Checking authentication:', {
    path: req.path,
    hasSession: !!req.session,
    sessionID: req.sessionID,
    authenticated: req.session?.authenticated,
    cookies: req.cookies
  });

  if (req.session && req.session.authenticated) {
    return next();
  }

  console.log('[Auth] Authentication failed, redirecting to login');

  // API 요청인 경우 JSON 응답
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ message: '인증이 필요합니다.' });
  }

  // 페이지 요청인 경우 로그인 페이지로 리다이렉트
  res.redirect('/login.html');
}

// Static files for dashboard (로그인 페이지는 인증 불필요, index.html은 제외)
app.use(express.static(path.join(__dirname, 'public'), {
  index: false  // Don't auto-serve index.html - it's protected below
}));

// ============================================
// Socket.IO Server Setup
// ============================================
const io = new Server(httpServer, {
  cors: {
    origin: '*', // 개발 단계: 모든 출처 허용 (나중에 제한)
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: CONNECTION_TIMEOUT,
  pingInterval: HEARTBEAT_INTERVAL,
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB (for large file transfers)
});

// ============================================
// Connection State
// ============================================
const backends = new Map(); // socket.id → { socket, instanceId, metadata, lastHeartbeat }
const clients = new Map();  // socket.id → { socket, metadata, lastHeartbeat }
let activeBackendId = null;        // Production 활성 백엔드 socket.id
let activeDevBackendId = null;     // Development 활성 백엔드 socket.id

// Event log (최근 100개만 저장, 디스크 영구 저장)
const eventLog = [];
const MAX_LOG_SIZE = 100;
const LOG_FILE_PATH = path.join(__dirname, 'logs', 'events.json');

// 로그 디렉토리 생성
if (!fs.existsSync(path.join(__dirname, 'logs'))) {
  fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
}

// 서버 시작 시 로그 파일에서 로드
function loadEventLog() {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      const data = fs.readFileSync(LOG_FILE_PATH, 'utf8');
      const logs = JSON.parse(data);
      eventLog.push(...logs.slice(0, MAX_LOG_SIZE));
      console.log(`[Relay] Loaded ${eventLog.length} event logs from disk`);
    }
  } catch (error) {
    console.error('[Relay] Failed to load event logs:', error.message);
  }
}

// 로그 파일에 저장 (비동기)
function saveEventLog() {
  try {
    fs.writeFileSync(LOG_FILE_PATH, JSON.stringify(eventLog, null, 2), 'utf8');
  } catch (error) {
    console.error('[Relay] Failed to save event logs:', error.message);
  }
}

loadEventLog();

// ============================================
// Heartbeat Timeout Monitor
// ============================================

/**
 * 주기적으로 heartbeat 타임아웃 체크 (30초마다)
 * CONNECTION_TIMEOUT(90초) 동안 heartbeat 없으면 연결 끊기
 */
setInterval(() => {
  const now = Date.now();

  // 백엔드 타임아웃 체크
  for (const [id, data] of backends.entries()) {
    const timeSinceLastHeartbeat = now - data.lastHeartbeat;

    if (timeSinceLastHeartbeat > CONNECTION_TIMEOUT) {
      console.log(`[Relay] Backend ${data.instanceId} (socket.id: ${id}) heartbeat timeout (${timeSinceLastHeartbeat}ms), disconnecting...`);

      addEventLog('backend:timeout', {
        instanceId: data.instanceId,
        socketId: id,
        timeSinceLastHeartbeat,
        environment: getEnvironment(data.metadata)
      });

      data.socket.disconnect(true);
      backends.delete(id);

      // 활성 백엔드였으면 재설정
      const environment = getEnvironment(data.metadata);
      if (id === getActiveBackendId(environment)) {
        const remainingBackends = Array.from(backends.entries())
          .filter(([_, b]) => getEnvironment(b.metadata) === environment)
          .map(([socketId, _]) => socketId);

        setActiveBackendId(environment, remainingBackends.length > 0 ? remainingBackends[0] : null);
      }

      broadcastStats();
    }
  }

  // 클라이언트 타임아웃 체크
  for (const [id, data] of clients.entries()) {
    const timeSinceLastHeartbeat = now - data.lastHeartbeat;

    if (timeSinceLastHeartbeat > CONNECTION_TIMEOUT) {
      console.log(`[Relay] Client ${id} heartbeat timeout (${timeSinceLastHeartbeat}ms), disconnecting...`);

      addEventLog('client:timeout', {
        clientId: id,
        timeSinceLastHeartbeat,
        environment: getEnvironment(data.metadata)
      });

      data.socket.disconnect(true);
      clients.delete(id);
      broadcastStats();
    }
  }
}, HEARTBEAT_INTERVAL); // 30초마다 체크

// ============================================
// Helper Functions
// ============================================

/**
 * 버전 체크 (semantic versioning)
 */
function checkVersion(version) {
  if (!version) return false;

  const [major1, minor1] = MIN_BACKEND_VERSION.split('.').map(Number);
  const [major2, minor2] = (version || '0.0.0').split('.').map(Number);

  return major2 >= major1 && minor2 >= minor1;
}

/**
 * 이벤트 로그 추가
 */
function addEventLog(type, data) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type,
    data
  };

  eventLog.unshift(logEntry);
  if (eventLog.length > MAX_LOG_SIZE) {
    eventLog.pop();
  }

  // 디스크에 저장
  saveEventLog();

  // 대시보드에 실시간 전송
  io.to('dashboard').emit('log:update', logEntry);
}

/**
 * 백엔드/클라이언트의 environment 가져오기 (없으면 production)
 */
function getEnvironment(metadata) {
  return metadata?.environment || 'production';
}

/**
 * environment에 맞는 활성 백엔드 ID 가져오기
 */
function getActiveBackendId(environment) {
  return environment === 'development' ? activeDevBackendId : activeBackendId;
}

/**
 * environment에 맞는 활성 백엔드 ID 설정하기
 */
function setActiveBackendId(environment, backendId) {
  if (environment === 'development') {
    activeDevBackendId = backendId;
  } else {
    activeBackendId = backendId;
  }
}

/**
 * 연결 상태 브로드캐스트 (대시보드용)
 */
function broadcastStats() {
  const stats = {
    backends: Array.from(backends.entries()).map(([socketId, data]) => ({
      id: socketId, // socket.id를 ID로 사용
      instanceId: data.instanceId, // instanceId는 별도 필드
      active: socketId === activeBackendId || socketId === activeDevBackendId,
      environment: getEnvironment(data.metadata),
      metadata: data.metadata,
      connected: data.socket.connected,
      lastHeartbeat: data.lastHeartbeat
    })),
    clients: Array.from(clients.entries()).map(([id, data]) => ({
      id,
      environment: getEnvironment(data.metadata),
      metadata: data.metadata,
      connected: data.socket.connected,
      lastHeartbeat: data.lastHeartbeat
    })),
    activeBackendId,
    activeDevBackendId,
    eventCount: eventLog.length
  };

  io.to('dashboard').emit('stats:update', stats);
}

// ============================================
// Socket.IO Connection Handler
// ============================================
io.on('connection', (socket) => {
  console.log(`[Relay] New connection: ${socket.id}`);

  // 연결 이벤트 로그
  addEventLog('relay:connection', {
    socketId: socket.id,
    ip: socket.handshake.address
  });

  // ============================================
  // Handshake Handler
  // ============================================
  socket.on('handshake', (data) => {
    const { type, version, instanceId, metadata } = data;

    console.log(`[Relay] Handshake from ${type}:`, { instanceId, version, metadata });

    // 핸드셰이크 이벤트 로그
    addEventLog('relay:handshake', {
      socketId: socket.id,
      type,
      instanceId,
      version
    });

    // 1. Backend Handshake
    if (type === 'backend') {
      // 버전 체크
      if (!checkVersion(version)) {
        console.error(`[Relay] Backend version mismatch: ${version} < ${MIN_BACKEND_VERSION}`);
        socket.emit('handshake:error', {
          error: 'VERSION_MISMATCH',
          message: `Backend version ${version} is not compatible. Minimum version: ${MIN_BACKEND_VERSION}`
        });
        socket.disconnect(true);
        return;
      }

      const environment = getEnvironment(metadata);

      // 백엔드 등록 (socket.id를 키로 사용, instanceId는 메타데이터에 저장)
      backends.set(socket.id, {
        socket,
        instanceId, // 메타데이터에 instanceId 저장
        metadata: { ...metadata, version, instanceId, environment },
        lastHeartbeat: Date.now()
      });

      // 해당 environment의 첫 번째 백엔드면 자동 활성화
      const currentActiveId = getActiveBackendId(environment);
      if (!currentActiveId) {
        setActiveBackendId(environment, socket.id);
        console.log(`[Relay] Auto-activated first ${environment} backend: ${instanceId} (socket.id: ${socket.id})`);
      }

      socket.emit('handshake:success', {
        relayId: socket.id,
        active: socket.id === getActiveBackendId(environment),
        environment,
        message: `Backend connected to relay server (${environment})`
      });

      addEventLog('backend:connected', { instanceId, socketId: socket.id, version, environment });
      broadcastStats();
    }

    // 2. Client Handshake
    else if (type === 'client') {
      const clientId = socket.id; // 클라이언트는 socket.id를 ID로 사용
      const environment = getEnvironment(metadata);

      clients.set(clientId, {
        socket,
        metadata: { ...metadata, clientId, environment },
        lastHeartbeat: Date.now()
      });

      socket.emit('handshake:success', {
        relayId: socket.id,
        environment,
        message: `Client connected to relay server (${environment})`
      });

      addEventLog('client:connected', { clientId, environment, metadata });
      broadcastStats();
    }

    // 3. Dashboard Handshake
    else if (type === 'dashboard') {
      socket.join('dashboard');

      socket.emit('handshake:success', {
        relayId: socket.id,
        message: 'Dashboard connected'
      });

      // 대시보드 연결 이벤트 로그
      addEventLog('dashboard:connected', {
        socketId: socket.id,
        userAgent: metadata?.userAgent
      });

      // 현재 상태 즉시 전송
      broadcastStats();

      // 이벤트 로그 전송
      socket.emit('log:init', eventLog);
    }

    // Unknown type
    else {
      console.error(`[Relay] Unknown handshake type: ${type}`);
      socket.disconnect(true);
    }
  });

  // ============================================
  // Heartbeat Handler
  // ============================================
  socket.on('heartbeat', () => {
    // 백엔드 하트비트
    for (const [id, data] of backends.entries()) {
      if (data.socket.id === socket.id) {
        data.lastHeartbeat = Date.now();
        socket.emit('heartbeat:ack');
        return;
      }
    }

    // 클라이언트 하트비트
    for (const [id, data] of clients.entries()) {
      if (data.socket.id === socket.id) {
        data.lastHeartbeat = Date.now();
        socket.emit('heartbeat:ack');
        return;
      }
    }
  });

  // ============================================
  // Event Relay (Backend → Clients)
  // ============================================
  const RELAY_EVENTS = [
    'memo:created',
    'memo:deleted',
    'schedule:created',
    'schedule:updated',
    'schedule:deleted',
    'consultation:created',
    'consultation:updated',
    'consultation:deleted',
    'email:created',
    'email:updated',
    'email:deleted'
  ];

  RELAY_EVENTS.forEach((eventName) => {
    socket.on(eventName, (eventData) => {
      // 1. 백엔드 찾기 (socket.id로 직접 조회)
      const backendData = backends.get(socket.id);

      if (!backendData) {
        console.warn(`[Relay] Event ${eventName} from non-backend socket ${socket.id}`);
        return;
      }

      // 2. 백엔드의 environment 확인
      const backendEnv = getEnvironment(backendData.metadata);
      const activeId = getActiveBackendId(backendEnv);

      // 3. 활성 백엔드가 아니면 무시
      if (socket.id !== activeId) {
        console.log(`[Relay] Ignoring event ${eventName} from inactive ${backendEnv} backend ${backendData.instanceId} (socket.id: ${socket.id})`);
        return;
      }

      console.log(`[Relay] Relaying event: ${eventName} from ${backendEnv} backend ${backendData.instanceId} (socket.id: ${socket.id})`);

      // 4. 같은 environment의 클라이언트들에게만 브로드캐스트
      let relayedCount = 0;
      for (const [clientId, clientData] of clients.entries()) {
        const clientEnv = getEnvironment(clientData.metadata);

        // 같은 environment일 때만 중계
        if (clientEnv === backendEnv) {
          clientData.socket.emit(eventName, eventData);
          relayedCount++;
        }
      }

      console.log(`[Relay] Event ${eventName} relayed to ${relayedCount} ${backendEnv} clients`);

      addEventLog(eventName, {
        instanceId: backendData.instanceId,
        socketId: socket.id,
        environment: backendEnv,
        clientCount: relayedCount,
        data: eventData
      });
    });
  });

  // ============================================
  // Dashboard Commands
  // ============================================
  socket.on('dashboard:setActiveBackend', (params) => {
    // 하위 호환성: 문자열로 오는 경우 처리
    const socketId = typeof params === 'string' ? params : params.backendId; // backendId는 이제 socket.id
    const environment = typeof params === 'string' ? 'production' : (params.environment || 'production');

    if (!backends.has(socketId)) {
      socket.emit('error', { message: 'Backend not found' });
      return;
    }

    const backendData = backends.get(socketId);
    const oldActiveSocketId = getActiveBackendId(environment);
    setActiveBackendId(environment, socketId);

    console.log(`[Relay] Active ${environment} backend changed: ${oldActiveSocketId} → ${socketId} (instanceId: ${backendData.instanceId})`);

    // 같은 environment의 백엔드들에게만 활성 상태 알림
    for (const [id, data] of backends.entries()) {
      const backendEnv = getEnvironment(data.metadata);
      if (backendEnv === environment) {
        const activeId = getActiveBackendId(environment);
        data.socket.emit('active:changed', { active: id === activeId });
      }
    }

    addEventLog('backend:activated', {
      socketId,
      instanceId: backendData.instanceId,
      environment,
      oldSocketId: oldActiveSocketId
    });
    broadcastStats();
  });

  // ============================================
  // HTTP Tunnel Response Handler
  // ============================================
  socket.on('http:response', (response) => {
    const { requestId, statusCode, headers, body } = response;

    // Find pending request
    const pending = pendingHttpRequests.get(requestId);
    if (!pending) {
      console.warn(`[Relay] Received response for unknown requestId: ${requestId}`);
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timeout);
    pendingHttpRequests.delete(requestId);

    // Log response
    addEventLog('relay:proxy-response', {
      requestId,
      statusCode,
    });

    console.log(`[Relay] Tunnel response ${statusCode} (requestId: ${requestId})`);

    // Forward response to client
    const { res } = pending;

    // Set response headers (filter out problematic headers)
    Object.entries(headers).forEach(([key, value]) => {
      if (!['connection', 'transfer-encoding', 'content-length', 'x-binary-base64'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Handle binary data encoded as base64
    if (headers['x-binary-base64'] === 'true') {
      const binaryData = Buffer.from(body, 'base64');
      res.status(statusCode).send(binaryData);
    } else {
      res.status(statusCode).send(body);
    }
  });

  // ============================================
  // Disconnect Handler
  // ============================================
  socket.on('disconnect', (reason) => {
    console.log(`[Relay] Disconnected: ${socket.id}, reason: ${reason}`);

    // 백엔드 연결 해제 (socket.id로 직접 조회)
    const backendData = backends.get(socket.id);
    if (backendData) {
      const environment = getEnvironment(backendData.metadata);
      backends.delete(socket.id);

      console.log(`[Relay] Backend ${backendData.instanceId} (socket.id: ${socket.id}) disconnected`);

      // 활성 백엔드가 끊어지면 같은 environment의 다른 백엔드 자동 활성화
      const currentActiveId = getActiveBackendId(environment);
      if (currentActiveId === socket.id) {
        // 같은 environment의 남은 백엔드 찾기
        const remainingBackends = Array.from(backends.entries())
          .filter(([_, b]) => getEnvironment(b.metadata) === environment)
          .map(([socketId, _]) => socketId);

        const newActiveId = remainingBackends.length > 0 ? remainingBackends[0] : null;
        setActiveBackendId(environment, newActiveId);

        if (newActiveId) {
          const newActiveData = backends.get(newActiveId);
          console.log(`[Relay] Active ${environment} backend disconnected, switching to: ${newActiveData.instanceId} (socket.id: ${newActiveId})`);
        } else {
          console.log(`[Relay] Active ${environment} backend disconnected, no remaining backends`);
        }
      }

      addEventLog('backend:disconnected', {
        instanceId: backendData.instanceId,
        socketId: socket.id,
        environment,
        reason
      });
      broadcastStats();
      return;
    }

    // 클라이언트 연결 해제 (socket.id로 직접 조회)
    const clientData = clients.get(socket.id);
    if (clientData) {
      const environment = getEnvironment(clientData.metadata);
      clients.delete(socket.id);
      addEventLog('client:disconnected', { clientId: socket.id, environment, reason });
      broadcastStats();
      return;
    }
  });
});

// ============================================
// Authentication Routes
// ============================================

// 로그인 API
app.post('/api/login', (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ message: '비밀번호를 입력해주세요.' });
  }

  if (password === DASHBOARD_PASSWORD) {
    req.session.authenticated = true;
    req.session.loginTime = new Date().toISOString();

    console.log('[Auth] Session before save:', {
      sessionID: req.sessionID,
      authenticated: req.session.authenticated,
      cookie: req.session.cookie
    });

    // 세션을 명시적으로 저장한 후 응답 (비동기 세션 저장 보장)
    req.session.save((err) => {
      if (err) {
        console.error('[Auth] Session save error:', err);
        return res.status(500).json({
          success: false,
          message: '세션 저장 오류가 발생했습니다.'
        });
      }

      console.log('[Auth] Dashboard login successful from:', req.ip);
      console.log('[Auth] Session after save:', {
        sessionID: req.sessionID,
        authenticated: req.session.authenticated
      });

      // 로그인 성공 이벤트 로그
      addEventLog('auth:login:success', {
        ip: req.ip,
        sessionID: req.sessionID,
        timestamp: req.session.loginTime
      });

      return res.json({
        success: true,
        message: '로그인되었습니다.'
      });
    });
  } else {
    console.log('[Auth] Failed login attempt from:', req.ip);

    // 로그인 실패 이벤트 로그
    addEventLog('auth:login:failed', {
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    return res.status(401).json({
      success: false,
      message: '비밀번호가 일치하지 않습니다.'
    });
  }
});

// 로그아웃 API
app.post('/api/logout', (req, res) => {
  const sessionID = req.sessionID;
  const ip = req.ip;

  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Logout error:', err);
      return res.status(500).json({ message: '로그아웃 실패' });
    }

    // 로그아웃 이벤트 로그
    addEventLog('auth:logout', {
      ip,
      sessionID,
      timestamp: new Date().toISOString()
    });

    res.clearCookie('connect.sid');
    res.json({ message: '로그아웃되었습니다.' });
  });
});

// ============================================
// HTTP-over-WebSocket Tunnel
// ============================================

/**
 * Pending HTTP requests waiting for backend responses
 * requestId → { res (Express response object), timeout }
 */
const pendingHttpRequests = new Map();
const HTTP_TUNNEL_TIMEOUT = 120000; // 120 seconds (for large file downloads)

/**
 * Generate unique request ID
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Handle HTTP requests by tunneling through WebSocket to active backend
 *
 * Route: /proxy/*
 * Example: POST /proxy/auth/login → tunneled to backend as POST /auth/login
 */
app.use('/proxy', express.json({ limit: '10mb' }), (req, res) => {
  // Get environment from header (default: production)
  const environment = req.headers['x-relay-environment'] || 'production';
  const targetSocketId = getActiveBackendId(environment);

  // Check if active backend for this environment is connected
  if (!targetSocketId || !backends.has(targetSocketId)) {
    addEventLog('relay:proxy-error', {
      path: req.path,
      environment,
      error: `No active ${environment} backend available`
    });

    return res.status(503).json({
      error: 'service_unavailable',
      message: `No ${environment} backend server available`,
    });
  }

  const backendData = backends.get(targetSocketId);
  const backendSocket = backendData.socket;
  const requestId = generateRequestId();

  // Remove /proxy prefix from path and extract query parameters
  const fullUrl = req.originalUrl.replace(/^\/proxy/, '');
  const [targetPath, queryString] = fullUrl.split('?');

  // Parse query parameters
  const query = {};
  if (queryString) {
    const params = new URLSearchParams(queryString);
    for (const [key, value] of params.entries()) {
      query[key] = value;
    }
  }

  // Log tunnel request
  addEventLog('relay:proxy-request', {
    requestId,
    method: req.method,
    path: targetPath,
    query: query,
    socketId: targetSocketId,
    instanceId: backendData.instanceId,
    environment,
    clientIp: req.ip,
  });

  console.log(`[Relay] Tunneling ${req.method} ${targetPath} to ${environment} backend ${backendData.instanceId} (socket.id: ${targetSocketId}, requestId: ${requestId})`);

  // Set timeout for backend response
  const timeout = setTimeout(() => {
    if (pendingHttpRequests.has(requestId)) {
      pendingHttpRequests.delete(requestId);

      addEventLog('relay:proxy-timeout', {
        requestId,
        method: req.method,
        path: targetPath,
      });

      res.status(504).json({
        error: 'gateway_timeout',
        message: 'Backend response timeout',
      });
    }
  }, HTTP_TUNNEL_TIMEOUT);

  // Store pending request
  pendingHttpRequests.set(requestId, { res, timeout });

  // Send HTTP request to backend via WebSocket (now includes query parameters)
  backendSocket.emit('http:request', {
    requestId,
    method: req.method,
    path: targetPath,
    query: query,
    headers: req.headers,
    body: req.body,
  });
});

// 메인 페이지 보호
app.get('/', requireAuth, (req, res) => {
  // 쿼리 파라미터가 있으면 깔끔한 URL로 리다이렉트
  if (Object.keys(req.query).length > 0) {
    return res.redirect(301, '/');
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// REST API for Dashboard (인증 필요)
// ============================================
app.get('/api/stats', requireAuth, (req, res) => {
  res.json({
    backends: Array.from(backends.entries()).map(([socketId, data]) => ({
      id: socketId, // socket.id를 ID로 사용
      instanceId: data.instanceId, // instanceId는 별도 필드
      active: socketId === activeBackendId,
      metadata: data.metadata,
      connected: data.socket.connected,
      lastHeartbeat: data.lastHeartbeat
    })),
    clients: Array.from(clients.entries()).map(([id, data]) => ({
      id,
      metadata: data.metadata,
      connected: data.socket.connected,
      lastHeartbeat: data.lastHeartbeat
    })),
    activeBackendId,
    eventCount: eventLog.length,
    relayInfo: {
      version: '1.0.0',
      minBackendVersion: MIN_BACKEND_VERSION,
      heartbeatInterval: HEARTBEAT_INTERVAL,
      connectionTimeout: CONNECTION_TIMEOUT
    }
  });
});

app.get('/api/logs', requireAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(eventLog.slice(0, limit));
});

// ============================================
// ZOHO Webhook Endpoint
// ============================================
app.post('/api/zoho/webhook', express.json(), (req, res) => {
  console.log('[Relay] ========================================');
  console.log('[Relay] ZOHO Webhook received');
  console.log('[Relay] Headers:', JSON.stringify(req.headers, null, 2));
  console.log('[Relay] Body:', JSON.stringify(req.body, null, 2));
  console.log('[Relay] ========================================');

  // Log webhook event
  addEventLog('zoho:webhook:received', {
    headers: req.headers,
    body: req.body,
    ip: req.ip
  });

  // Check if active backend is connected
  if (!activeBackendId || !backends.has(activeBackendId)) {
    console.error('[Relay] No active backend to relay ZOHO webhook');
    addEventLog('zoho:webhook:error', {
      error: 'No active backend available'
    });

    return res.status(503).json({
      error: 'service_unavailable',
      message: 'No backend server available to process webhook'
    });
  }

  const backendSocket = backends.get(activeBackendId).socket;
  const requestId = generateRequestId();

  console.log(`[Relay] Relaying ZOHO webhook to backend ${activeBackendId} (requestId: ${requestId})`);

  // Set timeout for backend response
  const timeout = setTimeout(() => {
    if (pendingHttpRequests.has(requestId)) {
      pendingHttpRequests.delete(requestId);

      addEventLog('zoho:webhook:timeout', {
        requestId
      });

      res.status(504).json({
        error: 'gateway_timeout',
        message: 'Backend webhook processing timeout'
      });
    }
  }, HTTP_TUNNEL_TIMEOUT);

  // Store pending request
  pendingHttpRequests.set(requestId, { res, timeout });

  // Forward webhook to backend via WebSocket as HTTP request
  backendSocket.emit('http:request', {
    requestId,
    method: 'POST',
    path: '/api/zoho/webhook',
    query: {},
    headers: req.headers,
    body: req.body
  });

  addEventLog('zoho:webhook:relayed', {
    requestId,
    backendId: activeBackendId
  });
});

// ============================================
// Health Check
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ============================================
// Start Server
// ============================================
httpServer.listen(PORT, () => {
  console.log(`
=====================================
  APS WebSocket Relay Server
=====================================
  Port: ${PORT}
  Dashboard: http://localhost:${PORT}
  Min Backend Version: ${MIN_BACKEND_VERSION}
  Heartbeat Interval: ${HEARTBEAT_INTERVAL}ms
  Connection Timeout: ${CONNECTION_TIMEOUT}ms
  Event Logs Loaded: ${eventLog.length}
=====================================
  `);
});

// ============================================
// Graceful Shutdown
// ============================================
process.on('SIGTERM', () => {
  console.log('[Relay] SIGTERM received, closing server...');
  httpServer.close(() => {
    console.log('[Relay] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Relay] SIGINT received, closing server...');
  httpServer.close(() => {
    console.log('[Relay] Server closed');
    process.exit(0);
  });
});
