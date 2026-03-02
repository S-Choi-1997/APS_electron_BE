# APS Admin - 첫 실행 가이드

이 문서는 APS Admin 앱을 처음 설치하고 실행하는 방법을 설명합니다.

---

## 📋 사전 요구사항

- Docker & Docker Compose 설치됨
- Git 저장소 클론 완료
- PostgreSQL 컨테이너 실행 중

---

## 🚀 첫 실행 단계

### 1. 데이터베이스 초기 세팅

백엔드 디렉토리로 이동 후 DB 세팅 스크립트 실행:

```bash
cd backend-local
npm run setup-db
```

**출력 예시:**
```
🚀 Starting database setup...

📄 Running: 000_create_email_inquiries_table.sql
✅ Success: 000_create_email_inquiries_table.sql

📄 Running: 001_add_source_column.sql
✅ Success: 001_add_source_column.sql

📄 Running: 002_create_zoho_tokens_table.sql
✅ Success: 002_create_zoho_tokens_table.sql

✅ Database setup completed!

You can now start the server with: npm start
```

**만약 이미 테이블이 있다면:**
```
⚠️  Already exists: 000_create_email_inquiries_table.sql (skipping)
```
→ 정상입니다. 계속 진행하세요.

---

### 2. 환경 변수 설정

#### 기본 설정 (ZOHO 비활성화)

`.env` 파일이 이미 있으면 그대로 사용:
```env
# Database
DATABASE_URL=postgresql://apsuser:apspassword@localhost:5432/aps_admin

# Firebase Admin (선택사항)
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# JWT Secret
JWT_SECRET=your-secret-key-here

# ZOHO Mail Integration (비활성화)
ZOHO_ENABLED=false
```

#### ZOHO Mail 사용 시

ZOHO Mail을 사용하려면 [ZOHO_MAIL_SETUP.md](./ZOHO_MAIL_SETUP.md)를 참고하여 설정하세요.

---

### 3. 서버 시작

```bash
# 백엔드 서버 시작
cd backend-local
npm start
```

**정상 출력:**
```
[Server] APS Admin Local Backend Server
[Server] Version: 1.1.0
[Server] Environment: development
[Server] Port: 3001

[DB] PostgreSQL connected successfully
[Server] Local backend started on port 3001

[ZOHO] Integration disabled
```

---

### 4. 프론트엔드 실행

```bash
# 새 터미널에서
cd ..  # 프로젝트 루트로
npm run electron:dev
```

---

## 🐳 Docker로 실행 (권장)

### 한 번에 모든 서비스 시작

```bash
# 프로젝트 루트에서
docker-compose up -d
```

### 컨테이너 안에서 DB 세팅

```bash
# DB 컨테이너 이름 확인
docker ps

# 백엔드 컨테이너에서 DB 세팅 실행
docker exec -it aps-backend npm run setup-db
```

**또는 직접 SQL 실행:**
```bash
docker exec -i aps-db psql -U apsuser -d aps_admin < backend-local/migrations/000_create_email_inquiries_table.sql
docker exec -i aps-db psql -U apsuser -d aps_admin < backend-local/migrations/001_add_source_column.sql
docker exec -i aps-db psql -U apsuser -d aps_admin < backend-local/migrations/002_create_zoho_tokens_table.sql
```

---

## ✅ 확인 방법

### 1. 백엔드 서버 확인

브라우저에서:
```
http://localhost:3001/health
```

응답:
```json
{
  "status": "ok",
  "timestamp": "2025-12-20T..."
}
```

### 2. 데이터베이스 확인

PostgreSQL에 접속:
```bash
# 로컬
psql -U apsuser -d aps_admin

# Docker
docker exec -it aps-db psql -U apsuser -d aps_admin
```

테이블 확인:
```sql
\dt
```

출력:
```
 public | email_inquiries      | table | apsuser
 public | zoho_oauth_tokens    | table | apsuser
```

### 3. 프론트엔드 확인

Electron 앱이 실행되고 로그인 화면이 표시되면 성공!

---

## 🔧 문제 해결

### DB 연결 실패

**증상:**
```
[DB] PostgreSQL connection failed
```

**해결책:**
1. PostgreSQL 컨테이너 실행 중인지 확인:
   ```bash
   docker ps | grep postgres
   ```

2. `.env`의 `DATABASE_URL` 확인:
   ```env
   DATABASE_URL=postgresql://apsuser:apspassword@localhost:5432/aps_admin
   ```

3. Docker Compose로 실행 시 호스트를 `db`로 변경:
   ```env
   DATABASE_URL=postgresql://apsuser:apspassword@db:5432/aps_admin
   ```

### 테이블 생성 실패

**증상:**
```
❌ Error running 000_create_email_inquiries_table.sql
```

**해결책:**
1. PostgreSQL 사용자 권한 확인
2. 데이터베이스 `aps_admin`이 존재하는지 확인:
   ```sql
   \l
   ```
3. 없다면 생성:
   ```sql
   CREATE DATABASE aps_admin;
   ```

### 포트 충돌

**증상:**
```
Error: listen EADDRINUSE: address already in use :::3001
```

**해결책:**
1. 기존 프로세스 종료:
   ```bash
   # Windows
   netstat -ano | findstr :3001
   taskkill /PID <PID> /F

   # Linux/Mac
   lsof -ti:3001 | xargs kill -9
   ```

2. 또는 `.env`에서 포트 변경:
   ```env
   PORT=3002
   ```

---

## 📚 다음 단계

- [ ] [관리자 계정 생성](./ADMIN_ACCOUNT_GUIDE.md)
- [ ] [ZOHO Mail 연동](./ZOHO_MAIL_SETUP.md) (선택사항)
- [ ] [배포 가이드](./RELEASE_GUIDE.md) (프로덕션)

---

**작성일**: 2025-12-20
**버전**: 1.0.0
