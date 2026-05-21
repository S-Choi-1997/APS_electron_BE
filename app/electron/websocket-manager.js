const io = require('socket.io-client');

function normalizeRendererAuthSession(user) {
  if (!user) return null;

  const token = user.idToken || user.accessToken;
  if (!token) return null;

  return {
    email: user.email,
    provider: user.provider || 'local',
    displayName: user.displayName || user.name || user.email,
    idToken: token,
    accessToken: token,
  };
}

function createWebSocketManager({
  broadcastToAllWindows,
  createAppConfig,
  getAuthSession,
  getDefaultConfig,
}) {
  let socket = null;
  let currentConfig = null;
  let heartbeatInterval = null;

  function setupEventListeners() {
    if (!socket) return;

    const backendEvents = [
      'consultation:created',
      'consultation:updated',
      'consultation:deleted',
      'email:created',
      'email:updated',
      'email:deleted',
      'memo:created',
      'memo:updated',
      'memo:deleted',
      'schedule:created',
      'schedule:updated',
      'schedule:deleted',
    ];

    backendEvents.forEach((eventName) => {
      socket.on(eventName, (eventData) => {
        console.log(`[WebSocket] Event received: ${eventName}`);
        broadcastToAllWindows(eventName, eventData);
      });
    });
  }

  function disconnect(reason = 'manual') {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    broadcastToAllWindows('websocket-status-changed', {
      connected: false,
      environment: currentConfig?.environment || 'production',
      reason,
    });
  }

  function connect(config) {
    currentConfig = createAppConfig(config, config?.source || 'runtime');

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    console.log(`[WebSocket] Connecting to ${currentConfig.wsBaseUrl} (${currentConfig.environment})`);

    socket = io(currentConfig.wsBaseUrl, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnection: true,
      timeout: 10000,
      auth: async (callback) => {
        const user = await getAuthSession();
        callback({
          token: user?.idToken || user?.accessToken || null,
          environment: currentConfig.environment,
        });
      },
    });

    socket.on('connect', async () => {
      console.log('[WebSocket] Connected to backend WebSocket');
      const user = await getAuthSession();

      socket.emit('handshake', {
        type: 'client',
        metadata: {
          environment: currentConfig.environment,
          email: user?.email || 'main-process',
          provider: user?.provider || 'electron',
          displayName: user?.displayName || 'Main Process',
          connectedAt: new Date().toISOString(),
        },
      });
    });

    socket.on('handshake:success', (data) => {
      console.log('[WebSocket] Handshake successful:', data);
      broadcastToAllWindows('websocket-status-changed', {
        connected: true,
        environment: data?.environment || currentConfig.environment,
        direct: data?.direct ?? true,
      });
    });

    socket.on('disconnect', (reason) => {
      console.log('[WebSocket] Disconnected:', reason);
      broadcastToAllWindows('websocket-status-changed', {
        connected: false,
        environment: currentConfig.environment,
      });
    });

    socket.on('connect_error', (error) => {
      console.error('[WebSocket] Connection error:', error.message);
      broadcastToAllWindows('websocket-status-changed', {
        connected: false,
        environment: currentConfig.environment,
        reason: error.message,
      });
    });

    heartbeatInterval = setInterval(() => {
      if (socket && socket.connected) {
        socket.emit('heartbeat');
      }
    }, 30000);

    setupEventListeners();
  }

  function getStatus() {
    return {
      connected: socket?.connected || false,
      socketId: socket?.id || null,
      environment: currentConfig?.environment || 'production',
      url: currentConfig?.wsBaseUrl || getDefaultConfig().wsBaseUrl,
      transport: socket?.io?.engine?.transport?.name || null,
    };
  }

  function shutdown() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  }

  return {
    connect,
    disconnect,
    getCurrentConfig: () => currentConfig,
    getSocket: () => socket,
    getStatus,
    setCurrentConfig: (config) => {
      currentConfig = config;
    },
    shutdown,
  };
}

module.exports = {
  createWebSocketManager,
  normalizeRendererAuthSession,
};
