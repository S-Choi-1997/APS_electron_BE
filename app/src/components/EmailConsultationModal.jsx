/**
 * EmailConsultationModal.jsx - 이메일 상담 상세 모달
 *
 * ConsultationModal을 기반으로 이메일 전용 UI 구현
 */

import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { EMAIL_STATUS } from '../services/emailInquiryService';
import {
  useDownloadEmailAttachment,
  useEmailAttachments,
  useEmailContent,
  useEmailThread,
  useTranslateEmailInquiry,
} from '../hooks/queries/useEmailInquiries';
import { copyTextToClipboard, htmlToPlainText } from '../utils/clipboard';
import './ConsultationModal.css';

const EMAIL_HTML_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span',
  'blockquote', 'pre', 'code',
  'table', 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'img',
];

const EMAIL_HTML_ALLOWED_ATTR = [
  'href', 'target', 'rel', 'class', 'src', 'alt', 'width', 'height',
  'colspan', 'rowspan',
];

const RESPONSE_ATTACHMENT_MAX_COUNT = 10;
const RESPONSE_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const RESPONSE_ATTACHMENT_TOTAL_MAX_BYTES = 25 * 1024 * 1024;

function looksNonKorean(text = '') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const hangul = (normalized.match(/[가-힣]/g) || []).length;
  const latin = (normalized.match(/[A-Za-z]/g) || []).length;
  const japanese = (normalized.match(/[\u3040-\u30ff]/g) || []).length;
  const cjk = (normalized.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const letters = hangul + latin + japanese + cjk;
  if (letters < 20) return false;
  return hangul / letters < 0.18 && latin + japanese + cjk - hangul >= 20;
}

function EmailConsultationModal({ email, allEmails = [], onClose, onRespond }) {
  if (!email) return null;

  const [responseText, setResponseText] = useState('');
  const [sending, setSending] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [copyStatus, setCopyStatus] = useState(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translatedEmailOverride, setTranslatedEmailOverride] = useState(null);
  const [responseAttachments, setResponseAttachments] = useState([]);
  const [draggingAttachments, setDraggingAttachments] = useState(false);
  const [downloadingAllAttachments, setDownloadingAllAttachments] = useState(false);
  const responseAttachmentInputRef = useRef(null);
  const isZohoEmail = email.source === 'zoho';
  const canSendResponse = isZohoEmail && !email.isOutgoing;
  const responseUnavailableReason = !isZohoEmail
    ? 'Gmail 메일 답장은 아직 지원하지 않습니다.'
    : email.isOutgoing
      ? '보낸 메일에는 답장을 보낼 수 없습니다.'
      : '';
  const {
    data: fullContentResult = null,
    isLoading: loadingContent,
    isError: contentLoadFailed,
  } = useEmailContent(email.id, { enabled: isZohoEmail });
  const {
    data: attachments = [],
    isLoading: loadingAttachments,
    isError: attachmentsLoadFailed,
  } = useEmailAttachments(email.id, { enabled: isZohoEmail && Boolean(email.hasAttachments) && !email.isOutgoing });
  const {
    data: serverThreadEmails = [],
  } = useEmailThread(email.id);
  const downloadAttachmentMutation = useDownloadEmailAttachment();
  const translateMutation = useTranslateEmailInquiry();
  const fullContent = fullContentResult?.content || null;
  const translationEmail = translatedEmailOverride?.id === email.id
    ? { ...email, ...translatedEmailOverride }
    : email;
  const contentError = contentLoadFailed
    ? '전체 내용을 불러오지 못했습니다.'
    : fullContentResult?.unavailableReason || null;

  useEffect(() => {
    setTranslatedEmailOverride(null);
    setShowTranslation(false);
  }, [email.id]);

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getAttachmentKey = (file) => `${file.name}:${file.size}:${file.lastModified}`;

  const addResponseFiles = (fileList) => {
    if (!canSendResponse || sending) return;

    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const existingKeys = new Set(responseAttachments.map(getAttachmentKey));
    const accepted = [];
    const rejected = [];

    for (const file of files) {
      if (existingKeys.has(getAttachmentKey(file))) continue;

      if (responseAttachments.length + accepted.length >= RESPONSE_ATTACHMENT_MAX_COUNT) {
        rejected.push(`${file.name}: 최대 ${RESPONSE_ATTACHMENT_MAX_COUNT}개까지만 첨부할 수 있습니다.`);
        continue;
      }

      if (file.size > RESPONSE_ATTACHMENT_MAX_BYTES) {
        rejected.push(`${file.name}: 파일당 최대 ${formatFileSize(RESPONSE_ATTACHMENT_MAX_BYTES)}까지 첨부할 수 있습니다.`);
        continue;
      }

      const nextTotalBytes = [...responseAttachments, ...accepted, file].reduce((sum, item) => sum + item.size, 0);
      if (nextTotalBytes > RESPONSE_ATTACHMENT_TOTAL_MAX_BYTES) {
        rejected.push(`${file.name}: 첨부파일 총 용량은 ${formatFileSize(RESPONSE_ATTACHMENT_TOTAL_MAX_BYTES)}까지입니다.`);
        continue;
      }

      accepted.push(file);
      existingKeys.add(getAttachmentKey(file));
    }

    if (accepted.length > 0) {
      setResponseAttachments((prev) => [...prev, ...accepted]);
    }

    if (rejected.length > 0) {
      alert(rejected.join('\n'));
    }
  };

  const removeResponseAttachment = (targetFile) => {
    const targetKey = getAttachmentKey(targetFile);
    setResponseAttachments((prev) => prev.filter((file) => getAttachmentKey(file) !== targetKey));
  };

  const clearResponseDraft = () => {
    setResponseText('');
    setResponseAttachments([]);
    if (responseAttachmentInputRef.current) {
      responseAttachmentInputRef.current.value = '';
    }
  };

  const fileToBase64Attachment = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        contentBase64: result.includes(',') ? result.split(',')[1] : result,
      });
    };
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });

  const sanitizeEmailHtml = (html) => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: EMAIL_HTML_ALLOWED_TAGS,
    ALLOWED_ATTR: EMAIL_HTML_ALLOWED_ATTR,
  });

  const getMessageText = (html, fallbackText) => {
    if (html) return htmlToPlainText(html);
    return (fallbackText || '').trim();
  };

  const copyMessageText = async (html, fallbackText, label = '메일 본문') => {
    const messageText = getMessageText(html, fallbackText);
    if (!messageText) {
      showCopyResult('', '복사할 본문이 없습니다.', false);
      return;
    }

    const success = await copyTextToClipboard(messageText);
    showCopyResult(`${label}을 복사했습니다.`, `${label} 복사에 실패했습니다.`, success);
  };

  const handleDownloadAttachment = async (attachment) => {
    console.log('[Email Modal] Download clicked:', attachment.attachmentName);
    try {
      const downloadEndpoint = `/email-inquiries/${email.id}/attachments/${attachment.attachmentId}/download`;
      console.log('[Email Modal] Downloading from:', downloadEndpoint);

      const blob = await downloadAttachmentMutation.mutateAsync({
        emailId: email.id,
        attachmentId: attachment.attachmentId,
      });
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
          throw new Error(result.error || '파일 저장에 실패했습니다.');
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

  const saveAttachmentBlob = async (attachment, blob, directoryPath = null) => {
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Array.from(new Uint8Array(arrayBuffer));

    if (directoryPath && window.electron?.saveFileToDirectory) {
      const result = await window.electron.saveFileToDirectory(
        buffer,
        directoryPath,
        attachment.attachmentName
      );

      if (!result.success) {
        throw new Error(result.error || '파일 저장에 실패했습니다.');
      }

      return result;
    }

    if (window.electron?.saveFile) {
      const result = await window.electron.saveFile(buffer, attachment.attachmentName);
      if (!result.success && !result.canceled) {
        throw new Error(result.error || '파일 저장에 실패했습니다.');
      }
      return result;
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.attachmentName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    return { success: true };
  };

  const handleDownloadAllAttachments = async () => {
    if (!attachments.length || downloadingAllAttachments) return;

    let directoryPath = null;

    try {
      setDownloadingAllAttachments(true);

      if (window.electron?.selectDirectory && window.electron?.saveFileToDirectory) {
        const selectedDirectory = await window.electron.selectDirectory();
        if (selectedDirectory.canceled) return;
        if (!selectedDirectory.success) {
          throw new Error(selectedDirectory.error || '저장 폴더를 선택하지 못했습니다.');
        }
        directoryPath = selectedDirectory.directoryPath;
      }

      let savedCount = 0;
      for (const attachment of attachments) {
        const blob = await downloadAttachmentMutation.mutateAsync({
          emailId: email.id,
          attachmentId: attachment.attachmentId,
        });
        const result = await saveAttachmentBlob(attachment, blob, directoryPath);
        if (result.success) savedCount += 1;
      }

      showCopyResult(
        `첨부파일 ${savedCount}개를 저장했습니다.`,
        '첨부파일 전체 다운로드에 실패했습니다.',
        savedCount === attachments.length
      );
    } catch (error) {
      console.error('[Email Modal] Failed to download all attachments:', error);
      alert('첨부파일 전체 다운로드에 실패했습니다: ' + error.message);
    } finally {
      setDownloadingAllAttachments(false);
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

  const getThreadKey = (item) => item.threadId || item.inReplyTo || item.messageId;

  const referencesContainMessage = (item, messageId) => {
    if (!messageId || !Array.isArray(item.references)) return false;
    return item.references.includes(messageId);
  };

  const isSameThread = (candidate, current) => {
    if (candidate.id === current.id) return false;

    const currentThreadKey = getThreadKey(current);
    const candidateThreadKey = getThreadKey(candidate);

    if (current.threadId && candidate.threadId && current.threadId === candidate.threadId) return true;
    if (current.messageId && candidate.inReplyTo === current.messageId) return true;
    if (candidate.messageId && current.inReplyTo === candidate.messageId) return true;
    if (current.inReplyTo && candidate.messageId === current.inReplyTo) return true;
    if (candidate.inReplyTo && current.messageId === candidate.inReplyTo) return true;
    if (referencesContainMessage(candidate, current.messageId)) return true;
    if (referencesContainMessage(current, candidate.messageId)) return true;

    return Boolean(currentThreadKey && candidateThreadKey && currentThreadKey === candidateThreadKey);
  };

  // 스레드 관련 이메일 찾기 (threadId/inReplyTo/references 우선)
  const getThreadEmails = () => {
    const sourceEmails = serverThreadEmails.length > 0 ? serverThreadEmails : allEmails;
    if (!sourceEmails || sourceEmails.length === 0) return { before: [], after: [] };

    // 현재 이메일의 수신 시간
    const currentTime = new Date(email.receivedAt).getTime();

    const threadEmails = sourceEmails.filter(e => isSameThread(e, email));

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

  const showCopyResult = (successMessage, failedMessage, success) => {
    setCopyStatus(success ? successMessage : failedMessage);
    setTimeout(() => setCopyStatus(null), 1800);
  };

  const getCurrentMessageText = () => {
    return getMessageText(fullContent || email.bodyHtml, email.body);
  };

  const hasTranslation = translationEmail.translationStatus === 'completed' && Boolean(translationEmail.translatedBody);
  const translationCanRetry = ['failed', 'disabled', 'not_required'].includes(translationEmail.translationStatus);
  const translationBusy = translationEmail.translationStatus === 'pending' || translateMutation.isPending;
  const likelyNonKorean = !email.isOutgoing && looksNonKorean(`${email.subject || ''}\n${getCurrentMessageText()}`);
  const shouldShowTranslationControl =
    hasTranslation || translationBusy || likelyNonKorean || ['failed', 'disabled'].includes(translationEmail.translationStatus);
  const displayedSubject = showTranslation && translationEmail.translatedSubject ? translationEmail.translatedSubject : email.subject;
  const displayedBody = showTranslation && hasTranslation ? translationEmail.translatedBody : null;

  const getTranslationButtonLabel = () => {
    if (showTranslation && hasTranslation) return '원문 보기';
    if (hasTranslation) return '번역 보기';
    if (translationBusy) return '번역 준비 중';
    if (translationEmail.translationStatus === 'disabled') return '번역 재시도';
    if (translationEmail.translationStatus === 'failed') return '번역 재시도';
    return '번역하기';
  };

  const handleTranslationClick = async () => {
    if (hasTranslation) {
      setShowTranslation((value) => !value);
      return;
    }

    if (!translationCanRetry || translationBusy) return;

    try {
      const translatedEmail = await translateMutation.mutateAsync(email.id);
      if (translatedEmail?.translationStatus === 'completed') {
        setTranslatedEmailOverride(translatedEmail);
        setShowTranslation(true);
      }
    } catch (error) {
      showCopyResult('', `번역 실패: ${error.message}`, false);
    }
  };

  const handleCopyEmail = async () => {
    const address = cleanEmail(email.from);
    if (!address) return;

    const success = await copyTextToClipboard(address);
    showCopyResult('이메일 주소를 복사했습니다.', '이메일 주소 복사에 실패했습니다.', success);
  };

  const handleCopyMessage = async () => {
    if (showTranslation && hasTranslation) {
      const success = await copyTextToClipboard(translationEmail.translatedBody);
      showCopyResult('번역 본문을 복사했습니다.', '번역 본문 복사에 실패했습니다.', success);
      return;
    }

    await copyMessageText(fullContent || email.bodyHtml, email.body);
  };

  const handleCopyThreadMessage = async (thread) => {
    await copyMessageText(thread.bodyHtml, thread.body, '스레드 본문');
  };

  const handleSendResponse = async () => {
    if (!canSendResponse) {
      alert(responseUnavailableReason || '이 메일에는 답장을 보낼 수 없습니다.');
      return;
    }

    if (!responseText.trim()) {
      alert('답변 내용을 입력해주세요.');
      return;
    }

    try {
      setSending(true);
      const attachmentPayload = await Promise.all(responseAttachments.map(fileToBase64Attachment));
      await onRespond(email.id, responseText, attachmentPayload);

      clearResponseDraft();

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
            throw new Error(result.error || '파일 다운로드에 실패했습니다.');
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
              <>
                <div className="message-toolbar thread-message-toolbar">
                  <button type="button" className="copy-btn" onClick={() => handleCopyThreadMessage(thread)}>
                    본문 복사
                  </button>
                </div>
              <div
                className="message-html selectable-content"
                onClick={handleHtmlClick}
                dangerouslySetInnerHTML={{
                  __html: sanitizeEmailHtml(thread.bodyHtml)
                }}
              />
              </>
            ) : (
              <>
                <div className="message-toolbar thread-message-toolbar">
                  <button type="button" className="copy-btn" onClick={() => handleCopyThreadMessage(thread)} disabled={!thread.body}>
                    본문 복사
                  </button>
                </div>
                <div className="thread-text selectable-content">{thread.body || '내용 없음'}</div>
              </>
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
      {copyStatus && (
        <div className="email-copy-status" role="status">
          {copyStatus}
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
                      <>
                        <div className="message-toolbar thread-message-toolbar">
                          <button type="button" className="copy-btn" onClick={() => handleCopyThreadMessage(thread)}>
                            본문 복사
                          </button>
                        </div>
                      <div
                        className="message-html selectable-content"
                        onClick={handleHtmlClick}
                        dangerouslySetInnerHTML={{
                          __html: sanitizeEmailHtml(thread.bodyHtml)
                        }}
                      />
                      </>
                    ) : (
                      <>
                        <div className="message-toolbar thread-message-toolbar">
                          <button type="button" className="copy-btn" onClick={() => handleCopyThreadMessage(thread)} disabled={!thread.body}>
                            본문 복사
                          </button>
                        </div>
                        <div className="message-text selectable-content">{thread.body || '내용 없음'}</div>
                      </>
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
                  <h2 className="modal-title">{displayedSubject}</h2>
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
                      {email.status === EMAIL_STATUS.RESPONDED && '응답'}
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
                  <div className="message-toolbar">
                    {shouldShowTranslationControl && (
                      <button
                        type="button"
                        className={`translation-btn ${hasTranslation ? 'available' : ''}`}
                        onClick={handleTranslationClick}
                        disabled={translationBusy}
                        title={translationEmail.translationError || ''}
                      >
                        {getTranslationButtonLabel()}
                      </button>
                    )}
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={handleCopyMessage}
                      disabled={!getCurrentMessageText()}
                    >
                      본문 복사
                    </button>
                  </div>
                  {showTranslation && hasTranslation ? (
                    <div className="message-text selectable-content translated-message">
                      {displayedBody}
                    </div>
                  ) : (fullContent || email.bodyHtml) ? (
                    <div
                      className="message-html selectable-content"
                      onClick={handleHtmlClick}
                      dangerouslySetInnerHTML={{
                        __html: sanitizeEmailHtml(fullContent || email.bodyHtml)
                      }}
                    />
                  ) : (
                    <div className="message-text selectable-content">
                      {email.body || '(내용 없음)'}
                    </div>
                  )}
                </>
              )}

              {/* 첨부파일 섹션 */}
              {email.hasAttachments && (
                <div className="attachments-section">
                  <div className="attachments-header">
                    <h4 className="attachments-title">📎 첨부파일</h4>
                    {isZohoEmail && attachments.length > 0 && (
                      <button
                        type="button"
                        className="download-all-attachments-btn"
                        onClick={handleDownloadAllAttachments}
                        disabled={downloadingAllAttachments}
                      >
                        {downloadingAllAttachments ? '저장 중...' : '전체 다운로드'}
                      </button>
                    )}
                  </div>
                  {!isZohoEmail ? (
                    <div className="attachments-empty">Gmail 첨부파일 조회는 아직 지원하지 않습니다.</div>
                  ) : email.isOutgoing ? (
                    <div className="attachments-empty">보낸 메일 첨부파일은 메일함에서 확인할 수 있습니다. 앱에서는 받은 메일 첨부 다운로드만 지원합니다.</div>
                  ) : attachmentsLoadFailed ? (
                    <div className="attachments-empty">첨부파일 조회에 필요한 ZOHO 폴더 정보가 없거나 조회에 실패했습니다.</div>
                  ) : loadingAttachments ? (
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
                placeholder={canSendResponse ? '답변 내용을 입력하세요...' : responseUnavailableReason}
                disabled={sending || !canSendResponse}
              />

              {canSendResponse && (
                <div
                  className={`response-attachment-dropzone ${draggingAttachments ? 'dragging' : ''}`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDraggingAttachments(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDraggingAttachments(true);
                  }}
                  onDragLeave={(e) => {
                    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
                    setDraggingAttachments(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDraggingAttachments(false);
                    addResponseFiles(e.dataTransfer.files);
                  }}
                >
                  <input
                    ref={responseAttachmentInputRef}
                    type="file"
                    multiple
                    className="response-attachment-input"
                    onChange={(e) => {
                      addResponseFiles(e.target.files);
                      e.target.value = '';
                    }}
                    disabled={sending}
                  />
                  <div className="response-attachment-dropzone-main">
                    <span className="response-attachment-dropzone-title">첨부파일</span>
                    <span className="response-attachment-dropzone-hint">
                      파일을 끌어오거나 버튼으로 선택하세요. 최대 {RESPONSE_ATTACHMENT_MAX_COUNT}개, 총 {formatFileSize(RESPONSE_ATTACHMENT_TOTAL_MAX_BYTES)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="response-attachment-picker-btn"
                    onClick={() => responseAttachmentInputRef.current?.click()}
                    disabled={sending}
                  >
                    파일 선택
                  </button>
                </div>
              )}

              {responseAttachments.length > 0 && (
                <ul className="response-attachment-list">
                  {responseAttachments.map((file) => (
                    <li key={getAttachmentKey(file)} className="response-attachment-item">
                      <span className="response-attachment-name">{file.name}</span>
                      <span className="response-attachment-size">{formatFileSize(file.size)}</span>
                      <button
                        type="button"
                        className="response-attachment-remove-btn"
                        onClick={() => removeResponseAttachment(file)}
                        disabled={sending}
                        aria-label={`${file.name} 첨부 제거`}
                      >
                        제거
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {!canSendResponse && (
                <div className="response-disabled-message">{responseUnavailableReason}</div>
              )}

              <div className="response-actions">
                <button
                  className="send-button primary"
                  onClick={handleSendResponse}
                  disabled={sending || !canSendResponse || !responseText.trim()}
                >
                  {sending ? '전송 중...' : '답변 전송'}
                </button>
                <button
                  className="cancel-button"
                  onClick={() => {
                    clearResponseDraft();
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
                      <>
                        <div className="message-toolbar thread-message-toolbar">
                          <button type="button" className="copy-btn" onClick={() => handleCopyThreadMessage(thread)}>
                            본문 복사
                          </button>
                        </div>
                      <div
                        className="message-html selectable-content"
                        onClick={handleHtmlClick}
                        dangerouslySetInnerHTML={{
                          __html: sanitizeEmailHtml(thread.bodyHtml)
                        }}
                      />
                      </>
                    ) : (
                      <>
                        <div className="message-toolbar thread-message-toolbar">
                          <button type="button" className="copy-btn" onClick={() => handleCopyThreadMessage(thread)} disabled={!thread.body}>
                            본문 복사
                          </button>
                        </div>
                        <div className="message-text selectable-content">{thread.body || '내용 없음'}</div>
                      </>
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
