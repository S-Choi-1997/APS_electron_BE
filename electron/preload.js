// IPC 통신용 API 노출
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  version: process.versions.electron,

  // OAuth 팝업 창 열기
  openOAuthWindow: (url) => ipcRenderer.invoke('open-oauth-window', url),

  // 세션 정리 (로그아웃)
  clearSession: () => ipcRenderer.invoke('clear-session'),

  // 스티커 창 관리
  openStickyWindow: (type, title, data) =>
    ipcRenderer.invoke('open-sticky-window', { type, title, data }),

  closeStickyWindow: (type) =>
    ipcRenderer.invoke('close-sticky-window', type),

  isStickyWindowOpen: (type) =>
    ipcRenderer.invoke('is-sticky-window-open', type),

  resizeStickyWindow: (width, height) =>
    ipcRenderer.invoke('resize-sticky-window', { width, height }),

  showStickyWindow: () =>
    ipcRenderer.invoke('show-sticky-window'),

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

  onConsultationUpdated: (callback) => {
    ipcRenderer.on('consultation-updated', () => callback());
    // 정리 함수 반환
    return () => ipcRenderer.removeAllListeners('consultation-updated');
  },

  // Electron 환경 확인
  isElectron: true,
});
