import { useEffect, useId } from 'react';
import './css/Modal.css';

function Modal({
  isOpen,
  onClose,
  title,
  children,
  compact = false,
  size = 'default',
  closeDisabled = false,
  closeOnBackdrop = true,
}) {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen || closeDisabled) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDisabled, isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (closeOnBackdrop && !closeDisabled && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="dash-modal-backdrop" onClick={handleBackdropClick}>
      <div className="dash-modal-wrapper">
        <div
          className={`dash-modal-content ${compact ? 'compact' : ''} ${size === 'large' ? 'large' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="dash-modal-header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="dash-modal-close-btn" onClick={onClose} disabled={closeDisabled} aria-label="닫기">×</button>
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
