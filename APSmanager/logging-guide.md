# Cloud Logging 통합 가이드

## 1. 현재 상태

모든 서비스가 이미 Cloud Logging에 로그를 전송하고 있습니다 (`console.log` 사용).
하지만 구조화되지 않은 문자열 형태라 검색/분석이 어렵습니다.

## 2. 구조화된 로깅 구현

### GCP2 (백엔드 API) - SMS 발송 로그

**기존 코드 (index.js:632):**
```javascript
console.log(`SMS sent by ${req.user.email}: ${aligoResult.success_cnt} success, ${aligoResult.error_cnt} failed`);
```

**개선안:**
```javascript
// SMS 발송 성공 후 (index.js:632)
console.log(JSON.stringify({
  severity: 'INFO',
  component: 'sms',
  action: 'send',
  user: req.user.email,
  provider: req.user.provider,
  receiver: receiver,
  message_length: msg.length,
  msg_type: msg_type || 'SMS',
  success_count: aligoResult.success_cnt,
  error_count: aligoResult.error_cnt,
  msg_id: aligoResult.msg_id,
  '@type': 'type.googleapis.com/google.cloud.logging.v2.SmsLog',
  timestamp: new Date().toISOString()
}));
```

### GCP3 (SMS Relay) - 릴레이 로그

**기존 코드 (sms-relay/index.js:69,82):**
```javascript
console.log(`[${new Date().toISOString()}] Sending SMS to ${receiver}`);
console.log(`[${new Date().toISOString()}] Aligo response:`, aligoResult);
```

**개선안:**
```javascript
// SMS 전송 전 (index.js:69)
console.log(JSON.stringify({
  severity: 'INFO',
  component: 'sms-relay',
  action: 'forward',
  receiver: receiver,
  msg_length: msg.length,
  timestamp: new Date().toISOString()
}));

// Aligo 응답 후 (index.js:82)
console.log(JSON.stringify({
  severity: aligoResult.result_code >= 0 ? 'INFO' : 'ERROR',
  component: 'sms-relay',
  action: 'aligo_response',
  receiver: receiver,
  result_code: aligoResult.result_code,
  message: aligoResult.message,
  success_cnt: aligoResult.success_cnt,
  error_cnt: aligoResult.error_cnt,
  msg_id: aligoResult.msg_id,
  timestamp: new Date().toISOString()
}));
```

### GCP-cleanup - 자동 삭제(파기) 로그

**기존 코드 (index.js:79):**
```javascript
console.log(`문서 삭제: ${docId} (생성일: ${data.createdAt?.toDate?.()?.toISOString() || "unknown"})`);
```

**개선안:**
```javascript
// 문서 삭제 시 (index.js:79)
console.log(JSON.stringify({
  severity: 'NOTICE',
  component: 'cleanup',
  action: 'delete_inquiry',
  inquiry_id: docId,
  inquiry_created_at: data.createdAt?.toDate?.()?.toISOString(),
  inquiry_delete_at: data.deleteAt?.toDate?.()?.toISOString(),
  name: data.name,
  phone: data.phone,
  email: data.email,
  category: data.category,
  attachments_count: data.attachments?.length || 0,
  reason: 'retention_policy_179_days',
  '@type': 'type.googleapis.com/google.cloud.logging.v2.DeletionLog',
  timestamp: new Date().toISOString()
}));

// 첨부파일 삭제 시 (index.js:60)
console.log(JSON.stringify({
  severity: 'INFO',
  component: 'cleanup',
  action: 'delete_file',
  file_path: filePath,
  inquiry_id: docId,
  timestamp: new Date().toISOString()
}));

// 작업 완료 시 (index.js:93-96 대체)
console.log(JSON.stringify({
  severity: 'NOTICE',
  component: 'cleanup',
  action: 'cleanup_completed',
  deleted_docs: deletedDocs,
  deleted_files: deletedFiles,
  errors: errors.length,
  execution_time_ms: executionTime,
  '@type': 'type.googleapis.com/google.cloud.logging.v2.CleanupSummary',
  timestamp: now.toISOString()
}));
```

### GCP (문의 접수) - 접수 로그

**추가 권장:**
```javascript
// contact 엔드포인트 성공 후 (GCP/index.js:200 이후)
console.log(JSON.stringify({
  severity: 'INFO',
  component: 'inquiry',
  action: 'submit',
  name: name,
  phone: phone,
  email: email,
  category: validCategory,
  nationality: nationality,
  company: company,
  message_length: message.length,
  attachments_count: attachments.length,
  recaptcha_score: score,
  ip: ip,
  '@type': 'type.googleapis.com/google.cloud.logging.v2.InquiryLog',
  timestamp: now.toISOString()
}));
```

## 3. Cloud Logging에서 로그 조회

### 웹 콘솔
```
https://console.cloud.google.com/logs/query
```

### 필터 예시

**모든 SMS 발송 로그:**
```
jsonPayload.component="sms"
jsonPayload.action="send"
```

**특정 사용자의 SMS 발송:**
```
jsonPayload.component="sms"
jsonPayload.user="admin@apsconsulting.kr"
```

**삭제(파기) 로그만:**
```
jsonPayload.component="cleanup"
jsonPayload.action="delete_inquiry"
```

**SMS 발송 실패 로그:**
```
jsonPayload.component="sms"
jsonPayload.error_count>0
```

**특정 전화번호로 발송한 SMS:**
```
jsonPayload.component="sms"
jsonPayload.receiver="01012345678"
```

## 4. GCS로 장기 보관 설정

### 4.1 GCS 버킷 생성
```bash
gsutil mb -l us-central1 gs://aps-consulting-logs
```

### 4.2 Log Router Sink 생성

**SMS 로그 (GCP2 + GCP3):**
```bash
gcloud logging sinks create sms-logs-to-gcs \
  gs://aps-consulting-logs/sms/ \
  --log-filter='jsonPayload.component="sms" OR jsonPayload.component="sms-relay"'
```

**삭제(파기) 로그:**
```bash
gcloud logging sinks create cleanup-logs-to-gcs \
  gs://aps-consulting-logs/cleanup/ \
  --log-filter='jsonPayload.component="cleanup"'
```

**문의 접수 로그:**
```bash
gcloud logging sinks create inquiry-logs-to-gcs \
  gs://aps-consulting-logs/inquiries/ \
  --log-filter='jsonPayload.component="inquiry"'
```

**모든 감사 로그 (통합):**
```bash
gcloud logging sinks create audit-logs-to-gcs \
  gs://aps-consulting-logs/audit/ \
  --log-filter='jsonPayload.component=("sms" OR "sms-relay" OR "cleanup" OR "inquiry")'
```

### 4.3 권한 설정

Log Router가 자동으로 서비스 계정을 생성합니다. 권한 부여:

```bash
# Sink 생성 시 출력된 서비스 계정 확인
gcloud logging sinks describe sms-logs-to-gcs --format="value(writerIdentity)"

# GCS 버킷에 쓰기 권한 부여 (자동으로 되지만 확인용)
# serviceAccount:cloud-logs@...
gsutil iam ch serviceAccount:cloud-logs@xxxx.iam.gserviceaccount.com:objectCreator gs://aps-consulting-logs
```

## 5. 생명주기 관리 (비용 절감)

로그 파일을 자동으로 아카이빙/삭제:

```bash
# lifecycle.json 파일 생성
cat > lifecycle.json <<EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
        "condition": {"age": 90}
      },
      {
        "action": {"type": "SetStorageClass", "storageClass": "COLDLINE"},
        "condition": {"age": 365}
      },
      {
        "action": {"type": "Delete"},
        "condition": {"age": 2555}
      }
    ]
  }
}
EOF

# 버킷에 적용
gsutil lifecycle set lifecycle.json gs://aps-consulting-logs
```

- **90일 후**: Nearline (월 $0.01/GB) - 자주 안 보는 로그
- **1년 후**: Coldline (월 $0.004/GB) - 거의 안 보는 로그
- **7년 후**: 삭제 (법적 보관 기간 준수)

## 6. BigQuery 연동 (고급 분석)

대용량 로그 분석이 필요하면 BigQuery로 export:

```bash
# BigQuery 데이터셋 생성
bq mk --dataset --location=us-central1 apsconsulting:logs

# Log Router -> BigQuery Sink
gcloud logging sinks create sms-logs-to-bigquery \
  bigquery.googleapis.com/projects/apsconsulting/datasets/logs \
  --log-filter='jsonPayload.component="sms"'
```

## 7. 비용 추정

### Cloud Logging
- **무료 할당량**: 50GB/월
- **초과 시**: $0.50/GB
- **예상 사용량**: SMS 로그 ~1MB/건 → 월 100건 = 100MB (무료)

### Cloud Storage (장기 보관)
- **Standard**: $0.02/GB/월
- **Nearline**: $0.01/GB/월
- **Coldline**: $0.004/GB/월
- **예상**: 1년치 로그 ~10GB = 약 $0.10/월

**총 비용: 거의 무료 수준 (~$1/월 미만)**

## 8. 규정 준수

### GDPR/개인정보보호법 준수
```javascript
// 개인정보는 해시 처리
const crypto = require('crypto');

function hashPII(value) {
  return crypto.createHash('sha256').update(value).digest('hex').substring(0, 16);
}

console.log(JSON.stringify({
  severity: 'INFO',
  component: 'sms',
  action: 'send',
  receiver_hash: hashPII(receiver), // 010-1234-5678 -> a3f2e1b4c5d6
  name_hash: hashPII(name),
  // ... 나머지
}));
```

## 9. 추천 구현 순서

1. ✅ **GCP-cleanup 먼저 구현** (파기 로그 가장 중요)
2. ✅ **GCP2 SMS 로그** (감사 추적 필요)
3. ✅ **GCP3 SMS Relay 로그** (디버깅용)
4. ⚠️ **GCS Export 설정** (장기 보관)
5. ⚠️ **생명주기 정책** (비용 절감)

## 10. 다음 단계

로깅 코드를 각 파일에 적용할까요? 아니면 특정 서비스부터 시작하시겠어요?
