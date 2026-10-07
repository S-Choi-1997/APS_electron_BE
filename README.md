# APS Admin

홈페이지 상담, 이메일, SMS, 팀 메모와 일정을 관리하는 직원용 Electron 데스크톱 앱입니다.

## 시작하기

Node.js 20 이상과 npm이 필요합니다. 저장소 루트에는 `package.json`이 없으므로 서비스별 디렉터리에서 설치합니다.

```powershell
cd app
npm ci
npm run electron:dev
```

백엔드 설정과 로컬 DB 준비는 [개발 환경](docs/setup.md), 운영 빌드·배포는 [릴리스 절차](docs/release.md)를 따릅니다.

## 현재 시스템

```text
Electron 앱 → HTTPS / Socket.IO → Cloudflare Tunnel → NAS backend:3001
                                                     ├─ Firestore / Storage
                                                     ├─ PostgreSQL
                                                     ├─ Zoho Mail
                                                     └─ SMS 릴레이 → Aligo
홈페이지 → customer-api (Cloud Run) → Firestore / Storage
cleanup (Cloud Function) → 삭제 기한이 지난 상담·첨부파일 정리
```

- 로그인은 이메일·비밀번호 기반 JWT 인증이며 자동 로그인과 토큰 갱신을 지원합니다.
- 홈페이지 상담과 관리자 계정은 Firestore, 메일·메모·일정·Refresh Token은 PostgreSQL에 저장합니다.
- 메일은 수신·작성·답장·전달·첨부·임시저장·예약발송·번역을 지원합니다.
- Electron 메인은 창·트레이·알림·파일 처리·Socket.IO를 관리하고 React 화면에는 IPC로 전달합니다.
- `relay/`는 이전 앱 트래픽 중계 코드입니다. 현재 앱은 백엔드에 직접 연결하며 SMS 릴레이는 별도로 사용합니다.

## 문서

| 목적 | 기준 문서 |
|---|---|
| 문서 선택과 관리 원칙 | [문서 안내](docs/README.md) |
| 구조·데이터·이벤트 흐름 | [아키텍처](docs/architecture.md) |
| 서비스별 역할 | [서비스 구성](docs/services.md) |
| 설치·개발 실행·접속 설정 | [개발 환경](docs/setup.md) |
| 빌드·배포·업데이트·검증 | [릴리스 절차](docs/release.md) |
| 서버 위치·상태 확인 | [인프라 안내](docs/infrastructure.md) |
| 수집 프로세스의 메일 API | [자동화 메일](docs/automation-mail.md) |
| 개발 완료·리뷰 기준 | [개발 기준](docs/development.md) |
| 미확인 검증·유지보수 항목 | [유지보수](docs/maintenance.md) |

`app/`, `backend/`, `customer-api/`, `cleanup/`, `sms-relay/`, `power-state/`는 서비스 소스입니다. `nas-deploy/`와 `updates-deploy/`는 배포 구성, `scripts/`는 실행 도구입니다. `legacy/`는 수정하지 않는 과거 코드입니다.

과거 설계·작업 기록은 `docs/archive/`, 이전 시스템 문서는 `docs/legacy/`에 보관합니다. 현재 실행 절차는 위 기준 문서를 사용합니다.
