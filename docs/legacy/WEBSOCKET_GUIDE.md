# WebSocket 실시간 동기화 구현 가이드

## 개요
Socket.IO를 사용한 다중 사용자 실시간 데이터 동기화 시스템. Firestore와 PostgreSQL 데이터 변경 시 모든 연결된 클라이언트에 즉시 반영됩니다.

## 아키텍처

### 데이터 소스별 처리 방식
| 데이터 | 저장소 | 감지 방법 | 브로드캐스트 시점 |
|--------|--------|---------|-----------------|
| 상담(Inquiries) | Firestore | Firestore listener | 웹폼 제출/수정/삭제 시 자동 |
| 메모(Memos) | PostgreSQL | API 엔드포인트 | CRUD API 호출 직후 |
| 일정(Schedules) | PostgreSQL | API 엔드포인트 | CRUD API 호출 직후 |

**핵심 원칙**:
- Firestore는 listener가 모든 변경을 감지하므로 API에서 별도 broadcast 불필요
- PostgreSQL은 API 엔드포인트에서 직접 `global.broadcastEvent()` 호출

---

## 백엔드 구현

### 1. Socket.IO 서버 초기화
**위치**: `backend-local/server.js`

```javascript
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: corsOptions
});

// 마지막에 app.listen 대신 server.listen 사용
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ WebSocket (Socket.IO) ready on port ${PORT}`);
});
```

### 2. WebSocket 인증 미들웨어
JWT 토큰 및 OAuth 토큰 검증 후 화이트리스트 이메일 확인:

```javascript
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const provider = socket.handshake.auth.provider;

    if (!token) {
      return next(new Error('Authentication token required'));
    }

    let user;
    if (provider === 'local') {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      user = { email: decoded.email, provider: 'local' };
    } else {
      // Google/Naver OAuth 검증
      const decoded = await auth.verifyIdToken(token, provider);
      user = { email: decoded.email, provider };
    }

    // 화이트리스트 검증
    const allowedEmails = (process.env.ALLOWED_EMAILS || "").split(",").map(e => e.trim());
    if (!allowedEmails.includes(user.email)) {
      return next(new Error('Unauthorized email'));
    }

    socket.user = user;
    next();
  } catch (error) {
    console.error('[WebSocket] Authentication failed:', error.message);
    next(new Error('Authentication failed'));
  }
});

io.on('connection', (socket) => {
  console.log(`[WebSocket] User connected: ${socket.user.email}`);

  socket.on('disconnect', () => {
    console.log(`[WebSocket] User disconnected: ${socket.user.email}`);
  });
});
```

### 3. Firestore 실시간 리스너 (중요!)
**위치**: `server.listen()` 직전

```javascript
const db = admin.firestore();
let firestoreInitialized = false;  // 초기 로드 중복 방지

db.collection('inquiries').onSnapshot(snapshot => {
  // 첫 스냅샷 무시 (서버 시작 시 기존 문서 이벤트 방지)
  if (!firestoreInitialized) {
    firestoreInitialized = true;
    console.log('[Firestore] Initial snapshot loaded, skipping existing documents');
    return;
  }

  snapshot.docChanges().forEach(change => {
    const inquiryData = { id: change.doc.id, ...change.doc.data() };

    switch (change.type) {
      case 'added':
        // 웹 폼에서 신규 상담 제출
        console.log(`[Firestore] New inquiry created: ${change.doc.id}`);
        if (global.broadcastEvent) {
          global.broadcastEvent('consultation:created', inquiryData);
        }
        break;

      case 'modified':
        // 관리자가 확인 처리 (check: true)
        console.log(`[Firestore] Inquiry modified: ${change.doc.id}`);
        if (global.broadcastEvent) {
          global.broadcastEvent('consultation:updated', {
            id: change.doc.id,
            updates: inquiryData
          });
        }
        break;

      case 'removed':
        // 관리자가 상담 삭제
        console.log(`[Firestore] Inquiry removed: ${change.doc.id}`);
        if (global.broadcastEvent) {
          global.broadcastEvent('consultation:deleted', { id: change.doc.id });
        }
        break;
    }
  });
}, error => {
  console.error('[Firestore] Snapshot listener error:', error);
});

console.log('[Firestore] Real-time listener registered for inquiries collection');
```

**왜 `firestoreInitialized` 플래그가 필요한가?**
- 서버 시작 시 Firestore `onSnapshot`은 기존 모든 문서를 `added` 이벤트로 발동
- 이를 무시하지 않으면 서버 재시작마다 수백 개의 중복 알림 발생

### 4. PostgreSQL CRUD에 broadcast 추가
메모와 일정은 API 엔드포인트에서 직접 broadcast:

```javascript
// 메모 생성
app.post("/memos", auth.authenticateJWT, async (req, res) => {
  // INSERT 쿼리...
  const memoWithAuthor = await db_postgres.query(selectQuery, [result.rows[0].id]);

  if (global.broadcastEvent) {
    global.broadcastEvent('memo:created', memoWithAuthor.rows[0]);
  }

  res.json({ status: "ok", data: memoWithAuthor.rows[0] });
});

// 메모 삭제
app.delete("/memos/:id", auth.authenticateJWT, async (req, res) => {
  // DELETE 쿼리...

  if (global.broadcastEvent) {
    global.broadcastEvent('memo:deleted', { id: parseInt(id) });
  }

  res.json({ status: "ok" });
});

// 일정 생성/수정/삭제도 동일 패턴
```

### 5. 전역 broadcast 함수
```javascript
global.broadcastEvent = (eventType, data) => {
  io.emit(eventType, data);
  console.log(`[WebSocket] Broadcasted event: ${eventType}`);
};
```

---

## 프론트엔드 구현

### 1. WebSocket 클라이언트 모듈
**위치**: `src/services/websocketService.js`

```javascript
import { io } from 'socket.io-client';
import { API_URL } from '../config/api.js';
import { getCurrentUser } from '../auth/authManager.js';

let socket = null;

export function connectWebSocket() {
  const user = getCurrentUser();

  if (!user) {
    console.warn('[WebSocket] No user found, cannot connect');
    return null;
  }

  if (socket?.connected) {
    console.log('[WebSocket] Already connected');
    return socket;
  }

  console.log('[WebSocket] Connecting to', API_URL);

  socket = io(API_URL, {
    auth: {
      token: user.idToken,
      provider: user.provider
    },
    reconnectionDelay: 1000,
    reconnection: true,
    reconnectionAttempts: 10,
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log('[WebSocket] Connected to server');
  });

  socket.on('disconnect', (reason) => {
    console.log('[WebSocket] Disconnected from server:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('[WebSocket] Connection error:', error.message);
  });

  return socket;
}

export function disconnectWebSocket() {
  if (socket) {
    console.log('[WebSocket] Disconnecting...');
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}

export function refreshSocketAuth(newToken, newProvider) {
  if (socket && socket.connected) {
    console.log('[WebSocket] Refreshing authentication...');
    socket.disconnect();

    socket = io(API_URL, {
      auth: { token: newToken, provider: newProvider },
      reconnectionDelay: 1000,
      reconnection: true,
      reconnectionAttempts: 10
    });

    console.log('[WebSocket] Reconnected with new token');
  }
}
```

### 2. React 컴포넌트에서 이벤트 리스너

#### AppRouter.jsx - 상담 데이터
```javascript
import { connectWebSocket, disconnectWebSocket } from './services/websocketService';

useEffect(() => {
  if (!user) {
    disconnectWebSocket();
    return;
  }

  const socket = connectWebSocket();
  if (!socket) return;

  // 신규 상담 생성
  socket.on('consultation:created', (newConsultation) => {
    console.log('[WebSocket] New consultation received:', newConsultation);
    setConsultations(prev => [newConsultation, ...prev]);
    loadStats();
    showToastNotification('consultation', `신규 문의: ${newConsultation.name}님`);
  });

  // 상담 업데이트 (확인 처리)
  socket.on('consultation:updated', (data) => {
    console.log('[WebSocket] Consultation updated:', data);

    setConsultations(prev => {
      const existing = prev.find(c => c.id === data.id);
      // 중복 상태 업데이트 방지
      if (existing && existing.check === data.updates.check) {
        return prev;
      }
      return prev.map(c => c.id === data.id ? { ...c, ...data.updates } : c);
    });

    loadStats();

    if (data.updates.check === true) {
      showToastNotification('consultation', `${data.updates.name}님 문의가 확인되었습니다.`);
    }
  });

  // 상담 삭제
  socket.on('consultation:deleted', (data) => {
    console.log('[WebSocket] Consultation deleted:', data.id);
    setConsultations(prev => prev.filter(c => c.id !== data.id));
    loadStats();
  });

  // 재연결 시 데이터 동기화
  socket.on('connect', async () => {
    console.log('[WebSocket] Connected, reloading data...');
    try {
      const data = await fetchInquiries(auth);
      setConsultations(data);
      await loadStats();
    } catch (error) {
      console.error('[WebSocket] Failed to reload data on reconnect:', error);
    }
  });

  return () => {
    socket.off('consultation:created');
    socket.off('consultation:updated');
    socket.off('consultation:deleted');
    socket.off('connect');
  };
}, [user]);
```

#### Dashboard.jsx - 메모/일정 데이터
```javascript
import { getSocket } from '../services/websocketService';

useEffect(() => {
  if (!user) return;

  const socket = getSocket();
  if (!socket) return;

  socket.on('memo:created', (newMemo) => {
    console.log('[WebSocket] Memo created:', newMemo);
    loadMemos();
    showToastNotification('memo', `${newMemo.author_name || '사용자'}님이 메모를 등록했습니다.`);
  });

  socket.on('memo:deleted', (data) => {
    console.log('[WebSocket] Memo deleted:', data.id);
    loadMemos();
  });

  socket.on('schedule:created', (newSchedule) => {
    console.log('[WebSocket] Schedule created:', newSchedule);
    loadSchedules();

    const isPersonal = newSchedule.type === 'personal';
    const timeDisplay = newSchedule.time || '시간 미정';
    showToastNotification(
      isPersonal ? 'personalSchedule' : 'teamSchedule',
      `${timeDisplay} ${newSchedule.title} 일정이 등록되었습니다.`
    );
  });

  socket.on('schedule:updated', (data) => {
    console.log('[WebSocket] Schedule updated:', data);
    loadSchedules();
  });

  socket.on('schedule:deleted', (data) => {
    console.log('[WebSocket] Schedule deleted:', data.id);
    loadSchedules();
  });

  return () => {
    socket.off('memo:created');
    socket.off('memo:deleted');
    socket.off('schedule:created');
    socket.off('schedule:updated');
    socket.off('schedule:deleted');
  };
}, [user]);
```

### 3. Sticky 창 (HTML + CDN)
**위치**: `public/sticky.html`

```html
<!-- Socket.IO CDN -->
<script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>

<script>
  const API_BASE_URL = 'http://localhost:3001';
  let socket = null;

  function connectWebSocket() {
    const userStr = localStorage.getItem('currentUser');
    if (!userStr) return null;

    const user = JSON.parse(userStr);

    socket = io(API_BASE_URL, {
      auth: {
        token: user.idToken,
        provider: user.provider
      },
      reconnection: true,
      reconnectionAttempts: 10
    });

    socket.on('connect', () => {
      console.log('[Sticky WebSocket] Connected to server');
    });

    socket.on('consultation:created', () => {
      console.log('[Sticky WebSocket] New consultation created');
      loadConsultationStats();
    });

    socket.on('memo:created', () => {
      console.log('[Sticky WebSocket] Memo created');
      loadMemos();
    });

    socket.on('schedule:created', () => {
      console.log('[Sticky WebSocket] Schedule created');
      loadSchedules();
    });

    // 기타 이벤트 리스너...

    return socket;
  }

  // DOMContentLoaded에서 호출
  document.addEventListener('DOMContentLoaded', async () => {
    // 데이터 로드...
    connectWebSocket();
  });
</script>
```

---

## 이벤트 타입 정리

| 이벤트 | 데이터 형식 | 발생 시점 |
|--------|-----------|---------|
| `consultation:created` | `{ id, name, phone, content, createdAt, ... }` | 웹폼 제출 시 |
| `consultation:updated` | `{ id, updates: { check, name, ... } }` | 확인 처리 시 |
| `consultation:deleted` | `{ id }` | 삭제 시 |
| `memo:created` | `{ id, title, content, author_name, ... }` | 생성 시 |
| `memo:deleted` | `{ id }` | 삭제 시 |
| `schedule:created` | `{ id, title, time, type, ... }` | 생성 시 |
| `schedule:updated` | `{ id, ... }` | 수정 시 |
| `schedule:deleted` | `{ id }` | 삭제 시 |

---

## 핵심 포인트

### 1. Firestore 초기 로드 중복 방지 ⚠️
```javascript
let firestoreInitialized = false;

db.collection('inquiries').onSnapshot(snapshot => {
  if (!firestoreInitialized) {
    firestoreInitialized = true;
    return;  // 첫 스냅샷 무시
  }
  // 이벤트 처리...
});
```

### 2. React cleanup 필수 (메모리 누수 방지)
```javascript
useEffect(() => {
  socket.on('event', handler);

  return () => {
    socket.off('event');  // 필수!
  };
}, []);
```

### 3. 재연결 시 데이터 동기화
네트워크 단절 중 놓친 변경사항 복구:

```javascript
socket.on('connect', async () => {
  await Promise.all([
    loadMemos(),
    loadConsultations(),
    loadSchedules()
  ]);
});
```

### 4. 중복 상태 업데이트 방지
동시 수정 시 불필요한 리렌더링 방지:

```javascript
socket.on('consultation:updated', (data) => {
  setConsultations(prev => {
    const existing = prev.find(c => c.id === data.id);
    if (existing && existing.check === data.updates.check) {
      return prev;  // 변경 없으면 스킵
    }
    return prev.map(c => c.id === data.id ? { ...c, ...data.updates } : c);
  });
});
```

---

## 설치 및 실행

### 백엔드
```bash
cd backend-local
npm install socket.io
docker-compose down
docker-compose up --build -d
```

### 프론트엔드
```bash
npm install socket.io-client
npm run electron:dev
```

---

## 테스트 체크리스트

- [ ] **단일 사용자**: 메모 생성 → Dashboard와 Sticky 창에 즉시 표시
- [ ] **다중 창**: 2개 Electron 창에서 한쪽 메모 생성 → 다른 쪽 자동 표시
- [ ] **재연결**: Docker 백엔드 재시작 → 클라이언트 자동 재연결 및 데이터 리로드
- [ ] **상담 확인**: 한 창에서 확인 처리 → 모든 창에서 통계 카운터 감소
- [ ] **일정 추가**: 일정 생성 → Dashboard 캘린더 즉시 업데이트

---

## 트러블슈팅

### WebSocket 연결 실패
**증상**: `[WebSocket] Connection error` 콘솔 로그

**해결**:
1. Docker 컨테이너 재빌드: `docker-compose up --build -d`
2. 포트 3001 확인: 백엔드와 동일 포트 사용
3. 백엔드 로그 확인: `docker logs backend-local`

### 이벤트 수신 안됨
**증상**: 데이터 변경 시 다른 창에서 업데이트 안됨

**해결**:
1. React cleanup 확인: `socket.off()` 누락 여부
2. Firestore listener `firestoreInitialized` 플래그 확인
3. 브라우저 콘솔에서 `[WebSocket]` 로그 확인

### 중복 이벤트 발생
**증상**: 한 번 변경했는데 여러 번 업데이트됨

**해결**:
1. Firestore: API 엔드포인트에서 broadcast 제거 (listener만 사용)
2. React: useEffect dependency array 확인
3. 중복 체크 로직 추가 (위 "중복 상태 업데이트 방지" 참조)

### 서버 재시작 시 중복 알림
**증상**: Docker 재시작 시 수백 개의 알림 발생

**해결**:
- `firestoreInitialized` 플래그가 제대로 동작하는지 확인
- 서버 로그에서 `[Firestore] Initial snapshot loaded, skipping` 확인

---

## 주요 파일 위치

### 백엔드
- `backend-local/server.js` - WebSocket 서버, Firestore listener
- `backend-local/package.json` - socket.io 의존성

### 프론트엔드
- `src/services/websocketService.js` - WebSocket 클라이언트 모듈
- `src/AppRouter.jsx` - 상담 이벤트 리스너
- `src/components/Dashboard.jsx` - 메모/일정 이벤트 리스너
- `public/sticky.html` - Sticky 창 WebSocket 클라이언트
- `package.json` - socket.io-client 의존성

---

## 추가 참고사항

### 토큰 갱신 처리
JWT 토큰 1시간 만료 시 자동 갱신:

```javascript
// api.js에서 401 에러 시
const refreshedUser = await restoreSession();
if (refreshedUser) {
  refreshSocketAuth(refreshedUser.idToken, refreshedUser.provider);
}
```

### IPC vs WebSocket
- **IPC (Electron)**: 같은 PC 내 창 간 통신 (메인 프로세스 ↔ 렌더러 프로세스)
- **WebSocket**: 다른 PC 간 실시간 통신

두 가지 모두 유지하여 같은 PC 내에서는 즉시 반응, 다른 PC 간에도 실시간 동기화 보장
