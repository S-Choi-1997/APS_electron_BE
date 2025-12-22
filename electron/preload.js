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

  // API 호출 (Sticky 창에서 사용)
  createMemo: (memoData) => ipcRenderer.invoke('api-create-memo', memoData),

  // 대시보드에서 메모 생성 시 다른 창들에게 브로드캐스트
  broadcastMemoCreated: (memoData) => ipcRenderer.invoke('broadcast-memo-created', memoData),

  // 대시보드에서 메모 삭제 시 다른 창들에게 브로드캐스트
  broadcastMemoDeleted: (memoId) => ipcRenderer.invoke('broadcast-memo-deleted', memoId),

  // 대시보드에서 상담 생성/수정/삭제 시 다른 창들에게 브로드캐스트
  broadcastConsultationUpdated: () => ipcRenderer.invoke('broadcast-consultation-updated'),

  // 메모 서브 윈도우 열기
  openMemoSubWindow: (mode, memoId) => ipcRenderer.invoke('open-memo-sub-window', { mode, memoId }),

  // 외부 브라우저에서 URL 열기
  openExternal: (url) => ipcRenderer.invoke('open-external-url', url),

  // 메인 창 포커스 및 라우팅
  focusMainWindow: (route) => ipcRenderer.invoke('focus-main-window', route),

  // 이벤트 리스너 (메인 프로세스 → 렌더러)
  onMemoCreated: (callback) => {
    ipcRenderer.on('memo-created', (event, data) => callback(data));
    // 정리 함수 반환
    return () => ipcRenderer.removeAllListeners('memo-created');
  },

  onMemoDeleted: (callback) => {
    ipcRenderer.on('memo-deleted', (event, memoId) => callback(memoId));
    // 정리 함수 반환
    return () => ipcRenderer.removeAllListeners('memo-deleted');
  },

  onNavigateToRoute: (callback) => {
    ipcRenderer.on('navigate-to-route', (event, route) => callback(route));
    // 정리 함수 반환
    return () => ipcRenderer.removeAllListeners('navigate-to-route');
  },

  onConsultationUpdated: (callback) => {
    ipcRenderer.on('consultation-updated', () => callback());
    // 정리 함수 반환
    return () => ipcRenderer.removeAllListeners('consultation-updated');
  },

  // Toast 알림 관련 API
  showToastNotification: (data) => ipcRenderer.invoke('show-toast-notification', data),

  closeNotification: () => ipcRenderer.invoke('close-notification'),

  navigateFromNotification: (route) => ipcRenderer.invoke('navigate-from-notification', route),

  // 메인 창에서 네비게이션 이벤트 수신
  onNavigateTo: (callback) => {
    ipcRenderer.on('navigate-to', (event, route) => callback(route));
    return () => ipcRenderer.removeAllListeners('navigate-to');
  },

  // Electron 환경 확인
  isElectron: true,

  // 인증 토큰 가져오기 (메인 프로세스에서 제공)
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
});
