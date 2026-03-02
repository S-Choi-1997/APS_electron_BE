import './ConsultationListItem.css';

function ConsultationListItem({ consultation, isSelected, onClick }) {
  console.log('ConsultationListItem - consultation:', consultation);
  console.log('Has company?', consultation?.company);
  console.log('Has phone?', consultation?.phone);

  const formatDate = (timestamp) => {
    if (!timestamp) return '';

    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;

    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const truncateText = (text, maxLength = 80) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div
      className={`consultation-item ${isSelected ? 'selected' : ''} ${!consultation.read ? 'unread' : ''}`}
      onClick={onClick}
    >
      <div className="item-header">
        <div className="item-name">
          {!consultation.read && <span className="unread-dot"></span>}
          <span className="name-text">{consultation.name || '이름 없음'}</span>
        </div>
        <span className="item-date">{formatDate(consultation.createdAt)}</span>
      </div>

      <div className="item-info-grid">
        {consultation.company && (
          <div className="info-item">
            <span className="info-label">상호</span>
            <span className="info-value">{consultation.company}</span>
          </div>
        )}
        {consultation.phone && (
          <div className="info-item">
            <span className="info-label">연락처</span>
            <span className="info-value">{consultation.phone}</span>
          </div>
        )}
      </div>

      <div className="item-subject">
        {consultation.subject || consultation.type || '제목 없음'}
      </div>
      <div className="item-preview">
        {truncateText(consultation.message || consultation.content)}
      </div>
      {consultation.email && (
        <div className="item-meta">
          <span className="meta-email">{consultation.email}</span>
        </div>
      )}
    </div>
  );
}

export default ConsultationListItem;
