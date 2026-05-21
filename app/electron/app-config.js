const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PRODUCTION_BACKEND_URL = 'https://backend.apsconsulting.kr';

function normalizeHttpUrl(url) {
  const parsedUrl = new URL(url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('API URL은 http 또는 https 프로토콜만 사용할 수 있습니다.');
  }

  return parsedUrl.toString().replace(/\/$/, '');
}

function normalizeWebSocketUrl(url) {
  const parsedUrl = new URL(url);
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('WebSocket URL은 ws, wss, http, https 프로토콜만 사용할 수 있습니다.');
  }

  if (parsedUrl.protocol === 'http:') parsedUrl.protocol = 'ws:';
  if (parsedUrl.protocol === 'https:') parsedUrl.protocol = 'wss:';
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/$/, '');

  return parsedUrl.toString().replace(/\/$/, '');
}

function deriveWebSocketUrlFromRestUrl(restUrl) {
  const parsedUrl = new URL(restUrl);
  parsedUrl.protocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  parsedUrl.pathname = '';
  parsedUrl.search = '';
  parsedUrl.hash = '';
  return normalizeWebSocketUrl(parsedUrl.toString());
}

function getBuiltInApiFallback() {
  return app.isPackaged ? PRODUCTION_BACKEND_URL : 'http://localhost:3001';
}

function isLegacyBackendUrl(value) {
  if (!value || typeof value !== 'string') return false;

  const normalizedValue = value.toLowerCase();
  return [
    '/proxy',
    '136.113.67.193',
    'inquiryapi-',
    '.run.app',
    'ws-relay',
    'aps-websocket-relay',
    'your-cloudflare-backend-domain',
  ].some((pattern) => normalizedValue.includes(pattern));
}

function migratePersistedConfig(savedConfig, defaultConfig) {
  const migratedConfig = { ...savedConfig };
  const legacyRestBaseUrl = savedConfig['api' + 'Url'];
  const legacyWsRelayUrl = savedConfig['wsRelay' + 'Url'];
  const legacyWsBaseUrl = savedConfig['ws' + 'Url'];
  const savedUrls = [
    savedConfig.restBaseUrl,
    legacyRestBaseUrl,
    savedConfig.wsBaseUrl,
    legacyWsRelayUrl,
    legacyWsBaseUrl,
  ];

  if (!savedUrls.some(isLegacyBackendUrl)) {
    return { config: migratedConfig, migrated: false };
  }

  delete migratedConfig.restBaseUrl;
  delete migratedConfig['api' + 'Url'];
  delete migratedConfig.wsBaseUrl;
  delete migratedConfig['wsRelay' + 'Url'];
  delete migratedConfig['ws' + 'Url'];
  delete migratedConfig.wsDerivedFromRest;

  migratedConfig.mode = 'direct';
  migratedConfig.environment = defaultConfig.environment;
  migratedConfig.migratedFromLegacyBackend = true;
  migratedConfig.migratedAt = new Date().toISOString();

  console.warn('[Config] Legacy backend URL detected in userData config. Resetting backend URLs to packaged direct defaults.');
  return { config: migratedConfig, migrated: true };
}

function promotePersistedConfigAliases(savedConfig) {
  const promotedConfig = { ...savedConfig };
  let promoted = false;

  const legacyRestBaseUrl = savedConfig['api' + 'Url'];
  const legacyWsRelayUrl = savedConfig['wsRelay' + 'Url'];
  const legacyWsBaseUrl = savedConfig['ws' + 'Url'];

  if (!promotedConfig.restBaseUrl && legacyRestBaseUrl) {
    promotedConfig.restBaseUrl = legacyRestBaseUrl;
    promoted = true;
  }

  if (!promotedConfig.wsBaseUrl && (legacyWsRelayUrl || legacyWsBaseUrl)) {
    promotedConfig.wsBaseUrl = legacyWsRelayUrl || legacyWsBaseUrl;
    promoted = true;
  }

  delete promotedConfig['api' + 'Url'];
  delete promotedConfig['wsRelay' + 'Url'];
  delete promotedConfig['ws' + 'Url'];

  return { config: promotedConfig, promoted };
}

function createAppConfig(input = {}, source = 'runtime') {
  const restBaseUrl = normalizeHttpUrl(input.restBaseUrl || getBuiltInApiFallback());
  const hasExplicitWsBaseUrl = hasExplicitWebSocketUrl(input, restBaseUrl);
  const wsBaseUrl = normalizeWebSocketUrl(
    hasExplicitWsBaseUrl ? input.wsBaseUrl : deriveWebSocketUrlFromRestUrl(restBaseUrl)
  );

  return {
    version: 1,
    mode: input.mode || 'direct',
    environment: input.environment || 'production',
    restBaseUrl,
    wsBaseUrl,
    wsDerivedFromRest: !hasExplicitWsBaseUrl,
    source,
  };
}

function hasExplicitWebSocketUrl(input, restBaseUrl) {
  if (!input.wsBaseUrl) return false;
  if (input.wsDerivedFromRest === true) return false;
  if (input.wsDerivedFromRest === false) return true;

  try {
    return normalizeWebSocketUrl(input.wsBaseUrl) !== deriveWebSocketUrlFromRestUrl(restBaseUrl);
  } catch (error) {
    return true;
  }
}

function loadBundledDefaultConfig() {
  const candidatePaths = [
    path.join(__dirname, 'app-config.default.json'),
  ];

  if (process.resourcesPath) {
    candidatePaths.push(path.join(process.resourcesPath, 'app-config.default.json'));
  }

  for (const candidatePath of candidatePaths) {
    try {
      if (!fs.existsSync(candidatePath)) continue;
      const bundledConfig = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
      return createAppConfig(bundledConfig, 'packaged-default');
    } catch (error) {
      console.warn(`[Config] Failed to load bundled default config from ${candidatePath}:`, error.message);
    }
  }

  return null;
}

function getDefaultConfig() {
  const bundledDefaultConfig = loadBundledDefaultConfig();
  const restBaseUrl = process.env.APS_API_URL || process.env.VITE_API_URL || bundledDefaultConfig?.restBaseUrl || getBuiltInApiFallback();
  const wsBaseUrl = process.env.APS_WS_URL || process.env.VITE_WS_URL;
  const environment = process.env.APS_BACKEND_ENVIRONMENT || process.env.VITE_BACKEND_ENVIRONMENT || bundledDefaultConfig?.environment || 'production';

  return createAppConfig({
    environment,
    restBaseUrl,
    wsBaseUrl: wsBaseUrl || bundledDefaultConfig?.wsBaseUrl,
    mode: bundledDefaultConfig?.mode,
  }, process.env.APS_API_URL || process.env.VITE_API_URL ? 'env' : bundledDefaultConfig ? 'packaged-default' : 'local-fallback');
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'app-config.json');
}

function loadConfig() {
  const defaultConfig = getDefaultConfig();
  const restBaseUrlOverride = process.env.APS_API_URL || process.env.VITE_API_URL;
  const wsBaseUrlOverride = process.env.APS_WS_URL || process.env.VITE_WS_URL;
  const environmentOverride = process.env.APS_BACKEND_ENVIRONMENT || process.env.VITE_BACKEND_ENVIRONMENT;
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, 'utf8');
      const savedConfig = JSON.parse(data);
      const migration = migratePersistedConfig(savedConfig, defaultConfig);
      const persistedConfig = promotePersistedConfigAliases(migration.config);
      const parsedConfig = {
        ...defaultConfig,
        ...persistedConfig.config,
      };

      if (restBaseUrlOverride) {
        parsedConfig.restBaseUrl = restBaseUrlOverride;
      }

      if (wsBaseUrlOverride) {
        parsedConfig.wsBaseUrl = wsBaseUrlOverride;
      } else if (restBaseUrlOverride) {
        parsedConfig.wsBaseUrl = deriveWebSocketUrlFromRestUrl(restBaseUrlOverride);
      }

      if (environmentOverride) {
        parsedConfig.environment = environmentOverride;
      }

      const config = createAppConfig(parsedConfig, restBaseUrlOverride || wsBaseUrlOverride || environmentOverride ? 'env' : 'userData');
      if (migration.migrated || persistedConfig.promoted) {
        try {
          saveConfig(config);
        } catch (saveError) {
          console.error('[Config] Failed to persist migrated config:', saveError);
        }
      }
      console.log('[Config] Loaded configuration:', config);
      return config;
    } catch (e) {
      console.error('[Config] Failed to load config:', e);
    }
  }
  console.log('[Config] Using default configuration');
  return defaultConfig;
}

function saveConfig(config) {
  const configPath = getConfigPath();
  const normalizedConfig = createAppConfig(config, 'userData');
  try {
    fs.writeFileSync(configPath, JSON.stringify(normalizedConfig, null, 2), 'utf8');
    console.log('[Config] Saved configuration:', normalizedConfig);
    return normalizedConfig;
  } catch (e) {
    console.error('[Config] Failed to save config:', e);
    throw e;
  }
}

module.exports = {
  PRODUCTION_BACKEND_URL,
  createAppConfig,
  deriveWebSocketUrlFromRestUrl,
  getConfigPath,
  getDefaultConfig,
  loadConfig,
  normalizeHttpUrl,
  normalizeWebSocketUrl,
  saveConfig,
};
