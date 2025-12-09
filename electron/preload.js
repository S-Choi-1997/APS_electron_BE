// IPC 통신용 API 노출
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  version: process.versions.electron,

  // OAuth 팝업 창 열기
  openOAuthWindow: (url) => ipcRenderer.invoke('open-oauth-window', url),

  // 세션 정리 (로그아웃)
  clearSession: () => ipcRenderer.invoke('clear-session'),

  // Electron 환경 확인
  isElectron: true,
});
