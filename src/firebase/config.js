// Firebase 미사용: 환경변수 검사 및 초기화 제거
// 필요한 경우 이 파일을 교체하여 Firebase 설정을 추가하세요.

export const db = null;
export const auth = {
  currentUser: null,
  onAuthStateChanged: () => () => {},
  signOut: () => {},
};
export const googleProvider = null;
