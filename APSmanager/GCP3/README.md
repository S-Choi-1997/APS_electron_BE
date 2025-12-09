# GCP3 - SMS Relay 서버

## 개요
알리고 SMS API의 고정 IP 화이트리스트 요구사항을 충족하기 위한 Relay 서버입니다.

**현재 사용 방식**: SMS Relay (TinyProxy는 폐기됨)

## 아키텍처

```
GCP2 (Cloud Run)
    ↓ HTTP POST
SMS Relay 서버 (GCP3/sms-relay/, 고정 IP VM)
    ↓ HTTPS
Aligo SMS API
```

## 서버 정보

- **VM 이름**: aligo-proxy
- **리전/존**: us-central1-a
- **고정 IP**: 136.113.67.193
- **포트**: 3000
- **비용**: 프리티어 ($0/월)

## SMS Relay 서버 (sms-relay/)

### 위치
`GCP3/sms-relay/`

### 구성 파일
- `index.js` - Express 서버 (Aligo API 프록시)
- `package.json` - 의존성
- `install.sh` - VM에 설치/배포 스크립트
- `sms-relay.service` - systemd 서비스 설정

### API 엔드포인트

```
POST http://136.113.67.193:3000/send
Content-Type: application/json

Body:
{
  "key": "알리고 API 키",
  "user_id": "알리고 사용자 ID",
  "sender": "발신번호",
  "receiver": "수신번호",
  "msg": "메시지 내용"
}

Response:
{
  "result_code": 1,
  "message": "success",
  ...
}
```

### 배포 방법

#### 1. 로컬에서 VM으로 업로드 및 설치
```bash
cd GCP3/sms-relay

# VM에 파일 복사 및 설치
gcloud compute scp --recurse . aligo-proxy:/home/YOUR_USERNAME/sms-relay --zone=us-central1-a
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="cd sms-relay && bash install.sh"
```

#### 2. 수동 설치 (VM에 SSH 접속 후)
```bash
# VM에 SSH 접속
gcloud compute ssh aligo-proxy --zone=us-central1-a

# 의존성 설치
cd ~/sms-relay
npm install

# systemd 서비스 등록
sudo cp sms-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable sms-relay
sudo systemctl start sms-relay

# 상태 확인
sudo systemctl status sms-relay
```

### 서버 관리

#### 상태 확인
```bash
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo systemctl status sms-relay"
```

#### 재시작
```bash
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo systemctl restart sms-relay"
```

#### 로그 확인
```bash
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo journalctl -u sms-relay -f"
```

## VM 관리

### VM 생성 (최초 1회)
```bash
cd GCP3
bash create-vm.sh
```

생성 내용:
- VM: f1-micro (프리티어)
- 디스크: 10GB
- 리전: us-central1-a
- 태그: http-server

### 고정 IP 할당 (최초 1회)
```bash
# 고정 IP 생성
gcloud compute addresses create aligo-proxy-ip --region=us-central1

# IP 확인
gcloud compute addresses describe aligo-proxy-ip --region=us-central1 --format='value(address)'
# 출력 예: 136.113.67.193

# VM에 고정 IP 연결
gcloud compute instances delete-access-config aligo-proxy \
  --zone=us-central1-a \
  --access-config-name="external-nat"

gcloud compute instances add-access-config aligo-proxy \
  --zone=us-central1-a \
  --address=$(gcloud compute addresses describe aligo-proxy-ip --region=us-central1 --format='value(address)')
```

### 방화벽 설정 (최초 1회)
```bash
# HTTP 포트 3000 허용
gcloud compute firewall-rules create allow-sms-relay \
  --allow=tcp:3000 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=http-server \
  --description="Allow SMS Relay access"
```

### VM 재부팅
```bash
gcloud compute instances stop aligo-proxy --zone=us-central1-a
gcloud compute instances start aligo-proxy --zone=us-central1-a
```

## 테스트

### Relay 서버 Health Check
```bash
curl http://136.113.67.193:3000
# 출력: {"status":"ok","message":"SMS Relay Server"}
```

### SMS 발송 테스트
```bash
curl -X POST http://136.113.67.193:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "key": "YOUR_ALIGO_API_KEY",
    "user_id": "YOUR_ALIGO_USER_ID",
    "sender": "01012345678",
    "receiver": "01012345678",
    "msg": "테스트 메시지"
  }'
```

## 알리고 설정

1. [알리고 관리 페이지](https://smartsms.aligo.in) 로그인
2. 설정 → IP 화이트리스트
3. IP 등록: `136.113.67.193`

## 비용

| 항목 | 비용 | 조건 |
|-----|------|------|
| VM (f1-micro) | $0 | us-central1 프리티어 |
| 디스크 (10GB) | $0 | 30GB까지 프리티어 |
| 고정 IP | $0 | VM에 연결 시 무료 |
| 네트워크 egress | $0.12/GB | 프리티어 1GB 초과 시 |

**월 예상 비용**: **$0** (SMS는 데이터 사용량 극소)

## 트러블슈팅

### SMS 발송 실패
1. Relay 서버 상태 확인
   ```bash
   curl http://136.113.67.193:3000
   ```

2. 서비스 로그 확인
   ```bash
   gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo journalctl -u sms-relay -n 50"
   ```

3. 방화벽 확인
   ```bash
   gcloud compute firewall-rules list --filter="name=allow-sms-relay"
   ```

### 알리고 IP 차단 오류
- 알리고 화이트리스트에 `136.113.67.193` 등록 확인
- VM의 고정 IP 확인
  ```bash
  gcloud compute addresses describe aligo-proxy-ip --region=us-central1 --format='value(address)'
  ```

### 서비스 재시작 필요 시
```bash
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo systemctl restart sms-relay"
```

## 삭제 (필요 시)

```bash
# VM 삭제
gcloud compute instances delete aligo-proxy --zone=us-central1-a

# 고정 IP 삭제
gcloud compute addresses delete aligo-proxy-ip --region=us-central1

# 방화벽 규칙 삭제
gcloud compute firewall-rules delete allow-sms-relay
```

## 폐기된 파일들

다음 파일들은 TinyProxy 방식에서 사용되었으나 현재는 사용하지 않습니다:
- `tinyproxy.conf` - TinyProxy 설정 (미사용)
- `setup-tinyproxy.sh` - TinyProxy 설치 스크립트 (미사용)
- `allocate-static-ip.sh` - 고정 IP 할당 (이미 완료)
- `setup-firewall.sh` - 방화벽 설정 (이미 완료)
- `setup-all.ps1` - 전체 설정 스크립트 (미사용)

현재는 `sms-relay/` 디렉토리의 Relay 서버만 사용합니다.
