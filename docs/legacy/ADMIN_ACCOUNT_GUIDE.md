# 관리자 계정 추가 가이드

APS Admin 앱에 새로운 관리자 계정을 추가하는 방법입니다.

## 빠른 시작

```bash
# 백엔드 폴더로 이동
cd backend-local

# 관리자 계정 생성
node create-admin.js <이메일> <비밀번호> [이름] [role]
```

## 사용 예시

### 1. 관리자 계정 생성

```bash
node create-admin.js admin@test.com TestPass123 "관리자" admin
```

### 2. 일반 사용자 생성

```bash
node create-admin.js user@test.com UserPass123 "사용자" user
```

### 3. 이름 생략 (이메일이 이름으로 사용됨)

```bash
node create-admin.js test@test.com Pass12345678
```

## 파라미터 설명

| 파라미터 | 필수 | 설명 | 기본값 |
|---------|------|------|--------|
| 이메일 | ✅ | 로그인할 이메일 주소 | - |
| 비밀번호 | ✅ | 8자 이상의 비밀번호 | - |
| 이름 | ❌ | 앱에 표시될 이름 | 이메일과 동일 |
| role | ❌ | `admin` 또는 `user` | `admin` |

## 성공 시 출력 예시

```
✓ Firebase Admin initialized

[Create Admin] Creating admin user: admin@test.com
[Create Admin] Creating Firestore document...
[FirestoreAdmin] Created admin: admin@test.com (role: admin)

✅ Admin user created successfully in Firestore!
---------------------------------------------------
Email:        admin@test.com
Display Name: 관리자
Role:         admin
Active:       true
Provider:     local
---------------------------------------------------

You can now login with these credentials.
```

## 로그인 방법

1. Electron 앱 실행
2. 로그인 페이지에서 생성한 이메일/비밀번호 입력
3. 로그인 버튼 클릭
4. 성공! 🎉

## 문제 해결

### "User already exists" 에러

```
❌ Error: User admin@test.com already exists in Firestore
```

**해결 방법:**
- 다른 이메일 주소 사용
- 또는 Firestore에서 기존 계정 삭제 후 재생성

### "Firebase Admin initialization failed" 에러

**원인:** GCP 서비스 계정 인증 설정 누락

**해결 방법:**
1. `backend-local/.env` 파일 확인
2. `GOOGLE_APPLICATION_CREDENTIALS` 변수가 올바른 경로를 가리키는지 확인:
   ```env
   GOOGLE_APPLICATION_CREDENTIALS=E:/Projects/APS/APS_APP/backend-local/service-account.json
   ```

### "Password must be at least 8 characters" 에러

**해결 방법:** 비밀번호를 8자 이상으로 설정

---

**참고:** Google/Naver 소셜 로그인 사용자는 자동으로 생성되므로 이 방법이 필요 없습니다.
