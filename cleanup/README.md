# APS 상담 데이터 자동 삭제 함수

개인정보보호법 준수를 위해 179일 경과한 상담 데이터를 자동으로 삭제하는 Cloud Function입니다.

## 배포 방법

### 1. 의존성 설치
```bash
cd GCP-cleanup
npm install
```

### 2. Cloud Function 배포
```bash
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

**중요**:
- `STORAGE_BUCKET` 값을 실제 Firebase Storage 버킷 이름으로 변경하세요.
- `us-central1` 리전 사용 (프리티어 무료)

### 3. Cloud Scheduler 설정

#### 3-1. Scheduler 생성
```bash
gcloud scheduler jobs create http delete-old-inquiries \
  --location=us-central1 \
  --schedule="0 2 * * *" \
  --uri="https://us-central1-apsconsulting.cloudfunctions.net/deleteOldInquiries" \
  --http-method=GET \
  --time-zone="Asia/Seoul" \
  --description="매일 새벽 2시에 179일 경과한 상담 데이터 삭제"
```

#### 3-2. 수동 테스트
```bash
# Cloud Function 직접 호출 (테스트)
curl https://us-central1-apsconsulting.cloudfunctions.net/deleteOldInquiries

# Scheduler 수동 실행
gcloud scheduler jobs run delete-old-inquiries --location=us-central1
```

#### 3-3. 로그 확인
```bash
# Function 로그
gcloud functions logs read deleteOldInquiries --region=us-central1 --limit=50

# Scheduler 로그
gcloud scheduler jobs describe delete-old-inquiries --location=us-central1
```

## 작동 방식

1. **매일 새벽 2시** Cloud Scheduler가 함수 호출
2. `deleteAt < 오늘` 조건으로 문서 검색 (최대 500개)
3. 각 문서의 첨부파일 삭제 (GCS)
4. Firestore 문서 삭제
5. 결과 로그 출력

## 데이터 보존 기간

- **179일**: 상담 접수일로부터 179일 후 자동 삭제
- **180일 이내 삭제**: 개인정보보호법 준수

## 비용

- **Cloud Functions**: 월 200만 호출 무료 (매일 1회 = 월 30회)
- **Cloud Scheduler**: 월 3개까지 무료
- **Firestore 읽기**: 매일 삭제 대상만 읽음 (월 300회 이내)
- **총 예상 비용**: **$0/월** (무료 범위 내)

## 안전장치

- 한 번에 최대 500개만 처리 (과부하 방지)
- 파일 삭제 실패 시에도 문서는 삭제 (다음에 재시도)
- 404 에러 무시 (이미 삭제된 파일)
- 상세한 로그 출력

## 주의사항

1. **첫 배포 후 테스트**: 수동으로 함수 호출해서 정상 작동 확인
2. **로그 모니터링**: 첫 한 달간 주기적으로 로그 확인
3. **백업 정책**: 중요 데이터는 별도 백업 권장
