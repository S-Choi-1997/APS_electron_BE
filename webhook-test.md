# ZOHO Webhook 테스트 가이드

## 현재 상황 분석

**문제**: ZOHO 메일이 도착해도 앱에 자동으로 표시되지 않음
- ✅ 수동 동기화(Manual Sync): 정상 작동 (ZOHO Mail API에서 메일 가져옴)
- ❌ 실시간 업데이트(Webhook): 작동하지 않음 (백엔드 로그에 `[ZOHO Webhook]` 없음)

**원인 가능성**:
1. ZOHO에서 webhook을 전송하지 않음 (ZOHO 설정 문제)
2. Webhook URL이 잘못 설정됨
3. 방화벽/네트워크 문제로 webhook이 도달하지 못함
4. 백엔드 코드 문제 (가능성 낮음 - 코드는 정상)

---

## 테스트 1: 백엔드 Webhook 엔드포인트 테스트

백엔드가 정상적으로 webhook을 받을 수 있는지 로컬에서 테스트합니다.

### Windows PowerShell에서 실행:

```powershell
# 기본 테스트 (서명 없음)
curl -X POST http://localhost:5000/api/zoho/webhook `
  -H "Content-Type: application/json" `
  -d '{
    "event": "mail.received",
    "data": {
      "messageId": "test-message-123",
      "subject": "테스트 이메일",
      "fromAddress": "test@example.com",
      "toAddress": "support@apsnuri.com",
      "fromName": "테스트 발신자",
      "bodyText": "이것은 webhook 테스트 메시지입니다.",
      "bodyHtml": "<p>이것은 webhook 테스트 메시지입니다.</p>",
      "receivedTime": "2024-01-15T10:30:00Z",
      "hasAttachment": false
    }
  }'
```

### 예상 결과:

백엔드 콘솔에 다음과 같은 로그가 출력되어야 합니다:

```
[ZOHO Webhook] ========================================
[ZOHO Webhook] Received request
[ZOHO Webhook] Headers: {
  "content-type": "application/json",
  ...
}
[ZOHO Webhook] Body: {
  "event": "mail.received",
  "data": { ... }
}
[ZOHO Webhook] ========================================
[ZOHO Webhook] Received webhook event
[ZOHO Webhook] Webhook secret not configured, skipping verification
[ZOHO Webhook] Processing new message: test-message-123
[ZOHO Webhook] Message processed successfully
[ZOHO Webhook] Real-time event emitted
```

그리고 앱에서:
- 이메일 목록이 자동으로 업데이트됨
- Toast 알림이 표시됨: "새 이메일: 테스트 발신자\n테스트 이메일"

---

## 테스트 2: 외부에서 접근 가능한지 확인

ZOHO가 webhook을 보내려면 외부에서 백엔드에 접근할 수 있어야 합니다.

### 2-1. 현재 서버 정보 확인

백엔드가 실행 중인 서버 정보를 확인하세요:

```bash
# 백엔드가 리스닝 중인 포트 확인
netstat -an | findstr "5000"
```

### 2-2. 공인 IP 확인 (필요한 경우)

로컬 개발 환경이라면 ZOHO가 접근할 수 없습니다.
다음 중 하나의 방법이 필요합니다:

**옵션 1: ngrok 사용 (테스트용)**
```bash
# ngrok 설치 후 실행
ngrok http 5000
```

ngrok이 제공하는 공개 URL (예: `https://abc123.ngrok.io`)을 ZOHO webhook URL로 설정합니다.

**옵션 2: 프로덕션 서버 사용**
- 백엔드가 공인 IP를 가진 서버에서 실행 중이어야 함
- ZOHO webhook URL: `http://[서버-IP]:5000/api/zoho/webhook`
- 또는 도메인 사용: `https://yourdomain.com/api/zoho/webhook`

---

## 테스트 3: ZOHO Mail Webhook 설정 확인

ZOHO Mail 관리자 콘솔에서 webhook이 올바르게 설정되어 있는지 확인합니다.

### 확인 사항:

1. **Webhook URL 설정**:
   - ZOHO Mail 관리자 콘솔 → Webhooks 설정
   - URL이 올바르게 설정되어 있는지 확인
   - 예: `https://your-server.com/api/zoho/webhook`

2. **Webhook 이벤트 구독**:
   - "New Mail Received" 또는 "mail.received" 이벤트가 활성화되어 있는지 확인

3. **Webhook Secret** (선택사항):
   - 만약 ZOHO에서 서명을 사용한다면:
   - `.env` 파일에 `ZOHO_WEBHOOK_SECRET=your-secret-key` 설정 필요

### ZOHO Webhook 테스트 기능 사용:

ZOHO 관리자 콘솔에서 "Test Webhook" 버튼이 있다면 클릭해서 테스트 요청을 보내봅니다.

---

## 테스트 4: 실제 이메일로 End-to-End 테스트

1. **백엔드 로그 모니터링**:
   ```bash
   # 백엔드 콘솔에서 로그를 실시간으로 확인
   ```

2. **ZOHO Mail로 테스트 이메일 전송**:
   - Gmail 등 다른 이메일 서비스에서 `support@apsnuri.com`으로 테스트 이메일 전송

3. **로그 확인**:
   - ZOHO webhook 로그가 출력되는지 확인
   - 출력되지 않으면 → ZOHO 설정 또는 네트워크 문제
   - 출력되면 → 백엔드는 정상, WebSocket 이벤트 확인

4. **앱 UI 확인**:
   - 이메일 목록이 자동으로 업데이트되는지 확인
   - Toast 알림이 표시되는지 확인

---

## 디버깅 체크리스트

### ✅ 백엔드 코드 (이미 완료됨)
- [x] Webhook 엔드포인트 존재: `POST /api/zoho/webhook`
- [x] Verbose 로깅 추가됨
- [x] `email:created` WebSocket 이벤트 브로드캐스트
- [x] React Query 캐시 무효화 연결됨

### ⚠️ ZOHO 설정 (확인 필요)
- [ ] ZOHO Mail Webhook URL이 설정되어 있는가?
- [ ] Webhook URL이 외부에서 접근 가능한가?
- [ ] "New Mail" 이벤트가 구독되어 있는가?
- [ ] ZOHO Webhook Test 기능을 사용해봤는가?

### ⚠️ 네트워크 (확인 필요)
- [ ] 백엔드가 공인 IP를 가진 서버에서 실행 중인가?
- [ ] 방화벽에서 5000 포트가 열려 있는가?
- [ ] ngrok 또는 유사 도구를 사용해 터널링했는가? (로컬 개발 시)

---

## 예상되는 ZOHO Webhook Payload 구조

ZOHO에서 실제로 보내는 webhook payload는 다음과 같은 형태일 것으로 예상됩니다:

```json
{
  "event": "mail.received",
  "accountId": "12345",
  "data": {
    "messageId": "<actual-message-id@zoho.com>",
    "subject": "실제 이메일 제목",
    "fromAddress": "sender@example.com",
    "fromName": "발신자 이름",
    "toAddress": "support@apsnuri.com",
    "ccAddress": [],
    "receivedTime": "2024-01-15T10:30:00Z",
    "bodyText": "이메일 본문 텍스트",
    "bodyHtml": "<html>이메일 본문 HTML</html>",
    "hasAttachment": false
  }
}
```

또는 다른 형태:

```json
{
  "eventType": "NEW_MAIL",
  "messageId": "<message-id>",
  "subject": "제목",
  "from": {
    "address": "sender@example.com",
    "name": "발신자"
  },
  "to": [
    {
      "address": "support@apsnuri.com"
    }
  ],
  "receivedAt": "2024-01-15T10:30:00Z",
  "body": {
    "text": "텍스트 본문",
    "html": "HTML 본문"
  }
}
```

**중요**: ZOHO의 실제 webhook payload 구조는 ZOHO 공식 문서를 참고해야 합니다.
현재 코드는 여러 형태를 지원하도록 작성되어 있습니다 (`webhookData.data || webhookData`).

---

## 다음 단계

1. **먼저 테스트 1 실행**: 로컬에서 curl로 webhook 엔드포인트 테스트
2. **로그 확인**: 백엔드가 정상적으로 webhook을 처리하는지 확인
3. **ZOHO 설정 확인**: ZOHO 관리자 콘솔에서 webhook 설정 검토
4. **외부 접근성 확인**: ngrok 또는 공인 IP 설정
5. **실제 이메일 테스트**: End-to-end 테스트 수행

---

## 문제 해결

### 문제 1: curl 테스트 시 "Connection refused"
**해결**: 백엔드가 실행 중인지 확인하세요.
```bash
# 백엔드 실행 확인
netstat -an | findstr "5000"
```

### 문제 2: curl 테스트 성공했지만 ZOHO에서 webhook이 안 옴
**해결**: ZOHO에서 외부 접근이 불가능합니다.
- ngrok 사용 또는
- 백엔드를 공인 IP 서버로 이동

### 문제 3: Webhook은 도착하지만 앱 UI가 업데이트 안 됨
**해결**: WebSocket 연결 또는 React Query 문제
- 브라우저 콘솔에서 WebSocket 연결 확인
- `[WebSocket] New email received:` 로그 확인
- React Query DevTools에서 캐시 무효화 확인

### 문제 4: "Invalid signature" 에러
**해결**: Webhook secret 불일치
- `.env` 파일의 `ZOHO_WEBHOOK_SECRET` 확인
- ZOHO 관리자 콘솔에서 설정한 secret과 일치하는지 확인
- 또는 테스트를 위해 `.env`에서 `ZOHO_WEBHOOK_SECRET=` 제거 (서명 검증 비활성화)
