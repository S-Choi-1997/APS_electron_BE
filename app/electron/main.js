const { app, BrowserWindow, ipcMain, session, Menu, screen, shell, Tray, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  createAppConfig,
  getConfigPath,
  getDefaultConfig,
  loadConfig,
  saveConfig,
} = require('./app-config');
const {
  createWebSocketManager,
  normalizeRendererAuthSession,
} = require('./websocket-manager');
const { createAutoUpdaterManager } = require('./auto-updater-manager');
const { registerConfigIpcHandlers } = require('./config-ipc');
const { registerFileIpcHandlers } = require('./file-ipc');
const { registerStartupIpcHandlers } = require('./startup-ipc');
const {
  normalizeDownloadUrl,
  normalizeExternalUrl,
  registerIpcHandler,
} = require('./ipc-helpers');
const {
  createRendererWebPreferences,
  getIconPath,
  loadMainRenderer,
  loadRendererRoute,
} = require('./window-loader');

const APP_NAME = 'APS Admin';
const APP_USER_MODEL_ID = 'kr.apsconsulting.admin';
const APP_ROUTES = {
  DASHBOARD: '/',
  WEBSITE_CONSULTATIONS: '/consultations/website',
  EMAIL_CONSULTATIONS: '/consultations/email',
};

app.setName(APP_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// 단일 인스턴스 잠금 (설치기가 새 인스턴스 실행 시 기존 앱 종료 유도)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 이미 실행 중인 인스턴스가 있으면 즉시 종료
  app.quit();
  process.exit(0);
}

let mainWindow;
let tray = null; // System tray
let stickyWindows = {}; // { type: BrowserWindow }
let memoSubWindows = {}; // { stickyType: BrowserWindow }
let toastNotifications = []; // Toast 알림창 배열 (스택 관리 용)
let pendingNavigationRoute = null;

let rendererAuthSession = null;

// Lazy getters for paths (app.getPath는 app ready 이후에만 사용 가능)
let _stickySettingsPath = null;
let _updateLogPath = null;

function sendToMainWindow(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const send = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function normalizeNavigationRoute(route) {
  const routeValue = typeof route === 'string' ? route.trim() : '';
  if (!routeValue) return '/';

  return routeValue.startsWith('/') ? routeValue : `/${routeValue}`;
}

function sendNavigationRoute(route) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, error: '메인 창을 찾지 못했습니다.', route: normalizeNavigationRoute(route) };
  }

  const normalizedRoute = normalizeNavigationRoute(route);
  pendingNavigationRoute = normalizedRoute;

  const send = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    console.log(`[Main] Sending navigation route: ${normalizedRoute}`);
    mainWindow.webContents.send('navigate-to-route', normalizedRoute);
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }

  return { success: true, route: normalizedRoute };
}

/**
 * Graceful Shutdown - 모든 리소스를 정리하고 앱을 종료하는 함수
 * NSIS 설치기 호환성을 위해 필수
 */
async function gracefulShutdown() {
  console.log('[Shutdown] Starting graceful shutdown...');
  app.isQuitting = true;

  // 1. Heartbeat/WebSocket 정리
  webSocketManager.shutdown();
  console.log('[Shutdown] WebSocket disconnected');
  autoUpdateManager.shutdown();

  // 2. Toast 알림 정리
  toastNotifications.forEach(win => {
    if (win && !win.isDestroyed()) win.destroy();
  });
  toastNotifications = [];
  console.log('[Shutdown] Toast notifications closed');

  // 3. Memo sub windows 정리
  Object.values(memoSubWindows).forEach(win => {
    if (win && !win.isDestroyed()) win.destroy();
  });
  memoSubWindows = {};
  console.log('[Shutdown] Memo sub windows closed');

  // 4. Sticky windows 정리
  Object.values(stickyWindows).forEach(win => {
    if (win && !win.isDestroyed()) win.destroy();
  });
  stickyWindows = {};
  console.log('[Shutdown] Sticky windows closed');

  // 5. Tray 정리
  if (tray) {
    tray.destroy();
    tray = null;
    console.log('[Shutdown] Tray destroyed');
  }

  // 6. Main window 정리
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

async function getSocketAuthFromMainWindow() {
  return rendererAuthSession;
}

const webSocketManager = createWebSocketManager({
  broadcastToAllWindows,
  createAppConfig,
  getAuthSession: getSocketAuthFromMainWindow,
  getDefaultConfig,
});

registerConfigIpcHandlers({
  ipcMain,
  broadcastToAllWindows,
  createAppConfig,
  getConfigPath,
  getDefaultConfig,
  getSocketAuth: getSocketAuthFromMainWindow,
  loadConfig,
  saveConfig,
  webSocketManager,
});

registerFileIpcHandlers({
  dialog,
  getMainWindow: () => mainWindow,
  ipcMain,
  normalizeDownloadUrl,
  registerIpcHandler,
});

const autoUpdateManager = createAutoUpdaterManager({
  app,
  getUpdateLogPath,
  sendToMainWindow,
});
autoUpdateManager.registerIpcHandlers(ipcMain);

registerStartupIpcHandlers({
  app,
  appName: APP_NAME,
  ipcMain,
});

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
    webPreferences: createRendererWebPreferences({
      webSecurity: false, // Allow loading images from external URLs (Google Cloud Storage)
    }),
    icon: getIconPath('icon.png'),
  });

  loadMainRenderer(mainWindow);
  // mainWindow.webContents.openDevTools(); // 개발/디버깅 시 필요하면 주석 해제

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
    try {
      const safeUrl = normalizeExternalUrl(url);
      console.log('[Main] Window open request:', safeUrl);
      // 외부 URL은 시스템 브라우저로 열기
      shell.openExternal(safeUrl).catch((error) => {
        console.error('[Main] Failed to open external window URL:', error);
      });
    } catch (error) {
      console.warn('[Main] Blocked external window URL:', error.message);
    }
    return { action: 'deny' }; // Electron 새 창은 열지 않음
  });

  // Create system tray
  createTray();
}

// Create system tray
function createTray() {
  const iconPath = process.platform === 'win32'
    ? getIconPath('icon.ico')
    : getIconPath('icon.png');

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
  rendererAuthSession = null;
  if (mainWindow) {
    await session.defaultSession.clearStorageData({
      storages: ['cookies', 'localstorage'],
    });
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('set-auth-session', async (event, user) => {
  rendererAuthSession = normalizeRendererAuthSession(user);
  return {
    success: true,
    hasAuth: Boolean(rendererAuthSession),
  };
});

// 인증 토큰 가져오기 (sticky 윈도우용)
ipcMain.handle('get-auth-token', async () => {
  if (!rendererAuthSession) {
    return { success: false, error: '인증 정보를 찾지 못했습니다.' };
  }

  return {
    success: true,
    user: rendererAuthSession,
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

registerIpcHandler(ipcMain, 'close-current-window', ({ senderWindow }) => {
  senderWindow.close();
  return { success: true };
}, { requireSenderWindow: true });

// Sticky Window 관리
ipcMain.handle('open-sticky-window', async (event, { type, title, reset = false }) => {
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
  const minStickyOpacity = 0.2;
  const savedOpacity = Number(savedSettings?.opacity);
  const initialOpacity = Number.isFinite(savedOpacity)
    ? Math.min(1, Math.max(minStickyOpacity, savedOpacity))
    : defaultOpacity;

  const stickyWindow = new BrowserWindow({
    width: 300,
    height: 200,
    x: savedSettings?.x || defaultX,
    y: savedSettings?.y || defaultY,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    show: false, // 크기 조정 후 표시
    resizable: true, // setSize() 호출을 위해 true로 설정
    minWidth: 300,
    maxWidth: 300,
    opacity: initialOpacity,
    icon: getIconPath('icon.png'),
    webPreferences: createRendererWebPreferences(),
  });

  // Save position when window is moved
  stickyWindow.on('moved', () => {
    const [x, y] = stickyWindow.getPosition();
    const opacity = stickyWindow.getOpacity();
    saveStickySettings(type, { x, y, opacity });
  });

  // Sticky content is rendered by the shared React bundle.
  const stickyRoute = `/window/sticky/${encodeURIComponent(type || 'dashboard')}`;

  loadRendererRoute(stickyWindow, stickyRoute, { logPrefix: 'Sticky' });
  // stickyWindow.webContents.openDevTools({ mode: 'detach' }); // 디버깅 시 필요하면 주석 해제

  stickyWindows[type] = stickyWindow;
  console.log(`[Sticky] Registered sticky window: ${type}, current keys:`, Object.keys(stickyWindows));

  // 에러 핸들링 추가
  stickyWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[Sticky] Failed to load: ${errorCode} - ${errorDescription}`);
  });

  stickyWindow.webContents.on('did-finish-load', () => {
    console.log(`[Sticky] Successfully loaded: ${type}`);
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

registerIpcHandler(ipcMain, 'resize-sticky-window', async ({ senderWindow }, { width, height }) => {
  const safeWidth = Math.max(300, Math.min(300, Number(width) || 300));
  const safeHeight = Math.max(120, Math.min(900, Number(height) || 200));
  console.log(`[Sticky] Resizing window to ${safeWidth}x${safeHeight}`);
  senderWindow.setSize(safeWidth, safeHeight);
  console.log('[Sticky] Window resized successfully');
  return { success: true };
}, { requireSenderWindow: true });

registerIpcHandler(ipcMain, 'show-sticky-window', async ({ senderWindow }) => {
  senderWindow.show();
  return { success: true };
}, { requireSenderWindow: true });

registerIpcHandler(ipcMain, 'set-window-opacity', async ({ senderWindow }, opacity) => {
  const safeOpacity = Math.min(1, Math.max(0.2, Number(opacity) || 1));
  senderWindow.setOpacity(safeOpacity);

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
}, { requireSenderWindow: true });

// Get window opacity
registerIpcHandler(ipcMain, 'get-window-opacity', async ({ senderWindow }) => {
  const opacity = senderWindow.getOpacity();
  console.log(`[Sticky] Current opacity: ${opacity}`);
  return opacity;
}, { requireSenderWindow: true });

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
        sendNavigationRoute(route);
      }

      // Sticky 창들이 사라지지 않도록 다시 최상단으로
      Object.values(stickyWindows).forEach(stickyWindow => {
        if (stickyWindow && !stickyWindow.isDestroyed()) {
          stickyWindow.setAlwaysOnTop(true);
        }
      });

      return { success: true };
    }
    return { success: false, error: '메인 창을 찾지 못했습니다.' };
  } catch (error) {
    console.error('[Main] Failed to focus main window:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('consume-pending-navigation-route', async () => {
  const route = pendingNavigationRoute;
  pendingNavigationRoute = null;
  return route;
});

// 외부 브라우저에서 URL 열기
registerIpcHandler(ipcMain, 'open-external-url', async (_context, url) => {
  try {
    const safeUrl = normalizeExternalUrl(url);
    console.log(`[Main] Opening external URL: ${safeUrl}`);
    await shell.openExternal(safeUrl);
    return { success: true };
  } catch (error) {
    console.error('[Main] Failed to open external URL:', error);
    return { success: false, error: error.message };
  }
});

// 메모 서브 윈도우 열기 (알림창 옆에 배치)
registerIpcHandler(ipcMain, 'open-memo-sub-window', async ({ senderWindow: parentWindow }, { mode, memoId }) => {
  console.log('[Main] open-memo-sub-window called:', { mode, memoId });
  // 부모 창 타입 찾기 (stickyWindows에서)
  console.log('[Main] Looking for parent type in stickyWindows:', Object.keys(stickyWindows));
  const parentType = Object.keys(stickyWindows).find(
    type => stickyWindows[type] === parentWindow
  );
  console.log('[Main] Found parentType:', parentType);
  if (!parentType) {
    console.error('[Main] Parent is not a sticky window');
    return { success: false, error: '상위 창이 알림창이 아닙니다.' };
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
    icon: getIconPath('icon.png'),
    webPreferences: createRendererWebPreferences(),
  });

  // URL 구성
  const memoRoute = mode === 'view' && memoId
    ? `/window/memo/${encodeURIComponent(memoId)}`
    : '/window/memo/new';

  loadRendererRoute(subWindow, memoRoute, { looseDevelopmentRuntime: true });
  // subWindow.webContents.openDevTools({ mode: 'detach' }); // 디버깅 시 필요하면 주석 해제

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
}, { requireSenderWindow: true });

ipcMain.handle('memo-window-changed', async (event, payload = {}) => {
  const change = {
    domain: 'memo',
    at: new Date().toISOString(),
    ...payload,
  };

  broadcastToAllWindows('memo-window-changed', change);
  return { success: true };
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

  const params = new URLSearchParams({
    icon: data.icon || '🔔',
    title: data.title || '알림',
    message: data.message || '새로운 알림이 도착했습니다.',
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
    icon: getIconPath('icon.png'),
    webPreferences: createRendererWebPreferences(),
  });

  const toastRoute = `/window/toast?${params.toString()}`;

  loadRendererRoute(toastWindow, toastRoute, { looseDevelopmentRuntime: true });

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
registerIpcHandler(ipcMain, 'close-notification', async ({ senderWindow }) => {
  senderWindow.close();
  return { success: true };
}, { requireSenderWindow: true });

// Toast 알림에서 메인 창으로 네비게이션 IPC 핸들러
ipcMain.handle('navigate-from-notification', async (event, route) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return sendNavigationRoute(route);
  }
  pendingNavigationRoute = normalizeNavigationRoute(route);
  return { success: false, error: '메인 창을 찾지 못했습니다.', route: pendingNavigationRoute };
});

// 앱 재시작
ipcMain.handle('restart-app', async () => {
  await gracefulShutdown();
  app.relaunch();
  app.quit();
});

// 앱 완전 종료 (트레이 메뉴 또는 다른 곳에서 호출)
ipcMain.handle('quit-app', async () => {
  await gracefulShutdown();
  app.quit();
});

app.whenReady().then(() => {
  // AutoUpdater 초기화 (app.isPackaged 접근 가능)
  autoUpdateManager.init();

  createWindow();

  // WebSocket 연결 초기화
  const config = loadConfig();
  webSocketManager.connect(config);

  // 프로덕션 설치본에서 시작 시 1회, 이후 30분마다 업데이트 확인
  autoUpdateManager.scheduleChecks();
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
  webSocketManager.shutdown();
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
