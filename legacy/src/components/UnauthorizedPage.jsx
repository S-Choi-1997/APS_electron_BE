import './UnauthorizedPage.css';

function UnauthorizedPage({ onBackToLogin }) {
  return (
    <div className="unauthorized-page">
      <div className="unauthorized-container">
        <div className="unauthorized-header">
          <h1 className="unauthorized-company">APS 컨설팅</h1>
          <p className="unauthorized-subtitle">이민 · 비자 행정업무</p>
        </div>

        <div className="unauthorized-content">
          <div className="unauthorized-icon">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 8V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="16" r="1" fill="currentColor"/>
            </svg>
          </div>

          <h2 className="unauthorized-title">허용되지 않은 이메일입니다</h2>
          <p className="unauthorized-description">
            현재 로그인하신 계정은 접근 권한이 없습니다.<br />
            관리자에게 문의하시거나 다른 계정으로 시도해주세요.
          </p>

          <button className="back-to-login-btn" onClick={onBackToLogin}>
            로그인 화면으로
          </button>
        </div>
      </div>
    </div>
  );
}

export default UnauthorizedPage;
