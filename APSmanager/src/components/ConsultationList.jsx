import ConsultationListItem from './ConsultationListItem';
import './ConsultationList.css';

function ConsultationList({ consultations, selectedId, onSelect, loading, error }) {
  if (loading) {
    return (
      <div className="consultation-list">
        <div className="list-status">
          <div className="loading-spinner"></div>
          <p>상담 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="consultation-list">
        <div className="list-status error">
          <p>{error}</p>
          <small>Firebase 설정을 확인해주세요.</small>
        </div>
      </div>
    );
  }

  if (consultations.length === 0) {
    return (
      <div className="consultation-list">
        <div className="list-status">
          <p>상담 예약이 없습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="consultation-list">
      <div className="list-header">
        <h2 className="list-title">최근 상담</h2>
        <span className="list-count">{consultations.length}건</span>
      </div>
      <div className="list-items">
        {consultations.map((consultation) => (
          <ConsultationListItem
            key={consultation.id}
            consultation={consultation}
            isSelected={consultation.id === selectedId}
            onClick={() => onSelect(consultation)}
          />
        ))}
      </div>
    </div>
  );
}

export default ConsultationList;
