# 서비스 구성

실행 서비스와 배포 구성의 소유 범위를 안내합니다. 머신·주소는 [infrastructure](infrastructure.md), 연결 흐름은 [architecture](architecture.md)를 사용합니다.

| 디렉터리 | 역할 | 배포 단위 |
|---|---|---|
| `app/` | React 18/Vite UI, Electron 메인·IPC·알림·업데이트 | Windows NSIS 설치파일 |
| `backend/` | Express REST, JWT, Socket.IO, PostgreSQL/GCP/Zoho 연동 | Docker Hub 백엔드 이미지, NAS 실행 |
| `customer-api/` | 공개 상담 접수, reCAPTCHA, Firestore 저장, 첨부 업로드 URL | 독립 Cloud Run 서비스 |
| `cleanup/` | `deleteAt`이 지난 상담과 첨부 정리 | Cloud Function, Scheduler 호출 |
| `sms-relay/` | 고정 IP로 Aligo 요청 중계 | GCP VM systemd 서비스 |
| `power-state/` | 관리자 지정 ON/OFF 상태 저장·조회 | GCP VM Docker 서비스 |
| `relay/` | 이전 앱 HTTP/WebSocket 중계 | 레거시 서비스; 정상 앱 경로에서 미사용 |
| `nas-deploy/` | PostgreSQL·백엔드 Compose, 최초 DB 초기화 | 배포 구성; 소스 빌드 위치가 아님 |
| `updates-deploy/` | 앱 업데이트 feed·설치파일을 제공하는 정적 서버 | NAS Docker 구성 |
| `scripts/` | 개발 실행·빌드·게시·검증 도구 | 로컬/빌드 머신에서 선택 실행 |
| `legacy/` | 이전 소스와 문서 | 참고 전용, 수정하지 않음 |

`customer-api`와 `cleanup`은 이 저장소의 앱/백엔드 릴리스 스크립트로 배포되지 않습니다. 독립 서비스 변경은 해당 배포 구성을 확인합니다.

## 백엔드·앱 운영

백엔드 포트는 3001이며 JWT Access Token의 기본 만료는 1시간, Refresh Token은 30일입니다. 로그인 계정은 Firestore, Refresh Token은 PostgreSQL입니다. 일반 앱 REST/Socket.IO는 Cloudflare 직결입니다.

빌드·배포·업데이트 절차는 [release](release.md), 개발은 [setup](setup.md), 서비스 내부 코드는 [backend README](../backend/README.md)를 참고합니다.

## 독립 운영 문서

- [power-state](../power-state/README.md): 수동 ON/OFF 상태 관리. NAS 자동 상태 감지 기능이 아닙니다.
- [cleanup](../cleanup/README.md): 기한 기반 삭제, 호출 한도와 실패 처리.
- [업데이트 정적 서버](../updates-deploy/README.md): feed와 파일 제공 구성.
- [이전 릴레이 배포](../relay/DEPLOY.md): 과거 릴레이 운영 전용.

cleanup의 실행 시각은 Cloud Scheduler 설정이 결정합니다. 문서의 02:00 KST는 설정 예시이며 코드에 내장된 스케줄이 아닙니다.
