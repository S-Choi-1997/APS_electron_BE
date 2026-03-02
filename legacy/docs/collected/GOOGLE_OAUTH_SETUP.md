# Google OAuth 설정 가이드

프론트엔드에서 Google OAuth를 사용하려면 Google Cloud Console에서 OAuth 2.0 Client ID를 생성해야 합니다.

## 1. OAuth 동의 화면 구성

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials/consent?project=apsconsulting) 접속
2. "OAuth 동의 화면" 탭 선택
3. User Type: **Internal** 선택 (조직 내부 사용자만 접근)
4. 앱 정보 입력:
   - 앱 이름: `APS 상담 관리 시스템`
   - 사용자 지원 이메일: `infra.steve.01@gmail.com`
   - 개발자 연락처 이메일: `infra.steve.01@gmail.com`
5. 범위(Scopes): 기본값 유지 (openid, email, profile)
6. 저장

## 2. OAuth 2.0 Client ID 생성

1. [API 및 서비스 > 사용자 인증 정보](https://console.cloud.google.com/apis/credentials?project=apsconsulting) 접속
2. "사용자 인증 정보 만들기" 클릭
3. **OAuth 2.0 클라이언트 ID** 선택
4. 애플리케이션 유형: **웹 애플리케이션** 선택
5. 이름: `APS 상담 관리 웹 클라이언트`
6. 승인된 자바스크립트 원본:
   ```
   http://localhost:5173
   http://localhost:5174
   ```
7. 승인된 리디렉션 URI: (비워두기 - Google Identity Services는 리디렉션 URI가 필요 없음)
8. "만들기" 클릭
9. 생성된 **클라이언트 ID**를 복사 (형식: `XXXXX.apps.googleusercontent.com`)

## 3. 프론트엔드 환경 변수 설정

`.env` 파일을 열고 클라이언트 ID를 입력:

```env
VITE_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID_HERE.apps.googleusercontent.com
```

예:
```env
VITE_GOOGLE_CLIENT_ID=123456789-abcdefghijklmnop.apps.googleusercontent.com
```

## 4. 개발 서버 재시작

```bash
npm run dev
```

## 주의사항

- **Internal** User Type을 선택했으므로, Google Workspace 조직 내 사용자만 로그인할 수 있습니다
- 백엔드의 `ALLOWED_EMAILS` 환경변수에 등록된 이메일만 API 접근이 가능합니다
- localhost 포트가 5173이 아닌 경우, OAuth 클라이언트의 승인된 원본에 해당 포트를 추가하세요

## 테스트

1. 프론트엔드 접속: http://localhost:5173
2. "Google로 로그인" 버튼 클릭
3. Google 계정 선택
4. 로그인 성공 후 상담 목록이 표시되는지 확인

## 문제 해결

### "팝업이 차단되었습니다"
- 브라우저 설정에서 localhost의 팝업을 허용하세요

### "액세스가 거부되었습니다"
- OAuth 동의 화면이 "Internal"로 설정되어 있는지 확인
- 로그인한 Google 계정이 조직 내 계정인지 확인

### "ALLOWED_EMAILS에 없는 이메일입니다"
- 백엔드의 `ALLOWED_EMAILS` 환경변수에 해당 이메일을 추가하고 재배포하세요
