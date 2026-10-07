# 시스템 아키텍처

현재 프로세스 경계와 데이터·이벤트 흐름을 설명합니다. 설치와 AppConfig 입력은 [setup](setup.md), 서비스별 역할은 [services](services.md), 배포는 [release](release.md)를 사용합니다.

## 연결 구조

```text
React renderer ── REST HTTPS ────────────────────┐
      │ IPC                                     │
Electron main ── Socket.IO WSS ──────────────────┤
                                                ▼
                                    Cloudflare Tunnel
                                                │
                                    NAS backend:3001
                                      Express + Socket.IO
                                      ├─ PostgreSQL
                                      ├─ Firestore / Storage
                                      ├─ Zoho Mail / OpenRouter
                                      └─ 고정 IP SMS 릴레이 → Aligo

홈페이지 → customer-api (Cloud Run) → Firestore inquiries / Storage
cleanup (Cloud Function) → 삭제 기한이 지난 inquiries / Storage 정리
```

일반 앱 트래픽은 백엔드에 직접 연결합니다. `relay/`의 이전 `/proxy` 중계는 사용하지 않으며 NAS Compose는 `WS_RELAY_ENABLED=false`를 지정합니다. SMS는 제공자의 고정 IP 경로 때문에 별도 릴레이를 사용합니다.

## Electron 경계

- React/Vite는 화면·서비스 호출·TanStack React Query 캐시를 관리합니다.
- 메인 프로세스는 AppConfig, 창·트레이·알림·첨부파일·업데이트·Socket.IO를 관리합니다.
- `preload.js`는 격리된 렌더러에 `window.electron` IPC API를 노출합니다.
- 메인 Socket.IO 이벤트를 모든 관련 창으로 전달하고 `useWebSocketSync`가 캐시를 갱신하거나 다시 조회합니다.

접속 주소는 런타임 AppConfig가 기준입니다. `apiRequest()`는 인증 헤더, 요청/본문 타임아웃, 세션 복원을 처리합니다. 앱 사용자 로그인은 로컬 JWT이며 Zoho OAuth는 메일 계정 연결용입니다.

## 데이터 위치

| 데이터 | 저장소 |
|---|---|
| 홈페이지 상담 `inquiries` | GCP Firestore |
| 홈페이지 상담 첨부파일 | GCP Cloud Storage |
| 관리자 계정 `admins` | Firestore |
| 메모·일정·메일·폴더·라벨·임시저장·예약발송·제공자 작업 기록 | NAS PostgreSQL |
| Refresh Token | PostgreSQL |
| Zoho OAuth Token | Firestore 기반 토큰 저장 모듈 |
| ON/OFF 표시 상태 | power-state의 JSON 파일과 Docker 볼륨 |

웹 상담의 기준 데이터는 Firestore `/inquiries`입니다. 별도 `/web-form-inquiries` PostgreSQL 라우트도 남아 있지만 테이블이 없으면 빈 목록과 warning을 반환하는 보조 경로입니다.

## 상담·메모·일정 실시간 흐름

1. 홈페이지 API가 Firestore에 상담을 저장합니다.
2. 백엔드 `onSnapshot`이 생성·수정·삭제를 감지합니다. 최초 스냅샷의 기존 항목은 신규 알림으로 전송하지 않습니다.
3. `global.broadcastEvent`가 직접 Socket.IO 클라이언트에 `consultation:*` 이벤트를 보냅니다.
4. Electron 메인 → IPC → React Query 캐시 → 화면·알림으로 반영합니다.

메모와 일정은 백엔드 CRUD가 PostgreSQL에 반영한 뒤 `memo:*`, `schedule:*` 이벤트를 보냅니다. 직접 Socket.IO 연결도 Access Token을 검증합니다.

## 메일 흐름

Zoho 연동은 설정으로 활성화합니다. 웹훅 수신과 초기 동기화, 기본 5분 주기 증분 동기화가 PostgreSQL 메일 캐시를 갱신합니다. 앱의 수동 동기화도 지원합니다.

발송·답장·폴더·라벨 등 제공자 작업과 로컬 기록은 `email-mail-client-service.js` 및 `zoho/`가 처리합니다. 예약발송 디스패처는 DB 스키마 준비 후 서버 시작 시 실행합니다. 번역은 백엔드에서 OpenRouter를 호출하고 결과를 저장합니다.

별도 수집 컨테이너의 `POST /api/automation/email`은 같은 발송 서비스를 재사용합니다. 요청·응답과 결과 미확정 시 처리 기준은 [automation-mail](automation-mail.md)을 따릅니다.

## 시작과 상태 확인

백엔드는 PostgreSQL 연결을 재시도하고 스키마 준비를 마친 뒤 HTTP 서버와 예약발송 디스패처를 시작합니다. `/healthz`는 liveness, `/readyz`와 `/`는 DB 연결·스키마 준비 상태를 반환합니다. 이 응답으로 Zoho·SMS·Firestore 전체 상태까지 판정하지 않습니다.

앱 배포와 백엔드 이미지 배포는 독립적입니다. NAS는 구체적인 Docker 이미지 태그를 pull하며 앱 업데이트 서버는 NSIS 설치파일·blockmap·feed를 제공합니다.
