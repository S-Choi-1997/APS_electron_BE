const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

function isStrictDevelopmentRuntime() {
  return process.env.NODE_ENV !== 'production' && !app.isPackaged;
}

function isLooseDevelopmentRuntime() {
  return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

function getIconPath(filename = 'icon.png') {
  return path.join(__dirname, filename);
}

function getPreloadPath() {
  return path.join(__dirname, 'preload.js');
}

function createRendererWebPreferences(overrides = {}) {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    preload: getPreloadPath(),
    ...overrides,
  };
}

function loadMainRenderer(window) {
  console.log('=== Electron 로드 모드 확인 ===');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('app.isPackaged:', app.isPackaged);
  console.log('__dirname:', __dirname);

  if (isStrictDevelopmentRuntime()) {
    console.log('-> 개발 모드: Vite 서버 로드');
    window.loadURL('http://localhost:5173');
    return;
  }

  const distPath = path.join(__dirname, '../dist/index.html');
  console.log('-> 프로덕션 모드: 파일 로드');
  console.log('   파일 경로:', distPath);
  console.log('   파일 존재:', fs.existsSync(distPath));
  window.loadFile(distPath);
}

function loadRendererRoute(window, route, options = {}) {
  const developmentRuntime = options.looseDevelopmentRuntime
    ? isLooseDevelopmentRuntime()
    : isStrictDevelopmentRuntime();

  if (developmentRuntime) {
    if (options.logPrefix) {
      console.log(`[${options.logPrefix}] 개발 모드: Vite 서버에서 로드`);
    }
    window.loadURL(`http://localhost:5173/#${route}`);
    return;
  }

  if (options.logPrefix) {
    console.log(`[${options.logPrefix}] 프로덕션 모드: 파일에서 로드`);
  }
  const indexUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).toString();
  window.loadURL(`${indexUrl}#${route}`);
}

module.exports = {
  createRendererWebPreferences,
  getIconPath,
  getPreloadPath,
  loadMainRenderer,
  loadRendererRoute,
};
