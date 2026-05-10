const { app, BrowserWindow, ipcMain, session, Menu, screen, shell, Tray, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const io = require('socket.io-client');

// 단일 인스턴스 잠금 (설치기가 새 인스턴스 실행 시 기존 앱 종료 유도)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 이미 실행 중인 인스턴스가 있으면 즉시 종료
  app.quit();
}

// electron-updater는 app.whenReady() 이후에 로드 (개발 모드에서는 에러 발생하므로)
let autoUpdater = null;

let mainWindow;
let tray = null; // System tray
let stickyWindows = {}; // { type: BrowserWindow }
let memoSubWindows = {}; // { stickyType: BrowserWindow }
let toastNotifications = []; // Toast 알림창 배열 (스택 관리 용)

// WebSocket 관련 변수
let socket = null;
let currentConfig = null;
let heartbeatInterval = null;

// Lazy getters for paths (app.getPath는 app ready 이후에만 사용 가능)
let _stickySettingsPath = null;
let _updateLogPath = null;

// 업데이트 다운로드 상태 (중복 방지)
let isUpdateDownloading = false;

/**
 * Graceful Shutdown - 모든 리소스를 정리하고 앱을 종료하는 함수
 * NSIS 설치기 호환성을 위해 필수
 */
async function gracefulShutdown() {
  console.log('[Shutdown] Starting graceful shutdown...');
  app.isQuitting = true;

  // 1. Heartbeat 정리
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log('[Shutdown] Heartbeat cleared');
  }

  // 2. WebSocket 정리
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    console.log('[Shutdown] WebSocket disconnected');
  }

  // 3. Toast 알림 정리
  toastNotifications.forEach(win => {
    if (win && !win.isDestroyed()) win.destroy();
  });
  toastNotifications = [];
  console.log('[Shutdown] Toast notifications closed');

  // 4. Memo sub windows 정리
  Object.values(memoSubWindows).forEach(win => {
    if (win && !win.isDestroyed()) win.destroy();
  });
  memoSubWindows = {};
  console.log('[Shutdown] Memo sub windows closed');

  // 5. Sticky windows 정리
  Object.values(stickyWindows).forEach(win => {
    if (win && !win.isDestroyed()) win.destroy();
  });
  stickyWindows = {};
  console.log('[Shutdown] Sticky windows closed');

  // 6. Tray 정리
  if (tray) {
    tray.destroy();
    tray = null;
    console.log('[Shutdown] Tray destroyed');
  }

  // 7. Main window 정리
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
    console.log('[Shutdown] Main window destroyed');
  }

  console.log('[Shutdown] Graceful shutdown complete');
}

function getStickySettingsPath() {
  if (!_stickySettingsPath) {
    _stickySettingsPath = path.join(app.getPath('userData'), 'sticky-settings.json');
  }
  return _stickySettingsPath;
}

function getUpdateLogPath() {
  if (!_updateLogPath) {
    _updateLogPath = path.join(app.getPath('userData'), 'update.log');
  }
  return _updateLogPath;
}

function logUpdate(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log('[AutoUpdater]', message);
  try {
    fs.appendFileSync(getUpdateLogPath(), logMessage);
  } catch (e) {
    console.error('Failed to write update log:', e);
  }
}

// ============================================
// Environment 설정 관리
// ============================================
function normalizeWebSocketUrl(url) {
  const parsedUrl = new URL(url);
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('WebSocket URL must use ws, wss, http, or https protocol');
  }

  if (parsedUrl.protocol === 'http:') parsedUrl.protocol = 'ws:';
  if (parsedUrl.protocol === 'https:') parsedUrl.protocol = 'wss:';
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/$/, '');

  return parsedUrl.toString().replace(/\/$/, '');
}

function deriveWebSocketUrlFromApiUrl(apiUrl) {
  const parsedUrl = new URL(apiUrl);
  parsedUrl.protocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  parsedUrl.pathname = '';
  parsedUrl.search = '';
  parsedUrl.hash = '';
  return normalizeWebSocketUrl(parsedUrl.toString());
}

function createAppConfig(input = {}, source = 'runtime') {
  const restBaseUrl = normalizeHttpUrl(input.restBaseUrl || input.apiUrl || 'http://localhost:3001');
  const wsBaseUrl = normalizeWebSocketUrl(
    input.wsBaseUrl || input.wsRelayUrl || input.wsUrl || deriveWebSocketUrlFromApiUrl(restBaseUrl)
  );

  return {
    version: 1,
    mode: input.mode || 'direct',
    environment: input.environment || 'production',
    restBaseUrl,
    wsBaseUrl,
    wsDerivedFromRest: !(input.wsBaseUrl || input.wsRelayUrl || input.wsUrl),
    source,
    // Backward-compatible aliases for existing windows and saved config.
    apiUrl: restBaseUrl,
    wsRelayUrl: wsBaseUrl,
  };
}

function loadBundledDefaultConfig() {
  const candidatePaths = [
    path.join(__dirname, 'app-config.default.json'),
  ];

  if (process.resourcesPath) {
    candidatePaths.push(path.join(process.resourcesPath, 'app-config.default.json'));
  }

  for (const candidatePath of candidatePaths) {
    try {
      if (!fs.existsSync(candidatePath)) continue;
      const bundledConfig = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
      return createAppConfig(bundledConfig, 'packaged-default');
    } catch (error) {
      console.warn(`[Config] Failed to load bundled default config from ${candidatePath}:`, error.message);
    }
  }

  return null;
}

function getDefaultConfig() {
  const bundledDefaultConfig = loadBundledDefaultConfig();
  const apiUrl = process.env.APS_API_URL || process.env.VITE_API_URL || bundledDefaultConfig?.restBaseUrl || 'http://localhost:3001';
  const wsUrl = process.env.APS_WS_URL || process.env.VITE_WS_URL || process.env.VITE_WS_RELAY_URL;
  return createAppConfig({
    environment: process.env.APS_BACKEND_ENVIRONMENT || process.env.VITE_BACKEND_ENVIRONMENT || process.env.VITE_RELAY_ENVIRONMENT || 'production',
    apiUrl,
    wsUrl: wsUrl || bundledDefaultConfig?.wsBaseUrl,
    mode: bundledDefaultConfig?.mode,
  }, process.env.APS_API_URL || process.env.VITE_API_URL ? 'env' : bundledDefaultConfig ? 'packaged-default' : 'local-fallback');
}

function normalizeHttpUrl(url) {
  const parsedUrl = new URL(url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('API URL must use http or https protocol');
  }

  return parsedUrl.toString().replace(/\/$/, '');
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'app-config.json');
}

function loadConfig() {
  const defaultConfig = getDefaultConfig();
  const apiUrlOverride = process.env.APS_API_URL || process.env.VITE_API_URL;
  const wsUrlOverride = process.env.APS_WS_URL || process.env.VITE_WS_URL || process.env.VITE_WS_RELAY_URL;
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, 'utf8');
      const parsedConfig = {
        ...defaultConfig,
        ...JSON.parse(data),
      };

      if (apiUrlOverride) {
        parsedConfig.apiUrl = apiUrlOverride;
        parsedConfig.restBaseUrl = apiUrlOverride;
      }

      if (wsUrlOverride) {
        parsedConfig.wsRelayUrl = wsUrlOverride;
        parsedConfig.wsBaseUrl = wsUrlOverride;
      } else if (apiUrlOverride) {
        parsedConfig.wsRelayUrl = deriveWebSocketUrlFromApiUrl(apiUrlOverride);
        parsedConfig.wsBaseUrl = parsedConfig.wsRelayUrl;
      }

      const config = createAppConfig(parsedConfig, apiUrlOverride || wsUrlOverride ? 'env' : 'userData');
      console.log('[Config] Loaded configuration:', config);
      return config;
    } catch (e) {
      console.error('[Config] Failed to load config:', e);
    }
  }
  console.log('[Config] Using default configuration');
  return defaultConfig;
}

function saveConfig(config) {
  const configPath = getConfigPath();
  try {
    const normalizedConfig = createAppConfig(config, 'userData');
    fs.writeFileSync(configPath, JSON.stringify(normalizedConfig, null, 2));
    console.log('[Config] Saved configuration:', normalizedConfig);
  } catch (e) {
    console.error('[Config] Failed to save config:', e);
  }
}

// ============================================
// WebSocket 연결 관리
// ============================================
function broadcastToAllWindows(eventName, eventData) {
  // 메인 창
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(eventName, eventData);
  }

  // Sticky 창들
  Object.values(stickyWindows).forEach(window => {
    if (window && !window.isDestroyed()) {
      window.webContents.send(eventName, eventData);
    }
  });

  // Memo Sub 창들
  Object.values(memoSubWindows).forEach(window => {
    if (window && !window.isDestroyed()) {
      window.webContents.send(eventName, eventData);
    }
  });
}

function setupWebSocketEventListeners() {
  if (!socket) return;

  const RELAY_EVENTS = [
    'memo:created',
    'memo:updated',
    'memo:deleted',
    'consultation:created',
    'consultation:updated',
    'consultation:deleted',
    'schedule:created',
    'schedule:updated',
    'schedule:deleted',
    'email:created',
    'email:updated',
    'email:deleted'
  ];

  // 비즈니스 이벤트만 등록 (connect/disconnect는 connectWebSocket에서 처리)
  RELAY_EVENTS.forEach((eventName) => {
    socket.on(eventName, (eventData) => {
      console.log(`[WebSocket] Event received: ${eventName}`);
      broadcastToAllWindows(eventName, eventData);

      // 특정 이벤트에 대해 토스트 알림 생성 (메인 윈도우가 포커스 상태가 아닐 때만)
      if (eventName === 'consultation:created' && mainWindow && !mainWindow.isFocused()) {
        createToastNotification({
          icon: '📋',
          title: '새 홈페이지 상담',
          message: '새 홈페이지 상담이 접수되었습니다.',
          route: '/consultations/website',
          duration: 5000
        });
      } else if (eventName === 'email:created' && mainWindow && !mainWindow.isFocused()) {
        createToastNotification({
          icon: '📧',
          title: '새 이메일',
          message: '새 이메일이 도착했습니다.',
          route: '/consultations/email',
          duration: 5000
        });
      }
    });
  });
}

function getAuthTokenFromMainWindow() {
  // 메인 창에서 인증 정보 가져오기 (executeJavaScript 사용)
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      // localStorage에서 인증 정보를 가져오는 시도
      // 실제로는 preload를 통해 안전하게 가져와야 하지만,
      // 여기서는 간단하게 기본값 사용
      return {
        email: 'main-process@electron',
        provider: 'electron',
        displayName: 'Main Process'
      };
    } catch (e) {
      console.error('[WebSocket] Failed to get auth token:', e);
      return null;
    }
  }
  return null;
}

function connectWebSocket(config) {
  currentConfig = createAppConfig(config, config?.source || 'runtime');

  // 기존 heartbeat interval 정리
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // 기존 연결 정리
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  console.log(`[WebSocket] Connecting to ${currentConfig.wsBaseUrl} (${currentConfig.environment})`);

  socket = io(currentConfig.wsBaseUrl, {
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnection: true,
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log('[WebSocket] Connected to relay server');

    // 연결 상태 브로드캐스트
    broadcastToAllWindows('websocket-status-changed', {
      connected: true,
      environment: currentConfig.environment
    });

    const user = getAuthTokenFromMainWindow();

    socket.emit('handshake', {
      type: 'client',
      metadata: {
        environment: currentConfig.environment,
        email: user?.email || 'main-process',
        provider: user?.provider || 'electron',
        displayName: user?.displayName || 'Main Process',
        connectedAt: new Date().toISOString()
      }
    });
  });

  socket.on('handshake:success', (data) => {
    console.log('[WebSocket] Handshake successful:', data);
  });

  socket.on('disconnect', (reason) => {
    console.log('[WebSocket] Disconnected:', reason);

    // 연결 해제 상태 브로드캐스트
    broadcastToAllWindows('websocket-status-changed', {
      connected: false,
      environment: currentConfig.environment
    });
  });

  socket.on('connect_error', (error) => {
    console.error('[WebSocket] Connection error:', error.message);
  });

  // Heartbeat
  heartbeatInterval = setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('heartbeat');
    }
  }, 30000);

  // 이벤트 리스너 등록
  setupWebSocketEventListeners();
}

// AutoUpdater 초기화 함수 (app.whenReady() 이후에 호출)
function initAutoUpdater() {
  logUpdate(`initAutoUpdater called. app.isPackaged: ${app.isPackaged}`);

  // 개발 모드에서는 electron-updater 로드하지 않음
  if (!app.isPackaged) {
    logUpdate('Skipping in development mode');
    return;
  }

  try {
    logUpdate('Loading electron-updater...');
    autoUpdater = require('electron-updater').autoUpdater;
    logUpdate('electron-updater loaded successfully');
  } catch (e) {
    logUpdate(`Failed to load electron-updater: ${e.message}\n${e.stack}`);
    return;
  }

  autoUpdater.autoDownload = false;  // 사용자가 확인 후 다운로드
  autoUpdater.autoInstallOnAppQuit = false;  // 수동 설치 제어

  autoUpdater.on('checking-for-update', () => {
    logUpdate('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    const version = info?.version || 'unknown';
    logUpdate(`Update available: ${version}`);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', { version, releaseNotes: info?.releaseNotes || '' });
    }
    // 자동 다운로드 제거 - UI에서 사용자가 결정
  });

  autoUpdater.on('update-not-available', () => {
    const currentVersion = app.getVersion();
    logUpdate(`No update available. Current version: ${currentVersion} is latest.`);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-not-available', { currentVersion });
    }
  });

  autoUpdater.on('error', (error) => {
    logUpdate(`Update error: ${error.message}`);
    isUpdateDownloading = false;  // 다운로드 상태 리셋

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', { message: error.message });
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    logUpdate(`Download progress: ${progressObj.percent.toFixed(1)}%`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', {
        percent: progressObj.percent,
        bytesPerSecond: progressObj.bytesPerSecond,
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    const version = info?.version || 'unknown';
    logUpdate(`Update downloaded: ${version}`);
    isUpdateDownloading = false;  // 다운로드 완료

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', { version });
    }

    // 모달에서 재시작 처리 (dialog 제거)
  });

  console.log('[AutoUpdater] Initialized successfully');
}

// Load sticky window settings
function loadStickySettings(type) {
  try {
    const settingsPath = getStickySettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(data);
      return settings[type] || null;
    }
  } catch (error) {
    console.error('[Sticky Settings] Failed to load settings:', error);
  }
  return null;
}

// Save sticky window settings
function saveStickySettings(type, settings) {
  try {
    const settingsPath = getStickySettingsPath();
    let allSettings = {};
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      allSettings = JSON.parse(data);
    }
    allSettings[type] = settings;
    fs.writeFileSync(settingsPath, JSON.stringify(allSettings, null, 2));
    console.log(`[Sticky Settings] Saved settings for ${type}:`, settings);
  } catch (error) {
    console.error('[Sticky Settings] Failed to save settings:', error);
  }
}

function createWindow() {
  // 메뉴바 완전히 제거
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    frame: false, // Windows 기본 타이틀바 제거
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false, // Allow loading images from external URLs (Google Cloud Storage)
    },
    icon: path.join(__dirname, 'icon.png'),
  });

  // 개발 모드: Vite 개발 서버 로드
  console.log('=== Electron 로드 모드 확인 ===');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('app.isPackaged:', app.isPackaged);
  console.log('__dirname:', __dirname);

  if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
    console.log('-> 개발 모드: Vite 서버 로드');
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools(); // 개발 시 필요하면 주석 해제
  } else {
    // 프로덕션: 빌드된 파일 로드
    const distPath = path.join(__dirname, '../dist/index.html');
    console.log('-> 프로덕션 모드: 파일 로드');
    console.log('   파일 경로:', distPath);
    console.log('   파일 존재:', fs.existsSync(distPath));
    mainWindow.loadFile(distPath);
    // mainWindow.webContents.openDevTools(); // 디버깅 시 필요하면 주석 해제
  }

  // DevTools 단축키 활성화
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 네이티브 close 이벤트 처리 (X 버튼, Alt+F4, NSIS 설치기 등)
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      // 종료 요청이 아니면 숨김 (트레이 모드)
      event.preventDefault();
      mainWindow.hide();
      console.log('[Main] Window hidden to tray');
    }
    // app.isQuitting이 true면 정상 종료 허용
  });

  // 새 창 열기 요청 가로채기 (외부 링크 클릭 시)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Main] Window open request:', url);
    // 외부 URL은 시스템 브라우저로 열기
    shell.openExternal(url);
    return { action: 'deny' }; // Electron 새 창은 열지 않음
  });

  // Create system tray
  createTray();
}

// Create system tray
function createTray() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'icon.ico')
    : path.join(__dirname, 'icon.png');

  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '열기',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      type: 'separator'
    },
    {
      label: '종료',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('APS 컨설팅');
  tray.setContextMenu(contextMenu);

  // 트레이 아이콘 더블클릭 시 창 표시
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

// 세션 정리 (로그아웃 시 사용)
ipcMain.handle('clear-session', async () => {
  if (mainWindow) {
    await session.defaultSession.clearStorageData({
      storages: ['cookies', 'localstorage'],
    });
    return { success: true };
  }
  return { success: false };
});

// 인증 토큰 가져오기 (sticky 윈도우용)
ipcMain.handle('get-auth-token', async () => {
  try {
    // 메인 윈도우의 localStorage에서 인증 정보 가져오기
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not found' };
    }

    const userDataStr = await mainWindow.webContents.executeJavaScript(`
      localStorage.getItem('aps-local-auth-user')
    `);

    if (!userDataStr) {
      return { success: false, error: 'No auth data found' };
    }

    const userData = JSON.parse(userDataStr);
    return {
      success: true,
      user: {
        email: userData.email,
        displayName: userData.displayName,
        provider: userData.provider,
        idToken: userData.idToken,
        accessToken: userData.accessToken
      }
    };
  } catch (error) {
    console.error('[Main] Failed to get auth token:', error);
    return { success: false, error: error.message };
  }
});

// ============================================
// Environment 설정 IPC 핸들러
// ============================================
ipcMain.handle('get-environment', async () => {
  return currentConfig?.environment || 'production';
});

ipcMain.handle('set-environment', async (event, environment) => {
  const baseConfig = currentConfig || loadConfig();
  console.log(`[Config] Changing environment: ${baseConfig.environment} → ${environment}`);

  const newConfig = createAppConfig({ ...baseConfig, environment }, 'userData');
  saveConfig(newConfig);

  // WebSocket 재연결
  connectWebSocket(newConfig);

  // 모든 창에 알림
  broadcastToAllWindows('environment-changed', { environment });

  return { success: true, environment };
});

ipcMain.handle('set-websocket-url', async (event, url) => {
  try {
    const wsBaseUrl = normalizeWebSocketUrl(url);
    const baseConfig = currentConfig || loadConfig();

    if (baseConfig.wsBaseUrl === wsBaseUrl) {
      return { success: true, url: wsBaseUrl, changed: false, config: baseConfig };
    }

    const newConfig = createAppConfig({ ...baseConfig, wsBaseUrl }, 'userData');
    saveConfig(newConfig);
    connectWebSocket(newConfig);

    broadcastToAllWindows('app-config-changed', newConfig);

    return { success: true, url: wsBaseUrl, changed: true, config: newConfig };
  } catch (error) {
    console.error('[Config] Failed to set WebSocket URL:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-backend-urls', async (event, { apiUrl, wsUrl } = {}) => {
  try {
    if (!apiUrl || !wsUrl) {
      throw new Error('apiUrl and wsUrl are required');
    }

    const normalizedApiUrl = normalizeHttpUrl(apiUrl);
    const wsBaseUrl = normalizeWebSocketUrl(wsUrl);
    const baseConfig = currentConfig || loadConfig();
    const changed = baseConfig.restBaseUrl !== normalizedApiUrl || baseConfig.wsBaseUrl !== wsBaseUrl;

    if (!changed) {
      return { success: true, apiUrl: normalizedApiUrl, wsUrl: wsBaseUrl, changed: false, config: baseConfig };
    }

    const newConfig = createAppConfig({
      ...baseConfig,
      restBaseUrl: normalizedApiUrl,
      wsBaseUrl,
    }, 'userData');

    saveConfig(newConfig);

    if (baseConfig.wsBaseUrl !== wsBaseUrl) {
      connectWebSocket(newConfig);
    } else {
      currentConfig = newConfig;
    }

    broadcastToAllWindows('app-config-changed', newConfig);

    return { success: true, apiUrl: normalizedApiUrl, wsUrl: wsBaseUrl, changed: true, config: newConfig };
  } catch (error) {
    console.error('[Config] Failed to set backend URLs:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-app-config', async () => {
  if (!currentConfig) currentConfig = loadConfig();
  return currentConfig;
});

ipcMain.handle('set-app-config', async (event, configPatch = {}) => {
  try {
    const baseConfig = currentConfig || loadConfig();
    const mergedConfig = { ...baseConfig, ...configPatch };
    const restUrlChanged = Boolean(configPatch.restBaseUrl || configPatch.apiUrl);
    const explicitWsUrl = Boolean(configPatch.wsBaseUrl || configPatch.wsRelayUrl || configPatch.wsUrl);

    if (restUrlChanged && !explicitWsUrl && baseConfig.wsDerivedFromRest) {
      delete mergedConfig.wsBaseUrl;
      delete mergedConfig.wsRelayUrl;
      delete mergedConfig.wsUrl;
    }

    const newConfig = createAppConfig(mergedConfig, 'userData');
    const wsChanged = baseConfig.wsBaseUrl !== newConfig.wsBaseUrl;

    saveConfig(newConfig);

    if (wsChanged) {
      connectWebSocket(newConfig);
    } else {
      currentConfig = newConfig;
    }

    broadcastToAllWindows('app-config-changed', newConfig);
    return { success: true, config: newConfig };
  } catch (error) {
    console.error('[Config] Failed to set app config:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-config', async () => {
  if (!currentConfig) currentConfig = loadConfig();
  return currentConfig;
});

ipcMain.handle('get-websocket-status', async () => {
  return {
    connected: socket?.connected || false,
    environment: currentConfig?.environment || 'production',
    url: currentConfig?.wsBaseUrl || getDefaultConfig().wsBaseUrl
  };
});

// 윈도우 제어 IPC 핸들러
ipcMain.handle('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) {
    // 창을 완전히 닫지 않고 숨김 (백그라운드 실행)
    mainWindow.hide();
  }
});

// Sticky Window 관리
ipcMain.handle('open-sticky-window', async (event, { type, title, data, reset = false }) => {
  // 이미 열려있는 경우
  if (stickyWindows[type] && !stickyWindows[type].isDestroyed()) {
    if (reset) {
      // 리셋 모드: 기존 창 닫고 설정 삭제 후 재생성
      console.log(`[Sticky] Resetting sticky window: ${type}`);
      const oldWindow = stickyWindows[type];
      delete stickyWindows[type];  // 먼저 stickyWindows에서 제거
      oldWindow.removeAllListeners('closed');  // 이벤트 리스너 제거
      oldWindow.close();  // 그 다음 창 닫기

      // 저장된 설정 삭제
      try {
        const settingsPath = getStickySettingsPath();
        if (fs.existsSync(settingsPath)) {
          const data = fs.readFileSync(settingsPath, 'utf8');
          const allSettings = JSON.parse(data);
          delete allSettings[type];
          fs.writeFileSync(settingsPath, JSON.stringify(allSettings, null, 2));
          console.log(`[Sticky Settings] Deleted settings for ${type}`);
        }
      } catch (error) {
        console.error('[Sticky Settings] Failed to delete settings:', error);
      }
      // 아래에서 새 창 생성
    } else {
      // 일반 모드: 포커스만
      stickyWindows[type].focus();
      return { success: true, alreadyOpen: true };
    }
  }

  // Load saved settings (position, opacity)
  const savedSettings = loadStickySettings(type);
  const defaultX = 100;
  const defaultY = 100;
  const defaultOpacity = 1.0;

  const stickyWindow = new BrowserWindow({
    width: 300,
    height: 200,
    x: savedSettings?.x || defaultX,
    y: savedSettings?.y || defaultY,
    frame: false,
    alwaysOnTop: true,
    show: false, // 크기 조정 후 표시
    resizable: true, // setSize() 호출을 위해 true로 설정
    minWidth: 300,
    maxWidth: 300,
    opacity: savedSettings?.opacity || defaultOpacity,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Save position when window is moved
  stickyWindow.on('moved', () => {
    const [x, y] = stickyWindow.getPosition();
    const opacity = stickyWindow.getOpacity();
    saveStickySettings(type, { x, y, opacity });
  });

  // type만 URL 파라미터로 전달 (cachedData는 IPC로 전달 — URL 431 에러 방지)
  const queryParams = `type=${type}`;

  // 개발 모드와 프로덕션 모드 분기
  if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
    console.log('[Sticky] 개발 모드: Vite 서버에서 로드');
    stickyWindow.loadURL(`http://localhost:5173/sticky.html?${queryParams}`);
    // stickyWindow.webContents.openDevTools({ mode: 'detach' }); // 개발 시 필요하면 주석 해제
  } else {
    const stickyPath = path.join(__dirname, '../dist/sticky.html');
    console.log('[Sticky] 프로덕션 모드: 파일에서 로드');
    console.log('[Sticky] 파일 경로:', stickyPath);
    console.log('[Sticky] 파일 존재:', fs.existsSync(stickyPath));
    stickyWindow.loadFile(stickyPath, {
      search: queryParams
    });
    // stickyWindow.webContents.openDevTools({ mode: 'detach' }); // 디버깅 시 필요하면 주석 해제
  }

  stickyWindows[type] = stickyWindow;
  console.log(`[Sticky] Registered sticky window: ${type}, current keys:`, Object.keys(stickyWindows));

  // 에러 핸들링 추가
  stickyWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[Sticky] Failed to load: ${errorCode} - ${errorDescription}`);
  });

  stickyWindow.webContents.on('did-finish-load', () => {
    console.log(`[Sticky] Successfully loaded: ${type}`);
    // 로드 완료 후 캐시 데이터를 IPC로 전달
    if (data) {
      stickyWindow.webContents.send('sticky-cached-data', data);
      console.log(`[Sticky] Sent cached data via IPC: ${type}`);
    }
    stickyWindow.show();
    console.log(`[Sticky] Window shown: ${type}`);
  });

  stickyWindow.on('closed', () => {
    console.log(`[Sticky] Closing sticky window: ${type}`);
    delete stickyWindows[type];
    console.log(`[Sticky] After close, remaining keys:`, Object.keys(stickyWindows));
  });

  console.log(`[Sticky] Opened sticky window: ${type}, reset: ${reset}`);
  return { success: true, alreadyOpen: false, wasReset: reset };
});

ipcMain.handle('close-sticky-window', async (event, type) => {
  if (stickyWindows[type] && !stickyWindows[type].isDestroyed()) {
    stickyWindows[type].close();
    delete stickyWindows[type];
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('is-sticky-window-open', async (event, type) => {
  return !!(stickyWindows[type] && !stickyWindows[type].isDestroyed());
});

ipcMain.handle('resize-sticky-window', async (event, { width, height }) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    console.log(`[Sticky] Resizing window to ${width}x${height}`);
    senderWindow.setSize(width, height);
    console.log('[Sticky] Window resized successfully');
    return { success: true };
  }
  console.error('[Sticky] Resize failed: sender window not found');
  return { success: false };
});

ipcMain.handle('show-sticky-window', async (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    senderWindow.show();
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('set-window-opacity', async (event, opacity) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    senderWindow.setOpacity(opacity);

    // Save opacity setting immediately
    for (const [type, window] of Object.entries(stickyWindows)) {
      if (window === senderWindow) {
        const [x, y] = senderWindow.getPosition();
        const currentOpacity = senderWindow.getOpacity(); // Get current opacity
        saveStickySettings(type, { x, y, opacity: currentOpacity });
        console.log(`[Sticky] Opacity saved for ${type}: ${currentOpacity}`);
        break;
      }
    }

    return { success: true };
  }
  return { success: false };
});

// Get window opacity
ipcMain.handle('get-window-opacity', async (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    const opacity = senderWindow.getOpacity();
    console.log(`[Sticky] Current opacity: ${opacity}`);
    return opacity;
  }
  return 1.0; // Default opacity
});

// Close all sticky windows (called on logout)
ipcMain.handle('close-all-sticky-windows', async () => {
  try {
    const types = Object.keys(stickyWindows);
    for (const type of types) {
      if (stickyWindows[type] && !stickyWindows[type].isDestroyed()) {
        stickyWindows[type].close();
      }
    }
    stickyWindows = {};
    return { success: true, count: types.length };
  } catch (error) {
    console.error('[Sticky Windows] Failed to close all windows:', error);
    return { success: false, error: error.message };
  }
});

// 메인 창 포커스 및 특정 경로로 이동
ipcMain.handle('focus-main-window', async (event, route) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // 최소화된 경우 복원
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      // 창을 앞으로 가져오기
      mainWindow.show();
      mainWindow.focus();

      // 라우트 변경 (route가 제공된 경우)
      if (route) {
        console.log(`[Main] Navigating to route: ${route}`);
        mainWindow.webContents.send('navigate-to-route', route);
      }

      // Sticky 창들이 사라지지 않도록 다시 최상단으로
      Object.values(stickyWindows).forEach(stickyWindow => {
        if (stickyWindow && !stickyWindow.isDestroyed()) {
          stickyWindow.setAlwaysOnTop(true);
        }
      });

      return { success: true };
    }
    return { success: false, error: 'Main window not found' };
  } catch (error) {
    console.error('[Main] Failed to focus main window:', error);
    return { success: false, error: error.message };
  }
});

// 외부 브라우저에서 URL 열기
ipcMain.handle('open-external-url', async (event, url) => {
  try {
    console.log(`[Main] Opening external URL: ${url}`);
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('[Main] Failed to open external URL:', error);
    return { success: false, error: error.message };
  }
});

// 파일 다운로드 (리다이렉트 지원)
ipcMain.handle('download-file', async (event, { url, filename }) => {
  try {
    console.log(`[Main] Downloading file: ${filename} from ${url}`);
    const { dialog } = require('electron');
    const https = require('https');
    const http = require('http');

    // 다운로드 경로 선택 (먼저 파일 탐색기 띄움)
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    // URL에서 파일 다운로드 (리다이렉트 따라가기)
    const downloadWithRedirect = (downloadUrl, maxRedirects = 5) => {
      return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }

        const protocol = downloadUrl.startsWith('https') ? https : http;

        protocol.get(downloadUrl, (response) => {
          // 리다이렉트 처리 (301, 302, 303, 307, 308)
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            const redirectUrl = response.headers.location;
            console.log(`[Main] Redirecting to: ${redirectUrl}`);
            downloadWithRedirect(redirectUrl, maxRedirects - 1)
              .then(resolve)
              .catch(reject);
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          const file = fs.createWriteStream(filePath);
          response.pipe(file);

          file.on('finish', () => {
            file.close();
            console.log(`[Main] File downloaded successfully: ${filePath}`);
            resolve({ success: true, filePath });
          });

          file.on('error', (err) => {
            fs.unlink(filePath, () => {});
            reject(err);
          });
        }).on('error', (error) => {
          fs.unlink(filePath, () => {});
          reject(error);
        });
      });
    };

    return await downloadWithRedirect(url);
  } catch (error) {
    console.error('[Main] Failed to download file:', error);
    return { success: false, error: error.message };
  }
});

// Blob/Buffer 데이터를 파일로 저장 (인증이 필요한 다운로드용)
ipcMain.handle('save-file', async (event, { buffer, filename }) => {
  try {
    console.log(`[Main] Saving file: ${filename}`);
    const { dialog } = require('electron');

    // 다운로드 경로 선택
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    // Buffer 데이터를 파일로 저장
    fs.writeFileSync(filePath, Buffer.from(buffer));
    console.log(`[Main] File saved successfully: ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    console.error('[Main] Failed to save file:', error);
    return { success: false, error: error.message };
  }
});

// 메모 서브 윈도우 열기 (알림창 옆에 배치)
ipcMain.handle('open-memo-sub-window', async (event, { mode, memoId }) => {
  console.log('[Main] open-memo-sub-window called:', { mode, memoId });
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) {
    console.error('[Main] Parent window not found');
    return { success: false, error: 'Parent window not found' };
  }

  // 부모 창 타입 찾기 (stickyWindows에서)
  console.log('[Main] Looking for parent type in stickyWindows:', Object.keys(stickyWindows));
  const parentType = Object.keys(stickyWindows).find(
    type => stickyWindows[type] === parentWindow
  );
  console.log('[Main] Found parentType:', parentType);
  if (!parentType) {
    console.error('[Main] Parent is not a sticky window');
    return { success: false, error: 'Parent is not a sticky window' };
  }

  // 이미 열려있으면 닫고 새로 열기
  if (memoSubWindows[parentType] && !memoSubWindows[parentType].isDestroyed()) {
    console.log(`[Main] Closing existing sub-window for ${parentType}`);
    memoSubWindows[parentType].close();
    delete memoSubWindows[parentType];
  }

  // 서브 윈도우 위치 계산
  const parentBounds = parentWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: parentBounds.x, y: parentBounds.y });
  const screenBounds = display.workArea;

  // 모드에 따라 크기 다르게 설정
  const subWidth = 450;
  const subHeight = mode === 'create' ? 650 : 550;
  const gap = 10;
  console.log(`[Main] Opening memo sub-window - mode: ${mode}, size: ${subWidth}x${subHeight}`);

  let x, y;

  // 부모 창의 중심이 화면 왼쪽에 있으면 오른쪽에 배치
  if (parentBounds.x + parentBounds.width / 2 < screenBounds.x + screenBounds.width / 2) {
    x = parentBounds.x + parentBounds.width + gap;
    // 화면 오른쪽 경계 체크
    if (x + subWidth > screenBounds.x + screenBounds.width) {
      x = parentBounds.x - subWidth - gap; // 왼쪽에 배치
    }
  } else {
    x = parentBounds.x - subWidth - gap;
    // 화면 왼쪽 경계 체크
    if (x < screenBounds.x) {
      x = parentBounds.x + parentBounds.width + gap; // 오른쪽에 배치
    }
  }

  y = parentBounds.y;

  // 서브 윈도우 생성
  const subWindow = new BrowserWindow({
    width: subWidth,
    height: subHeight,
    x: x,
    y: y,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    parent: parentWindow,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // URL 구성
  const queryParams = mode === 'view' ? `mode=view&id=${memoId}` : 'mode=create';

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    subWindow.loadURL(`http://localhost:5173/memo-detail.html?${queryParams}`);
    // subWindow.webContents.openDevTools({ mode: 'detach' }); // 개발 시 필요하면 주석 해제
  } else {
    subWindow.loadFile(path.join(__dirname, '../dist/memo-detail.html'), {
      query: Object.fromEntries(new URLSearchParams(queryParams))
    });
    // subWindow.webContents.openDevTools({ mode: 'detach' }); // 디버깅 시 필요하면 주석 해제
  }

  memoSubWindows[parentType] = subWindow;

  // 서브 윈도우 닫힐 때 정리
  subWindow.on('closed', () => {
    delete memoSubWindows[parentType];
  });

  // 부모 윈도우 닫힐 때 서브 윈도우도 닫기
  // NOTE: .once() 사용하여 리스너 누적 방지
  const onParentClosed = () => {
    if (memoSubWindows[parentType] && !memoSubWindows[parentType].isDestroyed()) {
      memoSubWindows[parentType].close();
    }
  };
  parentWindow.once('closed', onParentClosed);

  return { success: true, alreadyOpen: false };
});

// Toast 알림창 생성 함수
function createToastNotification(data) {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const NOTIFICATION_WIDTH = 320;
  const NOTIFICATION_MIN_HEIGHT = 110;
  const NOTIFICATION_MAX_HEIGHT = 300; // 최대 높이 증가 (180 -> 300)
  const MARGIN = 20;
  const STACK_SPACING = 10;

  // 파괴된 알림 정리 (메모리 누수 방지)
  toastNotifications = toastNotifications.filter(win => !win.isDestroyed());

  // 최대 동시 표시 알림: 3개로 제한
  if (toastNotifications.length >= 3) {
    const oldest = toastNotifications[0];
    if (oldest && !oldest.isDestroyed()) {
      oldest.close();
    }
    toastNotifications.shift();
  }

  // 스택 인덱스 계산
  const stackIndex = toastNotifications.length;

  // 메시지 길이에 따른 높이 추정 (줄바꿈 포함)
  const messageLines = (data.message || '').split('\n').length;
  const estimatedHeight = Math.min(
    NOTIFICATION_MAX_HEIGHT,
    Math.max(NOTIFICATION_MIN_HEIGHT, 70 + (messageLines * 24))
  );

  // 이전 알림들의 실제 높이 누적
  let previousHeights = 0;
  for (let i = 0; i < stackIndex; i++) {
    if (toastNotifications[i] && !toastNotifications[i].isDestroyed()) {
      previousHeights += toastNotifications[i].getBounds().height + STACK_SPACING;
    }
  }

  // 우하단 위치 계산 (아래쪽 기준, 실제 높이 기반)
  const x = width - NOTIFICATION_WIDTH - MARGIN;
  const y = height - estimatedHeight - MARGIN - previousHeights;

  // URL 파라미터 생성
  const params = new URLSearchParams({
    icon: data.icon || '🔔',
    title: data.title || '알림',
    message: encodeURIComponent(data.message || '새로운 알림이 도착했습니다.'),
    route: data.route || '',
    duration: data.duration || 5000
  });

  const toastWindow = new BrowserWindow({
    width: NOTIFICATION_WIDTH,
    height: estimatedHeight,
    x: x,
    y: y,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    transparent: true,
    focusable: false,
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 개발 모드: Vite 개발 서버 로드
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    toastWindow.loadURL(`http://localhost:5173/toast-notification.html?${params.toString()}`);
  } else {
    // 프로덕션: 빌드된 파일 로드
    toastWindow.loadFile(path.join(__dirname, '../dist/toast-notification.html'), {
      search: params.toString()
    });
  }

  toastWindow.once('ready-to-show', () => {
    // 렌더러에서 실제 컨텐츠 높이를 측정한 후 윈도우 크기 조정
    toastWindow.webContents.executeJavaScript(`
      (async () => {
        // 폰트 로딩 대기
        await document.fonts.ready;

        // toast-container의 실제 높이 측정 (box-shadow, padding 포함)
        const container = document.querySelector('.toast-container');
        if (!container) {
          // 컨테이너가 없으면 기본 높이 반환
          return ${NOTIFICATION_MIN_HEIGHT};
        }
        const rect = container.getBoundingClientRect();

        // 추가 여유 공간 (box-shadow 등)
        const extraSpace = 30;

        return Math.ceil(rect.height) + extraSpace;
      })();
    `).then(contentHeight => {
      const actualHeight = Math.min(NOTIFICATION_MAX_HEIGHT, Math.max(NOTIFICATION_MIN_HEIGHT, contentHeight));
      const currentBounds = toastWindow.getBounds();

      // 아래쪽 기준으로 높이 조정 (y 위치를 위로 이동)
      const newY = currentBounds.y + currentBounds.height - actualHeight;

      toastWindow.setBounds({
        x: currentBounds.x,
        y: newY,
        width: NOTIFICATION_WIDTH,
        height: actualHeight
      }, true);

      console.log('[Toast] Resized - Content:', contentHeight, 'Actual:', actualHeight, 'Y:', newY);
      toastWindow.show();
    }).catch(err => {
      console.error('[Toast] Failed to measure content height:', err);
      toastWindow.show();
    });
  });

  // 배열에 추가
  toastNotifications.push(toastWindow);

  // 창이 닫힐 때 배열에서 제거 및 스택 재정렬
  toastWindow.on('closed', () => {
    const index = toastNotifications.indexOf(toastWindow);
    if (index > -1) {
      toastNotifications.splice(index, 1);
      repositionToasts();
    }
  });

  console.log('[Toast] Notification created:', data);
}

// 토스트 알림 재정렬
function repositionToasts() {
  // 파괴된 알림 정리 (메모리 누수 방지)
  toastNotifications = toastNotifications.filter(win => !win.isDestroyed());

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const NOTIFICATION_WIDTH = 320;
  const MARGIN = 20;
  const STACK_SPACING = 10;

  toastNotifications.forEach((toast, index) => {
    if (!toast.isDestroyed()) {
      const toastBounds = toast.getBounds();

      // 이전 알림들의 실제 높이 누적
      let previousHeights = 0;
      for (let i = 0; i < index; i++) {
        if (toastNotifications[i] && !toastNotifications[i].isDestroyed()) {
          previousHeights += toastNotifications[i].getBounds().height + STACK_SPACING;
        }
      }

      const x = width - NOTIFICATION_WIDTH - MARGIN;
      const y = height - toastBounds.height - MARGIN - previousHeights;
      toast.setPosition(x, y, true);
    }
  });
}

// Toast 알림창 표시 IPC 핸들러
ipcMain.handle('show-toast-notification', async (event, data) => {
  createToastNotification(data);
  return { success: true };
});

// Toast 알림창 닫기 IPC 핸들러
ipcMain.handle('close-notification', async (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    senderWindow.close();
  }
  return { success: true };
});

// Toast 알림에서 메인 창으로 네비게이션 IPC 핸들러
ipcMain.handle('navigate-from-notification', async (event, route) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('navigate-to', route);
  }
  return { success: true };
});

// 앱 버전 가져오기
ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

// 수동 업데이트 확인
ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) {
    return { success: false, error: 'AutoUpdater not available in development mode' };
  }
  logUpdate('Manual update check triggered');
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, result };
  } catch (err) {
    logUpdate(`Manual update check error: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// 앱 재시작
ipcMain.handle('restart-app', async () => {
  await gracefulShutdown();
  app.relaunch();
  app.quit();
});

// 업데이트 설치 및 재시작
ipcMain.handle('install-update', async () => {
  if (!autoUpdater) {
    return { success: false, error: 'AutoUpdater not available' };
  }

  logUpdate('User requested update installation');

  // NOTE: gracefulShutdown() 호출하면 안 됨!
  // quitAndInstall()이 앱 종료와 설치를 직접 처리함
  // gracefulShutdown()이 먼저 실행되면 autoUpdater가 제대로 작동하지 않음

  // 약간의 지연 후 설치 시작 (UI 응답 시간 확보)
  setTimeout(() => {
    // autoInstallOnAppQuit가 false이므로 직접 호출 필요
    // isSilent=false (설치 UI 표시), isForceRunAfter=true (설치 후 앱 재실행)
    autoUpdater.quitAndInstall(false, true);
  }, 500);

  return { success: true };
});

// 앱 완전 종료 (트레이 메뉴 또는 다른 곳에서 호출)
ipcMain.handle('quit-app', async () => {
  await gracefulShutdown();
  app.quit();
});

// 수동 업데이트 다운로드 (사용자 확인 후)
ipcMain.handle('download-update', async () => {
  if (!autoUpdater) {
    return { success: false, error: 'AutoUpdater not available' };
  }

  // 중복 다운로드 방지
  if (isUpdateDownloading) {
    logUpdate('Download already in progress, ignoring duplicate request');
    return { success: false, error: 'Download already in progress' };
  }

  logUpdate('Manual download triggered by user');
  isUpdateDownloading = true;

  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    isUpdateDownloading = false;
    logUpdate(`Download error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// ==================== 시작프로그램 설정 ====================
const STARTUP_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APP_NAME = 'APS Admin';

// 시작프로그램 등록 여부 확인
ipcMain.handle('get-startup-enabled', async () => {
  try {
    // Windows 전용
    if (process.platform !== 'win32') {
      return { success: false, error: 'Windows only feature' };
    }

    const { execSync } = require('child_process');
    const result = execSync(`reg query "${STARTUP_REG_KEY}" /v "${APP_NAME}" 2>nul`, {
      encoding: 'utf8',
      windowsHide: true
    });

    // 레지스트리 값이 존재하면 enabled
    return { success: true, enabled: result.includes(APP_NAME) };
  } catch (error) {
    // 레지스트리 키가 없으면 disabled
    return { success: true, enabled: false };
  }
});

// 시작프로그램 등록/해제
ipcMain.handle('set-startup-enabled', async (event, enabled) => {
  try {
    // Windows 전용
    if (process.platform !== 'win32') {
      return { success: false, error: 'Windows only feature' };
    }

    const { execSync } = require('child_process');
    const exePath = app.getPath('exe');

    if (enabled) {
      // 시작프로그램에 등록
      execSync(`reg add "${STARTUP_REG_KEY}" /v "${APP_NAME}" /t REG_SZ /d "\\"${exePath}\\"" /f`, {
        encoding: 'utf8',
        windowsHide: true
      });
      console.log('[Startup] Added to startup');
    } else {
      // 시작프로그램에서 제거
      execSync(`reg delete "${STARTUP_REG_KEY}" /v "${APP_NAME}" /f 2>nul`, {
        encoding: 'utf8',
        windowsHide: true
      });
      console.log('[Startup] Removed from startup');
    }

    return { success: true, enabled };
  } catch (error) {
    console.error('[Startup] Failed to set startup:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  // AutoUpdater 초기화 (app.isPackaged 접근 가능)
  initAutoUpdater();

  createWindow();

  // WebSocket 연결 초기화
  const config = loadConfig();
  connectWebSocket(config);

  // 프로덕션 환경에서만 업데이트 확인
  if (autoUpdater) {
    setTimeout(() => {
      logUpdate('Auto-checking for updates...');
      autoUpdater.checkForUpdates();
    }, 3000);
  }
});

// 외부(설치기/OS)에서 앱 종료 요청 시
app.on('before-quit', async (event) => {
  if (!app.isQuitting) {
    event.preventDefault();
    await gracefulShutdown();
    app.quit();
  }
});

// 최종 정리 (will-quit)
app.on('will-quit', () => {
  console.log('[App] will-quit: Final cleanup');
  // 혹시 남아있는 리소스 정리
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (socket) socket.disconnect();
  if (tray) tray.destroy();
});

// 두 번째 인스턴스 실행 시 (설치기가 새 인스턴스 시도)
app.on('second-instance', (event, commandLine) => {
  // 설치기/업데이트 요청 감지
  const isInstallerRequest = commandLine.some(arg =>
    arg.includes('--installer') ||
    arg.includes('--update') ||
    arg.includes('_iu') ||  // NSIS uninstall flag
    arg.includes('/S')      // Silent install flag
  );

  if (isInstallerRequest) {
    console.log('[App] Installer request detected, shutting down...');
    gracefulShutdown().then(() => app.quit());
    return;
  }

  // 일반적인 두 번째 인스턴스 - 기존 창 포커스
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  // 트레이로 백그라운드 실행 유지 (명시적 종료만 앱 종료)
  if (process.platform !== 'darwin' && app.isQuitting) {
    app.quit();
  }
  // 그 외에는 백그라운드에서 계속 실행
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
