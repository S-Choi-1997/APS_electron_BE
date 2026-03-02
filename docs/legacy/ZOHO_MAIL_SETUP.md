# ZOHO Mail Integration Setup Guide

이 문서는 APS Admin 앱에서 ZOHO Mail을 연동하는 방법을 설명합니다.

## 📋 목차

1. [사전 요구사항](#사전-요구사항)
2. [ZOHO API Console 설정](#zoho-api-console-설정)
3. [데이터베이스 마이그레이션](#데이터베이스-마이그레이션)
4. [환경 변수 설정](#환경-변수-설정)
5. [OAuth 인증 수행](#oauth-인증-수행)
6. [동기화 시작](#동기화-시작)
7. [Webhook 설정 (선택사항)](#webhook-설정-선택사항)
8. [문제 해결](#문제-해결)

---

## 사전 요구사항

- ZOHO Mail 계정
- ZOHO API Console 접근 권한
- 백엔드 서버 실행 중 (localhost:3001 또는 GCP)

---

## ZOHO API Console 설정

### 1. ZOHO API Console 접속

https://api-console.zoho.com/ 접속

### 2. Client 등록

1. **"ADD CLIENT"** 버튼 클릭
2. **Client Type**: "Server-based Applications" 선택
3. **Client Name**: "APS Admin Mail Integration" (원하는 이름)
4. **Homepage URL**: `http://136.113.67.193:3001` (또는 로컬: `http://localhost:3001`)
5. **Authorized Redirect URIs**:
   ```
   http://136.113.67.193:3001/auth/zoho/callback
   ```
   (로컬 테스트: `http://localhost:3001/auth/zoho/callback`)

### 3. Client ID와 Secret 복사

생성 후 표시되는 **Client ID**와 **Client Secret**을 안전한 곳에 복사해둡니다.

### 4. Scope 설정

다음 스코프들이 필요합니다:
- `ZohoMail.messages.READ` - 메일 읽기
- `ZohoMail.folders.READ` - 폴더 읽기
- `ZohoMail.accounts.READ` - 계정 정보 읽기

---

## 데이터베이스 마이그레이션

백엔드 서버가 실행 중인 상태에서 다음 SQL 파일들을 순서대로 실행합니다:

```bash
cd backend-local/migrations

# 1. 이메일 문의 테이블 생성
psql -U apsuser -d aps_admin -f 000_create_email_inquiries_table.sql

# 2. source 컬럼 추가 (이미 테이블이 있는 경우)
psql -U apsuser -d aps_admin -f 001_add_source_column.sql

# 3. ZOHO OAuth 토큰 테이블 생성
psql -U apsuser -d aps_admin -f 002_create_zoho_tokens_table.sql
```

**확인:**
```sql
\d email_inquiries
\d zoho_oauth_tokens
```

---

## 환경 변수 설정

`backend-local/.env` 파일을 수정합니다:

```bash
# ZOHO Mail Integration (Optional)
ZOHO_ENABLED=true

# ZOHO OAuth 2.0 Credentials (from API Console)
ZOHO_CLIENT_ID=your_client_id_here
ZOHO_CLIENT_SECRET=your_client_secret_here

# OAuth Redirect URI (must match API Console)
ZOHO_REDIRECT_URI=http://136.113.67.193:3001/auth/zoho/callback

# Webhook Configuration (for real-time updates)
ZOHO_WEBHOOK_URL=http://136.113.67.193:3001/api/zoho/webhook
ZOHO_WEBHOOK_SECRET=your_webhook_secret_here

# ZOHO Account Email to Monitor
ZOHO_ACCOUNT_EMAIL=your@email.com
```

**중요:**
- `ZOHO_CLIENT_ID`와 `ZOHO_CLIENT_SECRET`을 API Console에서 복사한 값으로 변경
- `ZOHO_ACCOUNT_EMAIL`을 모니터링할 ZOHO 계정 이메일로 변경
- 로컬 테스트 시 `localhost:3001`로 변경

---

## OAuth 인증 수행

### 1. 백엔드 서버 재시작

환경 변수를 변경했으므로 서버를 재시작합니다:

```bash
cd backend-local
npm start
```

콘솔에서 다음 메시지 확인:
```
✓ ZOHO Mail integration enabled
```

### 2. 브라우저에서 OAuth 시작

브라우저에서 다음 URL로 접속:

```
http://136.113.67.193:3001/auth/zoho
```

(로컬: `http://localhost:3001/auth/zoho`)

### 3. ZOHO 로그인 및 권한 승인

1. ZOHO 계정으로 로그인
2. 권한 요청 확인 (메일 읽기 권한)
3. **"Accept"** 클릭

### 4. 인증 성공 확인

성공 시 다음 메시지가 표시됩니다:

```
✅ Authorization Successful
ZOHO Mail integration is now active for: your@email.com
```

백엔드 콘솔에서도 확인:
```
[ZOHO OAuth] Authorization successful for: your@email.com
[ZOHO DB] OAuth tokens saved for: your@email.com
```

---

## 동기화 시작

### 1. 수동 동기화 (테스트)

브라우저나 Postman에서:

```bash
POST http://136.113.67.193:3001/api/zoho/sync
Authorization: Bearer YOUR_ACCESS_TOKEN
```

### 2. 자동 주기적 동기화 (권장)

`backend-local/server.js`의 ZOHO 섹션에 다음 코드 추가:

```javascript
// Start periodic sync (every 15 minutes)
if (process.env.ZOHO_CLIENT_ID && process.env.ZOHO_ENABLED === 'true') {
  // ... existing code ...

  // Add this after routes:
  zoho.startPeriodicSync(15); // 15 minutes interval

  console.log('✓ ZOHO Mail integration enabled');
}
```

서버 재시작 시 자동으로 15분마다 동기화됩니다.

### 3. 동기화 확인

프론트엔드에서 "이메일 상담" 페이지로 이동하면 ZOHO에서 가져온 이메일들이 표시됩니다.

---

## Webhook 설정 (선택사항)

실시간 업데이트를 위해 ZOHO Webhook을 설정할 수 있습니다.

### 1. ZOHO Mail Webhook 설정

ZOHO Mail 설정 페이지에서:
- Webhook URL: `http://136.113.67.193:3001/api/zoho/webhook`
- Secret: `.env`의 `ZOHO_WEBHOOK_SECRET`과 동일한 값
- Events: "New Mail Received" 선택

### 2. 작동 확인

새 이메일이 도착하면 백엔드 콘솔에서:
```
[ZOHO Webhook] Received webhook event
[ZOHO Webhook] Processing new message: ...
[ZOHO DB] Email inquiry saved: ...
```

---

## 문제 해결

### OAuth 인증 실패

**증상**: Authorization Failed 페이지

**해결책**:
1. `.env`의 `ZOHO_CLIENT_ID`와 `ZOHO_CLIENT_SECRET` 확인
2. `ZOHO_REDIRECT_URI`가 API Console에 등록된 URI와 정확히 일치하는지 확인
3. 백엔드 서버가 실행 중인지 확인

### 토큰 만료

**증상**: "No OAuth tokens found" 에러

**해결책**:
1. OAuth 인증을 다시 수행: `http://136.113.67.193:3001/auth/zoho`
2. 토큰은 자동으로 갱신되므로 한 번만 인증하면 됩니다

### 동기화 실패

**증상**: 이메일이 표시되지 않음

**해결책**:
1. 백엔드 콘솔에서 에러 로그 확인
2. OAuth 토큰이 유효한지 확인 (DB 조회):
   ```sql
   SELECT * FROM zoho_oauth_tokens;
   ```
3. ZOHO API 호출 제한 확인 (rate limit)

### 데이터베이스 에러

**증상**: "relation does not exist" 에러

**해결책**:
1. 마이그레이션 파일을 모두 실행했는지 확인
2. 테이블 존재 여부 확인:
   ```sql
   \dt email_inquiries
   \dt zoho_oauth_tokens
   ```

---

## API 엔드포인트

### OAuth
- `GET /auth/zoho` - OAuth 인증 시작
- `GET /auth/zoho/callback` - OAuth 콜백

### Sync
- `POST /api/zoho/sync` - 수동 동기화 (인증 필요)

### Webhook
- `POST /api/zoho/webhook` - ZOHO Webhook 수신

---

## 보안 권장사항

1. **환경 변수 보호**: `.env` 파일을 Git에 커밋하지 마세요
2. **HTTPS 사용**: 프로덕션에서는 HTTPS 필수
3. **Webhook Secret**: 강력한 랜덤 문자열 사용
4. **토큰 보안**: 데이터베이스 암호화 고려

---

## 참고 자료

- [ZOHO Mail API Documentation](https://www.zoho.com/mail/help/api/)
- [ZOHO OAuth 2.0 Guide](https://www.zoho.com/accounts/protocol/oauth/web-server-applications.html)
- [Backend ZOHO Module](../backend-local/zoho/)

---

**작성일**: 2025-12-19
**버전**: 1.0.0
