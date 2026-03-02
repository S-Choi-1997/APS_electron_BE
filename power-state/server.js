require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const PASSWORD = process.env.PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'power-state-secret';
const STATE_FILE = path.join(__dirname, 'data', 'state.json');

// 상태 초기화
let currentState = { state: 'OFF', lastUpdated: new Date().toISOString() };

// 파일에서 상태 로드
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      currentState = JSON.parse(data);
      console.log('State loaded from file:', currentState);
    } else {
      console.log('No state file found, using default state');
    }
  } catch (err) {
    console.error('Failed to load state:', err);
  }
}

// 파일에 상태 저장
function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2));
    console.log('State saved to file:', currentState);
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}

// 미들웨어 설정
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24시간
}));
app.use(express.static('public'));

// 인증 미들웨어
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login.html');
}

// 로그인 API
app.post('/api/login', (req, res) => {
  const { password } = req.body;

  if (password === PASSWORD) {
    req.session.authenticated = true;
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      console.log('User logged in successfully');
      res.json({ success: true });
    });
  } else {
    console.log('Login failed: invalid password');
    res.status(401).json({ error: 'Invalid password' });
  }
});

// 로그아웃 API
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
    }
    console.log('User logged out');
    res.json({ success: true });
  });
});

// 상태 조회 API (인증 필요)
app.get('/api/state', requireAuth, (req, res) => {
  res.json(currentState);
});

// 상태 변경 API (인증 필요)
app.post('/api/state', requireAuth, (req, res) => {
  const { state } = req.body;

  if (state !== 'ON' && state !== 'OFF') {
    return res.status(400).json({ error: 'Invalid state. Must be ON or OFF' });
  }

  currentState = {
    state,
    lastUpdated: new Date().toISOString()
  };

  saveState();
  console.log('State changed to:', state);
  res.json(currentState);
});

// 공개 상태 조회 API (인증 불필요 - 외부 PC용)
app.get('/api/public/state', (req, res) => {
  res.json({ state: currentState.state });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', state: currentState.state });
});

// 메인 페이지 (인증 필요)
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작 시 상태 로드
loadState();

app.listen(PORT, () => {
  console.log(`Power State Manager running on port ${PORT}`);
  console.log(`Current state: ${currentState.state}`);
  console.log(`Last updated: ${currentState.lastUpdated}`);
});
