# Firebase/GCP Firestore 설정 가이드

APS 컨설팅 상담 관리 시스템의 Firebase 설정 방법입니다.

## 1. Firebase 프로젝트 생성

### 1-1. Firebase Console 접속
1. https://console.firebase.google.com/ 접속
2. Google 계정으로 로그인
3. **"프로젝트 추가"** 클릭

### 1-2. 프로젝트 정보 입력
1. **프로젝트 이름**: `aps-consulting` (원하는 이름)
2. Google 애널리틱스: 선택 사항 (필요 없으면 비활성화)
3. **프로젝트 만들기** 클릭

---

## 2. Firestore 데이터베이스 생성

### 2-1. Firestore 활성화
1. 왼쪽 메뉴 **"Firestore Database"** 클릭
2. **"데이터베이스 만들기"** 클릭

### 2-2. 보안 규칙 선택
**테스트 모드로 시작** 선택 (나중에 변경 가능)
- 이 모드는 30일간 읽기/쓰기 가능

### 2-3. 위치 선택
**asia-northeast3 (Seoul)** 선택 후 **"사용 설정"**

### 2-4. 컬렉션 생성
1. **"컬렉션 시작"** 클릭
2. **컬렉션 ID**: `consultations` (정확히 입력!)
3. 첫 문서 추가 (테스트용):
   - **문서 ID**: 자동 ID
   - 필드 추가:
     ```
     name: "홍길동" (string)
     phone: "010-1234-5678" (string)
     email: "test@example.com" (string)
     type: "비자" (string)
     message: "테스트 상담입니다." (string)
     createdAt: 현재 타임스탬프 (timestamp)
     responded: false (boolean)
     number: 1 (number)
     ```
4. **저장** 클릭

---

## 3. Google 로그인 설정

### 3-1. Authentication 활성화
1. 왼쪽 메뉴 **"Authentication"** 클릭
2. **"시작하기"** 클릭

### 3-2. Google 로그인 활성화
1. **"Sign-in method"** 탭 클릭
2. **"Google"** 클릭
3. **사용 설정** 토글 ON
4. **프로젝트 지원 이메일** 선택 (본인 이메일)
5. **저장** 클릭

---

## 4. 웹 앱 등록 및 설정 정보 가져오기

### 4-1. 웹 앱 추가
1. 프로젝트 개요 페이지로 이동 (왼쪽 상단 톱니바퀴 옆)
2. **"웹 앱에 Firebase 추가"** 클릭 (</> 아이콘)

### 4-2. 앱 정보 입력
1. **앱 닉네임**: `APS 상담관리` (원하는 이름)
2. Firebase Hosting: 체크 안 함
3. **앱 등록** 클릭

### 4-3. 설정 정보 복사
다음과 같은 코드가 나타납니다:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "aps-consulting-xxxxx.firebaseapp.com",
  projectId: "aps-consulting-xxxxx",
  storageBucket: "aps-consulting-xxxxx.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdefghijklmnop"
};
```

**이 정보를 복사해두세요!**

---

## 5. 프로젝트에 설정 정보 입력

### 5-1. config.js 파일 수정
`src/firebase/config.js` 파일을 열고 다음과 같이 수정:

```javascript
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Firebase 설정 - 위에서 복사한 정보를 붙여넣기
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",           // ← 여기
  authDomain: "aps-consulting-xxxxx.firebaseapp.com",      // ← 여기
  projectId: "aps-consulting-xxxxx",                       // ← 여기
  storageBucket: "aps-consulting-xxxxx.appspot.com",       // ← 여기
  messagingSenderId: "123456789012",                       // ← 여기
  appId: "1:123456789012:web:abcdefghijklmnop"            // ← 여기
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);

// Firestore 인스턴스 생성
export const db = getFirestore(app);

// Auth 인스턴스 생성
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
```

### 5-2. 저장 후 테스트
파일 저장 후 브라우저에서 http://localhost:5174 접속

---

## 6. Firestore 보안 규칙 설정 (선택 사항)

### 6-1. 읽기 전용 규칙 (권장)
Firestore Database > **규칙** 탭에서 다음과 같이 수정:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 로그인한 사용자만 읽기 가능, 쓰기는 불가
    match /consultations/{document=**} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

**게시** 클릭

### 6-2. 읽기/쓰기 모두 허용 (개발/테스트용)
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /consultations/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## 7. 승인된 도메인 추가 (배포 시)

### 로컬 개발
- 기본적으로 `localhost`는 이미 승인되어 있음

### 배포 후 (Firebase Hosting, Vercel 등)
1. Authentication > **Settings** > **승인된 도메인**
2. **도메인 추가** 클릭
3. 배포된 도메인 입력 (예: `your-app.vercel.app`)
4. **추가** 클릭

---

## 8. 로그인 가능한 계정 제한 (선택 사항)

### 특정 이메일만 허용하려면:

#### 방법 1: Firebase Console에서 수동 추가
1. Authentication > **Users** 탭
2. 허용할 Google 계정으로 한 번 로그인
3. 코드에서 이메일 체크 추가

#### 방법 2: 코드에서 이메일 화이트리스트
`src/components/LoginPage.jsx` 수정:

```javascript
const ALLOWED_EMAILS = [
  'admin@aps-consulting.com',
  'manager@aps-consulting.com',
  'staff@aps-consulting.com'
];

const handleGoogleLogin = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);

    // 이메일 체크
    if (!ALLOWED_EMAILS.includes(result.user.email)) {
      await signOut(auth);
      alert('접근 권한이 없는 계정입니다.');
      return;
    }

    console.log('로그인 성공:', result.user);
    onLoginSuccess(result.user);
  } catch (error) {
    console.error('로그인 실패:', error);
    alert('로그인에 실패했습니다.');
  }
};
```

---

## 9. 환경 변수 사용 (프로덕션 권장)

### 9-1. .env 파일 생성
프로젝트 루트에 `.env` 파일 생성:

```
VITE_FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_FIREBASE_AUTH_DOMAIN=aps-consulting-xxxxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=aps-consulting-xxxxx
VITE_FIREBASE_STORAGE_BUCKET=aps-consulting-xxxxx.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdefghijklmnop
```

### 9-2. config.js 수정
```javascript
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
```

### 9-3. .gitignore에 추가
```
.env
.env.local
```

---

## 문제 해결

### 로그인 시 "unauthorized_client" 오류
- Authentication > Settings > 승인된 도메인에 현재 도메인 추가

### Firestore 데이터가 안 보임
- Firestore 규칙에서 `allow read: if request.auth != null;` 확인
- 컬렉션 이름이 정확히 `consultations`인지 확인

### "Firebase: Error (auth/configuration-not-found)" 오류
- config.js의 모든 값이 올바르게 입력되었는지 확인
- Firebase Console에서 웹 앱이 제대로 등록되었는지 확인

---

## 요약 체크리스트

- [ ] Firebase 프로젝트 생성
- [ ] Firestore 데이터베이스 생성 (asia-northeast3)
- [ ] `consultations` 컬렉션 생성
- [ ] Authentication에서 Google 로그인 활성화
- [ ] 웹 앱 등록 및 설정 정보 복사
- [ ] `src/firebase/config.js`에 설정 정보 입력
- [ ] 브라우저에서 로그인 테스트
- [ ] Firestore 보안 규칙 설정
- [ ] (선택) 환경 변수로 설정 정보 이동

완료!
