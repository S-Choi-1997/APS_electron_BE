import { useState, useEffect } from 'react';
import { signInWithLocal } from '../auth/localAuth';
import TitleBar from './TitleBar';
import './LoginPage.css';

function LoginPage({ onLoginSuccess, onUnauthorized }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoLogin, setAutoLogin] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(false);

  // 컴포넌트 마운트 시 저장된 이메일 불러오기
  useEffect(() => {
    const savedEmail = localStorage.getItem('aps-saved-email');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberEmail(true);
    }

    const savedAutoLogin = localStorage.getItem('aps-auto-login') === 'true';
    setAutoLogin(savedAutoLogin);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const user = await signInWithLocal(email, password);
      console.log('[LoginPage] Login successful:', user);

      // 이메일 저장 처리
      if (rememberEmail) {
        localStorage.setItem('aps-saved-email', email);
      } else {
        localStorage.removeItem('aps-saved-email');
      }

      // 자동 로그인 설정 저장
      localStorage.setItem('aps-auto-login', autoLogin.toString());

      onLoginSuccess(user);
    } catch (error) {
      console.error('[LoginPage] Login failed:', error);

      // Check if it's an unauthorized email error
      if (error.message.includes('Access denied') ||
          error.message.includes('unauthorized email') ||
          error.message.includes('forbidden') ||
          error.message.includes('whitelist')) {
        if (onUnauthorized) {
          onUnauthorized();
          return;
        }
      }

      setError(error.message || '로그인에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <TitleBar />
      <div className="login-container">
        <div className="login-header">
          <h1 className="login-company">APS 컨설팅</h1>
          <p className="login-subtitle">이민 · 비자 행정업무</p>
        </div>

        <div className="login-content">
          <h2 className="login-title">상담 관리 서비스</h2>
          <p className="login-description">
            이메일과 비밀번호로 로그인하세요.
          </p>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">이메일</label>
              <input
                id="email"
                type="email"
                placeholder="이메일을 입력하세요"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={isLoading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">비밀번호</label>
              <input
                id="password"
                type="password"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={isLoading}
              />
            </div>

            <div className="login-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={autoLogin}
                  onChange={(e) => setAutoLogin(e.target.checked)}
                  disabled={isLoading}
                />
                <span>자동 로그인</span>
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberEmail}
                  onChange={(e) => setRememberEmail(e.target.checked)}
                  disabled={isLoading}
                />
                <span>이메일 저장</span>
              </label>
            </div>

            {error && (
              <div className="login-error">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="login-submit-btn"
              disabled={isLoading}
            >
              {isLoading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <p className="login-notice">
            * 권한이 부여된 계정만 접근 가능합니다.
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
