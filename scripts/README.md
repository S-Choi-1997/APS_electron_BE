# 실행 스크립트

명령은 저장소 루트에서 실행합니다. 설치·개발 절차는 [setup](../docs/setup.md), 운영 빌드·배포는 [release](../docs/release.md)가 기준입니다.

| 도구 | 역할 |
|---|---|
| `start-dev.ps1` | 백엔드·Vite·Electron을 세 PowerShell 창에서 실행 |
| `stop-dev.ps1` | 3001/5173 포트의 프로세스와 이름이 Electron인 프로세스를 강제 종료 |
| `build-app-release.ps1` | 지정한 백엔드 URL로 앱 구성 생성·NSIS 빌드; `-PublishUpdates`로 게시 가능 |
| `release-app-update.ps1` | 버전 변경·앱 빌드·업데이트 게시 |
| `publish-app-update.ps1` | 이미 빌드한 업데이트 파일 게시 |
| `check-release.ps1` | 빌드 산출물 검사 |
| `docker-build-push.ps1`, `docker-build-push.sh` | 지정한 버전의 백엔드 이미지 빌드·푸시 |
| `deploy-nas-backend.ps1` | NAS의 이미지 태그 설정·pull·재생성·상태 확인 |
| `check-infra.ps1` | 백엔드·업데이트·SSH 인프라 읽기 전용 확인 |
| `smoke-backend-routes.ps1` | 로그인·라우트 확인과 기본 번역 요청; 번역을 제외하려면 `-SkipTranslation` |
| `smoke-*.cjs` | 기능별 검증; 소스 검사와 Electron 실행 검증의 범위는 각 파일을 확인 |

`stop-dev.ps1`은 이 저장소에서 시작한 프로세스만 식별하는 방식이 아닙니다. 다른 개발 앱을 실행 중이면 각 실행 터미널에서 `Ctrl+C`로 종료합니다. `start-dev.ps1`은 의존성·환경변수·PostgreSQL을 준비하지 않으며 앱이 연결하는 백엔드 주소도 바꾸지 않습니다.

명령의 선택 옵션은 스크립트의 `param` 정의와 기준 문서를 확인합니다. 백엔드 이미지 빌드는 Docker가 있는 `steve`, 운영 실행은 `nas`에서 수행합니다.
