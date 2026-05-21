const fs = require('fs');

function registerConfigIpcHandlers({
  ipcMain,
  broadcastToAllWindows,
  createAppConfig,
  getConfigPath,
  getDefaultConfig,
  getSocketAuth,
  loadConfig,
  saveConfig,
  webSocketManager,
}) {
  ipcMain.handle('refresh-websocket-auth', async () => {
    try {
      const user = await getSocketAuth();

      if (!user?.idToken && !user?.accessToken) {
        webSocketManager.disconnect('no-auth-token');
        return { success: true, connected: false, reason: 'no-auth-token' };
      }

      webSocketManager.connect(webSocketManager.getCurrentConfig() || loadConfig());

      return {
        success: true,
        connected: webSocketManager.getStatus().connected,
        environment: webSocketManager.getCurrentConfig()?.environment || 'production',
      };
    } catch (error) {
      console.error('[WebSocket] Failed to refresh auth:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-environment', async () => {
    return webSocketManager.getCurrentConfig()?.environment || 'production';
  });

  ipcMain.handle('set-environment', async (_event, environment) => {
    try {
      const baseConfig = webSocketManager.getCurrentConfig() || loadConfig();
      console.log(`[Config] Changing environment: ${baseConfig.environment} → ${environment}`);

      const newConfig = saveConfig(createAppConfig({ ...baseConfig, environment }, 'userData'));
      webSocketManager.setCurrentConfig(newConfig);
      webSocketManager.connect(newConfig);

      broadcastToAllWindows('environment-changed', { environment });
      broadcastToAllWindows('app-config-changed', newConfig);

      return { success: true, environment, config: newConfig };
    } catch (error) {
      console.error('[Config] Failed to set environment:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-app-config', async () => {
    if (!webSocketManager.getCurrentConfig()) {
      webSocketManager.setCurrentConfig(loadConfig());
    }
    return webSocketManager.getCurrentConfig();
  });

  ipcMain.handle('set-app-config', async (_event, configPatch = {}) => {
    try {
      const baseConfig = webSocketManager.getCurrentConfig() || loadConfig();
      const mergedConfig = { ...baseConfig, ...configPatch };
      const restUrlChanged = Boolean(configPatch.restBaseUrl);
      const explicitWsUrl = Boolean(configPatch.wsBaseUrl);

      if (restUrlChanged && !explicitWsUrl && baseConfig.wsDerivedFromRest) {
        delete mergedConfig.wsBaseUrl;
      }

      const newConfig = saveConfig(createAppConfig(mergedConfig, 'userData'));
      const wsChanged = baseConfig.wsBaseUrl !== newConfig.wsBaseUrl;

      if (wsChanged) {
        webSocketManager.connect(newConfig);
      } else {
        webSocketManager.setCurrentConfig(newConfig);
      }

      broadcastToAllWindows('app-config-changed', newConfig);
      return { success: true, config: newConfig };
    } catch (error) {
      console.error('[Config] Failed to set app config:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('reset-app-config', async () => {
    try {
      const configPath = getConfigPath();
      if (fs.existsSync(configPath)) {
        fs.rmSync(configPath, { force: true });
      }

      const defaultConfig = getDefaultConfig();
      webSocketManager.setCurrentConfig(defaultConfig);
      webSocketManager.connect(defaultConfig);
      broadcastToAllWindows('app-config-changed', defaultConfig);

      return { success: true, config: defaultConfig };
    } catch (error) {
      console.error('[Config] Failed to reset app config:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-websocket-status', async () => {
    return webSocketManager.getStatus();
  });
}

module.exports = {
  registerConfigIpcHandlers,
};
