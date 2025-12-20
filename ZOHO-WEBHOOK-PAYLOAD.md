# ZOHO Webhook Payload 구조

## ✅ 테스트 완료된 Payload

다음 구조로 webhook이 정상 작동합니다:

```json
{
  "event": "mail.received",
  "data": {
    "messageId": "test-456",
    "subject": "Complete Test",
    "fromAddress": "sender@example.com",
    "toAddress": "support@apsnuri.com",
    "sender": "Test Sender",
    "receivedTime": "1734676800000",
    "content": "Test email body",
    "hasAttachment": "0"
  }
}
```

## 📋 필수 필드

ZOHO webhook이 보내야 하는 최소 필드:

| 필드 | 타입 | 필수 | 설명 | 예시 |
|------|------|------|------|------|
| `messageId` | string | ✅ | 메시지 고유 ID | `"<abc123@zoho.com>"` |
| `subject` | string | ✅ | 이메일 제목 | `"문의 드립니다"` |
| `fromAddress` | string | ✅ | 발신자 이메일 | `"user@example.com"` |
| `toAddress` | string | ✅ | 수신자 이메일 | `"support@apsnuri.com"` |
| `sender` | string | ❌ | 발신자 이름 | `"홍길동"` |
| `receivedTime` | string | ❌ | 수신 시간 (timestamp ms) | `"1734676800000"` |
| `content` | string | ❌ | 이메일 본문 (텍스트) | `"안녕하세요..."` |
| `hasAttachment` | string | ❌ | 첨부파일 여부 | `"0"` 또는 `"1"` |

## 🔍 실제 ZOHO Webhook 설정

ZOHO Mail 관리자 콘솔에서 webhook 설정 시:

**Webhook URL:**
```
http://136-113-67-193.nip.io:8080/api/zoho/webhook
```

**Event:**
- ✅ New Mail Received

**Payload 형식:**
ZOHO가 실제로 보내는 payload는 위 구조와 다를 수 있습니다.
실제 webhook을 받으면 릴레이 서버 로그에서 확인 가능:

```bash
gcloud compute ssh aligo-proxy --zone=us-central1-a --command="docker logs ws-relay --tail 50 | grep -A 20 'ZOHO Webhook received'"
```

## 🧪 테스트 명령어

완전한 테스트 데이터로 테스트:

```bash
curl -X POST http://136-113-67-193.nip.io:8080/api/zoho/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "mail.received",
    "data": {
      "messageId": "test-456",
      "subject": "Complete Test",
      "fromAddress": "sender@example.com",
      "toAddress": "support@apsnuri.com",
      "sender": "Test Sender",
      "receivedTime": "1734676800000",
      "content": "Test email body",
      "hasAttachment": "0"
    }
  }'
```

## ⚠️ 주의사항

1. **`toAddress` 필수**: DB 제약조건으로 `to_email`이 NOT NULL입니다.
2. **날짜 형식**: `receivedTime`이 없으면 현재 시간이 자동으로 사용됩니다.
3. **한글 인코딩**: UTF-8 인코딩이 올바르게 전달되어야 합니다.

## 📊 백엔드 로그 확인

성공적인 처리 시 로그:

```
[Backend] Tunnel HTTP POST /api/zoho/webhook (requestId: ...)
[ZOHO Webhook] Received webhook event
[ZOHO Webhook] Processing new message: test-456
[ZOHO DB] Email inquiry saved: test-456
[ZOHO Webhook] Message processed successfully
[ZOHO Webhook] Real-time event emitted
[Backend] Tunnel response 200 (requestId: ...)
```

## 🎯 다음 단계

1. ZOHO Mail 관리자 콘솔에서 webhook URL 설정
2. 실제 이메일 전송하여 테스트
3. 릴레이 서버 로그에서 실제 payload 구조 확인
4. 필요하면 `parseMessageToInquiry` 함수 추가 수정
