# Development Environment 테스트 가이드

## 현재 브랜치
`test/dev-environment` - 개발 환경 테스트용

## 설정 완료 상태 ✅

### 1. Backend (backend-local/.env)
```bash
RELAY_ENVIRONMENT=development
```

### 2. Client (.env)
```bash
VITE_RELAY_ENVIRONMENT=development
```

## 테스트 방법

### 1. Backend 서버 실행
```bash
cd backend-local
npm run dev
```

**확인 사항:**
- 콘솔에 `[Relay] Auto-activated first development backend: backend-office-pc-1` 출력
- 또는 `Backend connected to relay server (development)` 메시지

### 2. Electron Client 실행
```bash
npm run dev
```

**확인 사항:**
- 콘솔에 `[WebSocket] Handshake successful: { environment: 'development', ... }` 출력

### 3. 대시보드 확인
브라우저에서 http://136.113.67.193:8080 접속

**확인 사항:**
- 노란색 "Development Environment" 섹션 펼치기
- Development Backends에 `backend-office-pc-1` 표시
- Development Clients에 연결된 클라이언트 표시
- Production 섹션은 비어있거나 기존 프로덕션 연결만 표시

## Production으로 돌아가기

### 방법 1: 브랜치 변경
```bash
git checkout main
```

### 방법 2: 환경변수만 변경
**backend-local/.env:**
```bash
RELAY_ENVIRONMENT=production
```

**.env:**
```bash
VITE_RELAY_ENVIRONMENT=production
```

서버 재시작 후 적용

## 주요 확인 포인트

### ✅ Development 환경이 제대로 작동하는 경우
1. Backend가 Development 섹션에 표시됨
2. Client가 Development 섹션에 표시됨
3. Backend에서 이벤트 발생 시 같은 Development Client만 수신
4. Production 섹션과 완전히 분리됨

### ❌ 문제가 있는 경우
- Backend/Client가 Production 섹션에 표시됨 → 환경변수 확인 및 서버 재시작
- 이벤트가 수신되지 않음 → 대시보드에서 Development Backend가 Active인지 확인
- 콘솔 로그에 `environment: 'production'` 표시 → .env 파일 저장 확인

## 브랜치 관리

### 테스트 완료 후 main으로 돌아가기
```bash
git checkout main
```

### 변경사항 유지하고 싶다면
```bash
git add .
git commit -m "Test: Development environment setup"
```

### 브랜치 삭제 (테스트 완료 후)
```bash
git checkout main
git branch -d test/dev-environment
```
