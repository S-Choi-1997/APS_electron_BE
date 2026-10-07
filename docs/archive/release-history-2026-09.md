# 2026-09 릴리스 기록

당시 수행한 배포와 검증 기록입니다. 현재 버전은 feed와 백엔드 응답으로 조회합니다.

### Backend 1.3.37 (2026-09-03)

- Deployed caller-selected `to`, `subject`, `body` / `bodyHtml` support for `POST /api/automation/email`.
- Built and pushed on `steve`, pulled and recreated on `nas`; image digest: `sha256:d878ccc99505dff932592bf2a0854c655931d4efb251969a969ce83357d16382`.
- Registered the service key documented in local-only `.local/mail-api.md` in the NAS environment. Keys are not included in the image or tracked docs.
- Verified healthy container, liveness/readiness, public version 1.3.37, unauthenticated 401, and authenticated request validation 400. No actual email was sent during deployment checks.

### Backend 1.3.38 (2026-09-10)

- Fixed self-addressed Zoho messages in Inbox being classified as outgoing and hidden from the received-mail view.
- Provider Inbox/Sent folder direction now takes precedence over sender-address inference; webhook payloads without reliable folder metadata retain sender inference.
- Corrected two existing hidden Inbox records (`2860`, `2863`) to incoming/unread.
- Built and pushed on `steve`, deployed to NAS, and verified healthy public version 1.3.38. Image digest: `sha256:ad36c11158e563c920c024103741a1a6cdd7e2975ce797e5b65e6dcc80af5307`.

### App 1.3.34 (2026-09-11)

- Mail HTML links now open in the Windows default browser instead of navigating the Electron app window.
- Added renderer interception in the active and legacy mail views plus a main-process `will-navigate` defense.
- Published installer and blockmap to the NAS update channel; public installer and blockmap returned HTTP 200 and the public feed reports 1.3.34.
- Local release artifact checks and the email-link smoke check passed.

### App 1.3.35 (2026-09-11)

- Split received-mail attachment actions into `열기` and `저장` controls.
- `저장` writes directly to the Windows Downloads folder with collision-safe filenames; `열기` uses an app-managed temporary copy and the system-associated application.
- Blocked direct opening for executable and script attachment extensions, and added cleanup for temporary attachment copies older than seven days.
- Polished the attachment list so filenames truncate cleanly and both actions remain visible in narrow reading panes.
- Published the installer and blockmap to the NAS update channel; local release checks passed and the public feed, installer, and blockmap were verified for 1.3.35.
