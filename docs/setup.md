# 개발 환경 세팅

## 사전 조건

- Node.js 18+
- Docker Desktop (backend/ 로컬 실행 시)
- Git

## Electron 앱 (루트)

```bash
npm install

# 개발 모드 (Vite + Electron + HMR)
npm run electron:dev

# 빌드
npm run electron:build

# GitHub Release 생성
npm run release
```

### 환경 변수 (`.env.development`)

```
VITE_API_URL=https://inquiryapi-mbi34yrklq-uc.a.run.app   # GCP2 개발용 API
VITE_GOOGLE_CLIENT_ID=...
VITE_NAVER_CLIENT_ID=...
VITE_NAVER_REDIRECT_URI=http://localhost:5173/naver-callback.html
VITE_RELAY_ENVIRONMENT=development
```

### 환경 변수 (`.env.production`)

```
VITE_API_URL=http://136.113.67.193:8080/proxy   # GCP4 Relay
VITE_RELAY_ENVIRONMENT=production
```

## Backend (NAS Docker)

```bash
cd backend/

# .env 파일 생성 (.env.example 참조)
cp .env.example .env

# Docker로 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f aps-backend
```

### backend/.env 주요 항목

```
PORT=3001
DATABASE_URL=postgresql://...
RELAY_WS_URL=ws://136.113.67.193:8080
RELAY_ENVIRONMENT=production
BACKEND_INSTANCE_ID=nas-backend
RELAY_URL=http://136.113.67.193:3000/sms/send
JWT_SECRET=...
```

Docker Hub: `choho97/aps-admin-backend:dev` (GitHub Actions 자동 빌드)

## SMS Relay (`sms-relay/`)

GCP3 VM에서 운영 중. 수정 시:

```bash
gcloud compute ssh aligo-proxy --zone=us-central1-a
cd ~/sms-relay
# 파일 수정 후
sudo systemctl restart sms-relay
sudo systemctl status sms-relay
```

## Customer API (`customer-api/`)

GCP Cloud Run에 독립 배포. 수정 시 Cloud Run에 별도 배포 필요.

## Cleanup (`cleanup/`)

GCP Cloud Function. 수정 시 `gcloud functions deploy`로 별도 배포.
