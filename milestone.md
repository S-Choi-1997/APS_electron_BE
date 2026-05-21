# Codebase Structure Cleanup Milestone

기준: Express, Electron, TanStack Query, React, Vite, Git ignore, Docker volume 레퍼런스와 현재 코드 구조 비교.

## Working Rule

- 모든 구현은 `구현시 명심.md`를 기준으로 진행한다.
- 단순히 테스트를 통과시키는 것이 아니라, 실제 사용 경로에서 동작하는지 runtime/output evidence까지 확인해야 한다.
- 각 work call을 시작할 때 Product Intent, Acceptance Matrix, Verification Method를 먼저 정리하고 구현한다.
- 구현 완료 후에는 반드시 서브에이전트를 별도로 호출해 `구현시 명심.md` 기준으로 제대로 구현되었는지 production readiness review를 맡긴다.
- 서브에이전트 검토는 기능 완성 선언 전에 수행한다. 검토 범위에는 실제 사용 경로, 실패 경로, 권한/보안 경계, 문서와 구현의 일치 여부, 배포 가능 여부가 포함되어야 한다.
- 서브에이전트가 지적한 blocker는 완료 처리 전에 수정하거나, 수정하지 못하면 명확히 blocked/residual risk로 남긴다.

## Done

| 영역 | 완료 내용 | 검증 |
|---|---|---|
| Backend route split | `backend/server.js`에서 memo API를 `backend/memo-routes.js`로 분리 | production backend `1.3.25` 배포 후 `GET /memos?limit=1` 200 |
| Backend SMS split | SMS relay 전송 로직을 `backend/sms-service.js`, `/sms/send` 라우트를 `backend/sms-routes.js`로 분리 | production backend `1.3.25` 배포 후 `POST /sms/send` validation 경로 400 `invalid_receiver` |
| Backend translation route split | email translation 라우트를 `backend/email-translation-routes.js`로 분리 | production backend `1.3.25` 배포 후 `POST /email-inquiries/657/translate` 200, backfill 200 |
| Backend Docker packaging | 새 backend module 파일들을 Docker image에 포함 | `steve`에서 `choho97/aps-admin-backend:1.3.25` build/push, NAS 배포 완료 |
| Production smoke verification | 실제 운영 경로에서 배포/검증 | `https://backend.apsconsulting.kr/` 200, NAS container healthy, `check-infra.ps1` 통과 |
| Backend remaining route boundaries | Firestore `/inquiries`, schedules, web form inquiries, email response routes, ZOHO integration 등록부를 module로 분리하고 `/email-inquiries` 중복 책임 정리 | production backend `1.3.27` 배포 후 `/inquiries`, `/inquiries/all`, `/schedules`, `/web-form-inquiries`, `/email-inquiries`, `/sms/send`, translation smoke 통과 |
| Backend route smoke script | backend route split 후 반복 가능한 운영 smoke script 추가 | `scripts/smoke-backend-routes.ps1 -BackendUrl https://backend.apsconsulting.kr` 전체 Pass |
| Electron main process split | `app/electron/main.js`에서 app config, WebSocket, updater, config IPC, file IPC, startup IPC, window loading helper를 module로 분리 | `npm --prefix app run electron:build` 통과, `win-unpacked` packaged smoke에서 app.asar module load/dist load/WebSocket init 확인 |
| Electron IPC hardening baseline | 공통 IPC wrapper와 URL/download sanitizer를 추가하고 auth/session IPC sender role 검증, 모든 BrowserWindow의 `window.open` protocol whitelist, REST→WS config 파생 보정을 적용 | preload invoke 41개와 main handlers 대조 결과 missing 0, BrowserWindow 4개 모두 external URL handler 적용, config derivation check 통과 |

## Remaining

| 우선순위 | 영역 | 남은 일 | 완료 기준 |
|---:|---|---|---|
| 2 | Electron full usage smoke | 로그인 이후 주요 IPC, notification/download, update downloaded → install flow를 실제 설치본 또는 동등한 harness에서 검증 | 실제 사용자 경로에서 auth/session IPC, 파일 저장/다운로드, 알림 창, 업데이트 설치 요청이 기대 출력/로그와 함께 통과 |
| 3 | Email page state split | `EmailConsultationsPage.jsx`의 mailbox/filter/selection/detail/composer/draft/scheduled 상태를 reducer 또는 `useEmailPageState`로 분리 | 주요 메일 UI 흐름이 기존과 동일하게 동작하고 컴포넌트 책임이 줄어듦 |
| 4 | Query invalidation narrowing | `emailQueryKeys`와 WebSocket invalidation을 이벤트별로 좁힘 | 생성/수정/삭제/메일함 이벤트별로 필요한 query만 invalidate |
| 5 | Static asset cleanup | `app/font`와 `app/public/font`의 Nanum font 중복 실제 사용 경로 확인 후 정리 | 사용되는 한 경로만 남고 app build 통과 |
| 5 | Artifact/runtime data cleanup | tracked SQL backup, repo 내부 runtime data, local artifact 탐색 잡음 정리 | 필요한 백업은 repo 밖 또는 명확한 docs 경로로 이동, ignore 정책 정리 |
| 5 | Docker DB data location | `nas-deploy/postgres-data/` 같은 repo 하위 DB data 경로를 운영 경로와 분리 검토 | 운영 compose가 repo 내부 DB data dir에 의존하지 않음 |
| 6 | Regression guard | 최소 smoke/lint/check 명령을 문서화 또는 스크립트화 | route split 후 반복 가능한 검증 명령이 존재 |

## Current Status

- 완료: Call 1 backend route boundary 정리, Call 2 Electron main/IPC code split 및 hardening baseline.
- 남음: Electron full usage smoke, React email page 상태 정리, query invalidation 정리, asset/artifact 정리, 회귀 검증 자동화.
- 현재 운영 backend: `choho97/aps-admin-backend:1.3.27`.
- 주의: WebSocket tunnel 관련 route-specific handler는 아직 `server.js`에 남아 있다. Call 1의 API route 분리 범위에서는 기능 유지 우선으로 남겼고, 별도 backend cleanup 후보로 둔다.

## Next 3 Work Calls

### Call 1: Finish Backend Route Boundaries - Done

목표: `backend/server.js`를 Express entrypoint에 가깝게 줄이고, 운영 API 동작은 유지한다.

포함 범위:

- `backend/server.js`에 남은 Firestore `/inquiries` API 분리.
- schedules API 분리.
- web form inquiries API 분리.
- `/email-inquiries` 본체와 `emailMailClient.registerRoutes()` 이후 중복 책임 정리.
- ZOHO integration 등록부를 별도 module로 분리할지 결정하고, 가능하면 분리.
- route split 후 반복 가능한 backend smoke checklist 정리.

완료 기준:

- `server.js`에는 app/bootstrap, middleware, WebSocket, module registration 중심만 남는다.
- 운영 image build/push/deploy 후 `https://backend.apsconsulting.kr/` health `1.3.x` 확인.
- 운영 URL에서 `/inquiries`, `/schedules`, `/email-inquiries`, `/memos`, `/sms/send`, translation 주요 경로 smoke test 통과.

구현 결과:

- commits: `9bcf271 refactor remaining backend route boundaries`, `fd11c88 handle missing web form inquiry table`.
- deployed image: `choho97/aps-admin-backend:1.3.27`.
- verification: `scripts/smoke-backend-routes.ps1 -BackendUrl https://backend.apsconsulting.kr`, `scripts/check-infra.ps1 -BackendUrl https://backend.apsconsulting.kr`.
- residual risk: production DB에 `web_form_inquiries` table이 없어 GET은 안전한 empty response로 처리하고 PATCH는 503을 반환한다. 실제 기능 활성화가 필요하면 DB migration/backfill이 별도 필요하다.

### Call 2: Split Electron Main And Harden IPC - Code Done, Full Smoke Pending

목표: Electron main process의 책임을 역할별로 분리하고 IPC handler 검증을 보기 쉽게 만든다.

포함 범위:

- `app/electron/main.js`를 `windows`, `ipc`, `updater`, `websocket`, `appConfig`, notification/download 관련 module로 분리.
- preload API와 main IPC handler mapping 점검.
- IPC sender/권한/입력 검증 공통 helper 도입 여부 결정.
- sticky/memo window, updater, websocket reconnect 같은 운영 기능이 기존과 동일하게 동작하는지 확인.

완료 기준:

- Electron dev 또는 packaged app 경로에서 창 생성, login 이후 주요 IPC, update check, notification/download, websocket 연결 smoke test 통과.
- IPC handler 위치와 검증 규칙이 기능별로 추적 가능하다.

구현 결과:

- `app/electron/main.js`를 2052 lines 수준에서 약 1030 lines 수준으로 줄이고 app config, WebSocket, updater, config IPC, file IPC, startup IPC, window loading helper를 module로 분리했다.
- preload invoke 41개와 main/electron module handlers를 대조해 missing 0을 확인했다.
- 외부 URL은 IPC 경로와 모든 Electron `BrowserWindow`의 `window.open` 경로에서 protocol whitelist를 통과해야 열리도록 정리했다.
- auth/session IPC는 sender window role을 검증한다. `set-auth-session`/`clear-session`은 main window만, `get-auth-token`은 main/sticky/memo window만 허용한다.
- updater `install-update`는 `quitAndInstall` 전에 `app.isQuitting = true`를 설정해 전역 `before-quit` handler가 설치 흐름을 막지 않게 했다.
- REST-only config 변경 시 WebSocket URL이 REST URL에서 다시 파생되도록 `wsDerivedFromRest` 판정을 보정했다. 기존 저장 설정에 `wsDerivedFromRest:false`가 남아 있어도 REST에서 파생된 URL이면 derived로 재판정한다.
- verification: `node --check app/electron/*.js`, app config derivation check, IPC channel coverage check, `npm --prefix app run electron:build`, `app/dist/win-unpacked/APS Admin.exe` packaged smoke.
- subagent review: completion overclaim, child window URL gap, auth/session IPC role gap, old config compatibility gap을 지적받았고 code/milestone을 수정했다.
- residual risk: 실제 설치본의 업데이트 다운로드 완료 후 설치 버튼, 로그인 이후 실제 사용자 IPC, notification/download 전체 흐름은 아직 full usage smoke가 필요하다. 이 항목은 Remaining에 남긴다.

### Call 3: Frontend Email State, Query Invalidation, And Workspace Cleanup

목표: 메일 UI의 복잡 상태와 cache invalidation을 줄이고, repo 탐색 잡음을 정리한다.

포함 범위:

- `EmailConsultationsPage.jsx`에서 mailbox/filter/selection/detail/composer/draft/scheduled 상태를 reducer 또는 `useEmailPageState`로 분리.
- 화면 컴포넌트와 상태/효과 wiring 분리.
- `emailQueryKeys`와 WebSocket invalidation을 이벤트별로 좁힘.
- `app/font`와 `app/public/font` 중복 사용 경로 확인 후 정리.
- tracked SQL backup, repo 내부 runtime data, local artifact 위치와 ignore 정책 정리.
- 최소 lint/build/smoke 명령을 문서화 또는 script화.

완료 기준:

- 메일 주요 흐름: mailbox 전환, 상세 열기, reply/compose/draft/scheduled, websocket 반영이 기존과 동일하게 동작.
- 불필요한 broad invalidation이 줄고, query key 책임이 명확하다.
- app build 또는 해당 frontend 검증 명령 통과.
- repo 내부 local/runtime artifact 탐색 잡음이 줄어든다.
