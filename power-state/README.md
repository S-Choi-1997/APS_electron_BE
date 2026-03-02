# Power State Manager

간단한 ON/OFF 상태 관리 웹 서비스 - 외부 PC에서 "꺼져도 되는지" 상태를 확인할 수 있습니다.

## 기능

- 웹 UI를 통한 ON/OFF 상태 관리
- 비밀번호 인증
- 공개 API (인증 불필요) - 외부에서 상태 조회
- JSON 파일로 상태 영구 저장 (컨테이너 재시작 후에도 유지)
- 최소 리소스 사용 (~30-50MB 메모리)

## 기술 스택

- Node.js 20 Alpine
- Express.js
- express-session (세션 관리)
- 의존성: 4개만 사용

## 로컬 개발

### 1. 설치

```bash
npm install
```

### 2. 환경변수 설정

`.env` 파일:
```bash
PORT=3001
PASSWORD=your-password
SESSION_SECRET=your-secret-key
```

### 3. 실행

```bash
npm start
```

브라우저에서 `http://localhost:3001` 접속

## Docker 빌드 및 배포

### 1. Docker 이미지 빌드

```bash
docker build -t choho97/power-state-manager:latest .
```

### 2. Docker Hub에 푸시

```bash
docker push choho97/power-state-manager:latest
```

### 3. GCP VM에 배포

```bash
# VM에 SSH 접속
ssh aligo-proxy

# 이미지 Pull
docker pull choho97/power-state-manager:latest

# 기존 컨테이너 중지 및 제거
docker stop power-state 2>/dev/null || true
docker rm power-state 2>/dev/null || true

# 새 컨테이너 실행
docker run -d \
  --name power-state \
  --restart unless-stopped \
  -p 3001:3001 \
  -v /opt/power-state/data:/app/data \
  choho97/power-state-manager:latest

# 상태 확인
docker ps | grep power-state
docker logs power-state --tail 20
```

### 4. 방화벽 규칙 (최초 1회만)

```bash
gcloud compute firewall-rules create allow-power-state \
  --allow tcp:3001 \
  --source-ranges 0.0.0.0/0 \
  --target-tags http-server
```

## API 문서

### 공개 API (인증 불필요)

#### 상태 조회
```bash
GET http://136.113.67.193:3001/api/public/state
```

**응답:**
```json
{
  "state": "ON"  // 또는 "OFF"
}
```

### 관리자 API (인증 필요)

#### 로그인
```bash
POST /api/login
Content-Type: application/json

{
  "password": "your-password"
}
```

#### 상태 조회 (상세)
```bash
GET /api/state
```

**응답:**
```json
{
  "state": "ON",
  "lastUpdated": "2026-01-12T10:30:00.000Z"
}
```

#### 상태 변경
```bash
POST /api/state
Content-Type: application/json

{
  "state": "ON"  // 또는 "OFF"
}
```

#### Health Check
```bash
GET /health
```

**응답:**
```json
{
  "status": "ok",
  "state": "ON"
}
```

## 외부 PC에서 사용 예시

### Python
```python
import requests

response = requests.get('http://136.113.67.193:3001/api/public/state')
state = response.json()['state']

if state == 'ON':
    print("PC를 계속 켜두세요")
else:
    print("PC를 꺼도 됩니다")
```

### curl
```bash
curl http://136.113.67.193:3001/api/public/state
# {"state":"ON"}
```

### PowerShell
```powershell
$response = Invoke-RestMethod -Uri "http://136.113.67.193:3001/api/public/state"
if ($response.state -eq "ON") {
    Write-Host "PC를 계속 켜두세요"
} else {
    Write-Host "PC를 꺼도 됩니다"
}
```

## 유지보수

### 로그 확인
```bash
ssh aligo-proxy
docker logs power-state -f
```

### 상태 파일 확인
```bash
ssh aligo-proxy
cat /opt/power-state/data/state.json
```

### 컨테이너 재시작
```bash
ssh aligo-proxy
docker restart power-state
```

### 컨테이너 중지/삭제
```bash
ssh aligo-proxy
docker stop power-state
docker rm power-state
```

## 디렉토리 구조

```
power-state/
├── server.js              # Express 서버
├── package.json           # 의존성 정의
├── .env                   # 환경변수
├── Dockerfile             # Docker 이미지 빌드 파일
├── .dockerignore          # Docker 빌드 제외 파일
├── README.md              # 이 파일
├── public/
│   ├── login.html        # 로그인 페이지
│   └── index.html        # 대시보드 (ON/OFF 스위치)
└── data/                 # (런타임 생성) 상태 파일 저장
    └── state.json        # 현재 상태
```

## 보안

- 관리 페이지는 비밀번호 인증 필요
- 공개 API는 읽기 전용 (상태 조회만 가능)
- 세션 쿠키 24시간 유지
- HTTPS는 Cloudflare Tunnel이나 reverse proxy 사용 권장

## 리소스 사용량

- **이미지 크기**: ~130MB
- **메모리 사용**: ~30-50MB (idle)
- **CPU 사용**: 거의 없음 (요청 시에만)
- **디스크**: 상태 파일 <1KB

## 라이센스

MIT

## 작성자

APS Consulting
