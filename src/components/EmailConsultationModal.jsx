/**
 * EmailConsultationModal.jsx - 이메일 상담 상세 모달
 *
 * ConsultationModal을 기반으로 이메일 전용 UI 구현
 */

import { useState } from 'react';
import DOMPurify from 'dompurify';
import './ConsultationModal.css';

function EmailConsultationModal({ email, allEmails = [], onClose, onRespond }) {
  if (!email) return null;

  const [responseMode, setResponseMode] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [sending, setSending] = useState(false);

  // 제목 정규화: Re:, Fwd:, 답장: 등 제거
  const normalizeSubject = (subject) => {
    if (!subject) return '';
    return subject
      .replace(/^(Re|RE|Fwd|FW|답장|답변|전달)\s*:\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  // 같은 스레드의 이메일 찾기 (제목 기준)
  const threadEmails = allEmails.length > 0
    ? allEmails
        .filter(e => normalizeSubject(e.subject) === normalizeSubject(email.subject))
        .sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt))
    : [email];

  const isThreadView = threadEmails.length > 1;

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
    if (!email.from) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(email.from).catch(() => {});
    }
  };

  const handleSendResponse = async () => {
    if (!responseText.trim()) {
      alert('답변 내용을 입력해주세요.');
      return;
    }

    try {
      setSending(true);
      await onRespond(email.id, responseText);
      setResponseMode(false);
      setResponseText('');
      alert('답변이 전송되었습니다.');
    } catch (error) {
      console.error('[Email Response] Failed:', error);
      alert('답변 전송 실패: ' + error.message);
    } finally {
      setSending(false);
    }
  };

  const isUnread = !email.check;
  const sourceColor = email.source === 'zoho' ? '#6366f1' : '#dc2626'; // indigo : red

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-content consultation-modal">
        {/* Header */}
        <div className="modal-header">
          <div className="header-content">
            <div className="header-main">
              <h2 className="modal-title">{email.subject}</h2>
              <div className="header-badges">
                <span
                  className="type-badge"
                  style={{
                    backgroundColor: sourceColor,
                    color: 'white'
                  }}
                >
                  {email.source === 'zoho' ? 'ZOHO' : 'Gmail'}
                </span>
                {isUnread && <span className="unread-badge">미확인</span>}
                {email.hasAttachments && <span className="attachment-badge">📎</span>}
              </div>
            </div>
            <div className="header-meta">
              <span className="meta-item">
                <strong>보낸사람:</strong>
                <span className="email-address" onClick={handleCopyEmail} title="클릭하여 복사">
                  {email.fromName || email.from} &lt;{email.from}&gt;
                </span>
              </span>
              <span className="meta-item">
                <strong>받은시간:</strong> {formatFullDate(email.receivedAt)}
              </span>
            </div>
          </div>
          <button className="close-button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {/* Body */}
        <div className="modal-body email-modal-body">
          <div className="message-section">
            {email.bodyHtml ? (
              <div
                className="message-html"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(email.bodyHtml, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span'],
                    ALLOWED_ATTR: ['href', 'target', 'style', 'class']
                  })
                }}
              />
            ) : (
              <div className="message-text">
                {email.body || '(내용 없음)'}
              </div>
            )}
          </div>

          {/* Thread View Section */}
          {isThreadView && (
            <div className="thread-section">
              <h3>이메일 대화 ({threadEmails.length}개)</h3>
              <div className="thread-list">
                {threadEmails.map((threadEmail, index) => (
                  <div
                    key={threadEmail.id}
                    className={`thread-item ${threadEmail.id === email.id ? 'active' : ''}`}
                  >
                    <div className="thread-header">
                      <span className="thread-index">#{index + 1}</span>
                      <span className="thread-from">
                        {threadEmail.fromName || threadEmail.from}
                      </span>
                      <span className="thread-date">
                        {formatFullDate(threadEmail.receivedAt)}
                      </span>
                    </div>
                    <div className="thread-body">
                      {threadEmail.body?.substring(0, 200) || '내용 없음'}
                      {threadEmail.body && threadEmail.body.length > 200 && '...'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Response Section */}
          {!responseMode ? (
            <div className="action-buttons">
              <button
                className="respond-button primary"
                onClick={() => setResponseMode(true)}
              >
                답변하기
              </button>
            </div>
          ) : (
            <div className="response-section">
              <h3>답변 작성</h3>
              <textarea
                className="response-textarea"
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                placeholder="답변 내용을 입력하세요..."
                rows={8}
                disabled={sending}
              />
              <div className="response-actions">
                <button
                  className="send-button primary"
                  onClick={handleSendResponse}
                  disabled={sending || !responseText.trim()}
                >
                  {sending ? '전송 중...' : '답변 전송'}
                </button>
                <button
                  className="cancel-button"
                  onClick={() => {
                    setResponseMode(false);
                    setResponseText('');
                  }}
                  disabled={sending}
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EmailConsultationModal;
