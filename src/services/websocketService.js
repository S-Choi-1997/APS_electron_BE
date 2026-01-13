/**
 * websocketService.js - WebSocket 클라이언트 관리
 *
 * Socket.IO 클라이언트 연결 및 관리
 */

import { io } from 'socket.io-client';
import { getCurrentUser } from '../auth/authManager.js';

// WebSocket Relay URL (from environment variable)
const RELAY_WS_URL = import.meta.env.VITE_WS_RELAY_URL || 'ws://localhost:8080';
const RELAY_ENVIRONMENT = import.meta.env.VITE_RELAY_ENVIRONMENT || 'production';

let socket = null;

/**
 * WebSocket 연결 (Relay Server에 연결)
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

  console.log('[WebSocket] Connecting to relay server:', RELAY_WS_URL);

  socket = io(RELAY_WS_URL, {
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnection: true,
    reconnectionAttempts: 10,
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log('[WebSocket] Connected to relay server');

    // Send handshake
    socket.emit('handshake', {
      type: 'client',
      metadata: {
        environment: RELAY_ENVIRONMENT,
        email: user.email,
        provider: user.provider,
        displayName: user.displayName,
        connectedAt: new Date().toISOString()
      }
    });
  });

  socket.on('handshake:success', (data) => {
    console.log('[WebSocket] Handshake successful:', data);
  });

  socket.on('disconnect', (reason) => {
    console.log('[WebSocket] Disconnected from relay server:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('[WebSocket] Connection error:', error.message);
  });

  // Heartbeat
  const heartbeatInterval = setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('heartbeat');
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 30000);

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
 * (Relay 서버는 클라이언트 인증을 하지 않으므로 재연결만 수행)
 */
export function refreshSocketAuth() {
  if (socket && socket.connected) {
    console.log('[WebSocket] Token refreshed, maintaining connection to relay');
    // Relay 서버는 클라이언트 인증을 하지 않으므로 특별한 작업 불필요
  }
}
