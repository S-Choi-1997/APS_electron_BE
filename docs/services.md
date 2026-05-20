# 서비스 구성

이 레포지토리는 8개의 서비스를 하나의 모노레포로 관리합니다.

## app/ (Electron 앱)

| 폴더 | 역할 |
|------|------|
| `app/src/` | React 18 프론트엔드 (Vite) |
| `app/electron/` | Electron 메인 프로세스, IPC, 자동업데이트 |
| `app/public/` | 정적 파일 |
| `scripts/` | 개발용 보조 스크립트 (레포 루트) |

빌드: `cd app && npm run electron:build` → `app/dist/` (NSIS 설치파일)

## backend/

NAS/백엔드 서버에 Docker로 배포되는 Express 백엔드.

- **포트**: 3001 (Cloudflare Tunnel이 이 포트로 전달)
- **DB**: PostgreSQL (메모, 일정, 이메일 문의)
- **인증**: JWT (Access 1h + Refresh 30d)
- **실시간**: Socket.IO 직접 연결 (Electron 앱 ↔ backend)
- **Docker Hub**: `choho97/aps-admin-backend`

## relay/

레거시 WebSocket 릴레이 서버입니다. 현재 Electron 앱의 정상 트래픽은 Cloudflare Tunnel을 통해 backend에 직접 연결되므로 새 릴리스 경로에서는 사용하지 않습니다.

- **VM**: GCP Compute Engine `aligo-proxy` (us-central1-a)
- **IP**: `136.113.67.193:8080`
- **기존 역할**: Electron ↔ backend 간 HTTP 요청을 WebSocket 이벤트로 변환하여 중계
- **배포**: `relay/DEPLOY.md` 참조 (Docker Hub 푸시 → gcloud pull)
- **대시보드**: `http://136.113.67.193:8080` (레거시 상태 확인)

## power-state/

NAS PC를 꺼도 되는지 외부에서 확인하는 경량 ON/OFF 상태 서비스.

- **VM**: 동일 `aligo-proxy`, 포트 **3001**
- **공개 API**: `GET http://136.113.67.193:3001/api/public/state` (인증 불필요)
- **배포**: `power-state/README.md` 참조 (Docker Hub 푸시 → docker run)

## nas-deploy/

NAS에 복사해서 백엔드를 실행하기 위한 배포 키트 (소스 아님).

- **포함**: `docker-compose.yml` (Docker Hub 이미지 pull), `init-db.sql` (DB 초기화)
- **제외(gitignored)**: `.env`, `service-account.json`, `postgres-data/`
- `docker-compose up -d` 한 줄로 백엔드 + PostgreSQL 실행

## sms-relay/

Aligo SMS API용 고정 IP 중계 서버.

- **VM**: GCP Compute Engine `aligo-proxy` (us-central1-a)
- **IP**: `136.113.67.193:3000`
- **실행**: systemd (`sms-relay.service`)
- **엔드포인트**: `POST /sms/send`

## customer-api/

고객 상담 접수용 공개 API.

- **배포**: GCP Cloud Run
- **기능**: reCAPTCHA 검증, Firestore 저장
- **이 레포에서 직접 배포 안 함** (Cloud Run 독립 배포)

## cleanup/

개인정보보호법 준수 자동 삭제 Cloud Function.

- **실행**: 매일 02:00 KST (Cloud Scheduler)
- **대상**: Firestore에서 179일 지난 상담 문의 + Storage 첨부파일
- **이 레포에서 직접 배포 안 함** (Cloud Functions 독립 배포)

## legacy/

참고용 레거시 코드. 수정 금지.

- `legacy/gcp2/` — 구 Cloud Run 관리자 API (개발환경 API 타겟으로만 사용)
- `legacy/gcp3/` — GCP3 VM 설정 스크립트
- `legacy/gcp/` — customer-api 이전 버전
- `legacy/gcp-cleanup/` — cleanup 이전 버전
- `legacy/apsmanager/` — APSmanager 레거시 문서
- `legacy/docs/` — 레거시 문서들
