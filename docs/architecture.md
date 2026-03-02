# 시스템 아키텍처

## 전체 구성

```
[고객 브라우저]
      │ 상담 신청 (reCAPTCHA)
      ▼
┌─────────────────────────────────────┐
│  customer-api/ (GCP Cloud Run)      │
│  공개 상담 접수 API                  │
│  → Firestore에 직접 저장            │
└─────────────────────────────────────┘

[관리자 PC]
      │ 실행
      ▼
┌─────────────────────────────────────┐
│  Electron 데스크탑 앱               │
│  app/src/ (React 18) + app/electron/│
│  Windows 설치형 앱 (.exe)           │
└──────────────┬──────────────────────┘
               │ HTTP/WebSocket (IPC 브릿지)
               │
               ▼ (프로덕션)
┌─────────────────────────────────────┐
│  relay/ (GCP4, 136.113.67.193:8080)│
│  HTTP-over-WebSocket 터널           │
│  RELAY_ENVIRONMENT로 백엔드 라우팅  │
└──────────────┬──────────────────────┘
               │ WebSocket (아웃바운드)
               ▼
┌─────────────────────────────────────┐
│  backend/ (NAS Docker)              │
│  Express + Socket.IO                │
│  포트 3001 (외부 노출 안 됨)         │
│  ├── PostgreSQL: 메모, 일정          │
│  ├── Firestore: 상담 데이터          │
│  ├── GCP Storage: 첨부파일          │
│  └── → sms-relay/ 로 SMS 전달       │
└──────────────┬──────────────────────┘
               │ HTTP POST
               ▼
┌─────────────────────────────────────┐
│  sms-relay/ (GCP3, 포트 3000)      │
│  고정 IP VM → Aligo SMS API         │
│  IP: 136.113.67.193:3000            │
└─────────────────────────────────────┘
```

## GCP4 Relay (HTTP-over-WebSocket 터널)

백엔드(NAS)는 인터넷에 직접 노출되지 않고, GCP VM의 Relay 서버에 Socket.IO 클라이언트로 아웃바운드 연결합니다.

```
Electron → HTTP → GCP4 Relay (8080) → http:request 이벤트 → backend
backend → http:response 이벤트 → GCP4 Relay → HTTP 응답 → Electron
```

- `RELAY_WS_URL`: `ws://136.113.67.193:8080`
- `RELAY_ENVIRONMENT`: `production` | `development` — 어떤 백엔드 인스턴스로 라우팅할지 결정
- `BACKEND_INSTANCE_ID`: 백엔드 등록 ID

## 개발 환경 vs 프로덕션

| 항목 | 개발 | 프로덕션 |
|------|------|---------|
| API 타겟 | GCP2 Cloud Run (VITE_API_URL) | GCP4 Relay (136.113.67.193:8080/proxy) |
| WebSocket | GCP4 Relay | GCP4 Relay |
| RELAY_ENVIRONMENT | development | production |
| 백엔드 위치 | GCP2 Cloud Run | NAS (192.168.0.100:3001) |

## 데이터 흐름

| 데이터 | 저장소 |
|--------|--------|
| 상담 문의 (inquiries) | GCP Firestore |
| 첨부파일 | GCP Cloud Storage |
| 팀 메모, 일정 | PostgreSQL (NAS) |
| 이메일 문의 | PostgreSQL (email_inquiries 테이블) |

## 자동 삭제 (개인정보보호)

`cleanup/` Cloud Function: 매일 02:00 KST 실행 → 179일 지난 Firestore 문서 + Storage 파일 삭제
