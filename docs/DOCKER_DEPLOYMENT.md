# Docker 배포 가이드

이 문서는 빌드된 Docker 이미지를 받아서 배포하는 방법을 설명합니다.

---

## 📦 사전 준비

### 1. Docker 설치 확인

```bash
docker --version
docker-compose --version
```

### 2. 이미지 pull (또는 레지스트리에서 받기)

```bash
# Docker Hub에서 받는 경우
docker pull your-registry/aps-backend:latest

# GCP Container Registry에서 받는 경우
docker pull gcr.io/your-project/aps-backend:latest

# 또는 로컬에서 빌드한 경우 (소스코드 있을 때만)
cd backend-local
docker build -t aps-backend:latest .
```

---

## 🚀 첫 배포 (처음 1회)

### Step 1: .env 파일 생성

배포할 서버에 `.env` 파일 생성:

```bash
mkdir -p /opt/aps-backend
cd /opt/aps-backend
nano .env
```

**최소 필수 내용:**
```env
# Database
DATABASE_URL=postgresql://apsuser:apspassword@db:5432/aps_admin

# JWT Secret (랜덤 문자열로 변경!)
JWT_SECRET=your-super-secret-jwt-key-change-this

# Firebase Admin (선택사항)
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# ZOHO Mail (비활성화)
ZOHO_ENABLED=false
```

**ZOHO Mail 사용 시 추가:**
```env
ZOHO_ENABLED=true
ZOHO_CLIENT_ID=1000.ABC123...
ZOHO_CLIENT_SECRET=abc123...
ZOHO_REDIRECT_URI=http://your-domain.com:3001/auth/zoho/callback
ZOHO_WEBHOOK_URL=http://your-domain.com:3001/api/zoho/webhook
ZOHO_WEBHOOK_SECRET=your-random-secret
ZOHO_ACCOUNT_EMAIL=your@zohomail.com
```

---

### Step 2: docker-compose.yml 생성

```yaml
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    container_name: aps-db
    environment:
      POSTGRES_USER: apsuser
      POSTGRES_PASSWORD: apspassword
      POSTGRES_DB: aps_admin
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U apsuser -d aps_admin"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    image: your-registry/aps-backend:latest
    container_name: aps-backend
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - .env
    ports:
      - "3001:3001"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://localhost:3001/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  postgres-data:
```

---

### Step 3: 컨테이너 시작

```bash
docker-compose up -d
```

**확인:**
```bash
docker-compose ps
```

출력:
```
NAME          IMAGE                              STATUS
aps-db        postgres:15-alpine                 Up (healthy)
aps-backend   your-registry/aps-backend:latest   Up (healthy)
```

---

### Step 4: 데이터베이스 초기 세팅 (1회만!)

컨테이너가 실행된 후, **반드시** DB 세팅을 실행해야 합니다:

```bash
docker exec -it aps-backend npm run setup-db
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
```

**이미 실행한 경우:**
```bash
⚠️  Already exists: 000_create_email_inquiries_table.sql (skipping)
```
→ 정상입니다. 여러 번 실행해도 안전합니다.

---

### Step 5: 서버 확인

```bash
# Health check
curl http://localhost:3001/health

# 로그 확인
docker logs aps-backend
```

**정상 로그:**
```
[Server] APS Admin Local Backend Server
[Server] Version: 1.1.0
[DB] PostgreSQL connected successfully
[Server] Local backend started on port 3001
[ZOHO] Integration disabled (또는 enabled)
```

---

## 🔄 업데이트 배포 (이미지 새 버전)

### 1. 새 이미지 받기

```bash
docker pull your-registry/aps-backend:latest
```

### 2. 컨테이너 재시작

```bash
docker-compose down
docker-compose up -d
```

**중요:** DB 세팅은 다시 실행할 필요 **없습니다**! (테이블이 이미 존재)

---

## 🔧 ZOHO Mail 설정 (선택사항)

### 1. .env에 ZOHO 설정 추가

```bash
nano .env
```

```env
ZOHO_ENABLED=true
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_ACCOUNT_EMAIL=your@zohomail.com
# ... 나머지 설정
```

### 2. 컨테이너 재시작

```bash
docker-compose restart backend
```

### 3. OAuth 인증 (브라우저)

```
http://your-domain.com:3001/auth/zoho
```

1. ZOHO 로그인
2. 권한 승인
3. 완료!

이후 15분마다 자동으로 이메일 동기화됩니다.

---

## 📊 모니터링

### 로그 확인

```bash
# 실시간 로그
docker logs -f aps-backend

# 최근 100줄
docker logs --tail 100 aps-backend

# DB 로그
docker logs -f aps-db
```

### 컨테이너 상태

```bash
docker-compose ps
docker stats aps-backend aps-db
```

### DB 접속

```bash
docker exec -it aps-db psql -U apsuser -d aps_admin
```

SQL:
```sql
-- 테이블 확인
\dt

-- 이메일 문의 확인
SELECT COUNT(*) FROM email_inquiries;
SELECT * FROM email_inquiries ORDER BY received_at DESC LIMIT 10;

-- ZOHO 토큰 확인
SELECT zoho_email, expires_at FROM zoho_oauth_tokens;
```

---

## 🚨 문제 해결

### 컨테이너가 시작하지 않음

```bash
# 로그 확인
docker logs aps-backend

# 네트워크 확인
docker network ls
docker network inspect aps_default
```

### DB 연결 실패

**증상:**
```
[DB] PostgreSQL connection failed
```

**해결:**
1. DB 컨테이너 상태 확인:
   ```bash
   docker-compose ps db
   ```

2. `.env`의 `DATABASE_URL` 확인:
   ```env
   # Docker Compose에서는 호스트명을 'db'로!
   DATABASE_URL=postgresql://apsuser:apspassword@db:5432/aps_admin
   ```

3. DB 재시작:
   ```bash
   docker-compose restart db
   ```

### 테이블이 없다는 에러

**증상:**
```
relation "email_inquiries" does not exist
```

**해결:**
```bash
# DB 세팅 실행 (안전하게 여러 번 실행 가능)
docker exec -it aps-backend npm run setup-db
```

### 포트 충돌

**증상:**
```
Bind for 0.0.0.0:3001 failed: port is already allocated
```

**해결:**
1. docker-compose.yml 수정:
   ```yaml
   ports:
     - "3002:3001"  # 외부:내부
   ```

2. 재시작:
   ```bash
   docker-compose up -d
   ```

---

## 🔐 보안 권장사항

### 1. JWT Secret 변경

`.env`:
```bash
# 절대 기본값 사용 금지!
JWT_SECRET=$(openssl rand -hex 32)
```

### 2. PostgreSQL 비밀번호 변경

docker-compose.yml:
```yaml
environment:
  POSTGRES_PASSWORD: strong-random-password-here
```

`.env`:
```env
DATABASE_URL=postgresql://apsuser:strong-random-password-here@db:5432/aps_admin
```

### 3. 외부 접근 제한

프로덕션에서는 DB 포트를 외부에 노출하지 마세요:

```yaml
# docker-compose.yml
services:
  db:
    # ports 섹션 제거 또는 주석
    # ports:
    #   - "5432:5432"
```

### 4. HTTPS 사용

Nginx 또는 Traefik 리버스 프록시로 HTTPS 설정 권장

---

## 📝 요약

### 첫 배포 체크리스트

- [ ] `.env` 파일 생성 및 설정
- [ ] `docker-compose.yml` 작성
- [ ] `docker-compose up -d` 실행
- [ ] `docker exec -it aps-backend npm run setup-db` 실행 (1회만!)
- [ ] `curl http://localhost:3001/health` 확인
- [ ] ZOHO 사용 시: OAuth 인증 (`/auth/zoho`)

### 업데이트 체크리스트

- [ ] `docker pull` 새 이미지
- [ ] `docker-compose down && docker-compose up -d`
- [ ] ~~DB 세팅 (필요 없음!)~~
- [ ] Health check 확인

---

**작성일**: 2025-12-20
**버전**: 1.0.0
