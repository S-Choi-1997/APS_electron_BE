# ZOHO Webhook 설정 가이드

## 📋 개요

ZOHO Mail에서 새 이메일이 도착하면 자동으로 앱에 표시되도록 webhook을 설정합니다.

**아키텍처:**
```
ZOHO Mail → 릴레이 서버 (GCP) → WebSocket → 로컬 백엔드 → 앱 UI 자동 업데이트
```

---

## 🔧 1. ZOHO Mail Webhook 설정

### 1-1. ZOHO Mail 관리자 콘솔 접속

1. [ZOHO Mail 관리자 콘솔](https://mailadmin.zoho.com/) 접속
2. 로그인

### 1-2. Webhook 생성

1. **Settings** → **Developer** → **Webhooks** 메뉴로 이동
2. **Add Webhook** 클릭
3. 다음 정보 입력:

   **Webhook Name:** APS Email Notification

   **Webhook URL:**
   ```
   http://136.113.67.193:8080/api/zoho/webhook
   ```

   **Events to Subscribe:**
   - [x] **New Mail Received** (또는 `mail.received` 이벤트)

   **Webhook Secret (선택사항):**
   - 보안을 위해 사용하려면 secret 키 생성
   - 생성한 경우 로컬 백엔드 `.env` 파일에 추가:
     ```
     ZOHO_WEBHOOK_SECRET=your-secret-key-here
     ```

4. **Save** 클릭

### 1-3. Webhook 테스트

ZOHO 관리자 콘솔에서 "Test Webhook" 기능이 있다면 클릭해서 테스트 요청을 보냅니다.

---

## 🧪 2. 로컬 테스트 (Webhook 도착 확인)

### 2-1. 백엔드 로그 모니터링

백엔드 콘솔에서 다음 로그가 출력되는지 확인:

```
[ZOHO Webhook] ========================================
[ZOHO Webhook] Received request
[ZOHO Webhook] Headers: { ... }
[ZOHO Webhook] Body: { ... }
[ZOHO Webhook] ========================================
[ZOHO Webhook] Received webhook event
[ZOHO Webhook] Processing new message: <message-id>
[ZOHO Webhook] Message processed successfully
[ZOHO Webhook] Real-time event emitted
```

### 2-2. 앱 UI 확인

- 이메일 목록이 자동으로 업데이트되는지 확인
- Toast 알림이 표시되는지 확인: "새 이메일: [발신자]\n[제목]"

---

## 🔍 3. 릴레이 서버 로그 확인

### 릴레이 서버 로그 확인 방법:

```bash
# GCP 릴레이 서버 로그 확인
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker logs ws-relay --tail 50"
```

**예상되는 로그:**
```
[Relay] ========================================
[Relay] ZOHO Webhook received
[Relay] Headers: { ... }
[Relay] Body: { ... }
[Relay] ========================================
[Relay] Relaying ZOHO webhook to backend backend-office-pc-1 (requestId: req_...)
```

### 릴레이 서버 대시보드 확인:

브라우저에서 접속:
```
http://136.113.67.193:8080
```

비밀번호: `aps-relay-2025`

대시보드에서 확인:
- **Backends**: 로컬 백엔드가 연결되어 있는지 확인 (초록색 Active)
- **Event Logs**: `zoho:webhook:received`, `zoho:webhook:relayed` 이벤트 확인

---

## 🧰 4. 문제 해결

### 문제 1: ZOHO Webhook이 도착하지 않음

**확인 사항:**
1. **ZOHO Webhook URL이 올바른지 확인**
   - URL: `http://136.113.67.193:8080/api/zoho/webhook`
   - 포트 번호 8080 포함 확인

2. **ZOHO Webhook 이벤트 구독 확인**
   - "New Mail Received" 이벤트가 체크되어 있는지 확인

3. **릴레이 서버가 실행 중인지 확인**
   ```bash
   gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker ps | grep ws-relay"
   ```

4. **방화벽 규칙 확인**
   ```bash
   gcloud compute firewall-rules list --filter="name:allow-8080"
   ```

   만약 규칙이 없다면 생성:
   ```bash
   gcloud compute firewall-rules create allow-8080 \
     --allow tcp:8080 \
     --source-ranges 0.0.0.0/0 \
     --description "Allow ZOHO Webhook traffic"
   ```

### 문제 2: Webhook은 도착하지만 앱이 업데이트되지 않음

**확인 사항:**
1. **백엔드가 릴레이 서버에 연결되어 있는지 확인**
   - 릴레이 서버 대시보드에서 Backends 섹션 확인
   - 로컬 백엔드 로그에서 `[Relay] Connected to relay server` 확인

2. **프론트엔드 WebSocket 연결 확인**
   - 브라우저 콘솔에서 `[WebSocket]` 관련 로그 확인
   - React Query DevTools에서 캐시 무효화 확인

3. **백엔드 로그 확인**
   - `[ZOHO Webhook] Received request` 로그가 있는지 확인
   - 에러 메시지가 있는지 확인

### 문제 3: "Invalid signature" 에러

**해결 방법:**
1. ZOHO 관리자 콘솔에서 설정한 Webhook Secret 확인
2. 로컬 백엔드 `.env` 파일에 동일한 값 설정:
   ```
   ZOHO_WEBHOOK_SECRET=your-secret-key-from-zoho
   ```
3. 백엔드 재시작

또는 테스트를 위해 서명 검증 비활성화:
- `.env` 파일에서 `ZOHO_WEBHOOK_SECRET=` 제거 (빈 값)
- 백엔드 재시작

---

## 📊 5. End-to-End 테스트

### 테스트 절차:

1. **백엔드 로그 모니터링 시작**
   - 로컬 백엔드 콘솔 확인

2. **ZOHO Mail로 테스트 이메일 전송**
   - Gmail 등 다른 이메일 서비스에서 `support@apsnuri.com`으로 이메일 전송

3. **릴레이 서버 로그 확인**
   ```bash
   gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker logs ws-relay --tail 30 -f"
   ```

   예상 로그:
   ```
   [Relay] ZOHO Webhook received
   [Relay] Relaying ZOHO webhook to backend backend-office-pc-1
   ```

4. **백엔드 로그 확인**

   예상 로그:
   ```
   [ZOHO Webhook] Received request
   [ZOHO Webhook] Processing new message: <message-id>
   [ZOHO Webhook] Message processed successfully
   [ZOHO Webhook] Real-time event emitted
   ```

5. **앱 UI 확인**
   - 이메일 목록에 새 이메일이 자동으로 표시되는지 확인
   - Toast 알림이 나타나는지 확인

---

## 📝 요약

### 핵심 URL:
- **ZOHO Webhook URL**: `http://136.113.67.193:8080/api/zoho/webhook`
- **릴레이 서버 대시보드**: `http://136.113.67.193:8080` (비밀번호: `aps-relay-2025`)

### 데이터 흐름:
1. ZOHO Mail에 새 이메일 도착
2. ZOHO → 릴레이 서버 (HTTP POST)
3. 릴레이 서버 → 로컬 백엔드 (WebSocket)
4. 백엔드 → DB 저장 + WebSocket 이벤트 브로드캐스트
5. 프론트엔드 → React Query 캐시 무효화 → UI 자동 업데이트

### 확인 포인트:
- ✅ ZOHO Webhook URL 설정
- ✅ 릴레이 서버 실행 중 (GCP)
- ✅ 백엔드 릴레이 서버에 연결
- ✅ 프론트엔드 WebSocket 연결
- ✅ React Query 캐시 무효화 작동

---

## 🎯 다음 단계

1. ZOHO Mail 관리자 콘솔에서 Webhook 설정
2. 테스트 이메일 전송
3. 로그 확인 및 문제 해결

문제가 발생하면 위의 "문제 해결" 섹션을 참고하세요.
