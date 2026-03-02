# 배포 프로세스

## 1단계: GCP 백엔드 업데이트 (deleteAt 필드 적용)

```bash
cd GCP

# Cloud Run 배포 (기존 방식)
gcloud run deploy aps-contact-api \
  --source . \
  --platform managed \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --set-env-vars RECAPTCHA_API_KEY=YOUR_KEY,STORAGE_BUCKET=apsconsulting.appspot.com
```

**확인사항**:
- 새로운 상담 접수부터 `deleteAt` 필드가 자동으로 추가됨
- 기존 데이터는 `deleteAt` 없음 (자동 삭제 안 됨, 괜찮음)

---

## 2단계: 삭제 함수 배포

```bash
cd ../GCP-cleanup
npm install

# Cloud Function 배포 (us-central1 = 프리티어)
gcloud functions deploy deleteOldInquiries \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=deleteOldInquiries \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars STORAGE_BUCKET=apsconsulting.appspot.com \
  --memory=256MB \
  --timeout=540s
```

**배포 완료 후 URL 확인**:
```
https://us-central1-apsconsulting.cloudfunctions.net/deleteOldInquiries
```

---

## 3단계: 수동 테스트

```bash
# 함수 직접 호출 (현재는 삭제할 데이터 없으므로 deletedCount: 0 응답)
curl https://us-central1-apsconsulting.cloudfunctions.net/deleteOldInquiries
```

**예상 응답**:
```json
{
  "status": "success",
  "deletedCount": 0,
  "message": "삭제할 문서 없음",
  "executionTime": 150
}
```

---

## 4단계: Cloud Scheduler 설정 (매일 자동 실행)

```bash
# Scheduler 생성 (us-central1 = 프리티어)
gcloud scheduler jobs create http delete-old-inquiries \
  --location=us-central1 \
  --schedule="0 2 * * *" \
  --uri="https://us-central1-apsconsulting.cloudfunctions.net/deleteOldInquiries" \
  --http-method=GET \
  --time-zone="Asia/Seoul" \
  --description="매일 새벽 2시에 179일 경과한 상담 데이터 삭제"

# Scheduler 수동 실행 (테스트)
gcloud scheduler jobs run delete-old-inquiries --location=us-central1
```

---

## 5단계: 로그 확인

```bash
# Cloud Function 로그
gcloud functions logs read deleteOldInquiries \
  --region=us-central1 \
  --limit=50

# Scheduler 실행 내역
gcloud scheduler jobs describe delete-old-inquiries \
  --location=us-central1
```

---

## 배포 후 체크리스트

- [ ] GCP 백엔드 배포 완료 (deleteAt 필드 추가)
- [ ] Cloud Function 배포 완료
- [ ] 수동 테스트 성공 (deletedCount: 0 응답 확인)
- [ ] Cloud Scheduler 생성 완료
- [ ] Scheduler 수동 실행 테스트
- [ ] 로그 확인 (에러 없음)

---

## 문제 해결

### "Permission denied" 에러
```bash
# 프로젝트 확인
gcloud config get-value project

# 프로젝트 설정
gcloud config set project apsconsulting
```

### Function URL을 모를 때
```bash
gcloud functions describe deleteOldInquiries \
  --region=us-central1 \
  --gen2 \
  --format="value(serviceConfig.uri)"
```

### Scheduler 수정
```bash
# 삭제
gcloud scheduler jobs delete delete-old-inquiries --location=us-central1

# 재생성 (위의 4단계 명령어 다시 실행)
```

---

## 비용 모니터링

무료 범위:
- Cloud Functions: 월 200만 호출 (현재: 30회/월)
- Cloud Scheduler: 월 3개 무료 (현재: 1개)
- Firestore 읽기: 월 50,000회 (현재: ~300회/월)

**총 예상 비용: $0/월**
