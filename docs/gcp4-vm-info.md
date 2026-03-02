# GCP VM (aligo-proxy) 상세 정보

## 기본 정보
- **VM 이름**: aligo-proxy
- **프로젝트**: apsconsulting
- **Zone**: us-central1-a
- **Machine Type**: e2-micro
- **외부 IP**: 136.113.67.193
- **내부 IP**: 10.128.0.3
- **상태**: RUNNING
- **디스크**: 10GB

## SSH 접속 정보

### 등록된 SSH 키 (GCP VM에 등록됨)
- **키 파일**: `~/.ssh/google_compute_engine`
- **공개키 파일**: `~/.ssh/google_compute_engine.pub`
- **키 타입**: ssh-rsa
- **사용자명**: nothi
- **Fingerprint**: `AAAAB3NzaC1yc2EAAAADAQABAAABAQDHJ5/jGW1vwoqbLKt54d1whUkDuMxvLGAGfoAJmNLa+Z1UQj+wSFzYMpV2K7cvdOu8vcpDXyj8d+T0Y6ZRjP3R3UUdG6zSgxXxeAyzr69gMFGWAkx0RtCbBA86e7ZR16uPBztNQIbX1XhOWMcJ4zX1W2WXl6ei/Cd3KLfl+lM21/+wNzUgN9Ilcwv6vT98np9x2aBzerFG32b06APgdGWOaSi9nhh6gE9YM8acd1GUK7p7mjQiThhzmFezUqgYwkS206rxkwjH7rvdvr2jsvzc5hs3vslmT3eMVuODmnwyyVqpHtpX676I6w+CNMIvpfFqpkvtxqdhB351qWobBXQL`

### 로컬 SSH 키 목록
1. **google_compute_engine** ✅ (GCP VM 접속용)
   - 경로: `~/.ssh/google_compute_engine`
   - 공개키: `~/.ssh/google_compute_engine.pub`
   - 타입: ssh-rsa
   - 용도: GCP VM (aligo-proxy) 접속

2. **id_ed25519** (개인 키)
   - 경로: `~/.ssh/id_ed25519`
   - 공개키: `~/.ssh/id_ed25519.pub`
   - 타입: ssh-ed25519
   - Fingerprint: `AAAAC3NzaC1lZDI1NTE5AAAAIG871s8QdstdcxrmsnJPvnIBIDYCuExkLGi3Yy62ToFj`

3. **id_ed25519_nas** (NAS 접속용)
   - 경로: `~/.ssh/id_ed25519_nas`
   - 공개키: `~/.ssh/id_ed25519_nas.pub`
   - 타입: ssh-ed25519
   - 사용자: nas-root
   - Fingerprint: `AAAAC3NzaC1lZDI1NTE5AAAAIDcYL0YzmdoHf9xT0IIW9wfVo3c4OhbgD+8gyU0LOlPf`

### SSH 접속 명령어
```bash
# gcloud CLI를 통한 접속 (권장)
gcloud compute ssh aligo-proxy --zone=us-central1-a

# 직접 SSH 접속
ssh -i ~/.ssh/google_compute_engine nothi@136.113.67.193
```

## 실행 중인 서비스

### 1. WebSocket Relay Server (Docker)
- **컨테이너명**: ws-relay
- **이미지**: choho97/aps-websocket-relay:latest
- **포트**: 8080 (외부 → 컨테이너)
- **상태**: Up 3 weeks (healthy)
- **재시작 정책**: unless-stopped
- **목적**: 외부 요청을 Backend NAS:3001로 중계
- **Health check**: http://136.113.67.193:8080/health

#### 환경변수 (.env)
```env
PORT=8080
MIN_BACKEND_VERSION=1.0.0
HEARTBEAT_INTERVAL=30000
CONNECTION_TIMEOUT=90000
DASHBOARD_PASSWORD=1971101090!
SESSION_SECRET=aps-relay-session-secret-change-this-to-random-string
```

#### 배포 명령어
```bash
# 1. Docker 이미지 빌드 & 푸시
cd E:/Projects/APS/GCP4/ws-relay
docker build -t choho97/aps-websocket-relay:latest .
docker push choho97/aps-websocket-relay:latest

# 2. GCP VM에 배포
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker pull choho97/aps-websocket-relay:latest && docker stop ws-relay 2>/dev/null || true && docker rm ws-relay 2>/dev/null || true && docker run -d -p 8080:8080 --name ws-relay --restart unless-stopped choho97/aps-websocket-relay:latest && sleep 3 && docker ps | grep ws-relay && docker logs ws-relay --tail 20"
```

### 2. Aligo SMS Relay Server (시스템 서비스)
- **서비스명**: sms-relay.service
- **포트**: 3000
- **상태**: Active (running) since Dec 4, 2025
- **경로**: /opt/sms-relay/index.js
- **사용자**: smsrelay
- **목적**: Aligo SMS API 중계 (고정 IP 필요)
- **메모리 사용량**: 30.3M

#### 엔드포인트
- Health check: `http://localhost:3000/health`
- SMS 전송: `http://localhost:3000/sms/send` (POST)

#### 서비스 관리
```bash
# 서비스 상태 확인
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo systemctl status sms-relay"

# 서비스 재시작
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo systemctl restart sms-relay"

# 로그 확인
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo journalctl -u sms-relay -f"
```

### 3. Cloudflare Tunnel
- **서비스명**: cloudflared.service
- **상태**: Active (running) since Dec 20, 2025
- **명령어**: `/usr/local/bin/cloudflared tunnel --url http://localhost:8080`
- **메모리 사용량**: 23.5M
- **목적**: 로컬 8080 포트를 Cloudflare Tunnel을 통해 외부 노출

### 4. Google Cloud 모니터링
- **fluent-bit** (로깅): 포트 20202
- **opentelemetry-collector** (메트릭): 포트 20201

## 네트워크 포트

| 포트 | 서비스 | 설명 |
|------|--------|------|
| 22 | SSH | 원격 접속 |
| 25 | Exim4 | 메일 전송 (로컬) |
| 53 | systemd-resolved | DNS |
| 3000 | SMS Relay | Aligo SMS API 중계 |
| 5355 | systemd-resolved | mDNS |
| 8080 | WebSocket Relay | Docker 컨테이너 (ws-relay) |
| 20201 | Google Cloud Ops | 메트릭 수집 |
| 20202 | Google Cloud Ops | 로그 수집 |
| 20241 | cloudflared | 내부 사용 |
| 20242 | cloudflared | 내부 사용 |

## 디스크 사용량

### 정리 전 (2026-01-11)
- **총 용량**: 10GB
- **사용량**: 5.1GB (51%)
- **여유 공간**: 4.9GB

### 정리 후 (2026-01-11)
- **총 용량**: 10GB
- **사용량**: 3.8GB (41%)
- **여유 공간**: 5.4GB
- **정리된 용량**: 1.3GB

### 정리 내역
1. Docker 이미지 정리: 67.49MB (dangling 이미지 22개 삭제)
2. systemd journal 로그: 557.4MB (7일 이전 로그 삭제)
3. btmp 로그: 94MB (실패한 로그인 로그 초기화)
4. APT 캐시: 314MB 정리

### 용량 차지 항목
```
총 사용량: 3.8GB
├─ /usr (2.7GB) - 시스템 파일
│  ├─ Google Cloud SDK: 1.0GB
│  ├─ /usr/bin: 650MB
│  └─ /usr/lib: 1.5GB
├─ /var (2.0GB → 1.4GB) - 로그 & 데이터
│  ├─ systemd journal: 688MB → 131MB
│  ├─ Docker containerd: 485MB
│  ├─ APT 캐시: 314MB → 0MB
│  └─ Docker 데이터: 161MB
├─ /opt (428MB) - 추가 애플리케이션
└─ 기타 (50MB)
```

### 정기 유지보수 명령어
```bash
# Docker 이미지 정리
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker image prune -a -f"

# 오래된 로그 정리 (7일 이상)
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo journalctl --vacuum-time=7d"

# 실패한 로그인 로그 초기화
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo truncate -s 0 /var/log/btmp"

# APT 캐시 정리
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo apt clean"
```

## 리소스 사용량

### 메모리
- **총 용량**: 969Mi
- **사용량**: 710Mi (73%)
- **여유 공간**: 259Mi
- **Swap**: 미설정

### 주요 프로세스
- node server.js (ws-relay): 29MB
- node index.js (sms-relay): 28MB
- cloudflared: 23MB

## 아키텍처 흐름

```
┌─────────────────────────────────────────────────────────────┐
│                        외부 요청                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              GCP VM (aligo-proxy)                            │
│              IP: 136.113.67.193                              │
├─────────────────────────────────────────────────────────────┤
│  Cloudflare Tunnel (:20241, :20242)                         │
│         ↓                                                    │
│  WebSocket Relay (Docker :8080) ──→ Backend NAS:3001        │
│                                                              │
│  SMS Relay (:3000) ──→ Aligo API (고정 IP 필요)              │
└─────────────────────────────────────────────────────────────┘
```

## 로그 확인 명령어

### WebSocket Relay
```bash
# 실시간 로그
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker logs -f ws-relay"

# 최근 100줄
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker logs ws-relay --tail 100"
```

### SMS Relay
```bash
# 실시간 로그
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo journalctl -u sms-relay -f"

# 최근 100줄
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo journalctl -u sms-relay -n 100"
```

### Cloudflare Tunnel
```bash
# 실시간 로그
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo journalctl -u cloudflared -f"
```

## 재시작 명령어

```bash
# WebSocket Relay 재시작
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker restart ws-relay"

# SMS Relay 재시작
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo systemctl restart sms-relay"

# Cloudflare Tunnel 재시작
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo systemctl restart cloudflared"

# VM 재부팅
gcloud compute instances reset aligo-proxy --zone=us-central1-a
```

## 보안 정보

### 방화벽 규칙
- SSH (22): 허용
- HTTP/HTTPS (80/443): Cloudflare Tunnel 사용
- 8080: WebSocket Relay (외부 접근 가능)
- 3000: SMS Relay (내부 전용)

### 접근 제어
- SSH: 키 기반 인증 (google_compute_engine)
- Dashboard: 비밀번호 인증 (DASHBOARD_PASSWORD)

## 최근 작업 내역

### 2026-01-11
- 디스크 정리 실행 (1.3GB 확보)
- Docker 이미지 22개 정리 (67.49MB)
- systemd journal 로그 정리 (557.4MB)
- btmp 로그 초기화 (94MB)
- APT 캐시 정리 (314MB)

### 2025-12-20
- Query Parameter 전달 기능 추가 (OAuth callback 지원)
- Cloudflare Tunnel 재시작

### 2025-12-04
- SMS Relay Server 배포
- systemd 서비스 등록

## 문제 해결

### WebSocket Relay가 응답하지 않을 때
```bash
# 1. 컨테이너 상태 확인
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker ps | grep ws-relay"

# 2. 로그 확인
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker logs ws-relay --tail 50"

# 3. Health check
curl http://136.113.67.193:8080/health

# 4. 재시작
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker restart ws-relay"
```

### SMS Relay가 응답하지 않을 때
```bash
# 1. 서비스 상태 확인
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo systemctl status sms-relay"

# 2. 로그 확인
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo journalctl -u sms-relay -n 50"

# 3. 재시작
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="sudo systemctl restart sms-relay"
```

### 디스크 공간 부족 시
```bash
# 정리 명령어 일괄 실행
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker image prune -a -f && sudo journalctl --vacuum-time=7d && sudo apt clean"
```

## 참고 문서
- DEPLOY.md: WebSocket Relay 배포 가이드
- server.js: WebSocket Relay 소스 코드
- /opt/sms-relay/index.js: SMS Relay 소스 코드

---
마지막 업데이트: 2026-01-11
