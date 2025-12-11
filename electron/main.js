const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const path = require('path');

let mainWindow;
let oauthWindow = null;
let stickyWindows = {}; // { type: BrowserWindow }

function createWindow() {
  // 메뉴바 완전히 제거
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: false, // Windows 기본 타이틀바 제거
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'icon.png'),
  });

  // 개발 모드: Vite 개발 서버 로드
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools(); // DevTools 자동 열기 비활성화 (F12로 수동 열기 가능)
  } else {
    // 프로덕션: 빌드된 파일 로드
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
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
}

// OAuth 팝업 창 생성 (Google, Naver)
ipcMain.handle('open-oauth-window', async (event, url) => {
  return new Promise((resolve, reject) => {
    oauthWindow = new BrowserWindow({
      width: 500,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      parent: mainWindow,
      modal: true,
      show: false,
    });

    oauthWindow.loadURL(url);

    oauthWindow.once('ready-to-show', () => {
      oauthWindow.show();
    });

    // URL 변경 감지 (리다이렉트 감지)
    oauthWindow.webContents.on('will-redirect', (event, redirectUrl) => {
      handleOAuthRedirect(redirectUrl, resolve, reject);
    });

    oauthWindow.webContents.on('did-navigate', (event, navigationUrl) => {
      handleOAuthRedirect(navigationUrl, resolve, reject);
    });

    // 사용자가 창을 닫은 경우
    oauthWindow.on('closed', () => {
      reject(new Error('OAuth window was closed by user'));
      oauthWindow = null;
    });
  });
});

// OAuth 리다이렉트 URL 처리
function handleOAuthRedirect(url, resolve, reject) {
  // Naver OAuth 콜백 처리
  if (url.includes('naver-callback') || url.includes('code=')) {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');
    const error = urlObj.searchParams.get('error');

    if (error) {
      reject(new Error(`OAuth error: ${error}`));
    } else if (code && state) {
      resolve({ code, state });
    }

    if (oauthWindow) {
      oauthWindow.close();
      oauthWindow = null;
    }
  }

  // Google OAuth 처리 (필요한 경우)
  if (url.includes('google') && url.includes('token=')) {
    // Google OAuth 처리 로직
    if (oauthWindow) {
      oauthWindow.close();
      oauthWindow = null;
    }
  }
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
    mainWindow.close();
  }
});

// Sticky Window 관리
ipcMain.handle('open-sticky-window', async (event, { type, title, data }) => {
  // 이미 열려있으면 focus
  if (stickyWindows[type] && !stickyWindows[type].isDestroyed()) {
    stickyWindows[type].focus();
    return { success: true, alreadyOpen: true };
  }

  const stickyWindow = new BrowserWindow({
    width: 400,
    height: 600,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 개발 모드와 프로덕션 모드 분기
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    stickyWindow.loadURL('http://localhost:5173/sticky.html');
    // 개발 모드에서 DevTools 자동 열기
    stickyWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    stickyWindow.loadFile(path.join(__dirname, '../dist/sticky.html'));
  }

  stickyWindows[type] = stickyWindow;

  stickyWindow.on('closed', () => {
    delete stickyWindows[type];
  });

  return { success: true, alreadyOpen: false };
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
    senderWindow.setSize(width, height);
    return { success: true };
  }
  return { success: false };
});

// 메모 생성 브로드캐스트
ipcMain.handle('broadcast-memo-created', async (event, memoData) => {
  // 자기 자신을 제외한 모든 창에 메모 생성 이벤트 전송
  const sender = event.sender;

  // 메인 창에 전송
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents !== sender) {
    mainWindow.webContents.send('memo-created', memoData);
  }

  // 다른 sticky 창들에 전송
  Object.values(stickyWindows).forEach(window => {
    if (window && !window.isDestroyed() && window.webContents !== sender) {
      window.webContents.send('memo-created', memoData);
    }
  });
  return { success: true };
});

// 메모 삭제 브로드캐스트
ipcMain.handle('broadcast-memo-deleted', async (event, memoId) => {
  // 자기 자신을 제외한 모든 창에 메모 삭제 이벤트 전송
  const sender = event.sender;

  // 메인 창에 전송
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents !== sender) {
    mainWindow.webContents.send('memo-deleted', memoId);
  }

  // 다른 sticky 창들에 전송
  Object.values(stickyWindows).forEach(window => {
    if (window && !window.isDestroyed() && window.webContents !== sender) {
      window.webContents.send('memo-deleted', memoId);
    }
  });
  return { success: true };
});

// 상담 생성/수정 브로드캐스트
ipcMain.handle('broadcast-consultation-updated', async (event) => {
  const sender = event.sender;

  // 메인 창에 전송
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents !== sender) {
    mainWindow.webContents.send('consultation-updated');
  }

  // 다른 sticky 창들에 전송
  Object.values(stickyWindows).forEach(window => {
    if (window && !window.isDestroyed() && window.webContents !== sender) {
      window.webContents.send('consultation-updated');
    }
  });
  return { success: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
