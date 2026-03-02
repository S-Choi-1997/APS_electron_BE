# APS Admin - 릴리즈 가이드

이 문서는 APS Admin Electron 앱의 새 버전을 빌드하고 배포하는 방법을 설명합니다.

## 목차
1. [자동 릴리즈 (GitHub Actions)](#자동-릴리즈-github-actions)
2. [수동 릴리즈 (로컬 빌드)](#수동-릴리즈-로컬-빌드)
3. [버전 관리](#버전-관리)
4. [배포 후 확인 사항](#배포-후-확인-사항)

---

## 자동 릴리즈 (GitHub Actions)

**가장 권장하는 방법입니다.** GitHub Actions가 자동으로 Windows와 Linux 빌드를 생성하고 GitHub Releases에 업로드합니다.

### 1단계: 버전 업데이트

`package.json` 파일에서 버전을 업데이트합니다:

```json
{
  "name": "aps-admin-electron",
  "version": "1.2.0",  // 이 부분을 변경
  ...
}
```

버전 형식: `major.minor.patch` (예: 1.2.0)
- **major**: 큰 변경사항, 하위 호환성 깨짐
- **minor**: 새 기능 추가, 하위 호환성 유지
- **patch**: 버그 수정, 작은 개선

### 2단계: 변경사항 커밋

```bash
git add package.json
git commit -m "Bump version to 1.2.0"
git push
```

### 3단계: 태그 생성 및 푸시

```bash
# v로 시작하는 태그 생성 (예: v1.2.0)
git tag v1.2.0

# 태그를 원격 저장소에 푸시
git push origin v1.2.0
```

### 4단계: 빌드 진행 확인

1. GitHub 저장소의 **Actions** 탭으로 이동
2. "Build and Release" 워크플로우 확인
3. 빌드 진행 상황 모니터링 (약 5-10분 소요)

### 5단계: 릴리즈 확인

빌드가 완료되면:
1. GitHub 저장소의 **Releases** 탭으로 이동
2. 새로운 릴리즈 `v1.2.0` 확인
3. 다음 파일들이 업로드되어 있는지 확인:
   - `APS Admin Setup 1.2.0.exe` (Windows 설치 파일)
   - `APS-Admin-1.2.0.AppImage` (Linux 설치 파일)

### 자동 릴리즈 문제 해결

**빌드 실패 시:**
1. Actions 탭에서 실패한 워크플로우 클릭
2. 로그 확인하여 오류 원인 파악
3. 문제 해결 후 태그 재생성:
   ```bash
   # 로컬 태그 삭제
   git tag -d v1.2.0

   # 원격 태그 삭제
   git push origin :refs/tags/v1.2.0

   # 코드 수정 후 커밋 & 푸시
   git add .
   git commit -m "Fix build issue"
   git push

   # 태그 재생성 및 푸시
   git tag v1.2.0
   git push origin v1.2.0
   ```

---

## 로컬 빌드 및 릴리즈 (권장)

GitHub Actions 한도 초과 시 또는 빠른 릴리즈가 필요할 때 로컬에서 빌드합니다.

### 사전 요구사항

- Node.js 20 이상
- npm
- GitHub CLI (`gh`) 설치 및 로그인

```bash
# GitHub CLI 설치 (최초 1회)
winget install GitHub.cli

# GitHub 로그인 (최초 1회)
gh auth login
```

### 릴리즈 방법 (한 줄)

```bash
# 1. 버전 올리기
npm version patch   # 1.2.10 → 1.2.11 (버그 수정)
npm version minor   # 1.2.10 → 1.3.0  (새 기능)
npm version major   # 1.2.10 → 2.0.0  (대규모 변경)

# 2. 빌드 + GitHub Release 생성 + 푸시
npm run release
```

### 수동으로 단계별 실행

```bash
# 버전 올리기
npm version patch

# 빌드만 실행
npm run electron:build

# GitHub Release 생성 (버전에 맞게 수정)
gh release create v1.2.11 dist/APS-Admin-Setup-1.2.11.exe dist/latest.yml --title "v1.2.11"

# 코드 푸시
git push --follow-tags
```

### 빌드 결과물

빌드가 완료되면 `dist/` 폴더에 생성됩니다:

- `dist/APS-Admin-Setup-{버전}.exe` - 설치 파일
- `dist/latest.yml` - 자동 업데이트용 메타데이터

### 자동 업데이트 동작

1. 설치된 앱이 시작 시 GitHub Release의 `latest.yml` 확인
2. 새 버전 발견 시 다이얼로그 표시
3. 사용자가 "다운로드" 선택 시 exe 다운로드
4. 다운로드 완료 후 "재시작" 선택 시 자동 설치

### 업데이트 로그 확인

문제 발생 시 로그 파일 확인:
```
%APPDATA%/aps-admin-electron/update.log
```

### 주의사항

- `latest.yml`과 exe 파일명이 **정확히 일치**해야 자동 업데이트가 작동합니다
- 파일명 형식: `APS-Admin-Setup-{버전}.exe` (하이픈으로 구분)

---

## 버전 관리

### 버전 번호 규칙

`major.minor.patch` 형식을 따릅니다:

- **1.0.0** - 첫 번째 안정 버전
- **1.1.0** - 새 기능 추가
- **1.1.1** - 버그 수정
- **2.0.0** - 큰 변경사항, 기존 버전과 호환되지 않음

### 변경 내역 관리

릴리즈 노트를 작성하여 사용자에게 변경사항을 알립니다:

1. GitHub Releases에서 릴리즈 편집
2. 변경사항 요약 작성:
   ```markdown
   ## 새로운 기능
   - 상담 내역 엑셀 내보내기 기능 추가
   - 알림 설정 개선

   ## 버그 수정
   - 로그인 시 간헐적 오류 수정
   - SMS 발송 실패 문제 해결

   ## 개선사항
   - UI 반응 속도 개선
   - 검색 성능 향상
   ```

---

## 배포 후 확인 사항

### 1. 다운로드 테스트

1. GitHub Releases에서 설치 파일 다운로드
2. 설치 파일 실행하여 정상 설치 확인

### 2. 기능 테스트

설치 후 다음 항목을 확인합니다:

- [ ] 로그인 (Google, Naver)
- [ ] 상담 내역 조회
- [ ] 상담 내역 수정/삭제
- [ ] SMS 발송
- [ ] 실시간 알림 (WebSocket 연결)
- [ ] 메모/일정 기능

### 3. 환경 확인

- [ ] `.env` 파일 설정이 올바른지 확인
  - `VITE_API_URL=http://136.113.67.193:8080/proxy`
  - `VITE_WS_RELAY_URL=ws://136.113.67.193:8080`
- [ ] 백엔드 서버 (NAS) 정상 동작 확인
- [ ] GCP 릴레이 서버 정상 동작 확인

### 4. 사용자 공지

새 버전 배포 시 사용자에게 알립니다:

1. **업데이트 필수 여부** 명시
2. **주요 변경사항** 요약
3. **다운로드 링크** 제공
4. **설치 방법** 안내 (필요 시)

---

## 빠른 참조

### 자동 릴리즈 (권장)

```bash
# 1. 버전 업데이트 (package.json)
# 2. 커밋 & 푸시
git add package.json
git commit -m "Bump version to 1.2.0"
git push

# 3. 태그 생성 & 푸시
git tag v1.2.0
git push origin v1.2.0

# 4. GitHub Actions에서 자동 빌드 & 릴리즈
```

### 수동 릴리즈

```bash
npm run electron:build
# dist/ 폴더의 설치 파일을 사용자에게 전달
```

---

## 문제 해결

### "빌드가 시작되지 않아요"

- GitHub Actions 탭에서 워크플로우 확인
- 태그가 `v`로 시작하는지 확인 (예: `v1.2.0`)
- 태그가 제대로 푸시되었는지 확인: `git ls-remote --tags origin`

### "빌드가 실패했어요"

1. Actions 탭에서 로그 확인
2. 일반적인 원인:
   - `.env` 파일 누락 (자동 생성되어야 함)
   - 의존성 설치 실패 (인터넷 연결 확인)
   - 권한 문제 (workflow 파일에 `permissions: contents: write` 있는지 확인)

### "릴리즈가 생성되지 않았어요"

- 빌드는 성공했지만 릴리즈가 없는 경우:
  - GitHub Actions의 `permissions: contents: write` 확인
  - `GH_TOKEN` 환경 변수가 설정되어 있는지 확인
  - Artifacts 탭에서 빌드 파일 다운로드 가능 (임시 방법)

### "로컬 빌드가 안 돼요"

```bash
# 의존성 재설치
rm -rf node_modules package-lock.json
npm install

# 빌드 재시도
npm run electron:build
```

---

## 추가 참고 자료

- [Electron Builder 문서](https://www.electron.build/)
- [GitHub Actions 문서](https://docs.github.com/en/actions)
- [Semantic Versioning](https://semver.org/lang/ko/)
