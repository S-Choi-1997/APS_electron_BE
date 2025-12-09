# Changelog

## 2025-12-04 - 도메인 전환 및 프로젝트 문서화

### 구현 사항

1. **커스텀 도메인 적용**
   - 신규 도메인: `https://admin.apsconsulting.kr`
   - GitHub Pages CNAME 설정
   - Vite base path 변경 (`/APSmanager/` → `/`)
   - 모든 OAuth redirect URI 업데이트

2. **SMS 발송 UI/UX 개선**
   - ConfirmModal: SMS 발송 확인 모달 (아름다운 디자인)
   - AlertModal: 발송 성공/실패 알림 모달
   - 확인 완료 버튼: 초록색 + disabled 상태
   - alert() 대신 모달 사용으로 UX 향상

3. **SMS Relay 서버 안정화**
   - 고정 IP VM 서버: 136.113.67.193:3000
   - systemd 서비스로 자동 실행
   - Aligo API 화이트리스트 등록 완료
   - TinyProxy 방식 폐기 → Relay 서버로 전환

4. **프로젝트 문서화**
   - README.md: 프로젝트 전체 개요 (기술 스택, 아키텍처)
   - GCP2/README.md: 백엔드 API 문서 (엔드포인트, 배포, 환경변수)
   - GCP3/README.md: SMS Relay 서버 문서 (배포, 관리, 트러블슈팅)
   - 각 주요 파일에 헤더 주석 추가 (GCP2/index.js, GCP3/sms-relay/index.js, src/App.jsx)
   - 폐기 파일 정리 (GCP → GCP.DEPRECATED, GCP3/DEPRECATED.txt)

### 주요 변경 사항

#### 도메인 및 URL 변경
**기존:**
- Frontend: `https://s-choi-1997.github.io/APSmanager/`
- Base path: `/APSmanager/`

**변경:**
- Frontend: `https://admin.apsconsulting.kr`
- Base path: `/`
- CNAME: `admin.apsconsulting.kr`

#### SMS 아키텍처 변경
**기존 (폐기):**
```
Cloud Run → TinyProxy (VM) → Aligo API
```

**변경:**
```
Cloud Run → SMS Relay (VM:3000) → Aligo API
```

- 환경변수: `PROXY_URL` → `RELAY_URL`
- Relay 엔드포인트: `POST /sms/send`
- VM IP: 136.113.67.193 (고정)

#### 환경변수 수정
- `GCP2/.env`: RELAY_URL, ALLOWED_ORIGINS 업데이트
- `.env.production`: VITE_NAVER_REDIRECT_URI 업데이트
- `.github/workflows/deploy.yml`: Naver redirect URI 업데이트

### UI/UX 개선

1. **모달 컴포넌트**
   - `ConfirmModal.jsx`: SMS 발송 확인 (이름, 전화번호, 경고 메시지)
   - `AlertModal.jsx`: 알림 모달 (success, error, warning, info)
   - 애니메이션: fadeIn, slideUp
   - 모바일 반응형 디자인

2. **버튼 상태 개선**
   - 확인 완료 버튼: 파란색 → 초록색
   - disabled 속성 추가 (클릭 불가)
   - 호버 효과 제거 (disabled 상태)

### 파일 정리

**폐기:**
- `GCP/` → `GCP.DEPRECATED/` (Firebase Functions 기반 구버전)
- `GCP3/tinyproxy.conf` (TinyProxy 사용 안 함)
- `GCP3/setup-tinyproxy.sh` (TinyProxy 사용 안 함)
- `GCP3/allocate-static-ip.sh` (이미 완료)
- `GCP3/setup-firewall.sh` (이미 완료)
- `GCP3/setup-all.ps1` (사용 안 함)

**현재 사용:**
- `GCP2/`: 백엔드 API (Cloud Run)
- `GCP3/sms-relay/`: SMS Relay 서버
- `src/`: 프론트엔드 React 앱

### 기술 부채 해결

1. 환경변수 타입 오류 수정
   - 전화번호를 문자열로 강제 (`"0317011663"`)
   - deploy.ps1에서 모든 환경변수 quoting

2. Naver OAuth 이메일 권한 확인
   - "연락처 이메일 주소" 권한만 필요 (1개)
   - API 응답: `email` 필드 하나만 반환

### 배포 URL (업데이트)

- **Frontend**: https://admin.apsconsulting.kr
- **Backend**: https://inquiryapi-mbi34yrklq-uc.a.run.app
- **SMS Relay**: http://136.113.67.193:3000
- **Naver Callback**: https://admin.apsconsulting.kr/naver-callback.html

---

## 2025-12-03 - Naver OAuth 통합 및 배포 자동화

### 구현 사항

1. **다중 인증 제공자 통합**
   - Google OAuth (기존)
   - Naver OAuth (신규)
   - 통합 인증 매니저 (`authManager.js`)

2. **보안 개선**
   - Naver 토큰 교환을 백엔드에서 처리 (`/auth/naver/token`)
   - CLIENT_SECRET을 프론트엔드에서 제거
   - CSRF 방지 (state 파라미터 검증)

3. **GitHub Actions CI/CD**
   - `allfiles` 브랜치 push → 자동 빌드 및 배포
   - GitHub Secrets로 환경 변수 관리
   - `main` 브랜치에 빌드 결과 배포

4. **세션 관리**
   - localStorage 기반 세션 유지
   - 새로고침 시 자동 로그인
   - 로그아웃 시 자동 로그인 페이지 이동

### 주요 이슈 및 해결

#### 1. CORS 에러 (Naver 토큰 교환)
**문제**: 브라우저에서 Naver API 직접 호출 시 CORS 차단
**해결**: 백엔드에 `/auth/naver/token` 엔드포인트 추가

#### 2. 백엔드 API URL 불일치
**문제**: 환경 변수의 URL이 실제 Cloud Run URL과 다름
**해결**:
- 기존: `https://inquiryapi-759991718457.us-central1.run.app`
- 변경: `https://inquiryapi-mbi34yrklq-du.a.run.app`

#### 3. 팝업 메시지 전달 실패
**문제**: Naver 콜백 페이지에서 메인 창으로 메시지 전달 안 됨
**해결**: `checkClosed` 인터벌 전에 `let` 선언 이동, 메시지 수신 시 인터벌 즉시 clear

#### 4. 세션 복원 CORS 에러
**문제**: 페이지 새로고침 시 토큰 검증에서 CORS 에러
**해결**: 토큰 검증 제거, localStorage에서 직접 복원 (만료 시 API 호출에서 처리)

### 기술 스택

- **Frontend**: React + Vite
- **Backend**: Express.js on Cloud Run (GCP)
- **Auth**: Google Identity Services + Naver OAuth 2.0
- **Deployment**: GitHub Actions → GitHub Pages
- **Storage**: Firebase Firestore + Cloud Storage

### 허용된 이메일

```
infra.steve.01@gmail.com
nothingjustfake@gmail.com
camrel3850@gmail.com
choho97@naver.com
hwanki2k2019@gmail.com
joys401@naver.com
chanmoolee@gmail.com
```

### 배포 URL

- **Frontend**: https://s-choi-1997.github.io/APSmanager/
- **Backend**: https://inquiryapi-mbi34yrklq-du.a.run.app
- **Naver Callback**: https://s-choi-1997.github.io/APSmanager/naver-callback.html

### 브랜치 전략

- `allfiles`: 소스 코드 브랜치 (작업 브랜치)
- `main`: 빌드된 파일만 (GitHub Pages 배포용)

### 향후 개선 사항

- Naver 프로필 정보 (이름, 사진) 제공 설정 (현재 이메일만)
- package-lock.json 커밋 (빌드 성능 개선)
