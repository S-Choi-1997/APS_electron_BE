# 릴리스 프로세스

## Electron 앱 릴리스

1. `package.json`의 `version` 업데이트

2. `npm run release` 실행
   - Vite 빌드 → Electron 패키징 → NSIS 설치파일 생성
   - GitHub Releases에 자동 게시
   - 실행 중인 앱은 `electron-updater`로 자동 업데이트 알림

3. GitHub Releases에 릴리스 노트 작성 (선택)

## Backend Docker 이미지 릴리스

GitHub에 push하면 Actions가 자동 빌드/푸시:

- `main`/`master` → `choho97/aps-admin-backend:latest`
- `v*.*.*` 태그 → `choho97/aps-admin-backend:<버전>` + `latest`
- `test/*`, `feature/*` → `choho97/aps-admin-backend:dev`

NAS에서 최신 이미지 적용:

```bash
docker-compose pull
docker-compose up -d
```

## 버전 정책

- Electron 앱: `package.json` version = GitHub Release 태그
- Backend: Docker Hub 태그로 관리 (버전 태그 별도)
