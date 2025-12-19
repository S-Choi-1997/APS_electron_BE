# APS Admin - 고객 상담 관리 데스크톱 애플리케이션

> Electron 기반의 고객 상담 접수 및 관리 시스템

APS Admin은 홈페이지를 통해 접수된 고객 상담 내역을 실시간으로 조회하고 관리할 수 있는 데스크톱 애플리케이션입니다.

---

## 📖 문서

자세한 문서는 [docs/](docs/) 폴더를 참고하세요:
- **[릴리즈 가이드](docs/RELEASE_GUIDE.md)** - 새 버전 배포 방법
- **[관리자 계정 가이드](docs/ADMIN_ACCOUNT_GUIDE.md)** - 계정 추가 방법
- **[프로젝트 가이드](docs/CLAUDE.md)** - 전체 아키텍처 및 개발 가이드

---

## 🎯 주요 기능

### 1. 상담 내역 관리
- **실시간 조회**: 홈페이지에서 접수된 상담 내역을 실시간으로 확인
- **상세 정보**: 고객 이름, 연락처, 상담 내용, 첨부파일 등 전체 정보 조회
- **상태 관리**: 미확인/확인 상태 토글 및 일괄 처리
- **검색 및 필터**: 고객명, 전화번호, 이메일, 상담 유형별 검색

### 2. SMS 발송
- **빠른 발송**: 상담 내역에서 바로 SMS 발송
- **템플릿 지원**: 자주 사용하는 문구를 템플릿으로 저장
- **발송 이력**: SMS 발송 내역 추적

### 3. 팀 메모
- **공유 메모**: 팀원 간 공유되는 메모 작성
- **중요도 표시**: 중요 메모 강조 표시
- **만료일 설정**: 기간 제한 메모 관리
- **실시간 동기화**: WebSocket 기반 실시간 메모 업데이트

### 4. 일정 관리
- **월간 캘린더**: 월별 일정 조회 및 관리
- **일정 추가/수정/삭제**: 팀 일정 관리
- **알림**: 중요 일정 알림

### 5. 실시간 알림
- **데스크톱 알림**: 새 상담 접수 시 Windows/Linux 네이티브 알림
- **실시간 동기화**: WebSocket을 통한 실시간 데이터 업데이트
- **자동 새로고침**: 변경사항 자동 반영

### 6. 다중 인증
- **Google OAuth**: Google 계정으로 로그인
- **Naver OAuth**: Naver 계정으로 로그인
- **로컬 계정**: 이메일/비밀번호 기반 로그인
- **자동 로그인**: 로그인 상태 유지 (토큰 자동 갱신)

---

## 🏗️ 아키텍처

### 시스템 구성도

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Electron Desktop App (Frontend)                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  React 18 + Vite                                         │   │
│  │  - 상담 관리 UI (Dashboard, ConsultationsPage)          │   │
│  │  - 메모/일정 UI (MemoPage, SettingsPage)                │   │
│  │  - 실시간 알림 (WebSocket Client)                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Electron Main Process                                   │   │
│  │  - OAuth 팝업 창 관리 (Google/Naver)                    │   │
│  │  - 데스크톱 알림 (Notification API)                     │   │
│  │  - IPC 통신 (Renderer ↔ Main)                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕ HTTP/HTTPS + WebSocket
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: GCP Relay Server (Proxy + WebSocket Hub)             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  HTTP Proxy (136.113.67.193:8080/proxy)                 │   │
│  │  - 외부 → NAS 백엔드 프록시                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  WebSocket Relay (136.113.67.193:8080)                  │   │
│  │  - 클라이언트 ↔ 백엔드 실시간 통신 중계                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕ HTTP + WebSocket
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Backend API Server (NAS Local)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Node.js + Express (port 3001)                           │   │
│  │  - REST API (상담, 메모, 일정, SMS)                     │   │
│  │  - JWT 인증 (Google/Naver/Local)                        │   │
│  │  - WebSocket 서버 (실시간 이벤트 발행)                  │   │
│  │  - PostgreSQL (로컬 계정, 메모, 일정)                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕ GCP SDK
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4: GCP Cloud Services                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Firestore Database                                      │   │
│  │  - 상담 내역 (inquiries collection)                     │   │
│  │  - 사용자 정보 (admin_users collection)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Cloud Storage                                           │   │
│  │  - 상담 첨부파일 (이미지, 문서)                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Google Identity                                         │   │
│  │  - OAuth 2.0 인증 (Google/Naver)                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 주요 설계 결정

| 항목 | 선택 | 이유 |
|------|------|------|
| **프론트엔드** | Electron + React | 데스크톱 네이티브 기능 (알림, OAuth 팝업) 필요 |
| **백엔드 위치** | NAS 로컬 서버 | GCP Cloud Run 비용 절감 |
| **데이터베이스** | Firestore (상담) + PostgreSQL (메모/일정) | 기존 상담 데이터 유지, 새 기능은 로컬 DB |
| **실시간 통신** | WebSocket (Socket.IO) | 실시간 상담 알림 및 데이터 동기화 |
| **릴레이 서버** | GCP VM 고정 IP | NAS 외부 접근 (유동 IP 문제 해결) |

---

## 📁 프로젝트 구조

```
APS_APP/
├── electron/                      # Electron 메인 프로세스
│   ├── main.js                   # Electron 진입점, OAuth 팝업 처리
│   └── preload.js                # IPC 브리지 (보안 컨텍스트)
│
├── src/                          # React 앱 소스
│   ├── main.jsx                  # React 진입점
│   ├── App.jsx                   # 루트 컴포넌트
│   ├── AppRouter.jsx             # 라우팅 및 인증 처리
│   │
│   ├── auth/                     # 인증 모듈
│   │   ├── authManager.js       # 통합 인증 관리 (Google/Naver/Local)
│   │   └── localAuth.js         # 로컬 계정 인증 (이메일/비밀번호)
│   │
│   ├── components/               # 재사용 가능한 UI 컴포넌트
│   │   ├── Dashboard.jsx        # 대시보드 (통계, 미확인 상담)
│   │   ├── ConsultationTable.jsx # 상담 목록 테이블
│   │   ├── ConsultationModal.jsx # 상담 상세/수정 모달
│   │   ├── Sidebar.jsx          # 사이드바 네비게이션
│   │   ├── SearchBar.jsx        # 검색 및 필터
│   │   ├── Pagination.jsx       # 페이지네이션
│   │   └── ...                  # 기타 공통 컴포넌트
│   │
│   ├── pages/                    # 페이지 컴포넌트
│   │   ├── ConsultationsPage.jsx       # 홈페이지 상담 페이지
│   │   ├── EmailConsultationsPage.jsx  # 이메일 상담 페이지 (준비 중)
│   │   ├── MemoPage.jsx                # 팀 메모 페이지
│   │   └── SettingsPage.jsx            # 설정 페이지 (일정 관리)
│   │
│   ├── services/                 # API 서비스 (백엔드 통신)
│   │   ├── inquiryService.js    # 상담 CRUD
│   │   ├── memoService.js       # 메모 CRUD
│   │   ├── scheduleService.js   # 일정 CRUD
│   │   ├── smsService.js        # SMS 발송
│   │   ├── userService.js       # 사용자 정보
│   │   └── websocketService.js  # WebSocket 연결 관리
│   │
│   ├── hooks/                    # Custom React Hooks
│   │   ├── useConsultations.js  # 상담 목록 관리 로직
│   │   ├── useMemos.js          # 메모 관리 로직
│   │   ├── useSchedules.js      # 일정 관리 로직
│   │   └── useWebSocketSync.js  # 실시간 동기화
│   │
│   ├── config/                   # 설정 파일
│   │   └── api.js               # API 엔드포인트, 요청 헬퍼
│   │
│   └── utils/                    # 유틸리티 함수
│       └── notificationHelper.js # 데스크톱 알림 헬퍼
│
├── backend-local/                # 백엔드 서버 (NAS 배포용)
│   ├── server.js                # Express 서버 메인
│   ├── auth.js                  # JWT 인증 미들웨어
│   ├── firestore-admin.js       # Firestore Admin SDK
│   ├── create-admin.js          # 관리자 계정 생성 스크립트
│   ├── db.js                    # PostgreSQL 연결
│   └── .env                     # 환경 변수 (GCP 인증, DB 설정)
│
├── docs/                         # 문서
│   ├── RELEASE_GUIDE.md         # 릴리즈 가이드
│   ├── ADMIN_ACCOUNT_GUIDE.md   # 계정 추가 가이드
│   ├── CLAUDE.md                # 프로젝트 전체 가이드
│   └── ...                      # 기타 문서
│
├── .github/workflows/            # GitHub Actions
│   └── build.yml                # 자동 빌드 및 릴리즈
│
├── .env                          # 환경 변수 (프론트엔드)
├── package.json                  # 의존성 및 빌드 설정
├── vite.config.js               # Vite 번들러 설정
└── README.md                     # 이 파일
```

---

## 🚀 시작하기

### 사전 요구사항

- **Node.js 20** 이상
- **npm** (Node.js와 함께 설치됨)
- **Windows** 또는 **Linux** 환경

### 설치

```bash
# 저장소 클론
git clone https://github.com/S-Choi-1997/APS_electron_BE.git
cd APS_APP

# 의존성 설치
npm install
```

### 개발 모드 실행

```bash
# Vite 개발 서버 + Electron 실행 (Hot Reload)
npm run electron:dev
```

- Vite 개발 서버: `http://localhost:5173`
- Electron 창 자동 실행 (DevTools 포함)

### 프로덕션 빌드

```bash
# 앱 빌드 (Windows/Linux 설치 파일 생성)
npm run electron:build
```

빌드 결과물:
- Windows: `dist/APS Admin Setup 1.1.0.exe`
- Linux: `dist/APS-Admin-1.1.0.AppImage`

---

## 🔧 환경 설정

### 프론트엔드 (`.env`)

```env
# 백엔드 API URL (GCP 릴레이 프록시)
VITE_API_URL=http://136.113.67.193:8080/proxy

# WebSocket 릴레이 서버
VITE_WS_RELAY_URL=ws://136.113.67.193:8080
```

### 백엔드 (`backend-local/.env`)

주요 설정:
- `GOOGLE_APPLICATION_CREDENTIALS`: GCP 서비스 계정 키 경로
- `DATABASE_URL`: PostgreSQL 연결 문자열
- `JWT_SECRET`: JWT 토큰 서명 키
- `ALIGO_API_KEY`: SMS 발송 API 키
- `RELAY_WS_URL`: WebSocket 릴레이 서버 URL

자세한 내용은 [backend-local/README.md](backend-local/README.md) 참고

---

## 📦 배포

### 자동 배포 (GitHub Actions)

1. `package.json`에서 버전 업데이트
2. Git 태그 생성 및 푸시:
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
3. GitHub Actions가 자동으로 빌드하여 Releases에 업로드

자세한 내용은 [docs/RELEASE_GUIDE.md](docs/RELEASE_GUIDE.md) 참고

### 백엔드 배포

NAS 서버에 배포:
1. `backend-local/` 폴더를 NAS로 복사
2. `.env` 파일 설정
3. `npm install` 실행
4. systemd 서비스로 등록 및 실행

자세한 내용은 [docs/ELECTRON_MIGRATION.md](docs/ELECTRON_MIGRATION.md) 참고

---

## 🛠️ 기술 스택

### Frontend
- **Electron 28** - 데스크톱 애플리케이션 프레임워크
- **React 18** - UI 라이브러리
- **React Router 7** - 라우팅
- **Vite 6** - 빌드 도구
- **Socket.IO Client** - WebSocket 클라이언트
- **DOMPurify** - XSS 방지

### Backend
- **Node.js** - 런타임
- **Express** - 웹 프레임워크
- **Socket.IO** - WebSocket 서버
- **PostgreSQL** - 로컬 데이터베이스 (메모, 일정)
- **Firestore** - 클라우드 데이터베이스 (상담 내역)
- **JWT** - 인증 토큰

### Infrastructure
- **GCP Firestore** - 상담 데이터 저장
- **GCP Cloud Storage** - 첨부파일 저장
- **GCP VM** - 릴레이 서버 (고정 IP)
- **OMV NAS** - 백엔드 API 서버

---

## 🔐 인증 흐름

### 1. Google/Naver OAuth
```
사용자 → Electron 팝업 창 → OAuth 제공자 → 인증 코드 반환
→ 백엔드 토큰 교환 → JWT 발급 → 로컬 저장 → 자동 로그인
```

### 2. 로컬 계정
```
사용자 → 이메일/비밀번호 입력 → 백엔드 검증 → JWT 발급
→ 로컬 저장 → 자동 로그인
```

### 3. 토큰 갱신
- Access Token 만료 시 Refresh Token으로 자동 갱신
- Rolling Refresh: Refresh Token도 자동 갱신 (30일)

---

## 🌐 실시간 동기화

### WebSocket 이벤트

| 이벤트 | 설명 |
|--------|------|
| `consultation:created` | 새 상담 접수 → 데스크톱 알림 + 목록 업데이트 |
| `consultation:updated` | 상담 상태 변경 → 목록 업데이트 |
| `consultation:deleted` | 상담 삭제 → 목록에서 제거 |
| `memo:created` | 새 메모 작성 → 메모 목록 업데이트 |
| `memo:deleted` | 메모 삭제 → 메모 목록 업데이트 |
| `schedule:*` | 일정 생성/수정/삭제 → 캘린더 업데이트 |

---

## 📊 주요 API 엔드포인트

### 상담 관리
- `GET /inquiries` - 상담 목록 조회
- `GET /inquiries/:id` - 상담 상세 조회
- `PUT /inquiries/:id` - 상담 수정
- `DELETE /inquiries/:id` - 상담 삭제

### 메모 관리
- `GET /memos` - 메모 목록 조회
- `POST /memos` - 메모 작성
- `PUT /memos/:id` - 메모 수정
- `DELETE /memos/:id` - 메모 삭제

### 일정 관리
- `GET /schedules` - 일정 목록 조회
- `POST /schedules` - 일정 추가
- `PUT /schedules/:id` - 일정 수정
- `DELETE /schedules/:id` - 일정 삭제

### SMS
- `POST /sms/send` - SMS 발송

### 인증
- `POST /auth/local/login` - 로컬 로그인
- `POST /auth/local/refresh` - 토큰 갱신
- `POST /auth/naver/token` - Naver 토큰 교환

---

## 🧪 개발 팁

### Electron DevTools 열기
개발 모드(`npm run electron:dev`)에서 자동으로 DevTools가 열립니다.

### 로그 확인
- **프론트엔드**: Electron DevTools 콘솔
- **백엔드**: NAS 서버 로그 (`journalctl -u aps-backend -f`)

### Hot Reload
Vite 개발 서버가 파일 변경을 감지하여 자동으로 새로고침합니다.

---

## 🤝 기여

이 프로젝트는 APS Consulting 내부 프로젝트입니다.

---

## 📄 라이선스

MIT License

---

## 📞 문의

프로젝트 관련 문의: [GitHub Issues](https://github.com/S-Choi-1997/APS_electron_BE/issues)
