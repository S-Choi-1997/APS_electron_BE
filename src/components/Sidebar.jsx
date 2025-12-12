/**
 * Sidebar.jsx - 사이드바 네비게이션
 *
 * 협업툴 스타일의 왼쪽 사이드바
 */

import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { logout } from '../auth/authManager';
import './Sidebar.css';

function Sidebar({ user, stats = { website: 0, email: 0 } }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState({ consultations: true }); // 문의 메뉴 기본 펼침
  const userMenuRef = useRef(null);

  const isActive = (path) => {
    return location.pathname === path;
  };

  const toggleMenu = (menuKey) => {
    setExpandedMenus(prev => ({ ...prev, [menuKey]: !prev[menuKey] }));
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('로그아웃 실패:', error);
    }
  };

  // 외부 클릭 감지
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
          <p className="sidebar-subtitle">Manager</p>
        </div>
      </div>

      <nav className="sidebar-nav">
        <Link
          to="/"
          className={`nav-item ${isActive('/') ? 'active' : ''}`}
        >
          <span className="nav-label">대시보드</span>
        </Link>

        <div className="nav-section">
          <div
            className="nav-item nav-parent"
            onClick={() => toggleMenu('consultations')}
          >
            <span className="nav-label">문의 목록</span>
            <span className={`nav-arrow ${expandedMenus.consultations ? 'expanded' : ''}`}>›</span>
          </div>
          {expandedMenus.consultations && (
            <div className="nav-submenu">
              <Link
                to="/consultations/website"
                className={`nav-item nav-sub ${isActive('/consultations/website') || isActive('/consultations') ? 'active' : ''}`}
              >
                <span className="nav-label">홈페이지</span>
                {stats.website > 0 && (
                  <span className="nav-badge">{stats.website}</span>
                )}
              </Link>
              <Link
                to="/consultations/email"
                className={`nav-item nav-sub ${isActive('/consultations/email') ? 'active' : ''}`}
              >
                <span className="nav-label">이메일</span>
                {stats.email > 0 && (
                  <span className="nav-badge">{stats.email}</span>
                )}
              </Link>
            </div>
          )}
        </div>

        <Link
          to="/memo"
          className={`nav-item ${isActive('/memo') ? 'active' : ''}`}
        >
          <span className="nav-label">팀 메모</span>
        </Link>

        <Link
          to="/settings"
          className={`nav-item ${isActive('/settings') ? 'active' : ''}`}
        >
          <span className="nav-label">설정</span>
        </Link>
      </nav>

      <div className="sidebar-footer" ref={userMenuRef}>
        <div
          className="user-info"
          onClick={() => setShowUserMenu(!showUserMenu)}
        >
          <div className="user-avatar">
            {user.email?.charAt(0).toUpperCase()}
          </div>
          <div className="user-details">
            <div className="user-name">{user.displayName || user.email}</div>
            <div className="user-email">{user.email}</div>
          </div>
        </div>

        {showUserMenu && (
          <div className="user-menu">
            <button className="user-menu-item" onClick={() => navigate('/settings')}>
              설정
            </button>
            <button className="user-menu-item logout" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
