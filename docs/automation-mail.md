# 수집 프로세스의 메일 발송

별도 Docker 컨테이너에서 수집한 결과를 APS 백엔드의 `POST /api/automation/email`로 전달하면, 기존 ZOHO 발송 서비스가 서버에 지정된 수신자에게 전송합니다. Electron 실행이나 사용자 로그인이 필요하지 않습니다. 수집 프로세스는 ZOHO 토큰 또는 DB 접근 권한을 사용할 필요가 없습니다.

```text
수집 컨테이너 → APS 백엔드 → ZOHO → 지정된 내 메일
                           → PostgreSQL 발송 이력
                           → 앱에 email:created 알림
```

## 백엔드 설정

NAS 배포 디렉터리의 기존 `.env`에 아래 두 값을 추가합니다. 실제 수신 주소는 운영자가 지정하며 발신 주소는 기존 `ZOHO_ACCOUNT_EMAIL`을 사용합니다.

```dotenv
AUTOMATION_MAIL_API_KEY=<별도로 생성한 무작위 키>
AUTOMATION_MAIL_TO=<본인의 단일 이메일 주소>
```

키 생성:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

키는 32–256자의 공백 없는 ASCII 문자열이어야 합니다. JWT 서명 키와 별개의 키를 사용합니다. `ZOHO_ENABLED=true`와 기존 ZOHO 인증이 필요합니다. 키·수신자가 없거나 형식이 잘못되었거나 ZOHO가 비활성화되어 있으면 이 API는 503을 반환합니다. 나머지 앱 API는 기존대로 작동합니다.

`nas-deploy/docker-compose.yml`의 `env_file: .env`가 설정을 전달하므로 Compose 파일을 수정할 필요가 없습니다. 새 백엔드 이미지는 [배포 가이드](release.md)에 따라 `steve`에서 빌드·푸시하고 NAS에서 pull합니다. 환경변수 변경 후에는 `docker compose up -d --force-recreate aps-backend`로 컨테이너를 재생성합니다. 단순 `restart`는 새 환경변수를 반영하지 않습니다.

## 별도 Compose 프로젝트 연결

같은 NAS에서 운영한다면 수집 컨테이너를 APS 백엔드와 같은 Docker 네트워크에 연결합니다. `aps-network`는 Compose의 논리 이름이며 실제 이름에는 프로젝트 접두사가 붙을 수 있습니다. NAS에서 먼저 실제 이름을 확인합니다.

```sh
docker inspect aps-admin-backend --format '{{json .NetworkSettings.Networks}}'
```

수집 프로젝트의 `.env`에는 실제 네트워크 이름과 위에서 생성한 전용 키를 설정합니다.

```dotenv
APS_MAIL_NETWORK=<위에서 확인한 실제 네트워크 이름>
APS_MAIL_API_KEY=<AUTOMATION_MAIL_API_KEY와 같은 값>
```

수집 프로젝트의 Compose 예시:

```yaml
services:
  collector:
    image: your-collector-image
    environment:
      APS_MAIL_API_URL: http://aps-backend:3001/api/automation/email
      APS_MAIL_API_KEY: ${APS_MAIL_API_KEY:?Set APS_MAIL_API_KEY}
    networks:
      - aps-mail

networks:
  aps-mail:
    external: true
    name: ${APS_MAIL_NETWORK:?Set the existing APS Docker network name}
```

컨테이너의 `localhost`는 자기 자신을 가리킵니다. 다른 머신에 배포하는 경우에는 기존 공개 주소 `https://backend.apsconsulting.kr/api/automation/email`을 사용할 수 있습니다. 전용 API도 기존 백엔드와 동일한 리스너에 등록되므로 `/api/automation/`이라는 경로 자체가 내부망 접근을 강제하지는 않습니다.

## 요청과 응답

```http
POST /api/automation/email
Authorization: Bearer <전용 키>
Content-Type: application/json

{"subject":"오늘의 수집 결과","body":"새 항목 3개를 찾았습니다."}
```

- `subject`: 필수 문자열, 최대 500자, 줄바꿈 불가.
- `body` 또는 `bodyHtml`: 하나 이상 필요, 두 본문 합계 최대 200,000자. HTML은 기존 발송 서비스에서 정제합니다.
- 수신자·발신자·CC·BCC·첨부 등 다른 필드는 거절합니다. 수신 주소는 서버 설정으로만 변경합니다.
- 인증된 요청은 키 전체를 기준으로 분당 10회까지 허용합니다. 제한은 백엔드 프로세스 메모리에 있으며 재시작 시 초기화됩니다.

Python 수집 프로세스에서 호출하는 예시(표준 라이브러리만 사용):

```python
import json
import os
import urllib.request

payload = {"subject": "오늘의 수집 결과", "body": "새 항목 3개를 찾았습니다."}
request = urllib.request.Request(
    os.environ["APS_MAIL_API_URL"],
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    headers={
        "Authorization": "Bearer " + os.environ["APS_MAIL_API_KEY"],
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(request, timeout=120) as response:
    result = json.load(response)
    print(result)
```

정상 응답은 HTTP 200입니다.

```json
{"success":true,"deliveryStatus":"accepted","messageId":"ZOHO_MESSAGE_ID","localSaved":true}
```

`accepted`는 ZOHO의 접수 성공을 뜻하며 최종 수신함 도착을 보장하지 않습니다. 발송 후 로컬 저장 실패는 HTTP 200과 `localSaved:false`, `warning:sent_but_local_save_failed`로 구분합니다. 이 경우 재발송하지 않습니다.

| HTTP | 의미 |
|---|---|
| 400 | 잘못된 요청 또는 기존 발송 서비스의 입력 검증 실패 |
| 401 | 전용 키 누락·불일치 |
| 413 | 본문 길이 또는 서버 JSON 크기 제한 초과 |
| 429 | 분당 제한 초과, `Retry-After` 참조 |
| 502 | 발송 결과 미확정, `deliveryStatus:unknown`, `retrySafe:false` |
| 503 | 자동화 메일 설정 미완료 또는 ZOHO 비활성화 |

중복 요청 방지용 영속 키는 제공하지 않습니다. 502·클라이언트 시간 초과·연결 단절 시 이미 발송됐을 수 있으므로 자동 재전송하지 말고 ZOHO 보낸편지함과 APS 이력을 확인합니다. 기존 발송 서비스는 ZOHO 접수 후 감사 이력 저장 실패도 예외로 반환할 수 있으므로 이를 미확정 결과로 취급합니다.

## 로컬 검증

```sh
node --test backend/test/*.test.js
```

자동화 API 테스트는 임시 HTTP 서버와 모의 발송 함수를 사용하며 실제 메일·ZOHO·운영 DB에 접근하지 않습니다.
