const { app, BrowserWindow, ipcMain, session, Menu, screen, shell } = require('electron');
const path = require('path');

let mainWindow;
let stickyWindows = {}; // { type: BrowserWindow }
let memoSubWindows = {}; // { stickyType: BrowserWindow }

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
    // 창을 완전히 닫지 않고 숨김 (백그라운드 실행)
    mainWindow.hide();
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
    width: 300,
    height: 200,
    frame: false,
    alwaysOnTop: true,
    show: false,
    resizable: false,
    opacity: 0.95, // 95% 불투명도 (5% 투명)
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 개발 모드와 프로덕션 모드 분기
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    stickyWindow.loadURL('http://localhost:5173/sticky.html');
    // 개발 모드에서 DevTools 자동 열기 (크기 표시 때문에 주석 처리)
    // stickyWindow.webContents.openDevTools({ mode: 'detach' });
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

// 메모 서브 윈도우 열기 (알림창 옆에 배치)
ipcMain.handle('open-memo-sub-window', async (event, { mode, memoId }) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) {
    return { success: false, error: 'Parent window not found' };
  }

  // 부모 창 타입 찾기 (stickyWindows에서)
  const parentType = Object.keys(stickyWindows).find(
    type => stickyWindows[type] === parentWindow
  );
  if (!parentType) {
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
  } else {
    subWindow.loadFile(path.join(__dirname, '../dist/memo-detail.html'), {
      query: Object.fromEntries(new URLSearchParams(queryParams))
    });
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
