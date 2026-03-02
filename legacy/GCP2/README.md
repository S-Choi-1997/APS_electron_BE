# GCP2 - 백엔드 API (Cloud Run)

## 개요
APS Consulting 관리 시스템의 백엔드 API입니다.
- **플랫폼**: GCP Cloud Run
- **언어**: Node.js 20 + Express
- **데이터베이스**: Firestore
- **인증**: Google OAuth, Naver OAuth
- **스토리지**: Firebase Storage (첨부파일)

## 배포 URL
https://inquiryapi-mbi34yrklq-uc.a.run.app

## 주요 기능

### 1. 인증 시스템
- Google/Naver OAuth 토큰 검증
- 이메일 기반 접근 제어 (ALLOWED_EMAILS)
- 허가되지 않은 이메일 차단

### 2. 문의 관리 API
- 문의 목록 조회 (GET /inquiries)
- 문의 상세 조회 (GET /inquiries/:id)
- 문의 업데이트 (PATCH /inquiries/:id)
- 문의 삭제 (DELETE /inquiries/:id)

### 3. 첨부파일 처리
- Firebase Storage 서명된 URL 발급
- 첨부파일 다운로드 (GET /inquiries/:id/attachments/urls)

### 4. SMS 발송
- Aligo API 연동
- SMS Relay 서버를 통한 발송 (고정 IP)
- 발송 실패 시 에러 처리

### 5. Naver OAuth
- 토큰 교환 엔드포인트 (POST /auth/naver/token)
- 프론트엔드에서 인가 코드로 토큰 발급

## API 엔드포인트

### Health Check
```
GET /
```

### 인증 (Authentication)
```
POST /auth/naver/token
Content-Type: application/json

Body:
{
  "code": "네이버 인가 코드",
  "state": "state 값"
}

Response:
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

### 문의 관리 (Inquiries)

**모든 엔드포인트는 인증 필수**
```
Authorization: Bearer <access-token>
X-Provider: google | naver
```

#### 문의 목록 조회
```
GET /inquiries

Response:
{
  "status": "ok",
  "data": [
    {
      "id": "doc-id",
      "name": "홍길동",
      "phone": "010-1234-5678",
      "email": "test@example.com",
      "type": "비자",
      "message": "문의 내용",
      "check": false,
      "createdAt": "2024-12-04T10:00:00Z",
      "attachments": [...]
    }
  ]
}
```

#### 문의 상세 조회
```
GET /inquiries/:id
```

#### 문의 업데이트
```
PATCH /inquiries/:id
Content-Type: application/json

Body:
{
  "check": true,
  "notes": "메모"
}
```

#### 문의 삭제
```
DELETE /inquiries/:id
```

#### 첨부파일 URL 발급
```
GET /inquiries/:id/attachments/urls

Response:
{
  "status": "ok",
  "data": [
    {
      "name": "file.pdf",
      "type": "application/pdf",
      "size": 12345,
      "downloadUrl": "https://storage.googleapis.com/..."
    }
  ]
}
```

### SMS 발송
```
POST /sms/send
Content-Type: application/json

Body:
{
  "receiver": "01012345678",
  "msg": "메시지 내용"
}

Response:
{
  "status": "ok",
  "message": "SMS sent successfully",
  "data": {
    "result_code": 1,
    "message": "success"
  }
}
```

## 환경변수 (.env)

```env
# CORS 설정
ALLOWED_ORIGINS=https://admin.apsconsulting.kr,http://localhost:5173

# 접근 허용 이메일 (콤마로 구분)
ALLOWED_EMAILS=admin@example.com,manager@example.com

# Firebase
STORAGE_BUCKET=your-project.appspot.com
GCLOUD_PROJECT=your-project-id

# Naver OAuth
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
NAVER_REDIRECT_URI=https://admin.apsconsulting.kr/naver-callback.html

# Aligo SMS
ALIGO_API_KEY=your_aligo_api_key
ALIGO_USER_ID=your_aligo_user_id
ALIGO_SENDER_PHONE="0317011663"

# SMS Relay 서버
RELAY_URL=http://136.113.67.193:3000
```

## 배포 방법

### Windows (PowerShell)
```powershell
cd GCP2
.\deploy.ps1
```

### Windows (CMD)
```cmd
cd GCP2
deploy.bat
```

### 수동 배포
```bash
cd GCP2

# 환경변수를 Cloud Run에 설정하며 배포
gcloud run deploy inquiryapi \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars ALLOWED_ORIGINS=https://admin.apsconsulting.kr,...
```

## 개발 가이드

### 로컬 실행
```bash
cd GCP2
npm install

# .env 파일 생성 (.env.example 참고)
cp .env.example .env

# 로컬 서버 실행
npm start
```

### 로그 확인
```bash
gcloud run services logs read inquiryapi --region=us-central1 --limit=50
```

## 보안

### 1. 이메일 기반 접근 제어
- `ALLOWED_EMAILS` 환경변수에 등록된 이메일만 API 접근 가능
- 토큰 검증 후 이메일 확인

### 2. CORS 정책
- `ALLOWED_ORIGINS`에 등록된 도메인만 요청 허용

### 3. OAuth 토큰 검증
- Google: `googleapis.com/oauth2/v3/tokeninfo`
- Naver: `openapi.naver.com/v1/nid/me`

### 4. SMS 보안
- Relay 서버를 통한 간접 발송
- API 키는 환경변수로 관리

## 파일 구조

```
GCP2/
├── index.js              # 메인 Express 앱
├── server.js             # Cloud Run 엔트리포인트
├── package.json          # 의존성
├── .env                  # 환경변수 (gitignore)
├── .env.example          # 환경변수 예시
├── deploy.ps1            # PowerShell 배포 스크립트
├── deploy.bat            # CMD 배포 스크립트
├── Dockerfile            # Docker 설정 (선택)
└── README.md             # 이 파일
```

## 트러블슈팅

### 403 Forbidden (이메일 차단)
- `ALLOWED_EMAILS`에 사용자 이메일 추가
- 대소문자 구분 없음

### SMS 발송 실패
- Relay 서버 상태 확인 (136.113.67.193:3000)
- Aligo API 키 확인
- 전화번호 형식 확인 (하이픈 제거)

### Naver 로그인 실패
- `NAVER_REDIRECT_URI`가 네이버 앱 설정과 일치하는지 확인
- 클라이언트 시크릿 확인
