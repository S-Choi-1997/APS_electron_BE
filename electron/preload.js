// IPC 통신용 API 노출
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  version: process.versions.electron,

  // 세션 정리 (로그아웃)
  clearSession: () => ipcRenderer.invoke('clear-session'),

  // 스티커 창 관리
  openStickyWindow: (type, title, data, reset = false) =>
    ipcRenderer.invoke('open-sticky-window', { type, title, data, reset }),

  closeStickyWindow: (type) =>
    ipcRenderer.invoke('close-sticky-window', type),

  closeAllStickyWindows: () =>
    ipcRenderer.invoke('close-all-sticky-windows'),

  isStickyWindowOpen: (type) =>
    ipcRenderer.invoke('is-sticky-window-open', type),

  resizeStickyWindow: (width, height) =>
    ipcRenderer.invoke('resize-sticky-window', { width, height }),

  showStickyWindow: () =>
    ipcRenderer.invoke('show-sticky-window'),

  setWindowOpacity: (opacity) =>
    ipcRenderer.invoke('set-window-opacity', opacity),

  getWindowOpacity: () =>
    ipcRenderer.invoke('get-window-opacity'),

  // 메인 윈도우 제어
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),

  // NOTE: createMemo API 제거됨 - memoService.js의 API 호출 사용

  // IPC 브로드캐스트 제거됨 - WebSocket 이벤트가 자동으로 전파됨
  // broadcastMemoCreated, broadcastMemoDeleted, broadcastConsultationUpdated 제거

  // 메모 서브 윈도우 열기
  openMemoSubWindow: (mode, memoId) => ipcRenderer.invoke('open-memo-sub-window', { mode, memoId }),

  // 외부 브라우저에서 URL 열기
  openExternal: (url) => ipcRenderer.invoke('open-external-url', url),

  // 파일 다운로드
  downloadFile: (url, filename) => ipcRenderer.invoke('download-file', { url, filename }),

  // Blob/Buffer 데이터를 파일로 저장 (인증이 필요한 다운로드용)
  saveFile: (buffer, filename) => ipcRenderer.invoke('save-file', { buffer, filename }),

  // 메인 창 포커스 및 라우팅
  focusMainWindow: (route) => ipcRenderer.invoke('focus-main-window', route),

  // 이벤트 리스너 (메인 프로세스 → 렌더러)
  // NOTE: WebSocket 이벤트는 콜론(:) 구분자 사용 (memo:created, memo:deleted 등)
  // NOTE: removeListener 사용하여 해당 콜백만 제거 (다른 리스너 유지)
  onMemoCreated: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('memo:created', handler);
    return () => ipcRenderer.removeListener('memo:created', handler);
  },

  onMemoDeleted: (callback) => {
    const handler = (event, data) => callback(data?.id || data);
    ipcRenderer.on('memo:deleted', handler);
    return () => ipcRenderer.removeListener('memo:deleted', handler);
  },

  onNavigateToRoute: (callback) => {
    const handler = (event, route) => callback(route);
    ipcRenderer.on('navigate-to-route', handler);
    return () => ipcRenderer.removeListener('navigate-to-route', handler);
  },

  onConsultationUpdated: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('consultation:updated', handler);
    return () => ipcRenderer.removeListener('consultation:updated', handler);
  },

  // Toast 알림 관련 API
  showToastNotification: (data) => ipcRenderer.invoke('show-toast-notification', data),

  closeNotification: () => ipcRenderer.invoke('close-notification'),

  navigateFromNotification: (route) => ipcRenderer.invoke('navigate-from-notification', route),

  // 메인 창에서 네비게이션 이벤트 수신
  onNavigateTo: (callback) => {
    const handler = (event, route) => callback(route);
    ipcRenderer.on('navigate-to', handler);
    return () => ipcRenderer.removeListener('navigate-to', handler);
  },

  // Electron 환경 확인
  isElectron: true,

  // 인증 토큰 가져오기 (메인 프로세스에서 제공)
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),

  // ==================== Auto Update 관련 ====================
  // NOTE: removeListener 사용하여 해당 콜백만 제거 (여러 컴포넌트에서 동시 사용 가능)
  onUpdateAvailable: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },

  onUpdateDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('update-download-progress', handler);
    return () => ipcRenderer.removeListener('update-download-progress', handler);
  },

  onUpdateDownloaded: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },

  onUpdateNotAvailable: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('update-not-available', handler);
    return () => ipcRenderer.removeListener('update-not-available', handler);
  },

  onUpdateError: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('update-error', handler);
    return () => ipcRenderer.removeListener('update-error', handler);
  },

  // 앱 버전 가져오기
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // 수동 업데이트 확인
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // 앱 재시작
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // 업데이트 설치 및 재시작
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // 업데이트 다운로드 (사용자 확인 후)
  downloadUpdate: () => ipcRenderer.invoke('download-update'),

  // 앱 완전 종료
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // ==================== 시작프로그램 설정 ====================
  getStartupEnabled: () => ipcRenderer.invoke('get-startup-enabled'),
  setStartupEnabled: (enabled) => ipcRenderer.invoke('set-startup-enabled', enabled),

  // ==================== Environment 설정 ====================
  getEnvironment: () => ipcRenderer.invoke('get-environment'),
  setEnvironment: (environment) => ipcRenderer.invoke('set-environment', environment),
  getConfig: () => ipcRenderer.invoke('get-config'),

  // 환경 변경 이벤트 리스너
  // NOTE: removeListener 사용하여 해당 콜백만 제거 (다른 리스너 유지)
  onEnvironmentChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('environment-changed', handler);
    return () => ipcRenderer.removeListener('environment-changed', handler);
  },

  // ==================== WebSocket 상태 ====================
  getWebSocketStatus: () => ipcRenderer.invoke('get-websocket-status'),

  // WebSocket 연결 상태 이벤트
  // NOTE: removeListener 사용하여 해당 콜백만 제거 (다른 리스너 유지)
  onWebSocketStatusChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('websocket-status-changed', handler);
    return () => ipcRenderer.removeListener('websocket-status-changed', handler);
  },

  // WebSocket 이벤트 리스너 (범용)
  // NOTE: handler를 저장하여 removeListener에서 올바른 참조 사용
  onWebSocketEvent: (eventName, callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(eventName, handler);
    return () => ipcRenderer.removeListener(eventName, handler);
  },
});
