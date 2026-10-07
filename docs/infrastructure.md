# 인프라 안내

서비스 위치와 읽기 전용 조회 방법을 안내합니다. 아래 주소는 저장소 설정·운영 문서의 기준이며 이번 문서 정리에서 실서버 상태를 조회하지 않았습니다.

| 머신 | 역할 | 관련 문서 |
|---|---|---|
| 로컬 IDE PC | 코드 수정, 앱 패키징, 업데이트 게시 | [릴리스](release.md) |
| `steve` | Docker 백엔드 이미지 빌드·푸시 | [릴리스](release.md) |
| `nas` | PostgreSQL·백엔드·업데이트 정적 서버 | [개발 환경](setup.md), [업데이트 서버](../updates-deploy/README.md) |
| `aligo-proxy` | GCP `us-central1-a`, 고정 IP SMS·ON/OFF 상태 서비스 | [서비스 구성](services.md), [power-state](../power-state/README.md) |

## 주소와 조회

- 백엔드: `https://backend.apsconsulting.kr`, NAS 호스트 포트 3001.
- 업데이트 feed: `https://update.apsconsulting.kr/win/latest.yml`, NAS 정적 서버 호스트 포트 8088.
- SMS 릴레이: `136.113.67.193:3000`, `sms-relay.service`.
- ON/OFF 상태: `http://136.113.67.193:3001/api/public/state`. 관리자가 저장한 상태이며 자동 DB·NAS 가용성 판정은 아닙니다.
- 이전 앱 릴레이: `136.113.67.193:8080`. 현재 앱의 REST/Socket.IO 경로에 사용하지 않습니다. 실제 컨테이너 실행 여부는 조회로 확인합니다.

```powershell
.\scripts\check-infra.ps1 -BackendUrl https://backend.apsconsulting.kr
Invoke-RestMethod https://backend.apsconsulting.kr/readyz
ssh nas 'docker ps'
ssh aligo-proxy 'systemctl status sms-relay --no-pager'
```

## Cloudflare 대상

현재 NAS 문서의 `cloudflared`는 Docker bridge에서 실행하므로 백엔드 대상은 `http://172.17.0.1:3001`입니다. 업데이트 서버도 동일한 bridge 컨테이너에서 접근한다면 호스트 게이트웨이의 8088 포트를 사용합니다.

터널이 호스트에서 직접 실행되면 `localhost`, 같은 Docker 네트워크라면 해당 서비스 이름, 다른 머신이라면 도달 가능한 LAN 주소를 사용합니다. `localhost`는 터널 프로세스가 실행되는 네트워크 공간을 뜻하므로 배포 방식에 맞춰 확인합니다.

## 과거 머신 자료

[gcp4-vm-info.md](gcp4-vm-info.md)는 2026-01-11 당시 VM 사양·접속·설정 자료입니다. 고유한 설정 값을 포함한 원문은 그대로 보존합니다. `RUNNING`, 사용량, 컨테이너 uptime과 SSH 키 목록은 당시 기록이며 현재 상태를 단정하는 근거로 사용하지 않습니다.

이전 릴레이 운영 절차는 [relay/DEPLOY.md](../relay/DEPLOY.md)에 있습니다. 앱 개발 환경의 `VITE_RELAY_ENVIRONMENT` 설정 안내는 현재 코드에 적용되지 않습니다.
