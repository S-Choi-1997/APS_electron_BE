const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

let mainWindow;
let oauthWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true, // 메뉴바 자동 숨김
  });

  // 개발 모드: Vite 개발 서버 로드
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools(); // DevTools 자동 열기 비활성화 (F12로 수동 열기 가능)
  } else {
    // 프로덕션: 빌드된 파일 로드
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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
