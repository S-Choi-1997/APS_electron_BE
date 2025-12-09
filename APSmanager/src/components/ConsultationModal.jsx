import { useEffect, useMemo, useState } from 'react';
import './ConsultationModal.css';

const TYPE_COLORS = ['#2563eb', '#dc2626', '#f59e0b', '#16a34a']; // blue, red, yellow, green

const getTypeColor = (type = '') => {
  const sum = type.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return TYPE_COLORS[sum % TYPE_COLORS.length];
};

const hexToRgba = (hex, alpha) => {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const isImageFile = (file = {}) => {
  const name = (file.name || file.filename || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  const ext = name.split('.').pop();
  const imageExt = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'avif', 'svg'];
  return type.startsWith('image/') || (ext && imageExt.includes(ext));
};

function ConsultationModal({ consultation, onClose, onRespond, attachments, attachmentsLoading }) {
  if (!consultation) return null;

  const formatFullDate = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleCopyEmail = () => {
    if (!consultation.email) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(consultation.email).catch(() => {});
    }
  };

  const typeColor = getTypeColor(consultation.type);
  const isUnread = !consultation.check;

  const imageAttachments = useMemo(
    () => (attachments || []).filter((file) => isImageFile(file) && file.downloadUrl),
    [attachments]
  );
  const [previewIndex, setPreviewIndex] = useState(0);
  const [preloadedImages, setPreloadedImages] = useState({});

  useEffect(() => {
    setPreviewIndex(0);
  }, [imageAttachments.length]);

  // Preload all images
  useEffect(() => {
    if (imageAttachments.length === 0) return;

    const loaded = {};
    imageAttachments.forEach((file) => {
      const img = new Image();
      img.src = file.downloadUrl;
      img.onload = () => {
        loaded[file.downloadUrl] = true;
        setPreloadedImages((prev) => ({ ...prev, [file.downloadUrl]: true }));
      };
    });
  }, [imageAttachments]);

  const goPrev = () =>
    setPreviewIndex((prev) => (prev - 1 + imageAttachments.length) % imageAttachments.length);
  const goNext = () => setPreviewIndex((prev) => (prev + 1) % imageAttachments.length);

  const currentPreview = imageAttachments[previewIndex];

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-wrapper">
        <div className="modal-content">
          <div className="modal-header">
            <div className="modal-title-section">
              <h2 className="modal-title">상담 상세 정보</h2>
              <div className="modal-type-actions">
                <span
                  className="modal-type-tag"
                  style={{
                    color: typeColor,
                    backgroundColor: hexToRgba(typeColor, 0.12),
                    borderColor: hexToRgba(typeColor, 0.28),
                  }}
                >
                  {consultation.type}
                </span>
                <button
                  className={`modal-respond-btn ${isUnread ? 'primary' : 'secondary'}`}
                  onClick={() => onRespond?.(consultation.id, consultation.check)}
                  disabled={!isUnread}
                  type="button"
                  title={isUnread ? '확인 시 SMS 자동 발송' : '확인 완료 (문자 발송됨)'}
                >
                  {isUnread ? '확인문자' : '확인 완료'}
                </button>
              </div>
            </div>
            <button className="modal-close-btn" onClick={onClose} aria-label="닫기" type="button">
              ×
            </button>
          </div>

          <div className="modal-body">
            <div className="info-grid">
              <div className="info-row">
                <span className="info-label">성함</span>
                <span className="info-value">{consultation.name}</span>
              </div>
              {consultation.company && (
                <div className="info-row">
                  <span className="info-label">상호</span>
                  <span className="info-value company-value">{consultation.company}</span>
                </div>
              )}
              <div className="info-row">
                <span className="info-label">연락 전화번호</span>
                <span className="info-value">{consultation.phone}</span>
              </div>
              <div className="info-row">
                <span className="info-label">이메일</span>
                <span className="info-value email-value">
                  {consultation.email}
                  {consultation.email && (
                    <button className="copy-btn" onClick={handleCopyEmail} type="button">
                      복사
                    </button>
                  )}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">접수 일시</span>
                <span className="info-value">{formatFullDate(consultation.createdAt)}</span>
              </div>
            </div>

            <div className="detail-section">
              <h3 className="detail-title">문의 내용</h3>
              <div className="detail-content">
                {consultation.message || consultation.content || '문의 내용이 없습니다.'}
              </div>
            </div>

            <div className="detail-section">
              <h3 className="detail-title">첨부파일</h3>
              {attachmentsLoading ? (
                <div className="detail-content">첨부파일을 불러오는 중입니다.</div>
              ) : !attachments || attachments.length === 0 ? (
                <div className="detail-content">첨부파일이 없습니다.</div>
              ) : (
                <ul className="detail-content attachment-list">
                  {attachments.map((file, idx) => {
                    const isImage = isImageFile(file);
                    const imageIdx = imageAttachments.findIndex((img) => img === file);
                    return (
                      <li key={`${file.name || file.filename || 'file'}-${idx}`} className="attachment-item">
                        <span className="attachment-name">{file.name || file.filename || '파일'}</span>
                        <div className="attachment-actions">
                          {isImage && file.downloadUrl && imageIdx >= 0 && (
                            <button
                              type="button"
                              className={`preview-btn ${previewIndex === imageIdx ? 'active' : ''}`}
                              onClick={() => setPreviewIndex(imageIdx)}
                            >
                              미리보기
                            </button>
                          )}
                          {file.downloadUrl ? (
                            <a
                              href={file.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="download-link"
                            >
                              다운로드
                            </a>
                          ) : (
                            <span className="download-unavailable">다운로드 불가</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button className="modal-action-btn secondary" onClick={onClose} type="button">
              닫기
            </button>
          </div>
        </div>

        {imageAttachments.length > 0 && currentPreview && (
          <div className="side-preview" onClick={(e) => e.stopPropagation()}>
            <div className="side-preview-frame">
              <img src={currentPreview.downloadUrl} alt={currentPreview.name || 'attachment'} />
              {imageAttachments.length > 1 && (
                <>
                  <button className="image-nav prev" onClick={goPrev} type="button" aria-label="이전">
                    ‹
                  </button>
                  <button className="image-nav next" onClick={goNext} type="button" aria-label="다음">
                    ›
                  </button>
                </>
              )}
            </div>
            <div className="side-preview-caption">
              <div className="side-preview-name">{currentPreview.name || currentPreview.filename}</div>
              {imageAttachments.length > 1 && (
                <div className="image-counter">
                  {previewIndex + 1} / {imageAttachments.length}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConsultationModal;
