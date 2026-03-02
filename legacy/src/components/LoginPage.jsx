import { useEffect } from 'react';
import { initializeAuth, signInWithGoogle, signInWithNaver } from '../auth/authManager';
import './LoginPage.css';

function LoginPage({ onLoginSuccess, onUnauthorized }) {
  useEffect(() => {
    // Initialize both Google and Naver auth when component mounts
    initializeAuth().catch((error) => {
      console.error('Failed to initialize auth:', error);
      alert('로그인 초기화에 실패했습니다.\n' + error.message);
    });
  }, []);

  const handleGoogleLogin = async () => {
    try {
      const user = await signInWithGoogle();
      console.log('Google 로그인 성공:', user);
      onLoginSuccess(user);
    } catch (error) {
      console.error('Google 로그인 실패:', error);

      // Check if it's an unauthorized email error
      if (error.message.includes('Access denied') ||
          error.message.includes('unauthorized email') ||
          error.message.includes('forbidden')) {
        if (onUnauthorized) {
          onUnauthorized();
          return;
        }
      }

      let errorMessage = 'Google 로그인에 실패했습니다.\n\n';

      if (error.message.includes('popup')) {
        errorMessage += '사유: 팝업이 차단되었거나 닫혔습니다.\n해결: 브라우저 설정에서 팝업을 허용해주세요.';
      } else if (error.message.includes('CLIENT_ID')) {
        errorMessage += '사유: Google Client ID가 설정되지 않았습니다.\n해결: .env 파일에 VITE_GOOGLE_CLIENT_ID를 추가해주세요.';
      } else {
        errorMessage += `에러 메시지: ${error.message}`;
      }

      alert(errorMessage);
    }
  };

  const handleNaverLogin = async () => {
    try {
      const user = await signInWithNaver();
      console.log('Naver 로그인 성공:', user);
      onLoginSuccess(user);
    } catch (error) {
      console.error('Naver 로그인 실패:', error);

      // Check if it's an unauthorized email error
      if (error.message.includes('Access denied') ||
          error.message.includes('unauthorized email') ||
          error.message.includes('forbidden')) {
        if (onUnauthorized) {
          onUnauthorized();
          return;
        }
      }

      let errorMessage = 'Naver 로그인에 실패했습니다.\n\n';

      if (error.message.includes('팝업')) {
        errorMessage += '사유: 팝업이 차단되었거나 닫혔습니다.\n해결: 브라우저 설정에서 팝업을 허용해주세요.';
      } else if (error.message.includes('CLIENT_ID')) {
        errorMessage += '사유: Naver Client ID가 설정되지 않았습니다.\n해결: .env 파일에 VITE_NAVER_CLIENT_ID를 추가해주세요.';
      } else {
        errorMessage += `에러 메시지: ${error.message}`;
      }

      alert(errorMessage);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <h1 className="login-company">APS 컨설팅</h1>
          <p className="login-subtitle">이민 · 비자 행정업무</p>
        </div>

        <div className="login-content">
          <h2 className="login-title">상담 관리 서비스</h2>
          <p className="login-description">
            Google 또는 Naver 계정으로 로그인하여 상담 목록에 접근하세요.
          </p>

          <div className="login-buttons">
            <button className="google-login-btn" onClick={handleGoogleLogin}>
              <svg className="google-icon" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Google로 로그인
            </button>

            <button className="naver-login-btn" onClick={handleNaverLogin}>
              <svg className="naver-icon" viewBox="0 0 24 24">
                <path fill="#03C75A" d="M16.273 12.845L7.376 0H0v24h7.726V11.156L16.624 24H24V0h-7.727v12.845z" />
              </svg>
              Naver로 로그인
            </button>
          </div>

          <p className="login-notice">
            * 권한이 부여된 계정만 접근 가능합니다.
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
