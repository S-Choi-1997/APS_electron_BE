# Sticky Notification Window System 문서

APS 애플리케이션의 실시간 알림창 시스템 전체 아키텍처 및 구현 상세

---

## 목차

1. [시스템 개요](#시스템-개요)
2. [아키텍처](#아키텍처)
3. [주요 컴포넌트](#주요-컴포넌트)
4. [데이터 흐름](#데이터-흐름)
5. [WebSocket 실시간 동기화](#websocket-실시간-동기화)
6. [자동 크기 조정](#자동-크기-조정)
7. [문제 해결 가이드](#문제-해결-가이드)

---

## 시스템 개요

Sticky Notification Window는 사용자가 로그인하면 자동으로 표시되는 항상 최상위(always-on-top) 창으로, 다음 정보를 실시간으로 표시합니다:

- **오늘 일정** (Today's Schedule)
- **미처리 상담 요청** (Pending Consultations)
- **이메일/웹사이트 상담 통계** (Consultation Stats)
- **팀 메모** (Team Memos)

### 주요 특징

- ✅ **실시간 동기화**: WebSocket을 통한 즉각적인 데이터 업데이트
- ✅ **캐시 우선 렌더링**: URL 파라미터로 전달된 캐시 데이터로 즉시 표시
- ✅ **자동 크기 조정**: 컨텐츠에 따라 창 높이 자동 조절
- ✅ **위치/투명도 저장**: 사용자 설정 영구 저장
- ✅ **크로스 윈도우 동기화**: 모든 창 간 실시간 데이터 동기화
- ✅ **서브 윈도우**: 메모 추가/상세보기 별도 창

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Process                              │
│                     (electron/main.js)                           │
│                                                                   │
│  ┌──────────────────┐      ┌──────────────────┐                │
│  │ Window Manager   │      │ IPC Handlers     │                │
│  │ - stickyWindows  │◄────►│ - create/close   │                │
│  │ - memoSubWindows │      │ - broadcast      │                │
│  │ - settings       │      │ - navigation     │                │
│  └──────────────────┘      └──────────────────┘                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ IPC (preload.js)
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
    │  Dashboard   │ │ Sticky.html │ │ memo-detail  │
    │  (React)     │ │ (Vanilla JS)│ │ .html        │
    └──────┬───────┘ └──────┬──────┘ └──────┬───────┘
           │                │                │
           │                │                │
           └────────────────┼────────────────┘
                            ▼
                    ┌──────────────────┐
                    │  WebSocket       │
                    │  Relay Server    │
                    │  (ws://...)      │
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
                    │  Backend API     │
                    │  (PostgreSQL)    │
                    └──────────────────┘
```

---

## 주요 컴포넌트

### 1. Electron Main Process (electron/main.js)

#### Sticky Window 관리 (Lines 120-203)

**데이터 구조:**
```javascript
let stickyWindows = {};      // { type: BrowserWindow }
let memoSubWindows = {};     // { type: BrowserWindow }
```

**Window 설정:**
```javascript
{
  width: 300,
  height: 200,              // 초기값, 컨텐츠 로드 후 자동 조정
  frame: false,             // 커스텀 타이틀바 사용
  alwaysOnTop: true,        // 항상 최상위
  show: false,              // 크기 조정 후 표시
  resizable: false,         // 수동 리사이즈 불가
  opacity: 0.95,            // 기본 투명도 (설정에서 변경 가능)
}
```

**설정 영구 저장:**
- 파일 위치: `{userData}/sticky-settings.json`
- 저장 내용: `{ dashboard: { x, y, opacity } }`
- 자동 저장: 창 이동 시마다 저장

#### Memo Sub-Window 관리 (Lines 376-470)

**스마트 포지셔닝:**
```javascript
// 부모 sticky 창이 화면 왼쪽에 있으면 → 오른쪽에 배치
if (parentX < screenCenterX) {
  x = parentX + parentWidth + gap;
  // 화면 경계 체크, 넘으면 왼쪽으로
}
// 부모 sticky 창이 화면 오른쪽에 있으면 → 왼쪽에 배치
else {
  x = parentX - subWindowWidth - gap;
}
```

**부모-자식 관계:**
- `parent: stickyWindow` 설정으로 부모 창 닫힐 때 자동 닫힘
- 한 sticky 창당 하나의 서브 윈도우만 허용

#### IPC 핸들러 (Lines 205-326)

**주요 핸들러:**
- `open-sticky-window`: 창 생성/표시, 캐시 데이터 전달
- `close-sticky-window`: 특정 창 닫기
- `resize-sticky-window`: 컨텐츠 크기에 맞춰 창 높이 조정
- `set-window-opacity`: 투명도 조절 (0.5-1.0)
- `broadcast-memo-created/deleted`: 모든 창에 메모 이벤트 전파
- `broadcast-consultation-updated`: 상담 데이터 변경 알림
- `open-memo-sub-window`: 메모 상세보기/추가 창 열기

---

### 2. Sticky Window (public/sticky.html)

#### UI 구조 (Lines 1-900)

**레이아웃:**
```html
┌────────────────────────────────────┐
│  Custom Titlebar (40px)            │ ← 드래그 가능, 투명도 슬라이더
├────────────────────────────────────┤
│  📅 오늘 일정 (0)              [▼] │ ← 접기/펴기 가능
│  ┌──────────────────────────────┐ │
│  │ Schedule Items (max 180px)   │ │ ← 스크롤 가능
│  └──────────────────────────────┘ │
├────────────────────────────────────┤
│  ⚠️  미처리 상담 요청 (0)      [▼] │
│  ┌──────────────────────────────┐ │
│  │ Consultation Items (max 150) │ │
│  └──────────────────────────────┘ │
├────────────────────────────────────┤
│  📊 이메일 0 | 웹사이트 0         │ ← 클릭 시 해당 탭으로 이동
├────────────────────────────────────┤
│  📝 팀 메모 (0)          [+ 추가] │
│  ┌──────────────────────────────┐ │
│  │ Memo Items (max 300px)       │ │
│  └──────────────────────────────┘ │
└────────────────────────────────────┘
```

#### 데이터 로딩 전략 (Lines 1440-1518)

**3단계 로딩:**

1. **즉시 렌더링** (캐시 데이터)
   ```javascript
   // URL 파라미터에서 캐시 추출
   const urlParams = new URLSearchParams(window.location.search);
   const cachedDataStr = urlParams.get('cachedData');
   const cachedData = JSON.parse(decodeURIComponent(cachedDataStr));

   // 즉시 표시 (API 대기 없음)
   memos = cachedData.memos || [];
   schedules = cachedData.schedules || [];
   stats = cachedData.stats || { email: 0, website: 0 };

   renderMemos();
   renderSchedules();
   updateConsultationStats();
   ```

2. **백그라운드 API 로드** (최신 데이터)
   ```javascript
   await Promise.all([
     loadMemos(),              // GET /memos
     loadConsultationStats(),  // GET /inquiries/stats
     loadSchedules()           // GET /schedules
   ]);
   ```

3. **WebSocket 연결** (실시간 업데이트)
   ```javascript
   connectWebSocket(); // ws://136.113.67.193:8080
   ```

#### API 설정 (Lines 924-928)

```javascript
// HTTP API 요청 (릴레이 서버 프록시)
const API_BASE_URL = 'http://136.113.67.193:8080/proxy';

// WebSocket 연결 (릴레이 서버 직접)
const WEBSOCKET_URL = 'ws://136.113.67.193:8080';
```

**중요:**
- HTTP 요청은 `/proxy` 경로 사용
- WebSocket은 루트 경로 사용
- 둘 다 릴레이 서버를 거쳐 백엔드와 통신

#### WebSocket 연결 (Lines 1314-1437)

**Socket.IO 설정:**
```javascript
socket = io(WEBSOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnectionDelay: 1000,
  reconnection: true,
  reconnectionAttempts: 10,
  timeout: 10000
});
```

**핸드쉐이크 (메인 앱과 동일):**
```javascript
socket.on('connect', () => {
  socket.emit('handshake', {
    type: 'client',
    metadata: {
      email: user.email,
      provider: user.provider,
      displayName: user.displayName,
      connectedAt: new Date().toISOString()
    }
  });
});
```

**이벤트 리스너:**
```javascript
socket.on('memo:created', loadMemos);
socket.on('memo:deleted', loadMemos);
socket.on('schedule:created', loadSchedules);
socket.on('schedule:updated', loadSchedules);
socket.on('schedule:deleted', loadSchedules);
socket.on('consultation:created', loadConsultationStats);
socket.on('consultation:updated', loadConsultationStats);
socket.on('consultation:deleted', loadConsultationStats);
```

#### 자동 크기 조정 (Lines 1521-1539)

**동작 원리:**
```javascript
function adjustWindowHeight() {
  setTimeout(async () => {
    const container = document.querySelector('.sticky-container');
    const contentHeight = container.scrollHeight;
    const totalHeight = contentHeight + 40;  // 타이틀바 40px 추가

    // IPC로 창 크기 조정 요청
    await window.electron.resizeStickyWindow(300, totalHeight);

    // 크기 조정 완료 후 창 표시
    await window.electron.showStickyWindow();
  }, 100);
}
```

**호출 시점:**
- 초기 데이터 로드 완료 시
- `renderMemos()` 완료 시
- `renderSchedules()` 완료 시
- `updateConsultationStats()` 완료 시

---

### 3. Memo Sub-Window (public/memo-detail.html)

#### 두 가지 모드

**View Mode (상세보기):**
```javascript
?mode=view&id=123

// API: GET /memos → 전체 목록에서 ID로 찾기
// 표시: 제목, 내용, 작성자, 작성일, 만료일, 중요 배지
// 기능: 삭제 버튼, 닫기 버튼
```

**Create Mode (추가):**
```javascript
?mode=create

// Form Fields:
// - 제목 (선택): 비어있으면 내용 앞 20자 자동 생성
// - 내용 (필수): textarea
// - 만료일 (선택): 기본값 오늘
// - 중요 체크박스
// API: POST /memos
```

#### 제목 자동 생성 로직 (Lines 456-459)

```javascript
if (!title) {
  // 내용이 20자 이하: 전체를 제목으로
  // 내용이 20자 초과: 앞 20자 + '...'
  title = content.length > 20
    ? content.substring(0, 20) + '...'
    : content;
}
```

**Dashboard와 동일한 로직 적용**

#### 이벤트 브로드캐스트 (Lines 475-501)

**메모 생성 후:**
```javascript
await window.electron.broadcastMemoCreated(newMemo);
// → 모든 창(Dashboard, Sticky 등)에 memo-created 이벤트 전송
```

**메모 삭제 후:**
```javascript
await window.electron.broadcastMemoDeleted(memoId);
// → 모든 창에 memo-deleted 이벤트 전송
```

---

### 4. IPC API (electron/preload.js)

#### 노출된 API (Lines 4-99)

**Sticky Window 제어:**
```javascript
window.electron.openStickyWindow(type, title, data, reset)
window.electron.closeStickyWindow(type)
window.electron.isStickyWindowOpen(type)
window.electron.resizeStickyWindow(width, height)
window.electron.setWindowOpacity(opacity)
```

**Memo 작업:**
```javascript
window.electron.openMemoSubWindow(mode, memoId)  // 'create' | 'view'
window.electron.broadcastMemoCreated(memoData)
window.electron.broadcastMemoDeleted(memoId)
```

**네비게이션:**
```javascript
window.electron.focusMainWindow(route)  // 메인 창 포커스 + 라우팅
window.electron.openExternal(url)       // 외부 브라우저에서 URL 열기
```

**이벤트 리스너:**
```javascript
window.electron.onMemoCreated(callback)
window.electron.onMemoDeleted(callback)
window.electron.onConsultationUpdated(callback)
window.electron.onNavigateToRoute(callback)

// 모든 리스너는 cleanup 함수 반환
const cleanup = window.electron.onMemoCreated(handler);
cleanup();  // 리스너 제거
```

---

### 5. Dashboard 통합 (src/components/Dashboard.jsx)

#### 자동 오픈 (Lines 558-589)

```javascript
useEffect(() => {
  if (user && !memosLoading && !schedulesLoading) {
    const openStickyOnLogin = async () => {
      // 이미 열려있는지 확인
      const isOpen = await window.electron.isStickyWindowOpen('dashboard');
      if (isOpen) return;

      // 캐시 데이터 준비 (즉시 렌더링용)
      const cachedData = {
        memos,
        schedules,
        stats: {
          email: consultations.filter(c => !c.check && c.type === 'email').length,
          website: consultations.filter(c => !c.check && c.type === 'website').length
        }
      };

      // Sticky 창 열기
      await window.electron.openStickyWindow('dashboard', '알림창', cachedData, false);
    };

    openStickyOnLogin();
  }
}, [user, memosLoading, schedulesLoading, memos, schedules, consultations]);
```

#### WebSocket 리스너 (Lines 489-492)

```javascript
socket.on('memo:deleted', (data) => {
  console.log('[Dashboard] Memo deleted event received:', data.id);
  // WebSocket이 자동으로 새로고침하므로 loadMemos() 호출 불필요
  // 중복 호출 방지됨
});
```

**중요 수정 사항:**
- 이전: `handleMemoDelete` 함수에서 `loadMemos()` 직접 호출
- 문제: WebSocket 이벤트와 중복 호출로 race condition 발생 → 404 오류
- 해결: WebSocket 이벤트만 사용, 직접 호출 제거 (Line 252 주석 처리)

---

## 데이터 흐름

### 메모 생성 플로우

```
사용자가 Sticky Window에서 [+ 추가] 클릭
    ↓
IPC: openMemoSubWindow('create')
    ↓
electron/main.js: memo-detail.html 서브 윈도우 생성
    ↓
사용자가 폼 작성 후 저장
    ↓
POST /memos (API 요청)
    ↓
백엔드: PostgreSQL INSERT
    ↓
백엔드: WebSocket broadcast 'memo:created'
    ↓
    ├─ Sticky Window: loadMemos() → 메모 목록 갱신
    ├─ Dashboard: WebSocket 리스너 → 메모 목록 갱신
    └─ 다른 Sticky Windows: loadMemos() → 메모 목록 갱신
    ↓
IPC: broadcastMemoCreated(newMemo)
    ↓
    ├─ 모든 창에 memo-created 이벤트 전송
    └─ 각 창이 자신의 리스너로 UI 업데이트
    ↓
서브 윈도우 닫힘
```

### 메모 삭제 플로우

```
사용자가 메모 상세보기에서 [삭제] 클릭
    ↓
DELETE /memos/:id (API 요청)
    ↓
백엔드: Soft delete (deleted_at = NOW())
    ↓
백엔드: WebSocket broadcast 'memo:deleted'
    ↓
    ├─ Sticky Window: loadMemos() → 메모 목록 갱신
    ├─ Dashboard: WebSocket 리스너 (직접 loadMemos 호출 없음)
    └─ 다른 Sticky Windows: loadMemos() → 메모 목록 갱신
    ↓
IPC: broadcastMemoDeleted(memoId)
    ↓
    ├─ 모든 창에 memo-deleted 이벤트 전송
    └─ 각 창이 로컬 state에서 해당 메모 제거
    ↓
서브 윈도우 닫힘
```

### 상담 생성 플로우

```
ZOHO Webhook or 수동 생성
    ↓
POST /inquiries (백엔드)
    ↓
WebSocket broadcast 'consultation:created'
    ↓
    ├─ Dashboard: useWebSocketSync → React Query 캐시 업데이트
    ├─ Sticky Window: loadConsultationStats() → 통계 갱신
    └─ Toast Notification 표시
```

---

## WebSocket 실시간 동기화

### Relay Server 아키텍처

```
Client (Dashboard/Sticky)
    ↓
WebSocket: ws://136.113.67.193:8080
    ↓
Relay Server (Socket.IO)
    ↓
Backend API: http://localhost:3001
    ↓
PostgreSQL Database
```

**역할 분리:**
- **Relay Server**: WebSocket 중계, 클라이언트 간 이벤트 브로드캐스트
- **Backend API**: 비즈니스 로직, 데이터베이스 접근

### 핸드쉐이크 프로토콜

**클라이언트 → 서버:**
```javascript
socket.emit('handshake', {
  type: 'client',
  metadata: {
    email: user.email,
    provider: user.provider,
    displayName: user.displayName,
    connectedAt: new Date().toISOString()
  }
});
```

**서버 → 클라이언트:**
```javascript
socket.on('handshake:success', (data) => {
  console.log('Handshake successful:', data);
});
```

### 재연결 처리

```javascript
socket.on('connect', async () => {
  console.log('[Sticky] Reconnected to WebSocket');

  // 재연결 시 모든 데이터 새로고침
  await Promise.all([
    loadMemos(),
    loadConsultationStats(),
    loadSchedules()
  ]);
});
```

**설정:**
- 재연결 시도: 최대 10회
- 재연결 간격: 1초
- 타임아웃: 10초

---

## 자동 크기 조정

### 크기 계산 알고리즘

```javascript
1. 모든 섹션 렌더링 완료 대기
2. .sticky-container의 scrollHeight 측정
3. totalHeight = scrollHeight + 40px (타이틀바)
4. IPC: resizeStickyWindow(300, totalHeight)
5. 크기 조정 완료 후 show: true
```

### 호출 시점

```javascript
// 초기 로드
await loadAllData();
adjustWindowHeight();

// 메모 렌더링 완료
function renderMemos() {
  // ... render logic
  adjustWindowHeight();
}

// 일정 렌더링 완료
function renderSchedules() {
  // ... render logic
  adjustWindowHeight();
}

// 상담 통계 업데이트
function updateConsultationStats() {
  // ... update logic
  adjustWindowHeight();
}
```

### 최소/최대 높이

- **최소**: 타이틀바(40px) + 접힌 섹션들
- **최대**: 없음 (컨텐츠에 따라 무제한 확장)
- **너비**: 고정 300px

---

## 문제 해결 가이드

### 메모 저장 실패

**증상:**
- "메모 저장에 실패했습니다" 알림
- 메모가 DB에 저장되지 않음

**원인 및 해결:**

1. **제목이 필수로 설정됨**
   - 해결: `memo-detail.html` Line 456-459에서 자동 제목 생성 로직 확인
   - 내용 20자 이하는 전체, 20자 초과는 앞 20자 + '...'

2. **API 연결 오류**
   - 확인: `API_BASE_URL = http://136.113.67.193:8080/proxy`
   - 백엔드 상태 확인: Docker Compose 실행 중인지

3. **인증 토큰 만료**
   - 해결: 로그아웃 후 재로그인

### WebSocket 연결 실패

**증상:**
- Console: "Connection error: Invalid namespace"
- 실시간 업데이트 동작 안 함

**원인 및 해결:**

1. **잘못된 URL 사용**
   - ❌ 잘못: `io('http://136.113.67.193:8080/proxy')`
   - ✅ 올바름: `io('ws://136.113.67.193:8080')`
   - Sticky에서는 `WEBSOCKET_URL` 사용 필수

2. **핸드쉐이크 누락**
   - 확인: `socket.on('connect')` 내부에 `socket.emit('handshake')` 있는지
   - 메인 앱과 동일한 핸드쉐이크 로직 사용

### 메모 삭제 시 404 오류

**증상:**
- 메모는 삭제되지만 Console에 404 오류
- "메모 삭제에 실패했습니다" 알림 (실제로는 성공)

**원인:**
- `handleMemoDelete`에서 `loadMemos()` 직접 호출
- WebSocket 이벤트에서도 `loadMemos()` 호출
- Race condition으로 이미 삭제된 메모 조회 → 404

**해결:**
```javascript
// Dashboard.jsx Line 252
// WebSocket 이벤트가 자동으로 메모 목록을 새로고침하므로 loadMemos() 호출 불필요
// await loadMemos(); // 제거됨
```

### Sticky Window 크기 고장

**증상:**
- 컨텐츠가 잘림
- 창이 너무 크거나 작음
- 빈 공간이 많음

**원인:**
- `adjustWindowHeight()` 호출 누락
- 렌더링 완료 전 크기 계산

**해결:**
```javascript
// 각 렌더 함수 마지막에 추가
function renderMemos() {
  // ... render logic
  adjustWindowHeight();  // ✅ 추가
}

function renderSchedules() {
  // ... render logic
  adjustWindowHeight();  // ✅ 추가
}

function updateConsultationStats() {
  // ... update logic
  adjustWindowHeight();  // ✅ 추가
}
```

### 투명도 설정 저장 안 됨

**증상:**
- 투명도 조절해도 재시작 시 리셋됨

**원인:**
- 설정 파일 저장 실패
- `saveStickySettings()` 호출 안 됨

**해결:**
```javascript
// sticky.html에서 투명도 변경 시
const newOpacity = parseFloat(e.target.value);
await window.electron.setWindowOpacity(newOpacity);
// IPC 핸들러가 자동으로 settings 저장
```

---

## 개발 팁

### DevTools 활성화

**개발 모드에서 자동 열림:**
```javascript
// electron/main.js Line 187
stickyWindow.webContents.openDevTools({ mode: 'detach' });
```

**프로덕션에서 활성화:**
```javascript
// 임시로 주석 해제
// if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
stickyWindow.webContents.openDevTools({ mode: 'detach' });
// }
```

### 로그 확인

**Sticky Window 로그:**
```javascript
console.log('[Sticky] ...'); // sticky.html에서
```

**Main Process 로그:**
```javascript
console.log('[Main] ...'); // electron/main.js에서
// 터미널에 출력됨
```

**IPC 통신 로그:**
```javascript
// preload.js에서 각 IPC 호출 전후로 로그 추가
console.log('[IPC] Calling openStickyWindow with:', args);
```

### 테스트 시나리오

1. **기본 플로우**
   - 로그인 → Sticky 자동 오픈 → 데이터 표시 확인

2. **메모 생성**
   - [+ 추가] → 내용만 입력 → 저장 → 제목 자동 생성 확인
   - 모든 창에서 메모 표시되는지 확인

3. **메모 삭제**
   - 메모 클릭 → 상세보기 → [삭제] → 모든 창에서 사라지는지 확인
   - Console에 404 오류 없는지 확인

4. **창 크기 조정**
   - 메모 여러 개 추가/삭제 → 창 높이 자동 조정 확인
   - 섹션 접기/펴기 → 높이 변화 확인

5. **재연결**
   - 백엔드 중지 → Sticky에서 연결 끊김 확인
   - 백엔드 재시작 → 자동 재연결 + 데이터 새로고침 확인

6. **다중 창**
   - Sticky 창 2개 열기 (다른 type으로)
   - 한 창에서 메모 생성 → 다른 창에도 즉시 반영되는지 확인

---

## 파일 참조

| 파일 | 역할 | 주요 라인 |
|------|------|----------|
| `electron/main.js` | Electron 메인 프로세스, 창 관리 | 120-470 |
| `electron/preload.js` | IPC API 노출 | 4-99 |
| `public/sticky.html` | Sticky 알림 창 UI/로직 | 1-1542 |
| `public/memo-detail.html` | 메모 상세/추가 서브 윈도우 | 1-532 |
| `src/components/Dashboard.jsx` | Sticky 창 트리거, WebSocket 동기화 | 558-589, 489-492 |
| `src/hooks/useWebSocketSync.js` | WebSocket 이벤트 통합 관리 | 1-289 |
| `src/services/websocketService.js` | WebSocket 연결 관리 | 1-110 |

---

## 버전 히스토리

### 2025-01-XX
- ✅ WebSocket URL 분리 (HTTP API vs WebSocket)
- ✅ 메모 제목 자동 생성 로직 수정 (20자 이하는 ... 없음)
- ✅ 메모 삭제 시 중복 loadMemos() 호출 제거 (404 오류 해결)
- ✅ Sticky 창 자동 크기 조정 개선 (모든 렌더 함수에 추가)
- ✅ DevTools 자동 열기 활성화

### 이전 버전
- Sticky Window 시스템 초기 구현
- 서브 윈도우 방식으로 메모 모달 대체
- 캐시 우선 렌더링 전략 도입
- 설정 영구 저장 기능 추가

---

**문서 버전:** 1.0
**작성일:** 2025-01-XX
**작성자:** Claude Code Analysis
