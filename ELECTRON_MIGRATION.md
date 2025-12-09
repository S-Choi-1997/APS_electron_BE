# APS 관리 시스템 - Electron 데스크톱 앱 이식 가이드

> GCP Cloud Run → OMV 나스 PC (중고PC) + Electron 데스크톱 앱

## 목차

1. [마이그레이션 개요](#1-마이그레이션-개요)
2. [백엔드 서버 설정 (OMV NAS PC)](#2-백엔드-서버-설정-omv-nas-pc)
3. [프론트엔드 Electron 앱 설정](#3-프론트엔드-electron-앱-설정)
4. [Firebase 설정 유지](#4-firebase-설정-유지)
5. [배포 및 운영](#5-배포-및-운영)

---

## 1. 마이그레이션 개요

### 현재 아키텍처 (GCP 기반)
```
고객 문의 접수 (GCP - Cloud Run)
    ↓
Firestore (데이터 저장)
    ↓
관리자 웹앱 (GitHub Pages)
    ↓
백엔드 API (GCP2 - Cloud Run)
    ↓
SMS 중계 (GCP3 - VM)
    ↓
Aligo SMS
```

### 목표 아키텍처 (OMV NAS + Electron)
```
고객 문의 접수 (GCP - 유지)
    ↓
Firestore (유지)
    ↓
백엔드 API (OMV NAS PC - Node.js)
    ↓
Electron 데스크톱 앱 (Windows/Linux)
    ↓
SMS 발송 (NAS PC에서 직접 또는 GCP3 경유)
```

### 변경 사항

| 컴포넌트 | 현재 | 변경 후 | 이유 |
|---------|------|---------|------|
| 고객 문의 접수 (GCP) | Cloud Run | **유지** | 공개 엔드포인트 필요, reCAPTCHA 검증 |
| Firestore | Cloud | **유지** | 중앙 데이터베이스, 동기화 용이 |
| 백엔드 API (GCP2) | Cloud Run | **OMV NAS** | 로컬 네트워크에서 실행 |
| 프론트엔드 | GitHub Pages | **Electron 앱** | 데스크톱 앱으로 통합 |
| SMS 중계 (GCP3) | GCP VM | **선택 1: NAS 직접** 또는 **선택 2: GCP3 유지** | Aligo IP 화이트리스트 |
| 자동삭제 (GCP-cleanup) | Cloud Function | **유지** | 개인정보보호법 준수 |

---

## 2. 백엔드 서버 설정 (OMV NAS PC)

### 2.1 시스템 요구사항

**OMV NAS PC 환경:**
- OS: OMV (Debian 기반) 또는 Ubuntu Server
- Node.js: v20.x 이상
- 포트: 3001 (백엔드 API)
- 고정 IP: 로컬 네트워크 내 (예: 192.168.0.100)

### 2.2 Node.js 설치

```bash
# OMV NAS SSH 접속 후
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# 버전 확인
node --version  # v20.x.x
npm --version   # 10.x.x
```

### 2.3 백엔드 API 서버 설치

#### 디렉토리 구조
```bash
/opt/aps-backend/
├── index.js              # GCP2/index.js 복사
├── package.json          # GCP2/package.json 복사
├── .env                  # 환경변수
├── service-account.json  # Firebase Admin 인증키
└── aps-backend.service   # systemd 서비스 파일
```

#### 설치 스크립트
```bash
# 1. 디렉토리 생성
sudo mkdir -p /opt/aps-backend
sudo chown $USER:$USER /opt/aps-backend
cd /opt/aps-backend

# 2. 파일 복사 (로컬 개발 PC에서)
# GCP2/index.js → /opt/aps-backend/index.js
# GCP2/package.json → /opt/aps-backend/package.json

# 3. 의존성 설치
npm install

# 4. Firebase Admin 인증키 다운로드 및 배치
# Firebase Console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성
# 다운로드한 JSON을 service-account.json으로 복사
```

#### .env 파일 생성
```bash
cat > /opt/aps-backend/.env << 'EOF'
# CORS 허용 (Electron 앱용)
ALLOWED_ORIGINS=http://localhost:5173,app://aps-admin

# 허용 이메일
ALLOWED_EMAILS=admin@apsconsulting.kr,manager@apsconsulting.kr

# Firebase
STORAGE_BUCKET=aps-list.appspot.com
GOOGLE_APPLICATION_CREDENTIALS=/opt/aps-backend/service-account.json

# Naver OAuth
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
NAVER_REDIRECT_URI=app://aps-admin/naver-callback.html

# Aligo SMS
ALIGO_API_KEY=your_aligo_api_key
ALIGO_USER_ID=your_aligo_user_id
ALIGO_SENDER_PHONE=0317011663

# SMS 발송 방식 선택
# 선택 1: GCP3 VM 경유 (기존 방식)
RELAY_URL=http://136.113.67.193:3000

# 선택 2: NAS에서 직접 발송 (RELAY_URL 비워두기)
# RELAY_URL=

# NAS 서버 포트
PORT=3001
EOF
```

#### index.js 수정사항

**기존 GCP2/index.js에서 변경:**

```javascript
// 환경변수로 포트 설정 추가
const PORT = process.env.PORT || 3001;

// Firebase Admin 초기화 수정
admin.initializeApp({
  credential: admin.credential.cert(
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ),
  storageBucket: process.env.STORAGE_BUCKET,
});

// 서버 시작 (기존 코드 끝에 추가)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`APS Backend API running on port ${PORT}`);
  console.log(`ALLOWED_ORIGINS: ${process.env.ALLOWED_ORIGINS}`);
  console.log(`ALLOWED_EMAILS: ${process.env.ALLOWED_EMAILS}`);
});
```

### 2.4 systemd 서비스 등록

```bash
# aps-backend.service 파일 생성
sudo cat > /etc/systemd/system/aps-backend.service << 'EOF'
[Unit]
Description=APS Backend API Server
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/opt/aps-backend
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aps-backend

# 환경변수는 .env 파일에서 자동 로드
EnvironmentFile=/opt/aps-backend/.env

[Install]
WantedBy=multi-user.target
EOF

# YOUR_USERNAME을 실제 사용자명으로 변경
sudo sed -i "s/YOUR_USERNAME/$USER/g" /etc/systemd/system/aps-backend.service

# 서비스 활성화 및 시작
sudo systemctl daemon-reload
sudo systemctl enable aps-backend
sudo systemctl start aps-backend

# 상태 확인
sudo systemctl status aps-backend
```

### 2.5 방화벽 설정 (로컬 네트워크 접근 허용)

```bash
# UFW 사용 시
sudo ufw allow 3001/tcp comment 'APS Backend API'

# iptables 직접 사용 시
sudo iptables -A INPUT -p tcp --dport 3001 -j ACCEPT
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```

### 2.6 테스트

```bash
# NAS 로컬에서 테스트
curl http://localhost:3001
# 출력: {"status":"ok","service":"aps-inquiry-api"}

# 같은 네트워크의 다른 PC에서 테스트 (192.168.0.100은 예시)
curl http://192.168.0.100:3001
```

### 2.7 SMS 발송 방식 선택

#### 선택 1: GCP3 VM 경유 (권장)

**장점:** Aligo IP 화이트리스트 재설정 불필요

**설정:**
```bash
# .env 파일
RELAY_URL=http://136.113.67.193:3000
```

**추가 작업 없음** - GCP3 VM이 계속 SMS 중계

#### 선택 2: NAS에서 직접 발송

**장점:** GCP3 VM 비용 절감 (무료지만 리소스 절약)
**단점:** Aligo에 NAS 공인 IP 화이트리스트 등록 필요

**사전 요구사항:**
- NAS가 고정 공인 IP를 가지고 있거나, DDNS로 IP 추적 가능
- Aligo 화이트리스트에 NAS 공인 IP 등록

**index.js 수정:**
```javascript
// SMS 발송 API (/sms/send)
app.post("/sms/send", authenticate, async (req, res) => {
  // ...
  const RELAY_URL = process.env.RELAY_URL;

  if (!RELAY_URL || RELAY_URL === '') {
    // 직접 Aligo API 호출
    const aligoResponse = await fetch('https://apis.aligo.in/send/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        key: process.env.ALIGO_API_KEY,
        user_id: process.env.ALIGO_USER_ID,
        sender: process.env.ALIGO_SENDER_PHONE,
        receiver: receiver.replace(/-/g, ''),
        msg: msg,
      }),
    });

    const result = await aligoResponse.json();
    // ...
  } else {
    // 기존 Relay 서버 경유 로직
    // ...
  }
});
```

**Aligo 설정:**
1. https://smartsms.aligo.in 로그인
2. 설정 → IP 화이트리스트
3. NAS 공인 IP 등록 (ipconfig.io에서 확인)

---

## 3. 프론트엔드 Electron 앱 설정

### 3.1 Electron 프로젝트 구조

```
APSmanager-electron/
├── electron/
│   ├── main.js               # Electron 메인 프로세스
│   ├── preload.js            # 프리로드 스크립트
│   └── icon.png              # 앱 아이콘
├── src/                      # 기존 React 앱 (변경 없음)
│   ├── App.jsx
│   ├── components/
│   ├── auth/
│   └── config/
│       └── api.js            # API URL 수정 필요
├── package.json              # Electron 의존성 추가
├── vite.config.js            # Electron 빌드용 수정
└── electron-builder.yml      # 패키징 설정
```

### 3.2 패키지 설치

```bash
cd APSmanager

# Electron 의존성 추가
npm install --save-dev electron electron-builder concurrently wait-on

# package.json scripts 수정
```

#### package.json 수정
```json
{
  "name": "aps-admin-electron",
  "version": "1.0.0",
  "main": "electron/main.js",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "electron": "electron .",
    "electron:dev": "concurrently \"npm run dev\" \"wait-on http://localhost:5173 && electron .\"",
    "electron:build": "npm run build && electron-builder"
  },
  "dependencies": {
    "firebase": "^11.10.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.3",
    "electron": "^28.0.0",
    "electron-builder": "^24.9.1",
    "concurrently": "^8.2.2",
    "wait-on": "^7.2.0"
  },
  "build": {
    "appId": "kr.apsconsulting.admin",
    "productName": "APS Admin",
    "files": [
      "dist/**/*",
      "electron/**/*"
    ],
    "directories": {
      "buildResources": "electron"
    },
    "win": {
      "target": "nsis",
      "icon": "electron/icon.png"
    },
    "linux": {
      "target": "AppImage",
      "category": "Office"
    }
  }
}
```

### 3.3 Electron 메인 프로세스

#### electron/main.js
```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'icon.png'),
  });

  // 개발 모드: Vite 개발 서버 로드
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // 프로덕션: 빌드된 파일 로드
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
```

#### electron/preload.js
```javascript
// 필요 시 IPC 통신용 API 노출
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  version: process.versions.electron,
});
```

### 3.4 API URL 수정

#### src/config/api.js
```javascript
// 개발/프로덕션 환경별 API URL
export const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV
    ? 'http://localhost:3001'  // 개발: 로컬 테스트
    : 'http://192.168.0.100:3001'  // 프로덕션: NAS 서버
  );

// 나머지 코드 동일
export const API_ENDPOINTS = {
  INQUIRIES: '/inquiries',
  INQUIRY_DETAIL: (id) => `/inquiries/${id}`,
  INQUIRY_UPDATE: (id) => `/inquiries/${id}`,
  INQUIRY_DELETE: (id) => `/inquiries/${id}`,
  ATTACHMENTS: (id) => `/inquiries/${id}/attachments/urls`,
  SMS_SEND: '/sms/send',
};

// ... (기존 apiRequest 함수 동일)
```

#### .env 파일 생성 (선택 사항)
```bash
# 개발용 (.env.development)
VITE_API_URL=http://localhost:3001

# 프로덕션용 (.env.production)
VITE_API_URL=http://192.168.0.100:3001
```

### 3.5 OAuth 콜백 처리

Electron 앱에서는 `app://` 프로토콜 사용:

#### src/auth/naverAuth.js 수정
```javascript
const NAVER_CLIENT_ID = 'your_naver_client_id';
const REDIRECT_URI = window.electron
  ? 'app://aps-admin/naver-callback.html'
  : 'http://localhost:5173/naver-callback.html';

// ... (나머지 동일)
```

#### public/naver-callback.html
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Naver Login</title>
</head>
<body>
  <script>
    // URL에서 code, state 파라미터 추출
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (code && state) {
      // Opener 또는 부모 창으로 전달
      if (window.opener) {
        window.opener.postMessage({ code, state }, '*');
        window.close();
      }
    }
  </script>
</body>
</html>
```

### 3.6 빌드 및 실행

#### 개발 모드
```bash
# NAS 서버 실행 확인
curl http://192.168.0.100:3001

# Electron 앱 실행 (Vite + Electron)
npm run electron:dev
```

#### 프로덕션 빌드
```bash
# 1. Vite 빌드
npm run build

# 2. Electron 패키징 (Windows)
npm run electron:build

# 생성 위치: dist/APS Admin Setup 1.0.0.exe
```

#### Linux AppImage 빌드
```bash
npm run electron:build -- --linux
# 생성 위치: dist/APS-Admin-1.0.0.AppImage
```

---

## 4. Firebase 설정 유지

### 4.1 유지되는 컴포넌트

| 컴포넌트 | 유지 여부 | 이유 |
|---------|----------|------|
| GCP (고객 문의 접수) | ✅ 유지 | 공개 엔드포인트, reCAPTCHA 검증 |
| Firestore | ✅ 유지 | 중앙 데이터베이스 |
| Firebase Storage | ✅ 유지 | 첨부파일 저장소 |
| GCP-cleanup (자동삭제) | ✅ 유지 | 개인정보보호법 준수 |
| Google OAuth | ✅ 유지 | 관리자 인증 |
| Naver OAuth | ✅ 유지 | 관리자 인증 |

### 4.2 Firebase Admin SDK 인증

**NAS 서버에서 Firebase 사용:**
1. Firebase Console → 프로젝트 설정 → 서비스 계정
2. "새 비공개 키 생성" 클릭 → JSON 다운로드
3. `/opt/aps-backend/service-account.json` 배치
4. `.env`에 경로 설정:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=/opt/aps-backend/service-account.json
   ```

### 4.3 OAuth Redirect URI 추가

**Google OAuth:**
1. Google Cloud Console → API 및 서비스 → 사용자 인증 정보
2. OAuth 2.0 클라이언트 ID → 승인된 리디렉션 URI 추가:
   - `app://aps-admin/google-callback.html` (Electron)
   - `http://localhost:5173/google-callback.html` (개발)

**Naver OAuth:**
1. Naver Developers → 내 애플리케이션 → 설정
2. Callback URL 추가:
   - `app://aps-admin/naver-callback.html` (Electron)
   - `http://localhost:5173/naver-callback.html` (개발)

---

## 5. 배포 및 운영

### 5.1 최초 배포 체크리스트

**NAS 서버 설정:**
- [ ] Node.js 20.x 설치
- [ ] `/opt/aps-backend` 디렉토리 생성 및 파일 복사
- [ ] `.env` 파일 생성 및 환경변수 설정
- [ ] Firebase service-account.json 배치
- [ ] `npm install` 의존성 설치
- [ ] systemd 서비스 등록 및 시작
- [ ] 방화벽 포트 3001 허용
- [ ] 로컬 네트워크에서 접근 테스트

**Electron 앱 설정:**
- [ ] `npm install` (Electron 의존성)
- [ ] `src/config/api.js` API URL 수정
- [ ] OAuth Redirect URI 추가 (Google, Naver)
- [ ] 개발 모드 테스트 (`npm run electron:dev`)
- [ ] 프로덕션 빌드 (`npm run electron:build`)
- [ ] 설치 파일 배포

### 5.2 운영 관리

#### 로그 확인
```bash
# NAS 백엔드 로그
sudo journalctl -u aps-backend -f

# 최근 50줄
sudo journalctl -u aps-backend -n 50
```

#### 서비스 재시작
```bash
sudo systemctl restart aps-backend
```

#### 업데이트 배포
```bash
# 1. 코드 수정
cd /opt/aps-backend
nano index.js

# 2. 서비스 재시작
sudo systemctl restart aps-backend

# 3. 로그 확인
sudo journalctl -u aps-backend -n 20
```

### 5.3 자동 시작 설정

NAS 재부팅 시 자동 시작:
```bash
sudo systemctl enable aps-backend
```

### 5.4 백업 전략

**백엔드 파일 백업:**
```bash
# 매주 백업 (crontab)
0 3 * * 0 tar -czf /backup/aps-backend-$(date +\%Y\%m\%d).tar.gz /opt/aps-backend
```

**Firestore 데이터 백업:**
```bash
# GCP Console → Firestore → 가져오기/내보내기
# 또는 CLI:
gcloud firestore export gs://aps-backup-bucket/$(date +%Y%m%d)
```

### 5.5 모니터링

**NAS 서버 모니터링:**
```bash
# CPU, 메모리 사용률
htop

# 디스크 사용률
df -h

# 네트워크 상태
netstat -tuln | grep 3001
```

**Electron 앱 업데이트 배포:**
- 수동 배포: 새 설치 파일을 직원들에게 전달
- 자동 업데이트: electron-updater 사용 (추가 설정 필요)

### 5.6 문제 해결

#### NAS 서버 접근 불가
```bash
# 1. 서비스 상태 확인
sudo systemctl status aps-backend

# 2. 포트 확인
sudo netstat -tuln | grep 3001

# 3. 방화벽 확인
sudo ufw status

# 4. 로그 확인
sudo journalctl -u aps-backend -n 50
```

#### Electron 앱 API 연결 실패
```bash
# 개발자 도구 열기 (Ctrl+Shift+I)
# Console 탭에서 에러 확인

# API URL 확인
console.log(API_BASE_URL)

# NAS 서버 접근 테스트 (브라우저)
http://192.168.0.100:3001
```

---

## 부록: 선택적 고급 기능

### A. HTTPS 설정 (선택 사항)

로컬 네트워크에서는 HTTP로 충분하지만, 보안 강화 시:

```bash
# 1. 자체 서명 인증서 생성
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# 2. index.js에서 HTTPS 서버 사용
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('/opt/aps-backend/key.pem'),
  cert: fs.readFileSync('/opt/aps-backend/cert.pem')
};

https.createServer(options, app).listen(3001, '0.0.0.0', () => {
  console.log('HTTPS Server running on port 3001');
});
```

### B. Docker 컨테이너 배포 (선택 사항)

OMV에서 Docker 사용 시:

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY index.js .
COPY service-account.json .
EXPOSE 3001
CMD ["node", "index.js"]
```

```bash
# 빌드 및 실행
docker build -t aps-backend .
docker run -d --restart=always -p 3001:3001 --env-file .env aps-backend
```

---

## 요약

### 백엔드 (NAS)
1. Node.js 20 설치
2. `/opt/aps-backend` 구성 (index.js, package.json, .env, service-account.json)
3. systemd 서비스 등록
4. 포트 3001 방화벽 허용
5. SMS 발송: GCP3 경유 (권장) 또는 직접 발송

### 프론트엔드 (Electron)
1. Electron 의존성 설치
2. `electron/main.js` 작성
3. `src/config/api.js` API URL 수정
4. OAuth Redirect URI 추가
5. 빌드 및 배포

### 유지되는 GCP 컴포넌트
- GCP (고객 문의 접수)
- Firestore (데이터베이스)
- Firebase Storage (첨부파일)
- GCP-cleanup (자동 삭제)
- GCP3 (SMS 중계, 선택적)

**비용:** NAS 전기료만 (GCP 프리티어 유지)
