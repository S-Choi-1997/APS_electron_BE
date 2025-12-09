import './ConsultationDetail.css';

function ConsultationDetail({ consultation }) {
  if (!consultation) {
    return (
      <div className="consultation-detail">
        <div className="detail-empty">
          <svg className="empty-icon" viewBox="0 0 24 24">
            <path fill="currentColor" d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
          </svg>
          <p>상담 내용을 보려면 왼쪽 목록에서 선택해주세요.</p>
        </div>
      </div>
    );
  }

  const formatFullDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="consultation-detail">
      <div className="detail-header">
        <h2 className="detail-subject">
          {consultation.subject || consultation.type || '제목 없음'}
        </h2>
        <div className="detail-meta">
          <span className="detail-date">{formatFullDate(consultation.createdAt)}</span>
          {!consultation.read && <span className="detail-badge unread">안읽음</span>}
        </div>
      </div>

      <div className="detail-sender">
        <div className="sender-avatar">
          {(consultation.name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="sender-info">
          <div className="sender-name">{consultation.name || '이름 없음'}</div>
          {consultation.company && (
            <div className="sender-company">{consultation.company}</div>
          )}
          {consultation.email && (
            <div className="sender-email">{consultation.email}</div>
          )}
        </div>
      </div>

      <div className="detail-body">
        <div className="detail-content">
          {consultation.message || consultation.content || '내용이 없습니다.'}
        </div>
      </div>

      {/* 추가 정보가 있다면 표시 */}
      {(consultation.phone || consultation.company || consultation.type) && (
        <div className="detail-extra">
          <h3 className="extra-title">추가 정보</h3>
          <div className="extra-items">
            {consultation.phone && (
              <div className="extra-item">
                <span className="extra-label">전화번호:</span>
                <span className="extra-value">{consultation.phone}</span>
              </div>
            )}
            {consultation.company && (
              <div className="extra-item">
                <span className="extra-label">회사:</span>
                <span className="extra-value">{consultation.company}</span>
              </div>
            )}
            {consultation.type && !consultation.subject && (
              <div className="extra-item">
                <span className="extra-label">상담 유형:</span>
                <span className="extra-value">{consultation.type}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ConsultationDetail;
