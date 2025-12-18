# APS Admin 문서 모음

이 폴더는 APS Admin Electron 앱과 관련된 모든 문서를 포함합니다.

## 📚 사용 가이드

| 문서 | 설명 |
|------|------|
| [RELEASE_GUIDE.md](RELEASE_GUIDE.md) | **새 버전 릴리즈 방법** - 자동/수동 빌드 및 배포 |
| [ADMIN_ACCOUNT_GUIDE.md](ADMIN_ACCOUNT_GUIDE.md) | **관리자 계정 추가 방법** - 새 관리자 생성 |

## 🏗️ 아키텍처 문서

| 문서 | 설명 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | **프로젝트 전체 가이드** - Claude Code를 위한 프로젝트 개요 |
| [ELECTRON_MIGRATION.md](ELECTRON_MIGRATION.md) | GCP Cloud Run → Electron 마이그레이션 과정 |
| [JWT_AUTH_MIGRATION.md](JWT_AUTH_MIGRATION.md) | JWT 인증 시스템 마이그레이션 |
| [WEBSOCKET_GUIDE.md](WEBSOCKET_GUIDE.md) | WebSocket 릴레이 서버 가이드 |
| [CSS_STRUCTURE.md](CSS_STRUCTURE.md) | CSS 구조 및 스타일 가이드 |

## 🗂️ 레거시 문서

| 문서 | 설명 |
|------|------|
| [계정추가법_legacy.txt](계정추가법_legacy.txt) | 구 관리자 계정 추가 방법 (참고용) |
| [참고.txt](참고.txt) | 기타 참고 사항 |
| [임시-진행도.md](임시-진행도.md) | 개발 진행 상황 메모 |

---

## 빠른 참조

### 새 버전 배포하기
```bash
# 1. 버전 업데이트 (package.json)
# 2. 태그 생성 및 푸시
git tag v1.2.0
git push origin v1.2.0
# 3. GitHub Actions에서 자동 빌드
```
👉 자세한 내용: [RELEASE_GUIDE.md](RELEASE_GUIDE.md)

### 관리자 계정 추가하기
```bash
cd backend-local
node create-admin.js admin@test.com TestPass123 "관리자" admin
```
👉 자세한 내용: [ADMIN_ACCOUNT_GUIDE.md](ADMIN_ACCOUNT_GUIDE.md)

### 프로젝트 구조 이해하기
👉 [CLAUDE.md](CLAUDE.md) 참조

---

**문의:** 문제가 발생하면 각 문서의 "문제 해결" 섹션을 참고하세요.
