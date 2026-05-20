import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { logout } from '../auth/authManager';
import { ROUTES } from '../constants/routes';
import { useEmailStats, useWebsiteStats } from '../hooks/queries';
import { getDisplayName } from '../utils/displayName';
import './Sidebar.css';

function Sidebar({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const userMenuRef = useRef(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const statsQueriesEnabled = Boolean(user);
  const { data: websiteStats = {} } = useWebsiteStats({ enabled: statsQueriesEnabled });
  const { data: emailStats = {} } = useEmailStats({ enabled: statsQueriesEnabled });
  const userDisplayName = getDisplayName([user?.displayName, user?.email]);
  const stats = {
    website: websiteStats.website || websiteStats.unread || 0,
    email: emailStats.unread || 0,
  };

  const isActive = (path) => location.pathname === path;

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-section">
          <h1 className="sidebar-logo">APS 컨설팅</h1>
          <p className="sidebar-subtitle">관리자</p>
        </div>
      </div>

      <nav className="sidebar-nav">
        <Link
          to={ROUTES.DASHBOARD}
          className={`nav-item ${isActive(ROUTES.DASHBOARD) ? 'active' : ''}`}
        >
          <span className="nav-label">대시보드</span>
        </Link>

        <Link
          to={ROUTES.WEBSITE_CONSULTATIONS}
          className={`nav-item ${isActive(ROUTES.WEBSITE_CONSULTATIONS) ? 'active' : ''}`}
        >
          <span className="nav-label">홈페이지 문의</span>
          {stats.website > 0 && <span className="nav-badge">{stats.website}</span>}
        </Link>

        <Link
          to={ROUTES.EMAIL_CONSULTATIONS}
          className={`nav-item ${isActive(ROUTES.EMAIL_CONSULTATIONS) ? 'active' : ''}`}
        >
          <span className="nav-label">이메일</span>
          {stats.email > 0 && <span className="nav-badge">{stats.email}</span>}
        </Link>

        <Link
          to={ROUTES.MEMO}
          className={`nav-item ${isActive(ROUTES.MEMO) ? 'active' : ''}`}
        >
          <span className="nav-label">팀 메모</span>
        </Link>

        <Link
          to={ROUTES.SETTINGS}
          className={`nav-item ${isActive(ROUTES.SETTINGS) ? 'active' : ''}`}
        >
          <span className="nav-label">설정</span>
        </Link>
      </nav>

      <div className="sidebar-footer" ref={userMenuRef}>
        <button
          type="button"
          className="user-info"
          onClick={() => setShowUserMenu((value) => !value)}
        >
          <span className="user-avatar">
            {userDisplayName.charAt(0).toUpperCase()}
          </span>
          <span className="user-details">
            <span className="user-name">{userDisplayName}</span>
            <span className="user-email">{user?.email}</span>
          </span>
        </button>

        {showUserMenu && (
          <div className="user-menu">
            <button type="button" className="user-menu-item" onClick={() => navigate(ROUTES.SETTINGS)}>
              설정
            </button>
            <button type="button" className="user-menu-item logout" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
