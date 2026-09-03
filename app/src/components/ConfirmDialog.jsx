import Modal from './Modal';

function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = '확인',
  message,
  description,
  confirmLabel = '확인',
  cancelLabel = '취소',
  tone = 'primary',
  isConfirming = false,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      compact
      closeDisabled={isConfirming}
      closeOnBackdrop={!isConfirming}
    >
      <div className="confirm-dialog">
        <p className="confirm-dialog-message">{message}</p>
        {description ? <p className="confirm-dialog-description">{description}</p> : null}
        <div className="modal-actions">
          <button type="button" className="modal-btn secondary" onClick={onClose} disabled={isConfirming}>
            {cancelLabel}
          </button>
          <button type="button" className={`modal-btn ${tone}`} onClick={onConfirm} disabled={isConfirming}>
            {isConfirming ? '처리 중...' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
