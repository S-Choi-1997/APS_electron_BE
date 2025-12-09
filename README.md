# APS Admin - Electron Desktop Application

APS 관리 시스템의 Electron 데스크톱 애플리케이션입니다.

## 프로젝트 구조

```
APS_APP/
├── electron/                      # Electron 메인 프로세스
│   ├── main.js                   # Electron 진입점 + OAuth 처리
│   └── preload.js                # 프리로드 스크립트 (IPC 브리지)
├── src/                          # React 앱 소스
│   ├── main.jsx                  # React 진입점
│   ├── App.jsx                   # 메인 컴포넌트
│   ├── App.css                   # 메인 스타일
│   ├── index.css                 # 글로벌 스타일
│   ├── auth/                     # 인증 모듈
│   │   ├── authManager.js       # 통합 인증 관리
│   │   ├── googleAuth.js        # Google OAuth
│   │   └── naverAuth.js         # Naver OAuth (Electron 지원)
│   ├── components/               # React 컴포넌트 (13개)
│   │   ├── Header.jsx/css
│   │   ├── LoginPage.jsx/css
│   │   ├── ConsultationTable.jsx/css
│   │   ├── ConsultationModal.jsx/css
│   │   ├── SearchBar.jsx/css
│   │   ├── Pagination.jsx/css
│   │   └── ... (기타 컴포넌트)
│   ├── config/                   # 설정 파일
│   │   └── api.js                # API 엔드포인트
│   ├── services/                 # API 서비스
│   │   ├── inquiryService.js    # 문의 API
│   │   └── smsService.js        # SMS 발송 API
│   └── data/
│       └── dummyData.js         # 테스트용 더미 데이터
├── public/                       # 정적 파일
│   └── favicon-aps.png          # 파비콘
├── index.html                    # HTML 진입점
├── package.json                  # 패키지 설정
├── vite.config.js               # Vite 빌드 설정
├── .env.development             # 개발 환경 변수
├── .env.production              # 프로덕션 환경 변수
├── .gitignore                   # Git 무시 파일
└── ELECTRON_MIGRATION.md        # 마이그레이션 가이드
```

## 주요 기능

### 1. OAuth 인증
- Google OAuth 지원
- Naver OAuth 지원 (Electron IPC 통합)
- 브라우저 / Electron 환경 자동 감지

### 2. 문의 관리
- 문의 목록 조회 (필터링, 검색, 페이지네이션)
- 문의 상세 조회 및 수정
- 첨부파일 다운로드
- 일괄 선택 및 삭제

### 3. SMS 발송
- 개별 SMS 발송
- 일괄 SMS 발송
- SMS 발송 전 확인 모달

## 설치

```bash
npm install
```

## 개발 모드 실행

```bash
npm run electron:dev
```

이 명령은 다음을 동시에 실행합니다:
- Vite 개발 서버 (http://localhost:5173)
- Electron 앱 (DevTools 자동 열림)

## 프로덕션 빌드

```bash
npm run electron:build
```

빌드된 설치 파일은 `dist/` 디렉토리에 생성됩니다:
- Windows: `APS Admin Setup 1.0.0.exe`
- Linux: `APS-Admin-1.0.0.AppImage`

## 환경 설정

### 개발 환경 (.env.development)
```env
# 백엔드 API (개발 중에는 GCP 서버 사용)
VITE_API_URL=https://inquiryapi-mbi34yrklq-uc.a.run.app

# Google OAuth
VITE_GOOGLE_CLIENT_ID=your_google_client_id

# Naver OAuth
VITE_NAVER_CLIENT_ID=your_naver_client_id
VITE_NAVER_CLIENT_SECRET=your_naver_client_secret
VITE_NAVER_REDIRECT_URI=http://localhost:5173/naver-callback.html
```

### 프로덕션 환경 (.env.production)
```env
# NAS 서버 주소 (실제 환경에 맞게 변경)
VITE_API_URL=http://192.168.0.100:3001

# Google OAuth
VITE_GOOGLE_CLIENT_ID=your_google_client_id

# Naver OAuth (Electron에서는 app:// 프로토콜 사용)
VITE_NAVER_CLIENT_ID=your_naver_client_id
VITE_NAVER_CLIENT_SECRET=your_naver_client_secret
VITE_NAVER_REDIRECT_URI=app://aps-admin/naver-callback
```

## Electron 특화 기능

### IPC 통신 (preload.js)
```javascript
window.electron = {
  platform: 'win32' | 'darwin' | 'linux',
  version: '28.0.0',
  isElectron: true,
  openOAuthWindow: (url) => Promise<{code, state}>,
  clearSession: () => Promise<{success: boolean}>,
}
```

### OAuth 흐름 (Electron 환경)
1. 사용자가 Naver 로그인 버튼 클릭
2. `naverAuth.js`가 `window.electron.isElectron` 확인
3. Electron IPC로 OAuth URL 전달
4. `main.js`가 새 BrowserWindow로 OAuth 창 열기
5. 리다이렉트 URL 감지 (code, state 파라미터)
6. IPC로 결과 반환
7. 백엔드 API를 통해 토큰 교환
8. 로그인 완료

## 기술 스택

- **프론트엔드**: React 18 + Vite
- **데스크톱**: Electron 28
- **인증**: Google OAuth + Naver OAuth
- **API 통신**: Fetch API + REST
- **상태 관리**: React useState/useEffect
- **스타일링**: CSS Modules

## 다음 단계

- [ ] 의존성 설치: `npm install`
- [ ] 환경 변수 설정 (`.env.development`, `.env.production`)
- [ ] 개발 모드 테스트: `npm run electron:dev`
- [ ] 프로덕션 빌드: `npm run electron:build`
- [ ] NAS 서버 백엔드 설정 (ELECTRON_MIGRATION.md 참고)

자세한 마이그레이션 가이드는 [ELECTRON_MIGRATION.md](./ELECTRON_MIGRATION.md)를 참고하세요.
