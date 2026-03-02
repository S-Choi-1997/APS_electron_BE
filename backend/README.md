# APS Admin Local Backend Server

로컬 Docker 환경에서 실행되는 APS Admin 백엔드 API 서버입니다.

## 🐳 Docker Hub

**이미지**: https://hub.docker.com/r/choho97/aps-admin-backend

```bash
# 최신 버전 다운로드
docker pull choho97/aps-admin-backend:latest

# 특정 버전 다운로드
docker pull choho97/aps-admin-backend:1.0.0
```

## 📋 개요

- **원본**: GCP Cloud Run (GCP2)
- **이식 목적**: 로컬 환경에서 Docker로 실행, 비용 절감
- **유지되는 부분**:
  - GCP Firestore (데이터베이스)
  - GCP Storage (첨부파일)
  - GCP3 SMS Relay (고정 IP 필요)
  - Google/Naver OAuth (인증)

## 🔧 사전 요구사항

### 필수
1. **Docker & Docker Compose**
   ```bash
   # 설치 확인
   docker --version
   docker-compose --version
   ```

2. **GCP CLI (gcloud)** - 서비스 계정 자동 생성용
   ```bash
   # 설치: https://cloud.google.com/sdk/docs/install

   # 로그인
   gcloud auth login

   # 프로젝트 설정
   gcloud config set project YOUR_PROJECT_ID
   ```

3. **인터넷 연결** - GCP Firestore/Storage, OAuth, GCP3 SMS Relay 접근 필요

### 선택
- **NAS/로컬 서버**: 24시간 실행 가능한 환경 (권장)

## 🚀 빠른 시작

### 방법 1: Quick Start 스크립트 (가장 간단)

Docker Hub에서 이미지를 받아서 바로 실행합니다.

**Linux/Mac**:
```bash
# 필수 파일 준비
# 1. .env 파일 생성 (환경 설정)
# 2. service-account.json 복사 (GCP 인증)

# Quick Start 실행
./quick-start.sh
```

**Windows**:
```powershell
# 필수 파일 준비
# 1. .env 파일 생성 (환경 설정)
# 2. service-account.json 복사 (GCP 인증)

# Quick Start 실행
.\quick-start.ps1
```

**스크립트가 자동으로**:
1. 환경 파일 확인
2. Docker Hub에서 최신 이미지 다운로드
3. 컨테이너 실행
4. 상태 확인

---

### 방법 2: Docker Hub에서 직접 실행

```bash
# 1. 이미지 다운로드
docker pull choho97/aps-admin-backend:latest

# 2. 실행 (.env와 service-account.json 필요)
docker run -d \
  --name aps-admin-backend \
  --restart unless-stopped \
  -p 3001:3001 \
  --env-file .env \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/service-account.json \
  -v $(pwd)/service-account.json:/app/service-account.json:ro \
  choho97/aps-admin-backend:latest

# 3. 상태 확인
docker logs aps-admin-backend
```

---

### 방법 3: 처음부터 설정 (GCP 서비스 계정 생성)

### 1. GCP 서비스 계정 생성 (자동화)

```bash
cd backend

# 스크립트 실행 권한 부여
chmod +x setup-gcp-service-account.sh

# 자동 생성 실행
./setup-gcp-service-account.sh
```

**생성되는 파일**:
- `service-account.json` - GCP 인증 키 (절대 Git에 커밋하지 마세요!)
- `.env` - 환경 변수 파일 (자동 생성, 수정 필요)

**부여되는 권한**:
- `roles/datastore.user` - Firestore 읽기/쓰기
- `roles/storage.objectAdmin` - Storage 파일 접근

### 2. 환경 변수 설정

`.env` 파일을 편집하여 필수 값 입력:

```env
# 필수 입력 항목
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
ALLOWED_EMAILS=your@email.com,admin@email.com
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
ALIGO_API_KEY=your_aligo_api_key
ALIGO_USER_ID=your_aligo_user_id
ALIGO_SENDER_PHONE=01012345678
```

**중요**: `GOOGLE_APPLICATION_CREDENTIALS`는 환경에 맞게 설정:
- **로컬 개발**: 절대 경로 (예: `E:/Projects/APS/APS_APP/backend/service-account.json`)
- **도커 환경**: `/app/service-account.json` (docker-compose.yml이 자동 설정)

### 3. Docker 실행

```bash
# 컨테이너 빌드 및 시작
docker-compose up -d

# 로그 확인
docker-compose logs -f

# 상태 확인
docker-compose ps
```

### 4. 테스트

```bash
# Health check
curl http://localhost:3001/

# 예상 응답:
# {"status":"ok","service":"aps-admin-local-backend","version":"1.0.0","environment":"local"}
```

## 📁 디렉토리 구조

```
backend/
├── server.js                      # 백엔드 서버 코드 (GCP2 이식)
├── package.json                   # Node.js 의존성
├── Dockerfile                     # Docker 이미지 정의
├── docker-compose.yml             # Docker Compose 설정
├── .env.example                   # 환경 변수 템플릿
├── .env                           # 실제 환경 변수 (생성 필요, Git 무시)
├── service-account.json           # GCP 서비스 계정 키 (생성 필요, Git 무시)
├── setup-gcp-service-account.sh   # GCP 자동 설정 스크립트
└── README.md                      # 이 파일
```

## 🔐 보안

### Git에서 제외해야 할 파일 (.gitignore에 추가)

```
backend/.env
backend/service-account.json
backend/service-account.json.backup.*
```

### 환경 변수 보안

- `.env` 파일에 민감한 정보 저장 (절대 Git에 커밋하지 마세요!)
- `service-account.json`은 GCP 인증 키이므로 절대 외부 노출 금지
- `ALLOWED_EMAILS`로 접근 가능한 이메일만 제한

## 🛠️ 일반 작업

### 서버 시작/중지

```bash
# 시작
docker-compose up -d

# 중지
docker-compose down

# 재시작
docker-compose restart

# 로그 실시간 보기
docker-compose logs -f
```

### 컨테이너 내부 접근

```bash
docker-compose exec aps-backend sh
```

### 코드 수정 시 재배포

```bash
# 컨테이너 중지 및 삭제
docker-compose down

# 이미지 재빌드 및 시작
docker-compose up -d --build
```

### 환경 변수 변경

```bash
# .env 파일 수정 후 재시작
docker-compose restart
```

## 🔍 문제 해결

### 1. "GCP 서비스 계정 인증 실패"

```bash
# service-account.json 파일 확인
ls -lh service-account.json

# 환경변수 확인
echo $GOOGLE_APPLICATION_CREDENTIALS  # Linux/Mac
echo %GOOGLE_APPLICATION_CREDENTIALS%  # Windows

# .env 파일에서 GOOGLE_APPLICATION_CREDENTIALS 경로 확인
cat .env | grep GOOGLE_APPLICATION_CREDENTIALS

# 권한 확인 (GCP Console)
# IAM 및 관리자 → 서비스 계정 → 권한 확인
```

### 2. "Firestore 접근 불가"

```bash
# GCP 프로젝트 ID 확인
cat service-account.json | grep project_id

# Firestore API 활성화 확인 (GCP Console)
# Firestore → 데이터베이스 생성 확인
```

### 3. "포트 3001이 이미 사용 중"

```bash
# 포트 사용 중인 프로세스 확인
netstat -ano | findstr :3001  # Windows
lsof -i :3001                 # Linux/Mac

# docker-compose.yml에서 포트 변경
ports:
  - "3002:3001"  # 호스트:컨테이너
```

### 4. "SMS 발송 실패"

- GCP3 Relay 서버 상태 확인: http://136.113.67.193:3000/
- Aligo API 키 확인
- `.env`의 `RELAY_URL` 확인

## 📊 API 엔드포인트

### 인증 불필요

- `GET /` - Health check
- `POST /auth/naver/token` - Naver OAuth 토큰 교환

### 인증 필요 (Bearer Token)

- `GET /inquiries` - 문의 목록 조회
- `GET /inquiries/:id` - 문의 상세 조회
- `PATCH /inquiries/:id` - 문의 수정
- `DELETE /inquiries/:id` - 문의 삭제
- `GET /inquiries/:id/attachments/urls` - 첨부파일 URL 발급
- `POST /sms/send` - SMS 발송

**헤더 요구사항**:
```
Authorization: Bearer <google_or_naver_access_token>
X-Provider: google|naver
```

## 🌐 프론트엔드 연동

Electron 앱의 환경 변수 설정:

### .env.production (프론트엔드)
```env
VITE_API_URL=http://192.168.0.100:3001  # 로컬 백엔드 주소
```

**주의**: 로컬 네트워크 IP 주소 확인 필요

## 📦 배포 (NAS/로컬 서버)

### OMV NAS에 배포

1. **파일 전송** (SCP/Samba)
   ```bash
   # 로컬 PC에서
   scp -r backend/* user@nas-ip:/path/to/backend/
   ```

2. **NAS에서 실행**
   ```bash
   cd /path/to/backend
   docker-compose up -d
   ```

3. **자동 시작 설정**
   ```bash
   # docker-compose.yml에 이미 설정됨
   restart: unless-stopped
   ```

### 방화벽 설정

```bash
# OMV NAS에서 3001 포트 개방
sudo ufw allow 3001/tcp
```

## 🔄 GCP2 (Cloud Run) vs 로컬 백엔드

| 항목 | GCP2 (기존) | 로컬 백엔드 (신규) |
|------|-------------|-------------------|
| 호스팅 | Cloud Run | Docker (NAS/로컬) |
| 비용 | 사용량 기반 (유료) | 하드웨어 비용 (초기) |
| URL | https://inquiryapi-... | http://192.168.0.x:3001 |
| 인증 | 자동 (GCP IAM) | service-account.json |
| 로그 | Cloud Logging | docker-compose logs |
| 스케일링 | 자동 | 수동 |

## 📝 참고 문서

- [CLAUDE.md](../CLAUDE.md) - 프로젝트 전체 구조
- [ELECTRON_MIGRATION.md](../ELECTRON_MIGRATION.md) - 마이그레이션 가이드
- [GCP2 원본 코드](../legacy/GCP2/) - 원본 Cloud Run 코드

## 🆘 지원

문제가 발생하면:
1. 로그 확인: `docker-compose logs -f`
2. GCP Console에서 서비스 계정 권한 확인
3. `.env` 파일 설정 재확인
4. [ELECTRON_MIGRATION.md](../ELECTRON_MIGRATION.md) 참고
