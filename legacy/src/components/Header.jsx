import { signOut } from '../auth/authManager';
import './Header.css';

function Header({ user }) {
  const handleLogout = () => {
    try {
      signOut();
      // authManager's onAuthStateChanged will automatically update the user state
      // which will redirect to LoginPage
    } catch (error) {
      console.error('로그아웃 실패:', error);
    }
  };

  return (
    <header className="aps-header">
      <div className="header-container">
        <div className="logo-section">
          <h1 className="company-name">APS 컨설팅</h1>
          <p className="company-subtitle">이민 · 비자 행정업무</p>
        </div>
        <div className="header-info">
          <span className="system-title">상담 관리 서비스</span>
          {user && (
            <div className="user-section">
              <span className="user-email">{user.email}</span>
              <button className="logout-btn" onClick={handleLogout}>
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;
