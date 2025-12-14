/**
 * SettingsPage.jsx - 설정 페이지
 */

import { useState, useEffect } from 'react';
import { getCurrentUser, onAuthStateChanged } from '../auth/authManager';
import { updateDisplayName as updateDisplayNameAPI } from '../services/userService';
import '../components/css/PageLayout.css';
import './SettingsPage.css';

function SettingsPage() {
  const [user, setUser] = useState(getCurrentUser());
  const [autoLogin, setAutoLogin] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 인증 상태 변경 감지
  useEffect(() => {
    const unsubscribe = onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      setDisplayName(currentUser?.displayName || '');
    });
    return () => unsubscribe();
  }, []);

  // localStorage에서 자동 로그인 설정 불러오기
  useEffect(() => {
    const savedAutoLogin = localStorage.getItem('aps-auto-login') === 'true';
    setAutoLogin(savedAutoLogin);
  }, []);

  const handleSaveDisplayName = async () => {
    if (!displayName.trim()) {
      alert('이름을 입력해주세요.');
      return;
    }

    try {
      // Backend API call to update displayName
      const auth = { currentUser: user };
      const updatedUserInfo = await updateDisplayNameAPI(displayName, auth);

      // Update local user state with backend response
      const updatedUser = {
        ...user,
        displayName: updatedUserInfo.display_name,
      };
      setUser(updatedUser);

      setIsEditingName(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('이름 변경 실패:', error);
      alert('이름 변경에 실패했습니다: ' + error.message);
    }
  };

  const handleCancelEdit = () => {
    setDisplayName(user?.displayName || '');
    setIsEditingName(false);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">설정</h1>
      </div>

      <div className="page-content settings-content">
        {/* 계정 정보 */}
        <div className="settings-section">
          <h2 className="section-title">계정 정보</h2>
          <div className="settings-card">
            <div className="setting-item">
              <div className="setting-label">이메일</div>
              <div className="setting-value">{user?.email || '-'}</div>
            </div>
            <div className="setting-item">
              <div className="setting-label">이름</div>
              {isEditingName ? (
                <div className="setting-edit">
                  <input
                    type="text"
                    className="setting-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="이름을 입력하세요"
                    autoFocus
                  />
                  <div className="setting-buttons">
                    <button className="btn-save" onClick={handleSaveDisplayName}>저장</button>
                    <button className="btn-cancel" onClick={handleCancelEdit}>취소</button>
                  </div>
                </div>
              ) : (
                <div className="setting-display">
                  <div className="setting-value">{user?.displayName || '-'}</div>
                  <button className="btn-edit" onClick={() => setIsEditingName(true)}>변경</button>
                </div>
              )}
            </div>
            {saveSuccess && (
              <div className="save-success-message">이름이 저장되었습니다.</div>
            )}
          </div>
        </div>

        {/* 앱 설정 */}
        <div className="settings-section">
          <h2 className="section-title">앱 설정</h2>
          <div className="settings-card">
            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-label">자동 로그인</div>
                <div className="setting-description">앱 시작 시 자동으로 로그인합니다</div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={autoLogin}
                  onChange={(e) => {
                    const newValue = e.target.checked;
                    setAutoLogin(newValue);
                    localStorage.setItem('aps-auto-login', newValue.toString());
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-label">데스크톱 알림</div>
                <div className="setting-description">새로운 문의가 있을 때 알림을 표시합니다</div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={notifications}
                  onChange={(e) => setNotifications(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        {/* 정보 */}
        <div className="settings-section">
          <h2 className="section-title">앱 정보</h2>
          <div className="settings-card">
            <div className="setting-item">
              <div className="setting-label">버전</div>
              <div className="setting-value">1.0.0</div>
            </div>
            <div className="setting-item">
              <div className="setting-label">플랫폼</div>
              <div className="setting-value">
                {window.electron?.platform === 'win32' ? 'Windows' :
                 window.electron?.platform === 'darwin' ? 'macOS' :
                 window.electron?.platform === 'linux' ? 'Linux' : 'Web'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
