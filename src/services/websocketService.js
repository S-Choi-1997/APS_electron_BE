/**
 * websocketService.js - DEPRECATED
 *
 * WebSocket은 이제 Main Process에서 관리됩니다.
 * 이 파일은 하위 호환성을 위해 유지되며, 모든 함수는 no-op입니다.
 *
 * 리팩토링 날짜: 2026-01-20
 * 변경사항:
 * - Main Process가 유일한 WebSocket 연결 유지
 * - Renderer Process는 IPC 이벤트 리스너 사용
 * - Environment 설정도 Main Process에서 관리
 */

export function connectWebSocket() {
  console.warn('[WebSocket] connectWebSocket() is deprecated. WebSocket is now managed by Main Process.');
  return null;
}

export function disconnectWebSocket() {
  console.warn('[WebSocket] disconnectWebSocket() is deprecated.');
}

export function getSocket() {
  console.warn('[WebSocket] getSocket() is deprecated. Use window.electron.onWebSocketEvent() instead.');
  return null;
}

export function refreshSocketAuth() {
  console.warn('[WebSocket] refreshSocketAuth() is deprecated.');
}
