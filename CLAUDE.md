# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## ⚡ 세션 시작 시 필수 루틴 (compact 복귀 후 최우선 실행)

컨텍스트 압축(compact) 이후 새 세션이 시작되면 코드 작업 전에 반드시 아래 순서를 따른다.

### 1단계 — 이전 세션 미완료 작업 확인

다음 파일들을 순서대로 읽고, 미완료·미수정·TODO로 표시된 항목이 있으면 먼저 처리한다:

1. `memory/MEMORY.md` — 세션 간 인수인계 메모, 미완료 작업 기록
2. `CLAUDE.md` (이 파일) — 아키텍처 변경·제약 사항 업데이트 여부
3. 작업 중이었던 파일이 명시된 경우 해당 파일 직접 확인

미완료 작업이 있으면 **사용자에게 먼저 보고**하고 처리 방향을 확인한 뒤 진행한다.

---

## ✅ 작업 완료 시 필수 루틴 (코드 수정 후 반드시 실행)

코드 수정이 끝난 뒤 커밋·전달 전에 검토자 시선으로 아래를 순서대로 점검한다.

### 1단계 — 코드 정합성 검토

- 수정한 함수·컴포넌트의 **입출력 타입과 반환값**이 호출부와 일치하는지 확인
- `async/await` 누락, `Promise` 미처리, 미반환 케이스 없는지 확인
- 조건 분기 누락(null·undefined·빈 배열 등 엣지 케이스) 확인

### 2단계 — 연결부·호출부 검토

- 수정한 함수를 **호출하는 모든 위치** 검색 후, 시그니처 변경이 전파됐는지 확인
- IPC 채널명 변경 시 `main.js`의 `ipcMain.handle`과 `preload.js`의 `ipcRenderer.invoke` **양쪽 모두** 확인
- API 엔드포인트 변경 시 `src/config/api.js`의 `API_ENDPOINTS`와 백엔드(`backend/server.js`) 라우트 **양쪽** 확인
- `window.electron.xxx` 호출부가 preload에 실제로 노출돼 있는지 확인

### 3단계 — 런타임 위험 요소 검토

- 렌더러 프로세스에서 Node.js API 직접 호출 없는지 확인 (contextIsolation 위반)
- `apiRequest()` 를 우회하는 직접 `fetch`·`axios` 호출 없는지 확인 (인증 헤더 누락 위험)
- 환경변수 `VITE_` 접두사 누락 없는지 확인
- XSS 위험 있는 `innerHTML` 직접 삽입 시 DOMPurify 처리 여부 확인

### 4단계 — 문서 업데이트

위 검토 후 수정이 발생했거나 구조가 바뀐 경우:

- **`CLAUDE.md`** — 아키텍처·패턴·주요 파일 변경 사항 반영
- **`memory/MEMORY.md`** — 다음 세션에 전달할 미완료 작업·주의사항 기록
- 필요 시 `docs/` 하위 관련 문서도 갱신

---

## 프로젝트 개요

**APS Admin**은 고객 상담 문의를 관리하는 Electron 데스크탑 애플리케이션입니다. 로컬 OMV NAS PC에서 실행 중인 Node.js 백엔드와 연결되며, 데이터 저장에는 GCP 서비스를 사용합니다.

## 개발 명령어

```bash
cd app                       # Electron 앱 디렉토리로 이동 (모든 명령 여기서 실행)
npm install                  # 의존성 설치
npm run electron:dev         # 개발 모드: Vite(localhost:5173) + Electron + DevTools + 핫 리로드
npm run electron:build       # 빌드 및 NSIS 설치 파일 패키징 → app/dist/
npm run release              # 빌드 + GitHub Release 생성 및 설치 파일 업로드
npm run dev                  # Vite 개발 서버만 실행 (Electron 없음)
npm run build                # Vite 빌드만 실행 (app/dist/ 생성)
npm run electron             # 기존 app/dist/를 사용해 Electron 실행
```

자동화된 테스트 없음 — 수동 테스트만 진행. 테스트 시 Google/Naver OAuth 흐름 모두 확인하고, 개발 모드(Vite)와 프로덕션 모드(빌드된 앱) 양쪽에서 검증할 것.

## 아키텍처

### 3계층 구조

```
app/src/ (React) + app/electron/ (Node.js 메인 프로세스)
    │ IPC
    │ HTTP/WebSocket
백엔드 API: OMV NAS의 Node.js Express (backend/, 포트 3001)
    │ GCP SDKs
GCP Firestore (상담 데이터) + GCP Storage (첨부파일)
```

- **Electron 앱 루트**: `app/` (package.json, vite.config.js, src/, electron/ 모두 여기)
- **개발 환경**: 프론트엔드가 GCP Cloud Run을 가리킴 (`app/.env.development`의 `VITE_API_URL`)
- **프로덕션**: 릴레이 서버를 가리킴 (`app/.env`의 `VITE_API_URL`)
- `backend/`에 NAS 백엔드 소스 포함 (Docker 기반). `legacy/` 디렉터리는 레거시 참고용 코드 — 수정 금지.

### Electron 프로세스 분리

**메인 프로세스** (`app/electron/main.js`): 윈도우 생명주기, IPC 핸들러, WebSocket 클라이언트, 자동 업데이트(`electron-updater`), 고정 플로팅 윈도우, 토스트 알림, OAuth 팝업 관리.

**렌더러 프로세스** (`app/src/`): React 18 UI, React Router 7, TanStack React Query 5, Socket.IO 클라이언트. Node.js API에 직접 접근 불가 — 모든 크로스 프로세스 호출은 IPC 브릿지를 통해야 함.

**IPC 브릿지** (`app/electron/preload.js`): `contextIsolation: true`와 함께 `contextBridge`를 통해 렌더러에 `window.electron`을 노출.

### 인증 (핵심 패턴)

이 앱은 **Google Identity Services**를 직접 사용함 — `app/package.json`의 `firebase` 패키지는 사용하지 않음. `app/src/firebase/config.js`는 `null`을 export하는 플레이스홀더임.

**로컬 인증** (`app/src/auth/localAuth.js`): 이메일/비밀번호 → JWT를 localStorage + authManager 상태에 저장.

**Google OAuth** (`app/src/auth/googleAuth.js`): Google Identity Services (`accounts.google.com/gsi/client`) → Google ID 토큰 → authManager에 저장.

**Naver OAuth** (`app/src/auth/naverAuth.js`): Electron 전용 IPC 흐름:
1. 렌더러가 `window.electron.openOAuthWindow(authUrl)` 호출
2. 메인 프로세스가 팝업 `BrowserWindow`를 열고 리다이렉트 감지
3. 리다이렉트 URL에서 `code` + `state` 추출 후 IPC로 렌더러에 반환
4. 렌더러가 `{ code, state }`를 백엔드 `/auth/naver/token`으로 교환

**인증 상태**: `app/src/auth/authManager.js`가 모듈 레벨 변수 + 리스너/구독자 패턴으로 전역 `currentUser`를 관리 (Redux/Zustand 없음).

### API 요청 패턴

모든 백엔드 호출은 `app/src/config/api.js`의 `apiRequest()`를 통해 처리:
- `Authorization: Bearer <token>` 및 `X-Provider: google|naver|local` 헤더 자동 추가
- 401 토큰 만료 시 자동 갱신 처리
- 콘솔에 성능 지표 로깅

```javascript
import { apiRequest, API_ENDPOINTS } from '../config/api.js';  // app/src/ 기준 상대경로
import { getCurrentUser } from '../auth/authManager.js';

const result = await apiRequest(API_ENDPOINTS.SOME_ENDPOINT, {
  method: 'POST',
  body: JSON.stringify(data),
}, { currentUser: getCurrentUser() });
```

### 새 IPC 핸들러 추가 방법

**`electron/main.js`**:
```javascript
ipcMain.handle('your-channel', async (event, arg) => {
  return result;
});
```

**`electron/preload.js`**:
```javascript
contextBridge.exposeInMainWorld('electron', {
  // ...기존 항목,
  yourNewApi: (arg) => ipcRenderer.invoke('your-channel', arg),
});
```

**React 컴포넌트**:
```javascript
if (window.electron) {
  const result = await window.electron.yourNewApi(arg);
}
```

## 주요 파일

| 파일 | 역할 |
|------|------|
| `app/electron/main.js` | 메인 프로세스: 윈도우, IPC 핸들러, WebSocket, 자동 업데이트 |
| `app/electron/preload.js` | `window.electron`을 렌더러에 노출하는 IPC 브릿지 |
| `app/electron/installer.nsh` | NSIS 설치 스크립트 커스터마이징 (시작 프로그램 등록) |
| `app/src/config/api.js` | API 기본 URL, `API_ENDPOINTS`, `apiRequest()` 래퍼 |
| `app/src/auth/authManager.js` | 전역 인증 상태, `getCurrentUser()`, 리스너 패턴 |
| `app/src/AppRouter.jsx` | 인증 가드 및 라우트 정의가 포함된 HashRouter |
| `app/src/services/websocketService.js` | Socket.IO 클라이언트, 재연결 로직 |
| `app/src/hooks/useWebSocketSync.js` | 컴포넌트용 실시간 데이터 동기화 훅 |

## 환경 변수

프론트엔드에서 접근하려면 모든 환경 변수에 `VITE_` 접두사가 필요함.

환경 파일 위치: `app/.env`, `app/.env.development`, `app/.env.production`

| 변수 | 개발 | 프로덕션 |
|------|------|---------|
| `VITE_API_URL` | GCP Cloud Run URL | `http://136.113.67.193:8080/proxy` (릴레이) |
| `VITE_WS_RELAY_URL` | `ws://136.113.67.193:8080` | 동일 |
| `VITE_RELAY_ENVIRONMENT` | `development` | `production` |
| `VITE_GOOGLE_CLIENT_ID` | GCP OAuth 클라이언트 ID | 동일 |
| `VITE_NAVER_CLIENT_ID` | 네이버 앱 클라이언트 ID | 동일 |
| `VITE_NAVER_REDIRECT_URI` | `http://localhost:5173/naver-callback.html` | `app://aps-admin/naver-callback` |

## 제약 사항

- **OAuth 리다이렉트 URI**: 개발은 `http://localhost:5173`, 프로덕션은 `app://aps-admin` 커스텀 프로토콜. 둘 다 네이버 개발자 센터에 등록 필요.
- **Electron 컨텍스트 격리**: 렌더러 프로세스에서 Node.js API 직접 사용 불가. 모든 관련 작업은 IPC를 통해야 함.
- **네트워크**: 개발은 인터넷 필요 (GCP API). 프로덕션은 NAS LAN 접근 (`192.168.0.x`) + GCP Firestore/Storage를 위한 인터넷 필요.
- **자동 업데이트**: GitHub Releases를 업데이트 서버로 사용하는 `electron-updater`. `package.json`의 버전이 릴리스 번호를 결정.

## 릴리스 프로세스

자세한 내용은 `docs/release.md` 참고. 요약:
1. `package.json`의 버전 업데이트
2. `npm run release` 실행 — 설치 파일 빌드 후 GitHub Releases에 게시
3. 실행 중인 앱은 `electron-updater`를 통해 자동 업데이트
