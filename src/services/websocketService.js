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
let isConnecting = false;
let reconnectInterval = null;
const RECONNECT_CHECK_INTERVAL = 30000; // 30초마다 재연결 체크

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

  if (isConnecting) {
    console.log('[WebSocket] Already attempting to connect, skipping...');
    return socket;
  }

  isConnecting = true;
  console.log('[WebSocket] Connecting to relay server:', RELAY_WS_URL);

  // 기존 소켓이 있으면 정리
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  socket = io(RELAY_WS_URL, {
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnection: false, // Socket.IO 자동 재연결 비활성화 (수동 관리)
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log('[WebSocket] Connected to relay server');
    isConnecting = false;

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
    isConnecting = false;
  });

  // Heartbeat
  const heartbeatInterval = setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('heartbeat');
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 30000);

  // 주기적인 재연결 체크 시작
  startReconnectMonitor();

  return socket;
}

/**
 * 주기적으로 연결 상태 확인 및 재연결
 */
function startReconnectMonitor() {
  // 기존 인터벌이 있으면 정리
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
  }

  reconnectInterval = setInterval(() => {
    const user = getCurrentUser();

    if (!user) {
      console.log('[WebSocket] No user logged in, skipping reconnect check');
      return;
    }

    if (!socket || !socket.connected) {
      console.log('[WebSocket] Connection lost, attempting to reconnect...');
      connectWebSocket();
    }
  }, RECONNECT_CHECK_INTERVAL);
}

/**
 * WebSocket 연결 종료
 */
export function disconnectWebSocket() {
  // 재연결 모니터 중지
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
  }

  if (socket) {
    console.log('[WebSocket] Disconnecting...');
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  isConnecting = false;
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
