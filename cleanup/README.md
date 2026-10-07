# 상담 데이터 자동 삭제 함수

`deleteAt`이 현재 시간보다 이전인 Firestore 상담 문서와 연결된 Storage 파일을 처리하는 독립 Cloud Function입니다. `customer-api`는 상담 저장 시 접수일로부터 179일 뒤의 `deleteAt`을 기록합니다.

## 동작과 한계

- HTTP 엔트리포인트는 `deleteOldInquiries`입니다.
- 호출 한 번에 대상 문서 최대 500개를 처리합니다. 한도를 넘는 대상은 이후 호출에서 처리합니다.
- 첨부파일의 `path` 또는 `filename`으로 Storage 파일을 삭제한 뒤 문서를 삭제합니다.
- 파일 404는 무시합니다. 그 외 파일 삭제 실패는 응답·로그의 `errors`에 기록하지만 문서는 계속 삭제합니다.
- 문서가 삭제된 뒤 해당 파일 실패를 자동 재시도하는 기능은 없습니다. 기존 설명의 “다음에 재시도”는 구현되지 않았습니다.
- 일부 항목 실패도 HTTP 성공 응답일 수 있으므로 `status`뿐 아니라 `errors`를 확인합니다. 대상 없음 응답은 `deletedCount: 0`, 처리 응답은 `deletedDocs`·`deletedFiles`를 사용합니다.

보존 기간은 이 시스템의 설정입니다. 법적 적합성·고정 비용을 이 문서에서 보장하지 않습니다. 함수는 시간 예약을 내장하지 않으며 Cloud Scheduler의 실제 설정이 실행 시각을 결정합니다.

## 독립 배포

저장소의 앱/백엔드 릴리스와 별도입니다. 기존 프로젝트·버킷·Scheduler 설정을 먼저 확인합니다. 아래는 기존 배포 방식의 예시입니다.

```sh
cd cleanup
npm ci
gcloud functions deploy deleteOldInquiries \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=deleteOldInquiries \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars STORAGE_BUCKET=<actual-bucket-name> \
  --memory=256MB \
  --timeout=540s
```

Scheduler 생성 예시의 함수 URL은 실제 배포 응답에서 확인합니다. 기존 작업이 있다면 중복 생성하지 않습니다.

```sh
gcloud scheduler jobs create http delete-old-inquiries \
  --location=us-central1 \
  --schedule="0 2 * * *" \
  --uri="<deployed-function-url>" \
  --http-method=GET \
  --time-zone="Asia/Seoul" \
  --description="삭제 기한이 지난 상담 데이터 정리"
```

## 조회·검증

```sh
gcloud functions logs read deleteOldInquiries --region=us-central1 --limit=50
gcloud scheduler jobs describe delete-old-inquiries --location=us-central1
```

수동 함수 호출과 `gcloud scheduler jobs run`은 조회 테스트가 아니라 실제 삭제 실행입니다. 실행 결과의 오류 목록과 삭제 수를 확인하고 실패 파일은 별도로 처리합니다. 이 문서 정리에서는 삭제 작업을 실행하지 않았습니다.
