# APS WebSocket Relay Server - 배포 가이드

## 개요
GCP VM(aligo-proxy)에서 실행되는 WebSocket 중계 서버

## 배포 명령어

### 1. Docker 이미지 빌드 & 푸시
```bash
cd relay  # 모노레포 루트에서 실행
docker build -t choho97/aps-websocket-relay:latest .
docker push choho97/aps-websocket-relay:latest
```

### 2. GCP VM에 배포
```bash
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker pull choho97/aps-websocket-relay:latest && docker stop ws-relay 2>/dev/null || true && docker rm ws-relay 2>/dev/null || true && mkdir -p ~/ws-relay-logs && docker run -d -p 8080:8080 -v ~/ws-relay-logs:/app/logs --name ws-relay --restart unless-stopped choho97/aps-websocket-relay:latest && sleep 3 && docker ps | grep ws-relay && docker logs ws-relay --tail 20"
```

## 로그 확인

### Docker 컨테이너 로그 (콘솔 출력)
```bash
# 실시간 로그
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker logs -f ws-relay"

# 최근 로그 100줄
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker logs ws-relay --tail 100"
```

### 이벤트 로그 파일 (영구 저장)
로그 저장 위치: GCP VM의 `~/ws-relay-logs/events.json`

```bash
# 이벤트 로그 파일 확인
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="cat ~/ws-relay-logs/events.json | jq '.'"

# 최근 10개 이벤트만 보기
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="cat ~/ws-relay-logs/events.json | jq '.[:10]'"

# 특정 타입 이벤트만 필터링 (예: client:connect)
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="cat ~/ws-relay-logs/events.json | jq '.[] | select(.type==\"client:connect\")'"
```

**참고**:
- 이벤트 로그는 볼륨 마운트(`-v ~/ws-relay-logs:/app/logs`)를 통해 영구 저장됩니다.
- Docker 컨테이너를 삭제(`docker rm`)해도 로그는 유지됩니다.
- API: `http://136.113.67.193:8080/api/logs?limit=100`

## 상태 확인

```bash
# 컨테이너 상태
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker ps | grep ws-relay"

# Health check
curl http://136.113.67.193:8080/health
```

## 재시작

```bash
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker restart ws-relay"
```

## 주요 변경사항 (2025-12-20)

### Query Parameter 전달 기능 추가
- **문제**: OAuth callback 시 query parameters가 backend로 전달되지 않음
- **해결**: `server.js` Line 689-743 수정
  - Query string 파싱 추가
  - `http:request` 이벤트에 `query` 객체 포함
- **영향**: ZOHO OAuth 인증 등 query parameter가 필요한 모든 callback 정상 동작

## 아키텍처

```
외부 요청 → GCP VM (aligo-proxy:8080) → Relay Server → Backend (NAS:3001)
```

## SSH 접속

GCP VM(aligo-proxy)에 SSH로 접속 시 사용되는 키:

**SSH 키 경로**: `~/.ssh/google_compute_engine`

```bash
# 직접 SSH 접속
ssh -i ~/.ssh/google_compute_engine nothi@<VM_IP>

# gcloud CLI 사용 (권장)
gcloud compute ssh aligo-proxy --zone=us-central1-a
```

**공개키 확인**:
```bash
cat ~/.ssh/google_compute_engine.pub
```

## 환경변수

파일: `.env`
- `PORT=8080`
- `MIN_BACKEND_VERSION=1.0.0`
- `HEARTBEAT_INTERVAL=30000`
- `CONNECTION_TIMEOUT=90000`
- `DASHBOARD_PASSWORD=aps-relay-2025`
- `SESSION_SECRET=aps-relay-session-secret-change-this`
