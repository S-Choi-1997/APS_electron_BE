# 스크립트 안내

## 1) 프런트 빌드 → 다른 레포로 복사/커밋/푸시
- 스크립트: `scripts/build-and-push.ps1`
- 기능: `npm run build` 결과(`dist/`)를 `release/<OutputName>/`에 스테이징한 뒤, 지정한 Git 레포로 복사하여 add/commit/push까지 처리.

### 사용 예시 (PowerShell)
```
cd E:\Projects\APS\상담목록
powershell -ExecutionPolicy Bypass -File scripts/build-and-push.ps1 `
  -TargetRepoPath "D:\path\to\target-repo" `
  -Branch "main" `
  -OutputName "frontend-build-20241203" `
  -CommitMessage "chore: publish frontend build"
```

### 주요 옵션
- `TargetRepoPath` (필수): 빌드를 넣고 커밋/푸시할 Git 레포 경로.
- `Branch` (기본 `main`): 커밋/푸시할 브랜치. 없으면 새로 만듭니다.
- `OutputName` (선택): `release/`와 대상 레포에 생성될 폴더 이름(기본: 타임스탬프).
- `SkipInstall` (스위치): `node_modules`가 없어도 `npm install`을 건너뜁니다.
- `CommitMessage` (선택): 기본값 `chore: publish frontend build (<OutputName>)`.

### 동작 단계
1) `node_modules` 없으면 `npm install` (단, `-SkipInstall` 시 생략)
2) `npm run build`
3) `dist/` → `release/<OutputName>/` 복사
4) `release/<OutputName>/` → `<TargetRepoPath>/<OutputName>/` 복사
5) 브랜치 checkout/생성 → git add/commit/push

### 요구사항/주의
- `git`, `npm`이 PATH에 있어야 함.
- `TargetRepoPath`는 이미 Git 레포이고 origin이 설정돼 있어야 함.
- 동일한 `<OutputName>` 폴더가 대상 레포에 있으면 에러가 발생하니 이름을 바꾸거나 정리 후 실행하세요.

---

## 2) 백엔드 배포 (Cloud Functions 2nd gen)
- 스크립트: `GCP2/deploy.ps1` (랩퍼: `GCP2/deploy.bat`)
- 기능: `GCP2/.env`의 환경변수로 Cloud Functions(2nd gen) 배포.

### 사용
```
cd E:\Projects\APS\상담목록\GCP2
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

### 요구사항
- `GCP2/.env`에 필수값: `ALLOWED_ORIGINS`, `ALLOWED_EMAILS`
- 선택값: `STORAGE_BUCKET`, `GCLOUD_PROJECT`
- `gcloud auth login`, `gcloud config set project <프로젝트ID>` 후 실행

### 관리자 이메일 화이트리스트
- `GCP2/.env`에 콤마로 추가 후 배포:
  ```
  ALLOWED_EMAILS=infra.steve.01@gmail.com,new.admin@example.com
  ```

### OAuth 허용 목록(프런트 로그인)
1) Google Cloud Console → API 및 서비스 → OAuth 동의 화면  
   - 앱이 “테스트”면 **테스트 사용자**에 계정을 추가.
2) 사용자 인증 정보 → OAuth 2.0 클라이언트 ID(웹)  
   - 승인된 JavaScript 원본: `http://localhost:5173`, `https://<프런트-도메인>`  
   - 승인된 리디렉션 URI: 위와 동일 도메인, 경로/프래그먼트 없이  
3) 프런트 `.env`에 `VITE_GOOGLE_CLIENT_ID=...` 설정 후 dev 서버 재시작
