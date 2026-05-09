# 코드 검토 (APS Admin 완료 루틴)

최근 수정된 파일을 기준으로 CLAUDE.md의 4단계 완료 루틴을 수행한다.

## 실행 절차

### 0단계 — 변경 파일 파악
`git diff --name-only HEAD` 및 `git status`로 수정된 파일 목록을 확인한다.
변경 파일이 없으면 "검토할 변경사항이 없습니다"라고 보고하고 종료한다.

### 1단계 — 코드 정합성 검토
변경된 각 파일을 읽고 아래를 점검한다:
- 수정한 함수·컴포넌트의 **입출력 타입과 반환값**이 호출부와 일치하는지
- `async/await` 누락, `Promise` 미처리, 미반환 케이스
- 조건 분기 누락 (null·undefined·빈 배열 등 엣지 케이스)

문제 발견 시 파일 경로와 줄 번호를 명시하고, 수정이 필요한 경우 즉시 수정한다.

### 2단계 — 연결부·호출부 검토
변경된 함수·채널·엔드포인트를 호출하는 모든 위치를 검색한다:
- IPC 채널명 변경 → `electron/main.js`의 `ipcMain.handle`과 `electron/preload.js`의 `ipcRenderer.invoke` 양쪽 확인
- API 엔드포인트 변경 → `src/config/api.js`의 `API_ENDPOINTS`와 `backend/server.js` 라우트 양쪽 확인
- `window.electron.xxx` 호출 → preload에 실제로 노출됐는지 확인
- 함수 시그니처 변경 → 모든 호출부에 전파됐는지 확인

불일치 발견 시 즉시 수정한다.

### 3단계 — 런타임 위험 요소 검토
- 렌더러 프로세스에서 Node.js API 직접 호출 (contextIsolation 위반)
- `apiRequest()`를 우회하는 직접 `fetch`·`axios` 호출 (인증 헤더 누락 위험)
- `VITE_` 접두사 누락된 환경변수
- XSS 위험 있는 `innerHTML` 직접 삽입 (DOMPurify 처리 여부)

위험 요소 발견 시 즉시 수정한다.

### 4단계 — 결과 보고
검토 결과를 아래 형식으로 요약한다:

```
## 검토 결과

### 변경 파일
- 파일 목록

### 발견된 문제 (수정 완료)
- 문제 설명 (파일:줄번호)

### 발견된 문제 (수동 확인 필요)
- 문제 설명

### 이상 없음
- 통과한 항목 목록

### 문서 업데이트 필요 여부
- CLAUDE.md 업데이트 필요: 예/아니오
- MEMORY.md 업데이트 필요: 예/아니오
```
