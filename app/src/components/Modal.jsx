import { useEffect, useId, useRef } from 'react';
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
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !closeDisabled) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [])];
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [closeDisabled, isOpen]);

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
          ref={dialogRef}
          className={`dash-modal-content ${compact ? 'compact' : ''} ${size === 'large' ? 'large' : ''} ${size === 'viewport' ? 'viewport' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <div className="dash-modal-header">
            <h2 id={titleId}>{title}</h2>
            <button ref={closeButtonRef} type="button" className="dash-modal-close-btn" onClick={onClose} disabled={closeDisabled} aria-label="닫기">×</button>
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
