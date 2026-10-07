# 저장소 작업 안내

APS Admin은 React/Electron 앱과 NAS Express 백엔드, 독립 GCP 서비스로 구성된 모노레포입니다.

## 읽는 순서

1. `memory/MEMORY.md`: 직전 작업에서 이어받을 항목.
2. `docs/README.md`: 작업 목적에 맞는 현재 기준 문서.
3. 관련 소스와 테스트: 문서와 실제 동작이 다르면 코드를 확인하고 해당 기준 문서를 고칩니다.

아키텍처·설치·배포 절차는 각각 `docs/architecture.md`, `docs/setup.md`, `docs/release.md`에만 유지합니다. 과거 계획과 검증 기록은 `docs/archive/`에 있으며 현재 작업 지시로 적용하지 않습니다. `legacy/` 소스는 수정하지 않습니다.

## 주요 경계와 파일

- `app/src/AppRouter.jsx`: HashRouter, 인증 가드, QueryClient와 화면 구성.
- `app/src/config/api.js`: Electron AppConfig 캐시, REST URL, 인증 헤더, 요청 타임아웃·세션 복원.
- `app/src/auth/authManager.js`, `localAuth.js`: 이메일·비밀번호 JWT 로그인과 세션 관리.
- `app/electron/main.js`, `preload.js`: 창·IPC와 `window.electron` 브리지. 렌더러는 Node.js API에 직접 접근하지 않습니다.
- `app/electron/app-config.js`: 저장 설정·런타임 환경변수·패키징 기본값과 이전 주소 마이그레이션.
- `app/electron/websocket-manager.js`: 백엔드 직접 Socket.IO 연결과 창별 이벤트 전달.
- `app/src/hooks/useWebSocketSync.js`: 실시간 이벤트를 React Query 캐시에 반영.
- `backend/server.js`: 초기화, JWT 인증 라우트, 서비스 라우트 등록, 직접 Socket.IO, 상태 확인.
- `backend/email-mail-client-service.js`, `backend/zoho/`: 메일 클라이언트와 Zoho 연동.
- `backend/automation-mail-routes.js`: 별도 서비스 키로 사용하는 수집 프로세스 메일 API.

앱 사용자 로그인과 Zoho 계정 연결 OAuth를 혼동하지 않습니다. 일반 앱 트래픽은 Cloudflare 백엔드 직결이며 SMS만 고정 IP 릴레이를 사용합니다.

## 검증과 전달

코드 변경의 완료 기준은 [개발 기준](docs/development.md)을 따릅니다.

- 함수 입출력과 모든 호출부, API 경로·메서드, IPC main/preload/renderer 양쪽 연결을 확인합니다.
- 인증이 필요한 REST 요청은 `apiRequest()`를 사용하고, 렌더러의 HTML 표시·외부 링크 처리 방식은 기존 컴포넌트 경계를 유지합니다.
- 프런트엔드 기본 검증: `npm --prefix app run build`. 자동 테스트 스크립트는 없지만 `scripts/smoke-*.cjs`가 있습니다. 변경 범위에 맞는 검증만 실행합니다.
- 백엔드 기본 검증: `npm --prefix backend test`. 실제 DB·Zoho 경로는 모의 테스트와 구분해 보고합니다.
- 문서만 변경하면 링크·경로·명령과 코드의 일치, `git diff --check`를 확인합니다.
- 구조가 바뀌면 해당 기준 문서를 고칩니다. `memory/MEMORY.md`에는 다음 작업에 필요한 미완료 항목만 남기고 완료 작업의 긴 이력은 누적하지 않습니다.
