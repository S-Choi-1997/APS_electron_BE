# GCP4 Services

GCP VM (aligo-proxy, us-central1-a)에서 실행 중인 서비스들

## 실행 중인 서비스

| 서비스 | 포트 | 설명 |
|--------|------|------|
| ws-relay | 8080 | WebSocket 중계 서버 (Backend ↔ Client) |
| power-state | 3001 | ON/OFF 상태 관리 서비스 |
| sms-relay | 3000 | SMS 중계 서비스 |

## WebSocket Relay - Development 모드 사용법

### 개요
ws-relay는 Production과 Development 환경을 분리하여 운영할 수 있습니다.
- **Production**: 기본 환경 (기존 동작 유지)
- **Development**: 개발/테스트용 환경 (선택적 사용)

### Development 모드 설정 방법 (환경변수 사용)

#### 1. Backend 서버 (backend/.env)

```bash
# WebSocket Relay Server (GCP4)
RELAY_WS_URL=ws://136.113.67.193:8080
BACKEND_VERSION=1.0.0
BACKEND_INSTANCE_ID=backend-office-pc-1
RELAY_ENVIRONMENT=development  # ← production 또는 development
```

#### 2. Electron Client (.env)

```bash
# WebSocket Relay URL (GCP VM 릴레이 서버 사용)
VITE_WS_RELAY_URL=ws://136.113.67.193:8080

# WebSocket Relay Environment
VITE_RELAY_ENVIRONMENT=development  # ← production 또는 development
```

### 환경 전환 방법

1. **Production 모드로 전환**
   ```bash
   # Backend
   RELAY_ENVIRONMENT=production

   # Client
   VITE_RELAY_ENVIRONMENT=production
   ```

2. **Development 모드로 전환**
   ```bash
   # Backend
   RELAY_ENVIRONMENT=development

   # Client
   VITE_RELAY_ENVIRONMENT=development
   ```

3. **서버 재시작**
   - Backend: `npm run dev` 재실행
   - Client: `npm run dev` 재실행

### 핵심 규칙

1. **환경변수로 간편하게 관리**
   - `.env` 파일 한 줄만 수정하면 됨
   - 코드 수정 불필요

2. **환경 간 완전 격리**
   - Development Backend → Development Client만 통신
   - Production Backend → Production Client만 통신
   - 서로 섞이지 않음

3. **대시보드에서 확인**
   - http://136.113.67.193:8080 접속
   - Production 섹션: 파란색
   - Development 섹션: 노란색 (접을 수 있음)

### 기존 코드 영향 없음

`RELAY_ENVIRONMENT` 환경변수를 설정하지 않으면 자동으로 `production`으로 처리되므로, 기존 코드는 수정 없이 그대로 작동합니다.

---

## 상세 문서

- [GCP VM 정보](./GCP_VM_INFO.md)
- [ws-relay 배포 가이드](./ws-relay/DEPLOY.md)
- [power-state 사용법](./power-state/README.md)
