const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const envPath = path.join(appRoot, '.env');
const outputPath = path.join(appRoot, 'electron', 'app-config.default.json');

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) return acc;

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      acc[key] = value;
      return acc;
    }, {});
}

function getValue(env, ...keys) {
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
    if (env[key]) return env[key];
  }
  return '';
}

function normalizeHttpUrl(value) {
  const parsedUrl = new URL(value);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('API URL must use http or https protocol');
  }
  return parsedUrl.toString().replace(/\/$/, '');
}

function normalizeWebSocketUrl(value) {
  const parsedUrl = new URL(value);
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('WebSocket URL must use ws, wss, http, or https protocol');
  }
  if (parsedUrl.protocol === 'http:') parsedUrl.protocol = 'ws:';
  if (parsedUrl.protocol === 'https:') parsedUrl.protocol = 'wss:';
  return parsedUrl.toString().replace(/\/$/, '');
}

function deriveWebSocketUrl(restBaseUrl) {
  const parsedUrl = new URL(restBaseUrl);
  parsedUrl.protocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  parsedUrl.pathname = '';
  parsedUrl.search = '';
  parsedUrl.hash = '';
  return normalizeWebSocketUrl(parsedUrl.toString());
}

const dotEnv = readDotEnv(envPath);
const restBaseUrl = getValue(dotEnv, 'APS_API_URL', 'VITE_API_URL');
const configuredWsUrl = getValue(dotEnv, 'APS_WS_URL', 'VITE_WS_URL', 'VITE_WS_RELAY_URL');
const environment = getValue(dotEnv, 'APS_BACKEND_ENVIRONMENT', 'VITE_RELAY_ENVIRONMENT') || 'production';

if (!restBaseUrl) {
  if (fs.existsSync(outputPath)) {
    fs.rmSync(outputPath);
  }
  throw new Error('APS_API_URL or VITE_API_URL is required to build a packaged Electron app.');
}

const normalizedRestBaseUrl = normalizeHttpUrl(restBaseUrl);
const normalizedWsBaseUrl = configuredWsUrl
  ? normalizeWebSocketUrl(configuredWsUrl)
  : deriveWebSocketUrl(normalizedRestBaseUrl);

const config = {
  version: 1,
  mode: 'direct',
  environment,
  restBaseUrl: normalizedRestBaseUrl,
  wsBaseUrl: normalizedWsBaseUrl,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

console.log(`[AppConfig] Wrote ${path.relative(appRoot, outputPath)}`);
