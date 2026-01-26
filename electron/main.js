const { app, BrowserWindow, ipcMain, session, Menu, screen, shell, Tray, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const io = require('socket.io-client');

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
const DEFAULT_CONFIG = {
  environment: 'production',
  wsRelayUrl: 'ws://136.113.67.193:8080'
};

function getConfigPath() {
  return path.join(app.getPath('userData'), 'app-config.json');
}

function loadConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      console.log('[Config] Loaded configuration:', config);
      return config;
    } catch (e) {
      console.error('[Config] Failed to load config:', e);
    }
  }
  console.log('[Config] Using default configuration');
  return DEFAULT_CONFIG;
}

function saveConfig(config) {
  const configPath = getConfigPath();
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('[Config] Saved configuration:', config);
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

  RELAY_EVENTS.forEach((eventName) => {
    socket.on(eventName, (eventData) => {
      console.log(`[WebSocket] Event received: ${eventName}`);
      broadcastToAllWindows(eventName, eventData);
    });
  });

  // 연결 상태 이벤트
  socket.on('connect', () => {
    console.log('[WebSocket] Connected to relay server');
    broadcastToAllWindows('websocket-status-changed', {
      connected: true,
      environment: currentConfig.environment
    });
  });

  socket.on('disconnect', (reason) => {
    console.log('[WebSocket] Disconnected:', reason);
    broadcastToAllWindows('websocket-status-changed', {
      connected: false,
      environment: currentConfig.environment
    });
  });

  socket.on('connect_error', (error) => {
    console.error('[WebSocket] Connection error:', error.message);
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
  currentConfig = config;

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

  console.log(`[WebSocket] Connecting to ${config.wsRelayUrl} (${config.environment})`);

  socket = io(config.wsRelayUrl, {
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnection: true,
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log('[WebSocket] Connected to relay server');

    const user = getAuthTokenFromMainWindow();

    socket.emit('handshake', {
      type: 'client',
      metadata: {
        environment: config.environment,
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

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    logUpdate('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    const version = info?.version || 'unknown';
    logUpdate(`Update available: ${version}`);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', { version, releaseNotes: info?.releaseNotes || '' });
    }

    // 자동으로 다운로드 시작 (모달에서 진행 상황 표시)
    logUpdate('Starting automatic download');
    autoUpdater.downloadUpdate();
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
  console.log(`[Config] Changing environment: ${currentConfig.environment} → ${environment}`);

  const newConfig = { ...currentConfig, environment };
  saveConfig(newConfig);

  // WebSocket 재연결
  connectWebSocket(newConfig);

  // 모든 창에 알림
  broadcastToAllWindows('environment-changed', { environment });

  return { success: true, environment };
});

ipcMain.handle('get-config', async () => {
  return currentConfig;
});

ipcMain.handle('get-websocket-status', async () => {
  return {
    connected: socket?.connected || false,
    environment: currentConfig?.environment || 'production',
    url: currentConfig?.wsRelayUrl || 'ws://136.113.67.193:8080'
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

  // 캐시 데이터를 URL 파라미터로 인코딩
  const cachedDataParam = data ? `cachedData=${encodeURIComponent(JSON.stringify(data))}` : '';
  const typeParam = `type=${type}`;
  const queryParams = cachedDataParam ? `${typeParam}&${cachedDataParam}` : typeParam;

  // 개발 모드와 프로덕션 모드 분기
  if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
    console.log('[Sticky] 개발 모드: Vite 서버에서 로드');
    stickyWindow.loadURL(`http://localhost:5173/sticky.html?${queryParams}`);
    // stickyWindow.webContents.openDevTools({ mode: 'detach' }); // 개발 시 필요하면 주석 해제
  } else {
    // 프로덕션에서는 file:// 프로토콜이므로 URL 파라미터 전달 방식 다름
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
    // 로드 완료 후 윈도우 표시
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

// 메모 생성 브로드캐스트
// ============================================
// IPC 브로드캐스트 핸들러 제거됨
// WebSocket 이벤트가 Main Process를 통해 자동으로 모든 창에 전달됨
// ============================================

// Sticky 창 동기화를 위한 IPC 리스너 유지 (Sticky → Main 네비게이션용)
// onMemoCreated, onMemoDeleted, onConsultationUpdated는 preload.js에서 계속 사용
    }
  });
  return { success: true };
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
  parentWindow.on('closed', () => {
    if (memoSubWindows[parentType] && !memoSubWindows[parentType].isDestroyed()) {
      memoSubWindows[parentType].close();
    }
  });

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
  app.relaunch();
  app.exit(0);
});

// 업데이트 설치 및 재시작
ipcMain.handle('install-update', async () => {
  if (autoUpdater) {
    logUpdate('User requested update installation');

    // 업데이트 설치 전 모든 리소스 정리
    app.isQuitting = true;

    // 모든 Sticky 윈도우 닫기
    Object.values(stickyWindows).forEach(win => {
      if (win && !win.isDestroyed()) win.close();
    });
    stickyWindows = {};

    // 메모 서브 윈도우 닫기
    Object.values(memoSubWindows).forEach(win => {
      if (win && !win.isDestroyed()) win.close();
    });
    memoSubWindows = {};

    // Toast 알림 닫기
    toastNotifications.forEach(win => {
      if (win && !win.isDestroyed()) win.close();
    });
    toastNotifications = [];

    // 트레이 제거
    if (tray) {
      tray.destroy();
      tray = null;
    }

    // 메인 윈도우는 마지막에 닫기 (약간의 딜레이)
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    }, 200);

    // 약간의 딜레이 후 설치 시작 (윈도우 정리 완료 대기)
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 500);

    return { success: true };
  }
  return { success: false, error: 'AutoUpdater not available' };
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
