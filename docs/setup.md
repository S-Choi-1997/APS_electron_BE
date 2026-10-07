# 개발 환경과 최초 설정

서비스별 의존성 설치, 로컬 실행, 앱 접속 설정을 안내합니다. 운영 이미지와 앱 업데이트의 빌드·배포는 [release.md](release.md)가 기준입니다.

## 준비

- Node.js 20 이상, npm.
- 백엔드를 로컬에서 실행한다면 PostgreSQL과 GCP 서비스 계정 인증 파일.
- 운영 NAS 최초 설치에는 Docker Compose와 Cloudflare Tunnel.

저장소 루트에서 서비스별로 설치합니다.

```powershell
npm --prefix app ci
npm --prefix backend ci
```

## 앱 개발 실행

`app/.env`는 로컬 개발용입니다. 기존 파일이 있으면 필요한 값만 수정합니다.

```env
VITE_API_URL=http://localhost:3001
VITE_BACKEND_ENVIRONMENT=development
```

운영 백엔드에 연결해 개발할 때는 `VITE_API_URL=https://backend.apsconsulting.kr`, `VITE_BACKEND_ENVIRONMENT=production`을 사용합니다. 앱의 대상 서버를 확인한 뒤 데이터 변경 작업을 수행합니다.

```powershell
cd app
npm run electron:dev
```

이 명령은 Vite 5173과 Electron을 함께 실행합니다. Vite만 필요하면 `npm run dev`를 사용합니다. 수동으로 나누어 실행할 때는 Vite를 먼저 시작한 뒤 별도 터미널의 `app/`에서 `npm run electron`을 실행합니다. 빌드된 화면을 사용하려면 먼저 `npm run build`, 이후 `npm run electron:prod`를 사용합니다.

기존 `scripts/start-dev.ps1`은 백엔드·Vite·Electron을 세 창에서 실행하는 보조 도구입니다. PostgreSQL과 환경 설정을 준비하지는 않습니다. 종료 도구의 동작 범위는 [scripts README](../scripts/README.md)를 확인합니다.

## AppConfig와 연결 방식

Electron 메인이 AppConfig를 관리합니다. 렌더러 REST와 메인 Socket.IO는 이 설정을 함께 사용합니다.

| 입력 | 용도 |
|---|---|
| `VITE_API_URL`, `VITE_BACKEND_ENVIRONMENT` | 개발 및 패키징 기본값 생성 |
| `VITE_WS_URL` | 선택적 WebSocket 주소; 생략하면 API 주소에서 `ws`/`wss` 파생 |
| `APS_API_URL`, `APS_WS_URL`, `APS_BACKEND_ENVIRONMENT` | 메인 프로세스의 런타임 환경변수 재정의 |
| Electron userData의 `app-config.json` | 사용자별 저장 설정 |
| `app/electron/app-config.default.json` | 빌드 시 생성되는 패키징 기본값 |

저장 설정은 기본값 위에 적용되고 런타임 환경변수로 다시 덮어쓸 수 있습니다. 이전 `/proxy`·Cloud Run·릴레이 주소는 현재 코드의 마이그레이션 대상입니다. 기본 대체 주소는 개발에서 localhost, 패키징 앱에서 운영 백엔드입니다. `VITE_RELAY_ENVIRONMENT`는 현재 앱 설정 입력이 아닙니다.

실제 설정 선택은 `app/electron/app-config.js`, 생성은 `app/scripts/generate-app-config.js`를 확인합니다. 패키징 기본값을 직접 편집하지 않고 [release](release.md)의 빌드 스크립트를 사용합니다. 빌드 스크립트는 임시 환경 파일을 `APS_APP_CONFIG_ENV_FILE`로 전달합니다.

패키징 앱은 `APS_DISABLE_AUTO_UPDATE=true`가 아니면 업데이트 확인을 활성화합니다. 개발 앱은 updater 초기화를 건너뜁니다. `APS_ENABLE_AUTO_UPDATE`는 개발의 enabled 판정에 쓰이지만 초기화의 패키징 조건을 우회하지는 않습니다. 다운로드 기본값은 수동이며 업데이트 상태와 설치 동작은 `app/electron/auto-updater-manager.js`가 관리합니다.

## 백엔드 로컬 실행

`backend/.env.example`을 참고해 `backend/.env`를 준비합니다. 기존 `.env`를 덮어쓰지 않습니다. 로그인에 쓰이는 계정은 Firestore `admins`입니다. 오래된 `ALLOWED_EMAILS`·Naver 설정 예시는 현재 사용자 로그인 방식의 근거가 아닙니다.

```env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://apsuser:<password>@localhost:5432/aps_admin
GOOGLE_APPLICATION_CREDENTIALS=<absolute-service-account-path>
STORAGE_BUCKET=<actual-bucket-name>
JWT_SECRET=<configured-access-secret>
JWT_REFRESH_SECRET=<configured-refresh-secret>
WS_RELAY_ENABLED=false
BACKEND_ENVIRONMENT=development
```

실제 값은 기존 환경 설정을 사용합니다. DB 비밀번호에 `@`, `:`, `/`, `#`, `%` 등이 있으면 `DATABASE_URL`에는 URL 인코딩합니다. `NODE_ENV=production`에서는 JWT 두 값이 없거나 placeholder이거나 32자 미만이면 서버 시작이 실패합니다.

로컬 PostgreSQL에 사용자와 `aps_admin` DB를 준비하고, 빈 개발 DB에는 저장소 루트에서 초기 스키마를 적용합니다.

```powershell
psql --dbname '<local-db-connection-url>' --file backend/init-db.sql
```

그 뒤 백엔드에서:

```powershell
cd backend
npm start
```

`setup-db.js`는 메일 관련 마이그레이션을 실행하며 기본 메모·일정·Refresh Token 테이블을 모두 초기화하는 도구는 아닙니다. 이 스크립트는 `.env`도 자동으로 읽지 않으므로 별도로 필요할 때 `node --env-file=.env setup-db.js`를 사용합니다. 서버의 일반 `runMigrations()`는 현재 비활성화되어 있으며 시작 시 실행되는 일부 `ensure*Schema`와 구분합니다. 운영 DB를 로컬 검증 대상으로 사용하지 않습니다. 선택적 SMS·Zoho·번역 설정은 `.env.example`과 해당 서비스 코드를 확인합니다.

최초 계정 생성이 필요한 경우 Firestore 쓰기 자격으로 `backend/`에서 다음 CLI를 사용합니다. 기존 계정 생성은 거절됩니다.

```powershell
node create-admin.js '<email>' '<password>' '<display-name>' admin
```

## NAS 최초 설치

`nas-deploy/`의 `.env.example`에서 `.env`를 새로 만들고 서비스 계정 파일을 `service-account.json`으로 준비합니다. 기존 환경·데이터는 유지합니다.

필수 항목은 `BACKEND_IMAGE_TAG`, `POSTGRES_PASSWORD`, `DATABASE_URL`, JWT 두 값과 GCP 설정입니다. `DATABASE_URL`의 호스트는 Compose 서비스 이름 `postgres`입니다. 구체적인 이미지 태그를 사용합니다.

NAS의 배포 디렉터리에서:

```sh
docker compose pull aps-backend
docker compose up -d
docker compose logs -f aps-backend
curl -fsS http://localhost:3001/healthz
curl -fsS http://localhost:3001/readyz
```

`nas-deploy/docker-compose.yml`이 PostgreSQL과 선택한 백엔드 이미지를 실행합니다. `init-db.sql`은 빈 DB 볼륨의 최초 초기화에 적용됩니다. 기존 볼륨은 파일을 고쳐도 다시 초기화되지 않습니다. 이후 릴리스는 [release](release.md)를 따릅니다.

## 연결 확인

```powershell
Invoke-RestMethod https://backend.apsconsulting.kr/readyz
```

직결 운영에서 정상 응답은 `status: ok`, `database.ready: true`, `wsRelayEnabled: false`, `directWebSocket.enabled: true`입니다. `/healthz`는 프로세스 상태, `/readyz`는 DB 준비 상태입니다. Cloudflare 대상 주소는 [인프라 안내](infrastructure.md#cloudflare-대상)를 따릅니다.

로그는 앱 DevTools·Electron 출력, 백엔드는 `docker compose logs`로 확인합니다. 연결이 예상과 다르면 앱의 실제 AppConfig와 저장 설정·런타임 재정의부터 확인합니다.
