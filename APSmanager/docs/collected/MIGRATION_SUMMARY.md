# Firebase Auth → Google OAuth 마이그레이션 완료

Firebase Auth를 완전히 제거하고 순수 Google OAuth로 전환했습니다.

## 변경 사항

### 프론트엔드

#### 새로 추가된 파일
- `src/auth/googleAuth.js` - 순수 Google OAuth 인증 모듈 (Firebase 없음)
- `GOOGLE_OAUTH_SETUP.md` - Google OAuth 설정 가이드

#### 수정된 파일

**src/components/LoginPage.jsx**
- Firebase Auth 제거
- Google Identity Services 사용
- `initializeGoogleAuth()` 및 `signInWithGoogle()` 사용

**src/components/Header.jsx**
- Firebase Auth import 제거
- `googleAuth.js`에서 `signOut` import

**src/App.jsx**
- Firebase Auth import 제거
- `googleAuth.js`에서 `auth`, `onAuthStateChanged` import

**src/config/api.js**
- Firebase ID 토큰 → Google OAuth 액세스 토큰으로 변경
- `auth.currentUser.getIdToken()` → `auth.currentUser.idToken`

**.env**
- Firebase 설정 변수 모두 제거
- `VITE_GOOGLE_CLIENT_ID` 추가 (설정 필요)
- `VITE_API_URL` 추가

#### 제거된 의존성
- Firebase Auth 관련 import 모두 제거
- `src/firebase/config.js`는 남아있지만 더 이상 사용되지 않음 (삭제 가능)

### 백엔드 (GCP2/)

**index.js**
- `google-auth-library`의 `OAuth2Client` 제거
- Google OAuth 액세스 토큰 검증으로 변경
- `/oauth2/v3/tokeninfo` API 사용하여 토큰 검증
- `req.user.uid` → `req.user.sub` (Google 사용자 ID)

**package.json**
- `google-auth-library` 의존성 제거

**배포 완료**
- Cloud Run에 배포됨: https://inquiryapi-759991718457.us-central1.run.app
- 새로운 인증 방식 적용됨

## 인증 흐름

### 이전 (Firebase Auth)
```
프론트엔드: Firebase Auth 로그인
  ↓
Firebase ID Token 생성
  ↓
백엔드: Firebase Admin SDK로 토큰 검증
  ↓
문제: Firebase 프로젝트 ID 불일치 (apsconsulting vs apsconsulting-67cf4)
```

### 현재 (Google OAuth)
```
프론트엔드: Google Identity Services 로그인
  ↓
Google OAuth Access Token 생성
  ↓
백엔드: Google Tokeninfo API로 토큰 검증
  ↓
이메일 화이트리스트 확인
  ↓
성공
```

## 다음 단계

### 1. Google OAuth Client ID 생성 (필수)

`GOOGLE_OAUTH_SETUP.md` 파일의 지침을 따라:

1. GCP Console에서 OAuth 동의 화면 구성
2. OAuth 2.0 Client ID 생성 (웹 애플리케이션)
3. 승인된 자바스크립트 원본 추가:
   - http://localhost:5173
   - http://localhost:5174
4. 생성된 Client ID를 `.env` 파일에 추가:
   ```env
   VITE_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
   ```

### 2. 테스트

```bash
# 프론트엔드 개발 서버가 실행 중인지 확인
# 이미 실행 중: http://localhost:5174

# 브라우저에서 접속
open http://localhost:5174

# Google 로그인 테스트
# - 로그인 버튼 클릭
# - Google 계정 선택 (infra.steve.01@gmail.com)
# - 상담 목록이 표시되는지 확인
```

### 3. 프로덕션 배포 시

프론트엔드를 배포할 때:
1. 프로덕션 도메인을 OAuth Client의 승인된 원본에 추가
2. 프로덕션 환경변수 설정:
   ```env
   VITE_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
   VITE_API_URL=https://inquiryapi-759991718457.us-central1.run.app
   ```

백엔드 CORS 설정 업데이트:
```bash
gcloud run services update inquiryapi \
  --region us-central1 \
  --update-env-vars ALLOWED_ORIGINS=https://your-production-domain.com \
  --project apsconsulting
```

## 제거 가능한 파일

다음 파일들은 더 이상 사용되지 않으므로 삭제해도 됩니다:

- `src/firebase/config.js` (Firebase Auth 설정 - 더 이상 사용 안 함)
- `src/data/dummyData.js` (더미 데이터 - 이미 API 사용 중)

## 기술적 이점

1. **Firebase 의존성 제거**: GCP Firestore만 사용, Firebase 프로젝트 불필요
2. **프로젝트 통합**: 모든 것이 `apsconsulting` GCP 프로젝트에서 관리됨
3. **단순화된 인증**: Google OAuth만 사용, Firebase Admin SDK 불필요
4. **표준 OAuth 2.0**: 업계 표준 인증 방식 사용
5. **비용 절감**: Firebase 프로젝트 할당량 사용 안 함

## 주의사항

- OAuth Client를 "Internal" 타입으로 생성하면 조직 내 사용자만 로그인 가능
- `ALLOWED_EMAILS` 환경변수로 추가 접근 제어
- 액세스 토큰은 만료 시간이 있으므로 프로덕션에서는 토큰 갱신 로직 추가 권장
