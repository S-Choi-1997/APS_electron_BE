import React from 'react';
import './ConfirmModal.css';

const ConfirmModal = ({ isOpen, onClose, onConfirm, consultation, isConfirming = false }) => {
  if (!isOpen || !consultation) return null;

  return (
    <div className="confirm-modal-overlay" onClick={isConfirming ? undefined : onClose}>
      <div className="confirm-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-header">
          <h2>문자 발송 확인</h2>
          <button className="confirm-modal-close" onClick={onClose} disabled={isConfirming}>×</button>
        </div>

        <div className="confirm-modal-body">
          <div className="confirm-modal-icon">📱</div>
          <p className="confirm-modal-message">
            <strong>{consultation.name}</strong>님께<br />
            확인 문자를 발송하시겠습니까?
          </p>
          <div className="confirm-modal-info">
            <div className="info-row">
              <span className="info-label">전화번호</span>
              <span className="info-value">{consultation.phone}</span>
            </div>
          </div>
          <div className="confirm-modal-warning">
            발송 성공 후 상담 상태가 응답 완료로 변경됩니다.
          </div>
        </div>

        <div className="confirm-modal-footer">
          <button className="confirm-modal-btn cancel" onClick={onClose} disabled={isConfirming}>
            취소
          </button>
          <button className="confirm-modal-btn confirm" onClick={onConfirm} disabled={isConfirming}>
            {isConfirming ? '발송 중...' : '문자 발송'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
