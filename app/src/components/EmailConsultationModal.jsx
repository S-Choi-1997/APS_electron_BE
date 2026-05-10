/**
 * EmailConsultationModal.jsx - 이메일 상담 상세 모달
 *
 * ConsultationModal을 기반으로 이메일 전용 UI 구현
 */

import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { EMAIL_STATUS } from '../services/emailInquiryService';
import { buildApiUrl, getRelayEnvironment } from '../config/api';
import './ConsultationModal.css';

function EmailConsultationModal({ email, allEmails = [], onClose, onRespond }) {
  if (!email) return null;

  const [responseText, setResponseText] = useState('');
  const [sending, setSending] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [fullContent, setFullContent] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [contentError, setContentError] = useState(null);

  // 인증 토큰 가져오기
  const getAuthToken = () => {
    try {
      const raw = localStorage.getItem('aps-local-auth-user');
      if (raw) {
        const user = JSON.parse(raw);
        return user.idToken;
      }
    } catch (e) {
      console.error('[Email Modal] Failed to get auth token:', e);
    }
    return null;
  };

  // ZOHO 이메일의 경우 전체 내용과 첨부파일 정보 가져오기
  useEffect(() => {
    if (email.source === 'zoho') {
      fetchFullContent();
      if (email.hasAttachments) {
        fetchAttachments();
      }
    }
  }, [email.id]);

  const fetchFullContent = async () => {
    try {
      setLoadingContent(true);
      setContentError(null);
      const token = getAuthToken();
      const response = await fetch(await buildApiUrl(`/email-inquiries/${email.id}/content`), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Relay-Environment': await getRelayEnvironment()
        }
      });
      if (!response.ok) {
        if (response.status === 400) {
          // folder_id가 없는 기존 이메일은 에러 무시
          return;
        }
        throw new Error('Failed to fetch content');
      }
      const data = await response.json();
      setFullContent(data.content);
    } catch (error) {
      console.error('[Email Modal] Failed to fetch full content:', error);
      setContentError('전체 내용을 불러오지 못했습니다.');
    } finally {
      setLoadingContent(false);
    }
  };

  const fetchAttachments = async () => {
    try {
      setLoadingAttachments(true);
      const token = getAuthToken();
      const response = await fetch(await buildApiUrl(`/email-inquiries/${email.id}/attachments`), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Relay-Environment': await getRelayEnvironment()
        }
      });
      if (!response.ok) throw new Error('Failed to fetch attachments');
      const data = await response.json();
      setAttachments(data.attachments || []);
    } catch (error) {
      console.error('[Email Modal] Failed to fetch attachments:', error);
    } finally {
      setLoadingAttachments(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleDownloadAttachment = async (attachment) => {
    console.log('[Email Modal] Download clicked:', attachment.attachmentName);
    try {
      const token = getAuthToken();
      const downloadUrl = await buildApiUrl(`/email-inquiries/${email.id}/attachments/${attachment.attachmentId}/download`);
      console.log('[Email Modal] Downloading from:', downloadUrl);

      // fetch로 다운로드
      const response = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Relay-Environment': await getRelayEnvironment()
        }
      });

      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      // Electron 환경: saveFile 사용
      if (window.electron && window.electron.saveFile) {
        const result = await window.electron.saveFile(
          Array.from(new Uint8Array(arrayBuffer)),
          attachment.attachmentName
        );
        if (result.success) {
          console.log('[Email Modal] File saved:', result.filePath);
        } else if (!result.canceled) {
          throw new Error(result.error || 'Save failed');
        }
      } else {
        // 브라우저 환경: blob URL 방식
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.attachmentName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('[Email Modal] Failed to download attachment:', error);
      alert('첨부파일 다운로드에 실패했습니다.');
    }
  };

  // Helper function to decode HTML entities and extract clean email
  const cleanEmail = (emailStr) => {
    if (!emailStr) return '';

    // Decode HTML entities
    const decoded = emailStr
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"');

    // Extract email from formats like "Name <email@domain.com>" or "<email@domain.com>"
    const emailMatch = decoded.match(/<([^>]+)>/) || decoded.match(/([^\s<>]+@[^\s<>]+)/);
    return emailMatch ? emailMatch[1] : decoded.trim();
  };

  // 스레드 관련 이메일 찾기 (같은 상대방과 주고받은 모든 메일)
  const getThreadEmails = () => {
    if (!allEmails || allEmails.length === 0) return { before: [], after: [] };

    // 현재 이메일의 상대방 주소 (받은 메일이면 from, 보낸 메일이면 to)
    const counterpartyEmail = cleanEmail(email.isOutgoing ? email.to : email.from);
    if (!counterpartyEmail) return { before: [], after: [] };

    // 현재 이메일의 수신 시간
    const currentTime = new Date(email.receivedAt).getTime();

    // 같은 상대방과 주고받은 모든 이메일 (현재 이메일 제외)
    const threadEmails = allEmails.filter(e => {
      if (e.id === email.id) return false; // 현재 메일 제외

      // 받은 메일: from이 상대방 이메일과 일치
      // 보낸 메일: to가 상대방 이메일과 일치
      const emailCounterparty = cleanEmail(e.isOutgoing ? e.to : e.from);
      return emailCounterparty === counterpartyEmail;
    });

    // 시간순으로 정렬
    const sorted = threadEmails.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));

    // 현재 메일 기준으로 이전/이후 분리
    const before = sorted.filter(e => new Date(e.receivedAt).getTime() < currentTime);
    const after = sorted.filter(e => new Date(e.receivedAt).getTime() > currentTime);

    return { before, after };
  };

  const { before: previousThreads, after: laterThreads } = getThreadEmails();
  const [showPrevious, setShowPrevious] = useState(false);
  const [showLater, setShowLater] = useState(false);

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

      // Optimistic update: 현재 이메일 상태를 응신으로 변경
      email.status = EMAIL_STATUS.RESPONDED;

      setResponseText('');

      // 토스트 표시
      setShowToast(true);
      setTimeout(() => {
        setShowToast(false);
      }, 3000); // 3초 후 자동으로 사라짐
    } catch (error) {
      console.error('[Email Response] Failed:', error);
      alert('답변 전송 실패: ' + error.message);
    } finally {
      setSending(false);
    }
  };

  const sourceColor = email.source === 'zoho' ? '#6366f1' : '#dc2626'; // indigo : red

  // HTML 본문 내 링크 클릭 핸들러
  const handleHtmlClick = async (e) => {
    const link = e.target.closest('a');
    if (link && link.href) {
      e.preventDefault();

      const url = link.href;
      console.log('[Email Modal] Link clicked:', url);

      // 파일 다운로드 링크인지 확인 (확장자로 판단)
      const fileExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.hwp'];
      const linkText = link.textContent || link.innerText || '';
      const isFileLink = fileExtensions.some(ext =>
        url.toLowerCase().includes(ext) || linkText.toLowerCase().includes(ext)
      );

      // ZOHO 관련 링크 또는 파일 다운로드 링크
      const isDownloadLink = isFileLink ||
                             url.includes('workdrive.zoho') ||
                             url.includes('mail.zoho') ||
                             url.includes('zoho.com/share') ||
                             url.includes('download');

      if (isDownloadLink && window.electron && window.electron.downloadFile) {
        // 파일명 추출 (링크 텍스트에서 또는 URL에서)
        let filename = linkText.trim();
        if (!filename || filename.length > 100) {
          // URL에서 파일명 추출 시도
          const urlParts = url.split('/');
          filename = urlParts[urlParts.length - 1].split('?')[0] || 'download';
        }

        console.log('[Email Modal] Downloading file:', filename);

        try {
          const result = await window.electron.downloadFile(url, filename);
          if (result.success) {
            console.log('[Email Modal] File saved:', result.filePath);
          } else if (!result.canceled) {
            throw new Error(result.error || 'Download failed');
          }
        } catch (error) {
          console.error('[Email Modal] Download failed:', error);
          // 실패해도 브라우저 안 열고 그냥 에러만 표시
          alert('파일 다운로드에 실패했습니다: ' + error.message);
        }
      } else {
        // 일반 링크: setWindowOpenHandler가 처리하도록 window.open 사용
        // (main.js에서 외부 브라우저로 열고 Electron 창은 안 띄움)
        window.open(url, '_blank');
      }
    }
  };

  // ThreadItem Component (펼쳐진 상태만)
  const ThreadItem = ({ thread, index }) => {
    return (
      <div className="thread-item-expanded">
        <div className="thread-item-header-expanded">
          <span className="thread-index">#{index + 1}</span>
          <span className={`thread-direction ${thread.isOutgoing ? 'outgoing' : 'incoming'}`}>
            {thread.isOutgoing ? '→ 보낸 메일' : '← 받은 메일'}
          </span>
          <span className="thread-from">
            {thread.isOutgoing
              ? `To: ${thread.to || thread.from}`
              : (thread.fromName || thread.from)}
          </span>
          <span className="thread-date">
            {formatFullDate(thread.receivedAt)}
          </span>
        </div>

        <div className="thread-item-body">
          <div className="thread-subject">
            <strong>제목:</strong> {thread.subject}
          </div>
          <div className="thread-content">
            {thread.bodyHtml ? (
              <div
                onClick={handleHtmlClick}
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(thread.bodyHtml, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span'],
                    ALLOWED_ATTR: ['href', 'target', 'style', 'class']
                  })
                }}
              />
            ) : (
              <div className="thread-text">{thread.body || '내용 없음'}</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      {/* 토스트 알림 */}
      {showToast && (
        <div className="email-toast-notification">
          <div className="toast-icon">✓</div>
          <div className="toast-message">답변이 성공적으로 전송되었습니다</div>
        </div>
      )}

      <div className="email-thread-container">
        {/* 위쪽: 이전 메시지들 */}
        {previousThreads.length > 0 && !showPrevious && (
          <button
            className="thread-expand-button-stack"
            onClick={() => setShowPrevious(true)}
          >
            ▲ 이전 메시지 {previousThreads.length}개
          </button>
        )}

        {/* 스크롤 영역 */}
        <div className="thread-scroll-area">
          {/* 이전 메시지들 (펼쳤을 때) */}
          {showPrevious && (
            <div className="thread-stack">
              {previousThreads.map((thread, index) => (
                <div key={thread.id} className="thread-item-stack">
                  <div className="modal-header">
                    <div className="header-content">
                      <div className="header-main">
                        <h2 className="modal-title">{thread.subject}</h2>
                        <div className="header-badges">
                          <span className="thread-index-badge">#{index + 1}</span>
                          <span className={`thread-direction ${thread.isOutgoing ? 'outgoing' : 'incoming'}`}>
                            {thread.isOutgoing ? '→ 보낸 메일' : '← 받은 메일'}
                          </span>
                        </div>
                      </div>
                      <div className="header-meta">
                        <span className="meta-item">
                          <strong>보낸사람:</strong>
                          <span>{thread.fromName || thread.from} &lt;{thread.from}&gt;</span>
                        </span>
                        <span className="meta-item">
                          <strong>받은시간:</strong> {formatFullDate(thread.receivedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="modal-body">
                    {thread.bodyHtml ? (
                      <div
                        className="message-html"
                        onClick={handleHtmlClick}
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(thread.bodyHtml, {
                            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span'],
                            ALLOWED_ATTR: ['href', 'target', 'style', 'class']
                          })
                        }}
                      />
                    ) : (
                      <div className="message-text">{thread.body || '내용 없음'}</div>
                    )}
                  </div>
                </div>
              ))}
              <button
                className="thread-collapse-button-stack"
                onClick={() => setShowPrevious(false)}
              >
                ▼ 이전 메시지 접기
              </button>
            </div>
          )}

          {/* 현재 메일 */}
          <div className="current-email-stack">
            <div className="modal-header">
              <div className="header-content">
                <div className="header-main">
                  <h2 className="modal-title">{email.subject}</h2>
                  <div className="header-badges">
                    <span className="thread-index-badge">#{previousThreads.length + 1}</span>
                    <span
                      className="type-badge"
                      style={{
                        backgroundColor: sourceColor,
                        color: 'white'
                      }}
                    >
                      {email.source === 'zoho' ? 'ZOHO' : 'Gmail'}
                    </span>
                    <span className={`status-badge status-${email.status}`}>
                      {email.status === EMAIL_STATUS.UNREAD && '미확인'}
                      {email.status === EMAIL_STATUS.READ && '확인'}
                      {email.status === EMAIL_STATUS.RESPONDED && '응신'}
                    </span>
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

            <div className="modal-body">
              {/* 로딩 상태 표시 */}
              {loadingContent && (
                <div className="content-loading">전체 내용 불러오는 중...</div>
              )}

              {/* 에러 표시 */}
              {contentError && (
                <div className="content-error">{contentError}</div>
              )}

              {/* 이메일 본문 (전체 내용 우선, 없으면 기존 내용) */}
              {!loadingContent && (
                <>
                  {(fullContent || email.bodyHtml) ? (
                    <div
                      className="message-html"
                      onClick={handleHtmlClick}
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(fullContent || email.bodyHtml, {
                          ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'img'],
                          ALLOWED_ATTR: ['href', 'target', 'style', 'class', 'src', 'alt', 'width', 'height']
                        })
                      }}
                    />
                  ) : (
                    <div className="message-text">
                      {email.body || '(내용 없음)'}
                    </div>
                  )}
                </>
              )}

              {/* 첨부파일 섹션 */}
              {email.hasAttachments && (
                <div className="attachments-section">
                  <h4 className="attachments-title">📎 첨부파일</h4>
                  {loadingAttachments ? (
                    <div className="attachments-loading">첨부파일 목록 로딩 중...</div>
                  ) : attachments.length > 0 ? (
                    <ul className="attachments-list">
                      {attachments.map(att => (
                        <li key={att.attachmentId} className="attachment-item">
                          <button
                            className="attachment-download-btn"
                            onClick={() => handleDownloadAttachment(att)}
                            title="클릭하여 다운로드"
                          >
                            <span className="attachment-icon">📄</span>
                            <span className="attachment-name">{att.attachmentName}</span>
                            <span className="attachment-size">({formatFileSize(att.attachmentSize)})</span>
                            <span className="download-icon">⬇️</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="attachments-empty">첨부파일 정보를 가져올 수 없습니다.</div>
                  )}
                </div>
              )}

              <textarea
                className="response-textarea"
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                placeholder="답변 내용을 입력하세요..."
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
                    setResponseText('');
                  }}
                  disabled={sending}
                >
                  초기화
                </button>
              </div>
            </div>
          </div>

          {/* 이후 메시지들 (펼쳤을 때) */}
          {showLater && (
            <div className="thread-stack">
              <button
                className="thread-collapse-button-stack"
                onClick={() => setShowLater(false)}
              >
                ▲ 이후 메시지 접기
              </button>
              {laterThreads.map((thread, index) => (
                <div key={thread.id} className="thread-item-stack">
                  <div className="modal-header">
                    <div className="header-content">
                      <div className="header-main">
                        <h2 className="modal-title">{thread.subject}</h2>
                        <div className="header-badges">
                          <span className="thread-index-badge">#{previousThreads.length + 1 + index + 1}</span>
                          <span className={`thread-direction ${thread.isOutgoing ? 'outgoing' : 'incoming'}`}>
                            {thread.isOutgoing ? '→ 보낸 메일' : '← 받은 메일'}
                          </span>
                        </div>
                      </div>
                      <div className="header-meta">
                        <span className="meta-item">
                          <strong>보낸사람:</strong>
                          <span>{thread.fromName || thread.from} &lt;{thread.from}&gt;</span>
                        </span>
                        <span className="meta-item">
                          <strong>받은시간:</strong> {formatFullDate(thread.receivedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="modal-body">
                    {thread.bodyHtml ? (
                      <div
                        className="message-html"
                        onClick={handleHtmlClick}
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(thread.bodyHtml, {
                            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span'],
                            ALLOWED_ATTR: ['href', 'target', 'style', 'class']
                          })
                        }}
                      />
                    ) : (
                      <div className="message-text">{thread.body || '내용 없음'}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 아래쪽: 이후 메시지 버튼 */}
        {laterThreads.length > 0 && !showLater && (
          <button
            className="thread-expand-button-stack"
            onClick={() => setShowLater(true)}
          >
            ▼ 이후 메시지 {laterThreads.length}개
          </button>
        )}
      </div>
    </div>
  );
}

export default EmailConsultationModal;
