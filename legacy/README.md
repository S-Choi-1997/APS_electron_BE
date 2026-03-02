# APS Consulting 관리 시스템

## 프로젝트 개요
APS Consulting의 내부 관리자 전용 문의 관리 시스템입니다.
- 웹사이트에서 접수된 문의 내역 조회
- SMS 자동 발송 기능 (Aligo API 연동)
- Google/Naver OAuth 기반 로그인
- 허가된 이메일만 접근 가능 (환경변수 기반 접근 제어)

## 도메인
- **프론트엔드**: https://admin.apsconsulting.kr
- **백엔드 API**: https://inquiryapi-mbi34yrklq-uc.a.run.app

## 기술 스택

### 프론트엔드
- React 18 + Vite
- Firebase Storage (첨부파일)
- GitHub Pages 배포
- Google OAuth / Naver OAuth

### 백엔드 (GCP2/)
- Node.js + Express
- GCP Cloud Run 배포
- Firestore (데이터베이스)
- Google/Naver OAuth 토큰 검증
- 이메일 기반 접근 제어

### SMS Relay 서버 (GCP3/sms-relay/)
- Node.js + Express
- GCP Compute Engine (고정 IP: 136.113.67.193)
- Aligo API 연동 (SMS 발송)
- 포트: 3000

## 디렉토리 구조

```
APSmanager/
├── src/                    # 프론트엔드 React 앱
├── GCP2/                   # 백엔드 API (Cloud Run)
├── GCP3/sms-relay/         # SMS Relay 서버 (고정 IP VM)
├── public/                 # 정적 파일
├── .github/workflows/      # GitHub Actions (자동 배포)
└── dist/                   # 빌드 결과물

[삭제 대상]
├── GCP/                    # (구버전, 사용 안 함)
└── GCP3/*.sh, *.conf       # (VM 초기 설정용, 이미 완료)
```

## 개발 가이드

### 로컬 개발
```bash
npm install
npm run dev
```

### 배포
- **프론트엔드**: GitHub Actions로 자동 배포 (main 브랜치 푸시 시)
- **백엔드**: `cd GCP2 && ./deploy.ps1` 또는 `./deploy.bat`
- **SMS Relay**: 수동 배포 (GCP3/sms-relay/install.sh 참고)

## 환경변수

### 프론트엔드 (.env.production)
- VITE_BACKEND_URL
- VITE_GOOGLE_CLIENT_ID
- VITE_NAVER_CLIENT_ID
- VITE_NAVER_REDIRECT_URI

### 백엔드 (GCP2/.env)
- ALLOWED_ORIGINS
- ALLOWED_EMAILS (접근 허용 이메일 목록)
- STORAGE_BUCKET
- NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
- ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER_PHONE
- RELAY_URL (SMS Relay 서버 주소)

## 주요 기능

### 1. 인증 시스템
- Google/Naver OAuth 로그인
- 백엔드에서 허가된 이메일 목록과 대조
- 불일치 시 접근 거부 페이지 표시

### 2. 문의 관리
- 문의 목록 조회 (이름/전화번호/이메일 검색)
- 타입별 필터링
- 미확인 문의만 보기
- 일괄 선택/삭제

### 3. SMS 발송
- 확인 버튼 클릭 시 자동 SMS 발송
- 발송 실패 시 상태 자동 롤백
- 아름다운 모달 UI (ConfirmModal, AlertModal)

### 4. 첨부파일
- Firebase Storage에 저장
- 이미지 미리보기
- 다운로드 링크 제공

## 문서
- [DEPLOYMENT.md](./DEPLOYMENT.md) - 배포 가이드
- [CHANGELOG.md](./CHANGELOG.md) - 변경 이력
- [GCP2/README.md](./GCP2/README.md) - 백엔드 API 문서
- [GCP3/README.md](./GCP3/README.md) - SMS Relay 서버 문서
