/**
 * SettingsPage.jsx - 설정 페이지
 */

import { useState, useEffect } from 'react';
import { getCurrentUser, onAuthStateChanged } from '../auth/authManager';
import { updateDisplayName as updateDisplayNameAPI } from '../services/userService';
import { getNotificationSettings, updateNotificationSettings } from '../utils/notificationHelper';
import '../components/css/PageLayout.css';
import './SettingsPage.css';

function SettingsPage() {
  const [user, setUser] = useState(getCurrentUser());
  const [autoLogin, setAutoLogin] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [notificationSound, setNotificationSound] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [appVersion, setAppVersion] = useState('-');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null); // 'checking', 'available', 'not-available', 'error'

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

  // 알림 설정 불러오기
  useEffect(() => {
    const settings = getNotificationSettings();
    setNotificationEnabled(settings.enabled);
    setNotificationSound(settings.sound);
  }, []);

  // 앱 버전 가져오기
  useEffect(() => {
    if (window.electron?.getAppVersion) {
      window.electron.getAppVersion().then(version => {
        setAppVersion(version);
      });
    }
  }, []);

  // 수동 업데이트 확인
  const handleCheckForUpdates = async () => {
    if (!window.electron?.checkForUpdates) {
      alert('업데이트 확인은 설치된 앱에서만 가능합니다.');
      return;
    }

    setIsCheckingUpdate(true);
    setUpdateStatus('checking');

    try {
      const result = await window.electron.checkForUpdates();
      if (result.success) {
        // 업데이트 이벤트는 main.js에서 처리됨
        // 여기서는 잠시 후 상태 초기화 (업데이트 없을 경우)
        setTimeout(() => {
          setUpdateStatus(prev => prev === 'checking' ? 'not-available' : prev);
        }, 5000);
      } else {
        setUpdateStatus('error');
      }
    } catch (error) {
      console.error('Update check failed:', error);
      setUpdateStatus('error');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // 알림 설정 변경 핸들러
  const handleNotificationEnabledChange = (enabled) => {
    setNotificationEnabled(enabled);
    const currentSettings = getNotificationSettings();
    updateNotificationSettings({
      ...currentSettings,
      enabled: enabled
    });
  };

  const handleNotificationSoundChange = (sound) => {
    setNotificationSound(sound);
    const currentSettings = getNotificationSettings();
    updateNotificationSettings({
      ...currentSettings,
      sound: sound
    });
  };

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
                <div className="setting-description">새로운 문의, 메모, 일정 알림을 표시합니다</div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={notificationEnabled}
                  onChange={(e) => handleNotificationEnabledChange(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-label">알림 사운드</div>
                <div className="setting-description">알림 시 소리를 재생합니다 (추후 구현 예정)</div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={notificationSound}
                  onChange={(e) => handleNotificationSoundChange(e.target.checked)}
                  disabled
                />
                <span className="toggle-slider" style={{ opacity: 0.5 }}></span>
              </label>
            </div>
          </div>
        </div>

        {/* 정보 */}
        <div className="settings-section">
          <h2 className="section-title">앱 정보</h2>
          <div className="settings-card">
            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-label">버전</div>
                <div className="setting-description">v{appVersion}</div>
              </div>
              <button
                className="btn-update"
                onClick={handleCheckForUpdates}
                disabled={isCheckingUpdate}
              >
                {isCheckingUpdate ? '확인 중...' : '업데이트 확인'}
              </button>
            </div>
            {updateStatus === 'not-available' && (
              <div className="update-status success">최신 버전을 사용 중입니다.</div>
            )}
            {updateStatus === 'error' && (
              <div className="update-status error">업데이트 확인 실패. 나중에 다시 시도해주세요.</div>
            )}
            <div className="setting-item">
              <div className="setting-label">플랫폼</div>
              <div className="setting-value">
                {window.electron?.platform === 'win32' ? 'Windows' :
                 window.electron?.platform === 'darwin' ? 'macOS' :
                 window.electron?.platform === 'linux' ? 'Linux' : 'Web'}
              </div>
            </div>
            {window.electron?.restartApp && (
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">앱 재시작</div>
                  <div className="setting-description">캐시 문제 등이 있을 때 앱을 다시 시작합니다</div>
                </div>
                <button
                  className="btn-restart"
                  onClick={() => window.electron.restartApp()}
                >
                  재시작
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
