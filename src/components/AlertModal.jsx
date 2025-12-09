import React from 'react';
import './AlertModal.css';

const AlertModal = ({ isOpen, onClose, type = 'success', title, message }) => {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      default:
        return 'ℹ';
    }
  };

  return (
    <div className="alert-modal-overlay" onClick={onClose}>
      <div className="alert-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className={`alert-modal-icon ${type}`}>
          {getIcon()}
        </div>
        <h2 className="alert-modal-title">{title}</h2>
        {message && <p className="alert-modal-message">{message}</p>}
        <button className="alert-modal-btn" onClick={onClose}>
          확인
        </button>
      </div>
    </div>
  );
};

export default AlertModal;
