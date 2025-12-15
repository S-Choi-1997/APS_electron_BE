/**
 * websocketService.js - WebSocket 클라이언트 관리
 *
 * Socket.IO 클라이언트 연결 및 관리
 */

import { io } from 'socket.io-client';
import { API_URL } from '../config/api.js';
import { getCurrentUser } from '../auth/authManager.js';

let socket = null;

/**
 * WebSocket 연결
 * @returns {Socket} socket.io 클라이언트 인스턴스
 */
export function connectWebSocket() {
  const user = getCurrentUser();

  if (!user) {
    console.warn('[WebSocket] No user found, cannot connect');
    return null;
  }

  if (socket?.connected) {
    console.log('[WebSocket] Already connected');
    return socket;
  }

  console.log('[WebSocket] Connecting to', API_URL);

  socket = io(API_URL, {
    auth: {
      token: user.idToken,
      provider: user.provider
    },
    reconnectionDelay: 1000,
    reconnection: true,
    reconnectionAttempts: 10,
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log('[WebSocket] Connected to server');
  });

  socket.on('disconnect', (reason) => {
    console.log('[WebSocket] Disconnected from server:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('[WebSocket] Connection error:', error.message);
  });

  return socket;
}

/**
 * WebSocket 연결 종료
 */
export function disconnectWebSocket() {
  if (socket) {
    console.log('[WebSocket] Disconnecting...');
    socket.disconnect();
    socket = null;
  }
}

/**
 * 현재 WebSocket 인스턴스 가져오기
 * @returns {Socket|null}
 */
export function getSocket() {
  return socket;
}

/**
 * 토큰 갱신 후 WebSocket 재연결
 * @param {string} newToken - 새로운 인증 토큰
 * @param {string} newProvider - 인증 제공자 ('local', 'google', 'naver')
 */
export function refreshSocketAuth(newToken, newProvider) {
  if (socket && socket.connected) {
    console.log('[WebSocket] Refreshing authentication...');

    // 기존 연결 종료
    socket.disconnect();

    // 새 토큰으로 재연결
    socket = io(API_URL, {
      auth: {
        token: newToken,
        provider: newProvider
      },
      reconnectionDelay: 1000,
      reconnection: true,
      reconnectionAttempts: 10
    });

    console.log('[WebSocket] Reconnected with new token');
  }
}
