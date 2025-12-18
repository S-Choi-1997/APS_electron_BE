# JWT 인증 시스템 마이그레이션 문서

## 📋 개요

**날짜**: 2025-12-14
**목적**: OAuth (Google/Naver) → 자체 JWT 인증 시스템 전환
**핵심 이유**: 자동 로그인 기능 구현 (OAuth는 브라우저 보안정책으로 자동 팝업 불가)

---

## 🎯 마이그레이션 목표

### 기존 시스템 문제점
- **OAuth 자동 로그인 불가**: 토큰 갱신 시 사용자 팝업 필요 (브라우저가 자동 팝업 차단)
- **복잡한 인증 흐름**: Google/Naver 두 가지 OAuth 프로바이더 관리
- **외부 의존성**: Google/Naver API 장애 시 로그인 불가

### 새 시스템 목표
- ✅ **자동 로그인**: Refresh Token으로 사용자 개입 없이 자동 재인증
- ✅ **단순화**: 이메일/비밀번호 기반 단일 인증 시스템
- ✅ **독립성**: 외부 OAuth 서비스 의존도 제거
- ✅ **Firestore 화이트리스트**: 동적 접근 제어 (환경변수 대신)

---

## 🏗️ 아키텍처 변경

### Before (OAuth)
```
Frontend → OAuth Popup (Google/Naver) → accessToken
         ↓
Backend → Google/Naver API 검증 → ALLOWED_EMAILS 체크
```

### After (JWT)
```
Frontend → Email/Password Form → Backend /auth/login
         ↓
Backend → PostgreSQL 사용자 확인 → Firestore 화이트리스트 체크 → JWT 발급
         ↓
Frontend → accessToken (1h) + refreshToken (30d) 저장
         ↓
Auto-Login → /auth/refresh → 새 accessToken 발급 (사용자 개입 없음!)
```

---

## 📦 주요 변경 사항

### 1. Backend 변경사항

#### 새로 추가된 파일
- **`backend-local/auth.js`** (189 lines)
  - JWT 생성/검증 로직
  - Firestore 화이트리스트 체크
  - bcrypt 비밀번호 해싱
  - `authenticateJWT` 미들웨어

- **`backend-local/create-admin.js`** (130 lines)
  - 관리자 계정 생성 스크립트
  - 사용법: `node create-admin.js <email> <password> [displayName]`

- **`backend-local/init-whitelist.js`** (100 lines)
  - Firestore 화이트리스트 초기화 스크립트
  - 사용법: `node init-whitelist.js <email> <role>`

#### 수정된 파일
- **`backend-local/server.js`**
  - Line 32: `const auth = require("./auth");` 추가
  - Lines 385-590: 새 인증 엔드포인트 추가
    - `POST /auth/login`: 이메일/비밀번호 로그인
    - `POST /auth/refresh`: Refresh Token으로 자동 재인증 ⭐
    - `POST /auth/logout`: 로그아웃 (Refresh Token 무효화)
    - `POST /auth/register`: 신규 사용자 등록
  - 모든 `authenticate` 미들웨어를 `auth.authenticateJWT`로 교체

- **`backend-local/init-db.sql`**
  - Line 10-20: `users` 테이블 스키마 수정
    - `password_hash VARCHAR(255)` 컬럼 추가
    - `provider` 기본값을 `'local'`로 변경

- **`backend-local/package.json`**
  - 새 의존성 추가:
    - `bcrypt: ^6.0.0` (비밀번호 해싱)
    - `jsonwebtoken: ^9.0.3` (JWT 생성/검증)

- **`backend-local/.env`**
  - Lines 33-45: JWT 및 DB 설정 추가
    ```env
    JWT_SECRET=aps-admin-jwt-secret-key-change-this-to-random-string-minimum-32-characters
    JWT_REFRESH_SECRET=aps-admin-refresh-secret-key-change-this-to-random-string-minimum-32-characters
    JWT_EXPIRES_IN=1h
    JWT_REFRESH_EXPIRES_IN=30d

    DB_HOST=localhost
    DB_PORT=5432
    DB_NAME=aps_admin
    DB_USER=apsuser
    DB_PASSWORD=aps_secure_password_2025
    ```

- **`backend-local/docker-compose.yml`**
  - Line 42: `- ./auth.js:/app/auth.js` 볼륨 마운트 추가

---

### 2. Frontend 변경사항

#### 새로 추가된 파일
- **`src/auth/localAuth.js`** (232 lines)
  - `signInWithLocal(email, password)`: 로그인 함수
  - `restoreSession()`: ⭐ 자동 로그인 핵심 함수
    - localStorage에서 refreshToken 읽기
    - `/auth/refresh` 호출하여 새 accessToken 발급
    - **사용자 개입 없이 자동 실행!**
  - `signOut()`: 로그아웃 함수
  - localStorage 관리 함수들

#### 수정된 파일
- **`src/auth/authManager.js`** (177 lines)
  - OAuth 관련 import 제거 (googleAuth, naverAuth)
  - `localAuth` import 추가
  - `restoreSession()` 함수 추가 (모듈 로드 시 자동 실행)
  - Line 170-177: 앱 시작 시 자동으로 세션 복구 시도

- **`src/components/LoginPage.jsx`** (110 lines)
  - Google/Naver OAuth 버튼 제거
  - 이메일/비밀번호 입력 폼 추가
  - `handleSubmit`: `signInWithLocal()` 호출

- **`src/components/LoginPage.css`** (Lines 60-134)
  - `.login-form`: 폼 스타일
  - `.form-group`: 입력 필드 그룹
  - `.login-error`: 에러 메시지 스타일
  - `.login-submit-btn`: 로그인 버튼 스타일

- **`src/config/api.js`**
  - Lines 10-11: `export const API_URL` 추가 (localAuth.js에서 사용)

---

## 🔐 보안 설계

### JWT 토큰 전략
- **Access Token**: 1시간 유효, API 요청에 사용
- **Refresh Token**: 30일 유효, Access Token 갱신에만 사용
- **Storage**: localStorage (`aps-local-auth-user` 키)

### 비밀번호 해싱
- **알고리즘**: bcrypt
- **Salt Rounds**: 12
- **최소 길이**: 8자

### 화이트리스트 관리
- **저장소**: GCP Firestore `whitelist` 컬렉션
- **구조**:
  ```javascript
  {
    email: "user@example.com",  // Document ID
    role: "admin" | "user",
    active: true,
    createdAt: Timestamp
  }
  ```

---

## 🚀 배포 가이드

### 1. 백엔드 배포

#### Step 1: 환경 변수 설정
```bash
cd backend-local
# .env 파일에서 JWT_SECRET, JWT_REFRESH_SECRET을 강력한 랜덤 문자열로 변경
```

#### Step 2: Docker 재빌드 및 시작
```bash
# 패키지 설치를 위해 이미지 재빌드 필요
docker-compose build aps-backend

# 볼륨 삭제하고 깨끗하게 시작 (기존 DB 데이터 삭제됨!)
docker-compose down -v
docker-compose up -d
```

#### Step 3: Firestore 화이트리스트 초기화
```bash
node init-whitelist.js admin@example.com admin
```

#### Step 4: 관리자 계정 생성
```bash
node create-admin.js admin@example.com SecurePassword123 "관리자"
```

#### Step 5: 백엔드 로그 확인
```bash
docker-compose logs -f aps-backend
# ✓ APS Admin Local Backend Server running on port 3001 확인
```

---

### 2. 프론트엔드 배포

#### 개발 모드
```bash
npm run electron:dev
```

#### 프로덕션 빌드
```bash
npm run electron:build
# 출력: dist/APS Admin Setup 1.0.0.exe (Windows)
```

---

## 🧪 테스트 시나리오

### 1. 로그인 테스트
1. Electron 앱 실행
2. 이메일/비밀번호 입력
3. "로그인" 버튼 클릭
4. ✅ 메인 화면으로 이동 확인

### 2. 자동 로그인 테스트 ⭐
1. 로그인 완료 후 앱 종료
2. 앱 재실행
3. ✅ 로그인 페이지 건너뛰고 바로 메인 화면 진입 확인
4. **이것이 핵심 기능!**

### 3. 토큰 갱신 테스트
1. 로그인 후 1시간 이상 대기 (Access Token 만료)
2. API 요청 시도 (예: 상담 목록 조회)
3. ✅ 자동으로 Refresh Token으로 새 Access Token 발급 확인
4. ✅ API 요청 성공 확인

### 4. 로그아웃 테스트
1. 로그아웃 버튼 클릭
2. ✅ 로그인 페이지로 이동
3. 앱 재실행
4. ✅ 자동 로그인 안 됨 (Refresh Token 무효화됨)

---

## 📊 데이터베이스 스키마

### users 테이블
```sql
CREATE TABLE users (
  email VARCHAR(255) PRIMARY KEY,
  display_name VARCHAR(255),
  provider VARCHAR(50) DEFAULT 'local',  -- 'local' | 'google' | 'naver'
  password_hash VARCHAR(255),            -- NEW: bcrypt 해시
  role VARCHAR(50) DEFAULT 'user',       -- 'admin' | 'user'
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);
```

### 기존 DB 업그레이드
```sql
-- password_hash 컬럼 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- provider 기본값 변경
ALTER TABLE users ALTER COLUMN provider SET DEFAULT 'local';
```

---

## 🐛 트러블슈팅

### 문제 1: MODULE_NOT_FOUND './auth'
**증상**: Docker 컨테이너 시작 시 auth.js를 찾을 수 없음
**원인**: docker-compose.yml에 볼륨 마운트 누락
**해결**:
```yaml
volumes:
  - ./auth.js:/app/auth.js  # 추가
```

### 문제 2: Cannot find module 'bcrypt'
**증상**: bcrypt 패키지를 찾을 수 없음
**원인**: Docker 이미지가 재빌드되지 않음
**해결**:
```bash
docker-compose build aps-backend
docker-compose up -d
```

### 문제 3: column "password_hash" does not exist
**증상**: 관리자 계정 생성 시 컬럼 없음 에러
**원인**: 기존 DB 스키마에 password_hash 컬럼 없음
**해결**:
```bash
# 방법 A: 컬럼 추가
docker exec -i aps-postgres psql -U apsuser -d aps_admin -c \
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);"

# 방법 B: DB 완전 재생성 (데이터 삭제됨!)
docker-compose down -v
docker-compose up -d
```

### 문제 4: API_URL export 누락
**증상**: `The requested module '/src/config/api.js' does not provide an export named 'API_URL'`
**원인**: api.js에서 API_URL을 export하지 않음
**해결**:
```javascript
// src/config/api.js
export const API_URL = API_BASE_URL;  // 추가
```

---

## 🔄 롤백 가이드

만약 JWT 시스템에 문제가 있어 OAuth로 되돌려야 한다면:

### 1. 코드 롤백
```bash
git log --oneline  # 마이그레이션 전 커밋 찾기
git revert <commit-hash>
```

### 2. OAuth 파일 복구
- `src/auth/googleAuth.js`
- `src/auth/naverAuth.js`
- 이전 `LoginPage.jsx` (OAuth 버튼 포함)

### 3. 백엔드 복구
- 이전 `server.js` (OAuth 검증 로직)
- `auth.js` 삭제
- ALLOWED_EMAILS 환경변수 복구

---

## ✅ Phase 6 완료 - OAuth 코드 완전 제거

**제거된 파일**:
- ✅ `src/auth/googleAuth.js`
- ✅ `src/auth/naverAuth.js`
- ✅ `src/firebase/` (디렉토리 전체)

**제거된 환경변수**:
- ✅ `.env.development`, `.env.production`에서 OAuth 관련 변수 모두 제거
  - `VITE_GOOGLE_CLIENT_ID`
  - `VITE_NAVER_CLIENT_ID`
  - `VITE_NAVER_CLIENT_SECRET`
  - `VITE_NAVER_REDIRECT_URI`

**제거된 패키지**:
- ✅ `firebase` (package.json) - 67개 하위 패키지 함께 제거

**제거된 Electron IPC 코드**:
- ✅ `electron/main.js`: OAuth 팝업 창 관련 코드 제거 (Lines 5, 51-118)
- ✅ `electron/preload.js`: `openOAuthWindow` IPC API 제거

## 🆕 Phase 7 완료 - 사용자 경험 개선

### 추가된 기능

#### 1. 로그인 화면 중앙 정렬
- **CSS 수정**: `position: absolute` + `top: 50%` + `left: 50%` + `transform: translate(-50%, -50%)`
- 화면 크기에 관계없이 정확히 중앙에 배치

#### 2. 자동 로그인 체크박스
- **기능**: 체크 시 앱 재시작 시 자동으로 로그인
- **저장소**: `localStorage['aps-auto-login']`
- **로직**: `authManager.js`에서 체크박스 상태 확인 후 `restoreSession()` 실행 여부 결정

#### 3. 이메일 저장 체크박스
- **기능**: 체크 시 로그인한 이메일을 다음 로그인 시 자동으로 입력
- **저장소**: `localStorage['aps-saved-email']`
- **로직**: 로그인 성공 시 이메일 저장, 컴포넌트 마운트 시 불러오기

### 사용자 플로우

**첫 로그인**:
1. 이메일/비밀번호 입력
2. "자동 로그인" 체크 (선택)
3. "이메일 저장" 체크 (선택)
4. 로그인 버튼 클릭

**다음 로그인 (이메일 저장만 체크한 경우)**:
1. 앱 실행 → 로그인 페이지
2. 이메일이 자동으로 입력되어 있음
3. 비밀번호만 입력하고 로그인

**다음 실행 (자동 로그인 체크한 경우)**:
1. 앱 실행 → **로그인 페이지 건너뛰고 바로 메인 화면** 🎉
2. Refresh Token으로 자동 인증
3. 사용자 개입 없이 자동 로그인!

---

## 🎓 학습 포인트

### Docker 볼륨 vs 이미지 재빌드
- **코드 변경 (마운트된 파일)**: 재시작만 필요
- **새 파일 추가**: docker-compose.yml 볼륨 추가 후 재시작
- **package.json 변경**: 이미지 재빌드 필요
- **환경변수 변경**: 재시작만 필요

### JWT vs OAuth 자동 로그인
- **OAuth**: 브라우저 팝업 필요 → 자동화 불가
- **JWT**: Refresh Token으로 백그라운드 갱신 → 자동화 가능!

### Firestore 화이트리스트 vs 환경변수
- **환경변수**: 변경 시 서버 재시작 필요
- **Firestore**: 실시간 동적 변경 가능

---

## 📞 문의 및 지원

**문제 발생 시 확인사항**:
1. Docker 컨테이너 상태: `docker-compose ps`
2. 백엔드 로그: `docker-compose logs -f aps-backend`
3. PostgreSQL 연결: `docker exec -it aps-postgres psql -U apsuser -d aps_admin`
4. Firestore 화이트리스트: GCP Console에서 확인

**로그 수집**:
```bash
# 전체 로그
docker-compose logs > debug.log

# DB 상태
docker exec aps-postgres psql -U apsuser -d aps_admin -c "SELECT * FROM users;"
```

---

**마이그레이션 완료 날짜**: 2025-12-14
**테스트 완료**: ✅ 로그인, 자동 로그인, API 요청 모두 정상 작동 확인
