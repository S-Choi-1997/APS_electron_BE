# GitHub Pages 배포

## 빠른 배포

1. **저장소 이름 확인** (예: `consultation-list`)

2. **vite.config.js 수정**:
```js
export default defineConfig({
  plugins: [react()],
  base: '/consultation-list/'  // 본인 저장소 이름
})
```

3. **빌드 & 배포**:
```bash
npm run build
npx gh-pages -d dist
```

4. **GitHub 설정**: Settings > Pages > Source를 `gh-pages` 브랜치로 설정

끝! `https://username.github.io/consultation-list/` 접속

---

## 주의사항

- Firebase 사용 시 `.env` 파일로 API 키 관리 권장 (현재는 코드에 하드코딩됨)
- 저장소가 private이면 GitHub Pages 사용 불가 (public으로 변경 필요)
