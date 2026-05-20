/**
 * SettingsPage.jsx - 설정 페이지
 */

import { useState, useEffect } from 'react';
import {
  getCurrentUser,
  onAuthStateChanged,
  setAutoLoginPreference,
  updateDisplayName as updateAuthDisplayName,
} from '../auth/authManager';
import { updateDisplayName as updateDisplayNameAPI } from '../services/userService';
import { getApiHealthDetails } from '../config/api';
import { copyTextToClipboard } from '../utils/clipboard';
import { getNotificationSettings, updateNotificationSettings } from '../utils/notificationHelper';
import '../components/css/PageLayout.css';
import './SettingsPage.css';

function SettingsPage() {
  const [user, setUser] = useState(getCurrentUser());
  const [autoLogin, setAutoLogin] = useState(false);
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [notificationSound, setNotificationSound] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [appVersion, setAppVersion] = useState('-');
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null); // 'checking', 'available', 'not-available', 'error'
  const [diagnosticStatus, setDiagnosticStatus] = useState(null); // 'copying', 'copied', 'error'
  const [diagnosticMessage, setDiagnosticMessage] = useState('');

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

  // 시작프로그램 설정 불러오기
  useEffect(() => {
    if (window.electron?.getStartupEnabled) {
      window.electron.getStartupEnabled()
        .then(result => {
          if (result.success) {
            setStartupEnabled(result.enabled);
          }
        })
        .catch(error => {
          console.error('[Settings] Failed to get startup setting:', error);
        });
    }
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
      window.electron.getAppVersion()
        .then(version => {
          setAppVersion(version);
        })
        .catch(error => {
          console.error('[Settings] Failed to get app version:', error);
        });
    }
  }, []);

  useEffect(() => {
    if (window.electron?.getAutoUpdateEnabled) {
      window.electron.getAutoUpdateEnabled()
        .then((enabled) => setAutoUpdateEnabled(Boolean(enabled)))
        .catch(() => setAutoUpdateEnabled(false));
    }
  }, []);

  // 업데이트 없음 이벤트 리스너
  useEffect(() => {
    if (!window.electron) return;

    const cleanupNotAvailable = window.electron.onUpdateNotAvailable?.(() => {
      setUpdateStatus('not-available');
      setIsCheckingUpdate(false);
    });

    const cleanupError = window.electron.onUpdateError?.(() => {
      setUpdateStatus('error');
      setIsCheckingUpdate(false);
    });

    return () => {
      cleanupNotAvailable?.();
      cleanupError?.();
    };
  }, []);

  // 수동 업데이트 확인
  const handleCheckForUpdates = async () => {
    if (!autoUpdateEnabled) {
      setUpdateStatus('disabled');
      return;
    }

    if (!window.electron?.checkForUpdates) {
      alert('업데이트 확인은 설치된 앱에서만 가능합니다.');
      return;
    }

    setIsCheckingUpdate(true);
    setUpdateStatus('checking');

    try {
      const result = await window.electron.checkForUpdates();
      if (!result.success) {
        setUpdateStatus('error');
        setIsCheckingUpdate(false);
      }
      // 업데이트 발견 시 모달이 자동으로 표시됨
      // 업데이트 없음 시 onUpdateNotAvailable 이벤트가 발생
    } catch (error) {
      console.error('Update check failed:', error);
      setUpdateStatus('error');
      setIsCheckingUpdate(false);
    }
  };

  // 시작프로그램 설정 변경 핸들러
  const handleStartupChange = async (enabled) => {
    if (!window.electron?.setStartupEnabled) {
      return;
    }

    try {
      const result = await window.electron.setStartupEnabled(enabled);
      if (result.success) {
        setStartupEnabled(enabled);
      } else {
        console.error('[Settings] Failed to set startup:', result.error);
      }
    } catch (error) {
      console.error('[Settings] Failed to set startup:', error);
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
      const savedDisplayName = updatedUserInfo.displayName || updatedUserInfo.display_name || displayName.trim();

      // Update local user state with backend response
      const updatedUser = updateAuthDisplayName(savedDisplayName);
      setUser(updatedUser);
      setDisplayName(savedDisplayName);

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

  const getPlatformLabel = () => {
    if (window.electron?.platform === 'win32') return 'Windows';
    if (window.electron?.platform === 'darwin') return 'macOS';
    if (window.electron?.platform === 'linux') return 'Linux';
    return 'Web';
  };

  const handleCopyDiagnostics = async () => {
    setDiagnosticStatus('copying');
    setDiagnosticMessage('진단 정보를 확인하는 중입니다.');

    try {
      const health = await getApiHealthDetails();

      const generatedAt = new Date().toISOString();
      const healthData = health.data || {};
      const lines = [
        'APS Admin Diagnostics',
        `GeneratedAt: ${generatedAt}`,
        `AppVersion: v${appVersion}`,
        `Platform: ${getPlatformLabel()}`,
        `ElectronPlatform: ${window.electron?.platform || 'unavailable'}`,
        `LoginState: ${user ? 'signed-in' : 'signed-out'}`,
        `UserEmail: ${user?.email || '-'}`,
        `UserProvider: ${user?.provider || '-'}`,
        `AutoLogin: ${autoLogin ? 'enabled' : 'disabled'}`,
        `AutoUpdate: ${autoUpdateEnabled ? 'enabled' : 'disabled'}`,
        `Startup: ${window.electron?.getStartupEnabled ? (startupEnabled ? 'enabled' : 'disabled') : 'unavailable'}`,
        `Notification: ${notificationEnabled ? 'enabled' : 'disabled'}`,
        `BackendHealth: ${health.ok ? 'ok' : 'failed'}`,
        `BackendHttpStatus: ${health.httpStatus ?? '-'}`,
        `BackendLatencyMs: ${health.elapsedMs}`,
        `BackendVersion: ${healthData.version || healthData.backendVersion || '-'}`,
      ];

      if (health.error) {
        lines.push(`BackendError: ${health.error}`);
      }

      const copied = await copyTextToClipboard(lines.join('\n'));
      if (!copied) {
        throw new Error('클립보드 복사에 실패했습니다.');
      }

      setDiagnosticStatus('copied');
      setDiagnosticMessage(`진단 정보를 복사했습니다. 백엔드 상태: ${health.ok ? '정상' : '실패'}`);
    } catch (error) {
      console.error('[Settings] Failed to copy diagnostics:', error);
      setDiagnosticStatus('error');
      setDiagnosticMessage(`진단 정보 복사 실패: ${error.message}`);
    }
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
                    setAutoLoginPreference(newValue);
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            {window.electron?.platform === 'win32' && (
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">Windows 시작 시 자동 실행</div>
                  <div className="setting-description">컴퓨터 시작 시 APS Admin을 자동으로 실행합니다</div>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={startupEnabled}
                    onChange={(e) => handleStartupChange(e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            )}
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
                disabled={!autoUpdateEnabled || isCheckingUpdate}
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
                {getPlatformLabel()}
              </div>
            </div>
            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-label">진단 정보</div>
                <div className="setting-description">버전, 로그인 상태, 백엔드 연결 상태를 복사합니다</div>
              </div>
              <button
                className="btn-diagnostics"
                onClick={handleCopyDiagnostics}
                disabled={diagnosticStatus === 'copying'}
              >
                {diagnosticStatus === 'copying' ? '확인 중...' : '진단 정보 복사'}
              </button>
            </div>
            {diagnosticMessage && (
              <div className={`diagnostic-status ${diagnosticStatus === 'error' ? 'error' : 'success'}`}>
                {diagnosticMessage}
              </div>
            )}
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
