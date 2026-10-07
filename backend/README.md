# APS Admin Backend

NAS에서 동작하는 Node.js 20+ Express / Socket.IO 서버입니다. 기본 포트는 3001이며 REST와 실시간 연결을 같은 HTTP 서버에서 제공합니다.

## 문서 범위

이 문서는 백엔드 코드 탐색과 로컬 검증 안내입니다. 설치는 [개발 환경](../docs/setup.md), 운영 이미지 빌드·NAS 배포는 [릴리스 절차](../docs/release.md)를 사용합니다.

## 코드 구성

| 파일 | 역할 |
|---|---|
| `server.js` | 초기화, 라우트 등록, 상태 확인, Socket.IO, 종료 처리 |
| `auth.js`, `firestore-admin.js` | JWT, bcrypt, Firestore `admins`, PostgreSQL Refresh Token |
| `db.js`, `startup-readiness.js` | PostgreSQL 풀, 시작 시 연결 재시도 |
| `inquiry-routes.js` | Firestore 홈페이지 상담·첨부파일 조회와 상태 수정 |
| `memo-routes.js`, `schedule-routes.js` | PostgreSQL 메모·일정 CRUD |
| `sms-routes.js`, `sms-service.js` | 입력 검증과 고정 IP SMS 릴레이 요청 |
| `email-mail-client-service.js` | 메일·스레드·폴더·라벨·임시저장·예약발송·감사 기록 |
| `zoho/`, `zoho-integration.js` | Zoho OAuth·웹훅·초기 및 주기 동기화·발송 |
| `email-translation-service.js` | OpenRouter 한국어 번역과 저장 |
| `automation-mail-routes.js` | [수집 프로세스 메일 발송](../docs/automation-mail.md) |
| `startup-diagnostics-routes.js` | 앱 시작 진단 기록 수집 |

`init-db.sql`과 `migrations/`에는 SQL 정의가 있습니다. 운영 초기 배포 SQL은 `nas-deploy/init-db.sql`입니다. 일반 `runMigrations()`는 현재 비활성화되어 있으며 일부 `ensure*Schema`만 시작 시 실행합니다. 기존 DB 변경은 이 범위를 확인한 뒤 계획합니다.

## 로컬 실행·검증

저장소 루트에서:

```powershell
npm --prefix backend ci
npm --prefix backend test
cd backend
npm start
```

실행 전에 PostgreSQL, `.env`, GCP 인증과 Firestore 관리자 계정이 필요합니다. 로컬 DB 준비·계정 생성은 [개발 환경](../docs/setup.md)을 따릅니다.

## 기본 API

| 경로 | 역할 |
|---|---|
| `POST /auth/login`, `/auth/refresh`, `/auth/logout` | 로그인·갱신·로그아웃 |
| `GET /users/me`, `PATCH /users/me` | 로그인 사용자 조회·표시 이름 수정 |
| `/inquiries` | 홈페이지 상담 목록·상세·수정·삭제; 수정은 `PATCH`, 접수는 독립 customer-api |
| `/memos`, `/schedules` | 메모·일정 CRUD; 수정은 `PATCH` |
| `/email-inquiries`, `/email-threads`, `/email-folders`, `/email-labels` | 메일 클라이언트 API; 상세 경로는 등록 코드를 확인 |
| `POST /sms/send` | SMS 발송 |
| `POST /api/automation/email` | 전용 서비스 키 메일 발송 |
| `GET /healthz` | 프로세스 liveness, 버전 |
| `GET /readyz`, `GET /` | DB 연결과 스키마 준비 상태; 미준비는 HTTP 503 |

`/healthz`만 성공했다고 DB 준비까지 검증된 것은 아닙니다. `/readyz`를 함께 확인합니다. 상태 응답은 Firestore·Zoho·SMS 전체 가용성을 보장하지 않습니다.
