/**
 * Modal.jsx - 재사용 가능한 모달 컴포넌트
 */

import './css/Modal.css';

function Modal({ isOpen, onClose, title, children, compact = false, size = 'default' }) {
  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="dash-modal-backdrop" onClick={handleBackdropClick}>
      <div className="dash-modal-wrapper">
        <div className={`dash-modal-content ${compact ? 'compact' : ''} ${size === 'large' ? 'large' : ''}`}>
          <div className="dash-modal-header">
            <h2>{title}</h2>
            <button className="dash-modal-close-btn" onClick={onClose}>×</button>
          </div>
          <div className="dash-modal-body">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Modal;
