/**
 * EmailConsultationsPage.jsx - 이메일 상담 전용 페이지
 *
 * 이메일로 접수된 상담 내역을 관리하는 페이지
 */

import '../components/css/PageLayout.css';
import './EmailConsultationsPage.css';

function EmailConsultationsPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">이메일 상담</h1>
        <p className="page-subtitle">이메일로 접수된 상담 내역</p>
      </div>

      <div className="page-content">
        <div className="empty-state">
          <div className="empty-icon">📧</div>
          <h2>이메일 상담 페이지</h2>
          <p>준비 중입니다.</p>
        </div>
      </div>
    </div>
  );
}

export default EmailConsultationsPage;
