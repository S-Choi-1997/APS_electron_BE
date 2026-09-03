import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import useDebounce from '../hooks/useDebounce';
import {
  useAddEmailLabel,
  useArchiveEmail,
  useDeleteEmailDraft,
  useDeleteEmailPermanently,
  useDeleteScheduledEmail,
  useDownloadEmailAttachment,
  useEmailAttachments,
  useEmailContent,
  useEmailDetail,
  useEmailDrafts,
  useEmailFolders,
  useEmailLabels,
  useEmailMailbox,
  useEmailStats,
  useTranslateEmailInquiry,
  useRemoveEmailLabel,
  useReplyToEmail,
  useRestoreEmail,
  useSaveEmailDraft,
  useScheduleEmail,
  useSendEmail,
  useSendEmailDraft,
  useScheduledEmails,
  useSendScheduledNow,
  useSetEmailFlag,
  useSetEmailReadState,
  useSetEmailResponseState,
  useTrashEmail,
  useUnarchiveEmail,
  useTriggerZohoSync,
} from '../hooks/queries/useEmailInquiries';
import { EMAIL_STATUS } from '../services/emailInquiryService';
import { useEmailPageState } from '../hooks/useEmailPageState';
import { auth } from '../auth/authManager';
import { copyTextToClipboard, htmlToPlainText } from '../utils/clipboard';
import { buildEmailPrintDocument } from '../utils/emailPrintDocument';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import RichTextEditor from '../components/email/RichTextEditor';
import RecipientInput from '../components/email/RecipientInput';
import './EmailConsultationsPage.css';

const PAGE_SIZE = 20;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;

const MAILBOXES = [
  { key: 'inbox', label: '받은 메일' },
  { key: 'sent', label: '보낸 메일' },
  { key: 'drafts', label: '임시보관' },
  { key: 'scheduled', label: '예약 발송' },
  { key: 'archive', label: '보관함' },
  { key: 'trash', label: '휴지통' },
];

const EMPTY_COMPOSER = {
  mode: 'compose',
  emailId: null,
  originalEmailId: null,
  draftId: null,
  scheduledId: null,
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
  bodyHtml: '',
  scheduledAt: '',
  attachments: [],
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_EXTRACT_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function uniqueRecipients(values) {
  const seen = new Set();
  return values
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseRecipientText(value) {
  const source = String(value || '').replace(/\u3000/g, ' ');
  return source
    .split(/[,\n;]+/)
    .flatMap((chunk) => {
      const trimmed = chunk.trim();
      if (!trimmed) return [];
      const matches = trimmed.match(EMAIL_EXTRACT_PATTERN);
      if (matches?.length) return matches.map((item) => item.trim());
      return trimmed.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    });
}

function splitRecipients(value) {
  if (Array.isArray(value)) {
    return uniqueRecipients(value.flatMap((item) => splitRecipients(item)));
  }
  return uniqueRecipients(parseRecipientText(value));
}

function joinRecipients(value) {
  return splitRecipients(value).join(', ');
}

function normalizeEmailAddress(value) {
  const text = String(value || '').trim();
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch ? emailMatch[0] : text;
}

function formatNamedEmailAddress(name, address) {
  const displayName = String(name || '').trim();
  const emailAddress = normalizeEmailAddress(address);
  if (!emailAddress) return displayName || '-';
  if (!displayName || normalizeEmailAddress(displayName).toLowerCase() === emailAddress.toLowerCase()) {
    return emailAddress;
  }
  return `${displayName} <${emailAddress}>`;
}

function useDismissiblePopover(open, setOpen) {
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, setOpen]);

  return popoverRef;
}

function collectEmailAddresses(...values) {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return collectEmailAddresses(...value);
    return splitRecipients(value).map(normalizeEmailAddress).filter(Boolean);
  });
}

function uniqueEmailAddresses(values, excludedValues = []) {
  const seen = new Set(collectEmailAddresses(excludedValues).map((value) => value.toLowerCase()));
  return collectEmailAddresses(values).filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function formatAttachmentSize(size = 0) {
  const bytes = Number(size || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function readAttachmentFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve({
        filename: file.name,
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        type: file.type || 'application/octet-stream',
        size: file.size,
        contentBase64: result.includes(',') ? result.split(',').pop() : result,
      });
    };
    reader.onerror = () => reject(reader.error || new Error('Attachment read failed'));
    reader.readAsDataURL(file);
  });
}

function validateComposerAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    return `첨부파일은 최대 ${MAX_ATTACHMENT_COUNT}개까지 보낼 수 있습니다.`;
  }
  const oversized = attachments.find((attachment) => Number(attachment.size || 0) > MAX_ATTACHMENT_BYTES);
  if (oversized) {
    return `${oversized.filename || oversized.name || '첨부파일'}은 20MB를 초과합니다.`;
  }
  const totalBytes = attachments.reduce((sum, attachment) => sum + Number(attachment.size || 0), 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return '첨부파일 전체 용량은 25MB를 초과할 수 없습니다.';
  }
  return '';
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays > 0 && diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
}

function formatScheduledDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((targetDay.getTime() - today.getTime()) / 86400000);
  const time = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  if (diffDays === 0) return `오늘 ${time}`;
  if (diffDays === 1) return `내일 ${time}`;
  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFullDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSenderLabel(email) {
  if (!email) return '-';
  if (email.direction === 'outgoing') return joinRecipients(email.to) || email.toEmail || '받는 사람 없음';
  return email.fromName || email.from || '발신자 없음';
}

function getMessageDate(email) {
  return email?.receivedAt || email?.sentAt || email?.updatedAt || email?.createdAt;
}

function getStatusLabel(email) {
  if (email?.responseState === 'responded' || email?.status === EMAIL_STATUS.RESPONDED) return '응답';
  if (email?.readState === EMAIL_STATUS.UNREAD || email?.status === EMAIL_STATUS.UNREAD) return '미확인';
  return '확인';
}

function getDeliveryLabel(email) {
  if (!email?.isOutgoing && email?.direction !== 'outgoing') return null;
  if (email.deliveryStatus === 'failed') return '반송됨';
  if (email.deliveryStatus === 'partial') return '일부 반송';
  return '발송 접수';
}

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

const EMAIL_SCROLL_STYLE_PROPERTIES = [
  'height',
  'max-height',
  'min-height',
  'overflow',
  'overflow-x',
  'overflow-y',
  'resize',
];

function sanitizeEmailHtmlForDisplay(html = '') {
  const sanitizedHtml = DOMPurify.sanitize(html);
  if (!sanitizedHtml || typeof document === 'undefined') return sanitizedHtml;

  const template = document.createElement('template');
  template.innerHTML = sanitizedHtml;

  template.content.querySelectorAll('*').forEach((element) => {
    if (!(element instanceof HTMLElement)) return;

    EMAIL_SCROLL_STYLE_PROPERTIES.forEach((property) => {
      element.style.removeProperty(property);
    });

    if (element.tagName.toLowerCase() !== 'img') {
      element.removeAttribute('height');
    }
    element.removeAttribute('scrolling');
  });

  return template.innerHTML;
}

function printHtmlDocument(html) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('출력 환경을 찾을 수 없습니다.'));
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', '메일 출력');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';

    let settled = false;
    let printRequested = false;
    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument || frameWindow?.document;
    if (!frameWindow || !frameDocument) {
      fail(new Error('출력 창을 만들 수 없습니다.'));
      return;
    }

    const printFrame = () => {
      if (printRequested) return;
      printRequested = true;
      window.setTimeout(() => {
        try {
          if (typeof frameWindow.print !== 'function') {
            throw new Error('출력 기능을 사용할 수 없습니다.');
          }
          frameWindow.focus();
          frameWindow.print();
          if (!settled) {
            settled = true;
            resolve();
          }
        } catch (error) {
          fail(error);
        }
      }, 80);
    };

    frameWindow.addEventListener('afterprint', cleanup, { once: true });
    iframe.addEventListener('load', printFrame, { once: true });
    frameDocument.open();
    frameDocument.write(html);
    frameDocument.close();

    window.setTimeout(() => {
      if (!settled) printFrame();
    }, 500);
    window.setTimeout(cleanup, 60000);
  });
}

function normalizeDraftLike(item) {
  return {
    originalEmailId: item?.originalEmailId || item?.original_email_id || null,
    to: joinRecipients(item?.to),
    cc: joinRecipients(item?.cc),
    bcc: joinRecipients(item?.bcc),
    subject: item?.subject || '',
    body: item?.body || item?.bodyText || '',
    bodyHtml: item?.bodyHtml || '',
    scheduledAt: item?.scheduledAt ? new Date(item.scheduledAt).toISOString().slice(0, 16) : '',
    attachments: Array.isArray(item?.attachments) ? item.attachments : [],
  };
}

function buildComposerPayload(composer) {
  const isReplyMode = composer.mode === 'reply' || composer.mode === 'replyAll';
  return {
    originalEmailId: isReplyMode ? (composer.originalEmailId || composer.emailId || null) : null,
    to: splitRecipients(composer.to),
    cc: splitRecipients(composer.cc),
    bcc: splitRecipients(composer.bcc),
    subject: composer.subject.trim(),
    body: composer.body,
    bodyText: composer.body,
    bodyHtml: composer.bodyHtml || null,
    attachments: Array.isArray(composer.attachments) ? composer.attachments : [],
  };
}

function canReplyToEmail(email) {
  if (!email) return false;
  if (email.capabilities?.reply !== undefined) return Boolean(email.capabilities.reply);
  return email.source === 'zoho' && Boolean(email.messageId) && !email.isOutgoing;
}

function validateComposer(composer, { requireTo = true, requireFutureSchedule = false, requireContent = true } = {}) {
  const to = splitRecipients(composer.to);
  const cc = splitRecipients(composer.cc);
  const bcc = splitRecipients(composer.bcc);
  const invalidRecipients = [...to, ...cc, ...bcc].filter((email) => !EMAIL_PATTERN.test(email));
  const attachmentError = validateComposerAttachments(composer.attachments);

  if (requireTo && to.length === 0) return '받는사람을 한 명 이상 입력하세요.';
  if (invalidRecipients.length > 0) return `이메일 형식을 확인하세요: ${invalidRecipients.join(', ')}`;
  if (requireContent && !composer.subject.trim()) return '제목을 입력하세요.';
  if (requireContent && !composer.body.trim() && !composer.bodyHtml?.replace(/<[^>]*>/g, '').trim()) return '본문을 입력하세요.';

  if (attachmentError) return attachmentError;

  if (requireFutureSchedule) {
    const scheduledAt = new Date(composer.scheduledAt);
    if (!composer.scheduledAt || Number.isNaN(scheduledAt.getTime())) return '예약 시간을 입력하세요.';
    if (scheduledAt.getTime() <= Date.now()) return '예약 시간은 현재보다 이후여야 합니다.';
  }

  return '';
}

function MailRow({ item, active, onClick }) {
  const unread = item.status === EMAIL_STATUS.UNREAD || item.readState === EMAIL_STATUS.UNREAD;
  const label = getStatusLabel(item);

  return (
    <button
      type="button"
      className={`mail-row ${active ? 'active' : ''} ${unread ? 'unread' : ''}`}
      onClick={() => onClick(item)}
    >
      <span className="mail-row-check" aria-hidden="true">{unread ? '●' : ''}</span>
      <span className="mail-row-main">
        <span className="mail-row-meta">
          <span className="mail-row-sender">{getSenderLabel(item)}</span>
          <span className="mail-row-date">{formatDate(getMessageDate(item))}</span>
        </span>
        <span className="mail-row-subject">{item.subject || '(제목 없음)'}</span>
        <span className="mail-row-preview">{item.preview || item.bodyText || item.body || ''}</span>
        <span className="mail-row-tags">
          <span className="mail-tag source">{item.source || item.status || 'mail'}</span>
          {item.hasAttachments || item.attachmentCount > 0 ? <span className="mail-tag">첨부 {item.attachmentCount || ''}</span> : null}
          {getDeliveryLabel(item) ? <span className={`mail-tag delivery ${item.deliveryStatus || 'accepted'}`}>{getDeliveryLabel(item)}</span> : null}
          <span className={`mail-tag state ${label === '응답' ? 'done' : ''}`}>{label}</span>
        </span>
      </span>
    </button>
  );
}

function DraftRow({ item, active, onClick, dateValue, dateFormatter = formatDate }) {
  const displayDate = dateValue || item.updatedAt || item.createdAt || item.scheduledAt;
  return (
    <button
      type="button"
      className={`mail-row draft-row ${active ? 'active' : ''}`}
      onClick={() => onClick(item)}
    >
      <span className="mail-row-check" aria-hidden="true">◇</span>
      <span className="mail-row-main">
        <span className="mail-row-meta">
          <span className="mail-row-sender">{joinRecipients(item.to) || '받는 사람 없음'}</span>
          <span className="mail-row-date">{dateFormatter(displayDate)}</span>
        </span>
        <span className="mail-row-subject">{item.subject || '(제목 없음)'}</span>
        <span className="mail-row-preview">{item.body || item.failureReason || ''}</span>
        <span className="mail-row-tags">
          <span className="mail-tag source">{item.status || 'draft'}</span>
        </span>
      </span>
    </button>
  );
}

function Composer({
  composer,
  onChange,
  onClose,
  onSend,
  onSaveDraft,
  onSchedule,
  sending,
  contentLocked = false,
  errorMessage = '',
  lockMessage = '',
  onError = () => {},
}) {
  const canSchedule = Boolean(composer.scheduledAt);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const allAttachments = Array.isArray(composer.attachments) ? composer.attachments : [];
  const attachments = allAttachments.filter(attachment => attachment.inline !== true);
  const attachmentTotalBytes = attachments.reduce((sum, attachment) => sum + Number(attachment.size || 0), 0);
  const attachmentHint = attachments.length > 0
    ? `${attachments.length}개 / ${formatAttachmentSize(attachmentTotalBytes)}`
    : `최대 ${MAX_ATTACHMENT_COUNT}개, 파일당 20MB`;
  const composerModeLabel = {
    reply: '답장',
    replyAll: '전체 답장',
    forward: '전달',
    draft: '임시보관',
    scheduled: '예약 발송',
    compose: '새 메일',
  }[composer.mode] || '메일 작성';
  const excludedRecipientEmails = [
    composer.to,
    composer.cc,
    composer.bcc,
    auth.currentUser?.email,
    auth.currentUser?.emailAddress,
  ];

  const addAttachmentFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    try {
      const nextAttachments = await Promise.all(files.map(readAttachmentFile));
      const mergedAttachments = [...allAttachments, ...nextAttachments];
      const validationError = validateComposerAttachments(mergedAttachments);
      if (validationError) {
        onError(validationError);
        return;
      }
      onChange({ attachments: mergedAttachments });
    } catch (error) {
      onError(error?.message || '첨부파일을 읽지 못했습니다.');
    }
  };

  const handleAttachmentChange = async (event) => {
    const files = event.target.files;
    event.target.value = '';
    await addAttachmentFiles(files);
  };

  const handleAttachmentDrop = async (event) => {
    event.preventDefault();
    setAttachmentDragActive(false);
    if (contentLocked) return;
    await addAttachmentFiles(event.dataTransfer?.files);
  };

  const handleAttachmentDragOver = (event) => {
    event.preventDefault();
    if (!contentLocked) {
      event.dataTransfer.dropEffect = 'copy';
      setAttachmentDragActive(true);
    }
  };

  const handleAttachmentDragLeave = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setAttachmentDragActive(false);
    }
  };

  const removeAttachment = (index) => {
    onChange({
      attachments: allAttachments.filter(attachment => attachment.inline === true || attachment !== attachments[index]),
    });
  };

  const addInlineImage = (newInlineImages) => {
    const mergedAttachments = [...allAttachments, ...(newInlineImages || [])];
    const validationError = validateComposerAttachments(mergedAttachments);
    if (validationError) {
      onError(validationError);
      return false;
    }
    onChange({ attachments: mergedAttachments });
    return true;
  };

  const handleEditorChange = (patch) => {
    onChange(patch);
  };

  return (
    <form className="mail-composer" onSubmit={onSend}>
      <div className="composer-tabs">
        <div className="composer-header-main">
          <span className="composer-mode">{composerModeLabel}</span>
        </div>
        <button type="button" className="ghost-button composer-close-button" onClick={onClose}>닫기</button>
      </div>
      <div className="composer-fields">
        <div className="composer-field-row">
          <span className="composer-field-label">받는사람</span>
          <RecipientInput
            value={composer.to}
            onChange={(value) => onChange({ to: value })}
            disabled={contentLocked}
            placeholder="받는 사람 이메일"
            ariaLabel="받는사람"
            excludedEmails={excludedRecipientEmails}
          />
        </div>
        <div className="composer-field-row">
          <span className="composer-field-label">참조</span>
          <RecipientInput
            value={composer.cc}
            onChange={(value) => onChange({ cc: value })}
            disabled={contentLocked}
            placeholder="참조 이메일"
            ariaLabel="참조"
            excludedEmails={excludedRecipientEmails}
          />
        </div>
        <div className="composer-field-row">
          <span className="composer-field-label">숨은참조</span>
          <RecipientInput
            value={composer.bcc}
            onChange={(value) => onChange({ bcc: value })}
            disabled={contentLocked}
            placeholder="숨은참조 이메일"
            ariaLabel="숨은참조"
            excludedEmails={excludedRecipientEmails}
          />
        </div>
        <label className="composer-field-row">
          <span className="composer-field-label">제목</span>
          <input
            value={composer.subject}
            onChange={(event) => onChange({ subject: event.target.value })}
            disabled={contentLocked}
            placeholder="메일 제목"
          />
        </label>
      </div>
      {lockMessage ? <p className="composer-notice">{lockMessage}</p> : null}
      <RichTextEditor
        bodyHtml={composer.bodyHtml}
        bodyText={composer.body}
        disabled={contentLocked}
        onChange={handleEditorChange}
        onInlineImage={addInlineImage}
        onError={onError}
      />
      <div
        className={`composer-attachments ${attachmentDragActive ? 'dragging' : ''} ${contentLocked ? 'disabled' : ''}`}
        onDragEnter={handleAttachmentDragOver}
        onDragOver={handleAttachmentDragOver}
        onDragLeave={handleAttachmentDragLeave}
        onDrop={handleAttachmentDrop}
      >
        <div className="composer-attachment-summary">
          <span className="composer-attachment-mark" aria-hidden="true" />
          <div className="composer-attachment-copy">
            <strong>첨부파일</strong>
            <span>{contentLocked ? '예약 메일은 첨부파일을 변경할 수 없습니다.' : `파일을 끌어오거나 선택하세요. ${attachmentHint}`}</span>
          </div>
        </div>
        <label className={`attachment-picker ${contentLocked ? 'disabled' : ''}`}>
          파일 선택
          <input type="file" multiple onChange={handleAttachmentChange} disabled={contentLocked} aria-label="첨부파일 선택" />
        </label>
        {attachments.length > 0 ? (
          <ul className="composer-attachment-list">
            {attachments.map((attachment, index) => (
              <li className="composer-attachment-chip" key={`${attachment.filename || attachment.name}-${index}`}>
                <span title={attachment.filename || attachment.name}>{attachment.filename || attachment.name}</span>
                <small>{formatAttachmentSize(attachment.size)}</small>
                <button type="button" onClick={() => removeAttachment(index)} disabled={contentLocked} aria-label="첨부 제거">x</button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {errorMessage ? <p className="composer-error">{errorMessage}</p> : null}
      <div className="composer-footer">
        <label className="schedule-field">
          예약
          <input
            type="datetime-local"
            value={composer.scheduledAt}
            onChange={(event) => onChange({ scheduledAt: event.target.value })}
          />
        </label>
        <div className="composer-actions">
          <button type="button" className="secondary-button" onClick={onSaveDraft} disabled={sending || contentLocked}>
            임시 저장
          </button>
          <button type="button" className="secondary-button" onClick={onSchedule} disabled={sending || !canSchedule}>
            예약 저장
          </button>
          <button type="submit" className="primary-button" disabled={sending || contentLocked}>
            보내기
          </button>
        </div>
      </div>
    </form>
  );
}

function EmailConsultationsPage() {
  const {
    mailbox,
    selectedId,
    selectedDraftId,
    selectedScheduledId,
    searchTerm,
    readState,
    responseState,
    labelId,
    hasAttachments,
    starred,
    page,
    composer,
    composerDirty,
    actionError,
    restoreFolderId,
    lastSyncMessage,
    showTranslation,
    translatedEmailOverride,
    filtersOpen,
    actionsOpen,
    setMailbox,
    setSelectedId,
    setSelectedDraftId,
    setSelectedScheduledId,
    setSearchTerm,
    setReadState,
    setResponseState,
    setLabelId,
    setHasAttachments,
    setStarred,
    setPage,
    setComposer,
    setComposerDirty,
    setActionError,
    setRestoreFolderId,
    setLastSyncMessage,
    setShowTranslation,
    setTranslatedEmailOverride,
    setFiltersOpen,
    setActionsOpen,
  } = useEmailPageState();
  const filterMenuRef = useDismissiblePopover(filtersOpen, setFiltersOpen);
  const actionMenuRef = useDismissiblePopover(actionsOpen, setActionsOpen);
  const debouncedSearch = useDebounce(searchTerm, 300);
  const pendingConfirmActionRef = useRef(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState([]);
  const [labelSaving, setLabelSaving] = useState(false);
  const [bodyCopyState, setBodyCopyState] = useState('idle');
  const bodyCopyTimerRef = useRef(null);

  const filters = useMemo(() => ({
    search: debouncedSearch.trim() || undefined,
    readState: readState === 'all' ? undefined : readState,
    responseState: responseState === 'all' ? undefined : responseState,
    labelId: labelId || undefined,
    hasAttachments: hasAttachments ? true : undefined,
    starred: starred ? true : undefined,
  }), [debouncedSearch, hasAttachments, labelId, readState, responseState, starred]);
  const activeFilterCount = [
    readState !== 'all',
    responseState !== 'all',
    Boolean(labelId),
    hasAttachments,
    starred,
  ].filter(Boolean).length;

  const pageParams = useMemo(() => ({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }), [page]);
  const draftScheduleParams = useMemo(() => ({
    search: filters.search,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [filters.search, page]);
  const isDraftMailbox = mailbox === 'drafts';
  const isScheduledMailbox = mailbox === 'scheduled';
  const isMailMailbox = !isDraftMailbox && !isScheduledMailbox;

  const mailboxQuery = useEmailMailbox(mailbox, filters, pageParams, { enabled: isMailMailbox });
  const draftsQuery = useEmailDrafts(draftScheduleParams, { enabled: isDraftMailbox });
  const scheduledQuery = useScheduledEmails(draftScheduleParams, { enabled: isScheduledMailbox });
  const { data: stats = {} } = useEmailStats();
  const { data: labels = [] } = useEmailLabels();
  const { data: folders = [] } = useEmailFolders();

  const activeQuery = isDraftMailbox ? draftsQuery : isScheduledMailbox ? scheduledQuery : mailboxQuery;
  const pageData = activeQuery.data || { items: [], total: 0, count: 0, hasMore: false };
  const items = pageData.items || [];
  const total = Number(pageData.total ?? pageData.count ?? items.length);
  const hasNextPage = pageData.hasMore || (page + 1) * PAGE_SIZE < total;

  const { data: detail } = useEmailDetail(selectedId, { enabled: Boolean(selectedId) && isMailMailbox });
  const selectedEmail = detail || items.find((item) => String(item.id) === String(selectedId)) || null;
  const { data: content } = useEmailContent(selectedId, { enabled: Boolean(selectedId) && isMailMailbox });
  const { data: attachments = [] } = useEmailAttachments(selectedId, {
    enabled: Boolean(selectedId) && isMailMailbox && selectedEmail?.source === 'zoho' && Boolean(selectedEmail?.messageId),
  });

  const syncMutation = useTriggerZohoSync();
  const markReadMutation = useSetEmailReadState();
  const responseStateMutation = useSetEmailResponseState();
  const archiveMutation = useArchiveEmail();
  const unarchiveMutation = useUnarchiveEmail();
  const trashMutation = useTrashEmail();
  const restoreMutation = useRestoreEmail();
  const permanentDeleteMutation = useDeleteEmailPermanently();
  const flagMutation = useSetEmailFlag();
  const addLabelMutation = useAddEmailLabel();
  const removeLabelMutation = useRemoveEmailLabel();
  const sendMutation = useSendEmail();
  const replyMutation = useReplyToEmail();
  const saveDraftMutation = useSaveEmailDraft();
  const deleteDraftMutation = useDeleteEmailDraft();
  const sendDraftMutation = useSendEmailDraft();
  const scheduleMutation = useScheduleEmail();
  const deleteScheduledMutation = useDeleteScheduledEmail();
  const sendScheduledNowMutation = useSendScheduledNow();
  const downloadAttachmentMutation = useDownloadEmailAttachment();
  const translateMutation = useTranslateEmailInquiry();

  const restoreFolders = useMemo(() => folders.filter((folder) => {
    const type = String(folder.type || folder.folderType || '').toLowerCase();
    if (type === 'sent') return Boolean(selectedEmail?.isOutgoing);
    return type !== 'trash' && type !== 'spam';
  }), [folders, selectedEmail?.isOutgoing]);

  useEffect(() => {
    setPage(0);
    setSelectedId(null);
    setSelectedDraftId(null);
    setSelectedScheduledId(null);
    setShowTranslation(false);
    setTranslatedEmailOverride(null);
  }, [mailbox, debouncedSearch, readState, responseState, labelId, hasAttachments, starred]);

  useEffect(() => {
    setShowTranslation(false);
    setTranslatedEmailOverride(null);
  }, [selectedId]);

  useEffect(() => {
    if (!isMailMailbox && filtersOpen) {
      setFiltersOpen(false);
    }
  }, [filtersOpen, isMailMailbox, setFiltersOpen]);

  useEffect(() => {
    if (actionsOpen) setActionsOpen(false);
  }, [mailbox, selectedId]);

  useEffect(() => {
    if (!composerDirty) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [composerDirty]);

  useEffect(() => () => {
    if (bodyCopyTimerRef.current) window.clearTimeout(bodyCopyTimerRef.current);
  }, []);

  useEffect(() => {
    setBodyCopyState('idle');
    if (bodyCopyTimerRef.current) window.clearTimeout(bodyCopyTimerRef.current);
  }, [selectedId, showTranslation]);

  useEffect(() => {
    if (restoreFolders.length === 0) {
      if (restoreFolderId) setRestoreFolderId('');
      return;
    }
    const currentValid = restoreFolders.some((folder) => String(folder.folderId || folder.id) === String(restoreFolderId));
    if (restoreFolderId && currentValid) return;
    const inbox = restoreFolders.find((folder) => String(folder.type || folder.folderType || '').toLowerCase() === 'inbox');
    setRestoreFolderId(String((inbox || restoreFolders[0]).folderId || (inbox || restoreFolders[0]).id));
  }, [restoreFolderId, restoreFolders]);

  const closeConfirmDialog = () => {
    if (confirmDialog?.isConfirming) return;
    pendingConfirmActionRef.current = null;
    setConfirmDialog(null);
  };

  const requestConfirmation = (options, action) => {
    pendingConfirmActionRef.current = action;
    setConfirmDialog({ ...options, isConfirming: false });
  };

  const handleConfirmAction = async () => {
    const action = pendingConfirmActionRef.current;
    if (!action) return;
    setConfirmDialog((current) => ({ ...current, isConfirming: true }));
    try {
      await action();
      pendingConfirmActionRef.current = null;
      setConfirmDialog(null);
    } catch (error) {
      setActionError(error?.message || '작업 처리에 실패했습니다.');
      setConfirmDialog((current) => ({ ...current, isConfirming: false }));
    }
  };

  const runAfterDiscardConfirmation = (action) => {
    if (!composer || !composerDirty) {
      action();
      return;
    }
    requestConfirmation({
      title: '작성 중인 메일 닫기',
      message: '작성 중인 내용을 닫을까요?',
      description: '저장하지 않은 변경사항은 사라집니다.',
      confirmLabel: '닫기',
      tone: 'danger',
    }, action);
  };

  const closeComposer = () => {
    runAfterDiscardConfirmation(() => {
      setComposer(null);
      setComposerDirty(false);
      setActionError('');
    });
  };

  const updateComposer = (patch) => {
    setActionError('');
    setComposerDirty(true);
    setComposer((current) => ({ ...(current || EMPTY_COMPOSER), ...patch }));
  };

  const openCompose = (patch = {}) => {
    runAfterDiscardConfirmation(() => {
      setSelectedDraftId(null);
      setSelectedScheduledId(null);
      setComposer({ ...EMPTY_COMPOSER, ...patch });
      setComposerDirty(false);
      setActionError('');
    });
  };

  const selectMail = (item) => {
    runAfterDiscardConfirmation(() => {
      setSelectedId(item.id);
      setSelectedDraftId(null);
      setSelectedScheduledId(null);
      setActionError('');
      setComposer(null);
      setComposerDirty(false);
      if (item.status === EMAIL_STATUS.UNREAD || item.readState === EMAIL_STATUS.UNREAD) {
        markReadMutation.mutate({ id: item.id, readState: EMAIL_STATUS.READ });
      }
    });
  };

  const selectDraft = (item) => {
    runAfterDiscardConfirmation(() => {
      setSelectedId(null);
      setSelectedDraftId(item.id);
      setSelectedScheduledId(null);
      setComposer({ ...EMPTY_COMPOSER, mode: 'draft', draftId: item.id, ...normalizeDraftLike(item) });
      setComposerDirty(false);
      setActionError('');
    });
  };

  const selectScheduled = (item) => {
    runAfterDiscardConfirmation(() => {
      setSelectedId(null);
      setSelectedDraftId(null);
      setSelectedScheduledId(item.id);
      setComposer({ ...EMPTY_COMPOSER, mode: 'scheduled', scheduledId: item.id, ...normalizeDraftLike(item) });
      setComposerDirty(false);
      setActionError('');
    });
  };

  const openReply = (mode) => {
    if (!selectedEmail) return;
    if ((mode === 'reply' || mode === 'replyAll') && !canReplyToEmail(selectedEmail)) {
      setActionError('이 메일은 답장을 지원하지 않습니다. 보낸 메일이나 원본 ID가 없는 메일은 전달만 사용할 수 있습니다.');
      return;
    }
    const currentUserEmails = collectEmailAddresses(auth.currentUser?.email, auth.currentUser?.emailAddress);
    const senderAddresses = collectEmailAddresses(selectedEmail.replyTo || selectedEmail.reply_to || selectedEmail.from || selectedEmail.fromEmail);
    const originalToAddresses = collectEmailAddresses(selectedEmail.to || selectedEmail.toEmails || selectedEmail.toEmail);
    const originalCcAddresses = collectEmailAddresses(selectedEmail.cc || selectedEmail.ccEmails || selectedEmail.ccEmail);
    const replyAllToAddresses = uniqueEmailAddresses([...senderAddresses, ...originalToAddresses], currentUserEmails);
    const replyToAddresses = uniqueEmailAddresses(senderAddresses, currentUserEmails);
    const toAddresses = mode === 'replyAll'
      ? (replyAllToAddresses.length > 0 ? replyAllToAddresses : uniqueEmailAddresses(senderAddresses))
      : (replyToAddresses.length > 0 ? replyToAddresses : uniqueEmailAddresses(senderAddresses));
    const ccAddresses = mode === 'replyAll'
      ? uniqueEmailAddresses(originalCcAddresses, [...currentUserEmails, ...toAddresses])
      : [];
    const recipients = mode === 'forward' ? '' : toAddresses.join(', ');
    const visibleReplyAllCc = mode === 'replyAll' ? ccAddresses.join(', ') : '';
    const prefix = mode === 'forward' ? 'Fwd:' : 'Re:';
    openCompose({
      mode,
      emailId: selectedEmail.id,
      originalEmailId: mode === 'reply' || mode === 'replyAll' ? selectedEmail.id : null,
      to: recipients,
      cc: visibleReplyAllCc,
      subject: selectedEmail.subject?.startsWith(prefix) ? selectedEmail.subject : `${prefix} ${selectedEmail.subject || ''}`.trim(),
      body: mode === 'forward'
        ? `\n\n----- Forwarded message -----\nFrom: ${selectedEmail.from || ''}\nDate: ${formatFullDate(getMessageDate(selectedEmail))}\nSubject: ${selectedEmail.subject || ''}\n\n${content?.text || selectedEmail.bodyText || selectedEmail.body || ''}`
        : '',
    });
  };

  const handleSync = async () => {
    setActionError('');
    setLastSyncMessage('동기화 중');
    try {
      const result = await syncMutation.mutateAsync();
      setLastSyncMessage(`동기화 완료: 신규 ${result?.new || 0}건`);
    } catch (error) {
      setLastSyncMessage(error?.message || '동기화 실패');
    }
  };

  const handleSend = async (event) => {
    event.preventDefault();
    if (!composer) return;
    setActionError('');
    const payload = buildComposerPayload(composer);
    const validationError = validateComposer(composer);
    if (validationError) {
      setActionError(validationError);
      return;
    }

    try {
      if (composer.mode === 'reply' || composer.mode === 'replyAll') {
        if (!selectedEmail || String(selectedEmail.id) !== String(composer.emailId) || !canReplyToEmail(selectedEmail)) {
          setActionError('이 메일은 답장을 지원하지 않습니다.');
          return;
        }
        await replyMutation.mutateAsync({
          emailId: composer.emailId,
          ...payload,
          replyAll: composer.mode === 'replyAll',
        });
      } else if (composer.draftId) {
        const draft = await saveDraftMutation.mutateAsync({ id: composer.draftId, ...payload });
        await sendDraftMutation.mutateAsync(draft.id || composer.draftId);
      } else {
        await sendMutation.mutateAsync(payload);
      }
      setLastSyncMessage('발송 접수됨 · 수신 서버 반송 시 상태가 자동으로 갱신됩니다.');
      setComposer(null);
      setComposerDirty(false);
    } catch (error) {
      setActionError(error?.message || '메일 전송에 실패했습니다.');
    }
  };

  const handleSaveDraft = async () => {
    if (!composer) return;
    setActionError('');
    const validationError = validateComposer(composer, { requireTo: false, requireContent: false });
    if (validationError) {
      setActionError(validationError);
      return;
    }

    try {
      const result = await saveDraftMutation.mutateAsync({
        id: composer.draftId,
        ...buildComposerPayload(composer),
      });
      setComposer({ ...composer, mode: 'draft', draftId: result.id || composer.draftId });
      setComposerDirty(false);
    } catch (error) {
      setActionError(error?.message || '임시 저장에 실패했습니다.');
    }
  };

  const handleSchedule = async () => {
    if (!composer?.scheduledAt) return;
    setActionError('');
    const validationError = validateComposer(composer, {
      requireTo: !composer.scheduledId,
      requireFutureSchedule: true,
      requireContent: !composer.scheduledId,
    });
    if (validationError) {
      setActionError(validationError);
      return;
    }

    try {
      const scheduledAt = new Date(composer.scheduledAt).toISOString();
      const payload = composer.scheduledId
        ? { id: composer.scheduledId, scheduledAt }
        : { ...buildComposerPayload(composer), scheduledAt };
      const result = await scheduleMutation.mutateAsync(payload);
      setComposer({ ...composer, mode: 'scheduled', scheduledId: result.id || composer.scheduledId });
      setComposerDirty(false);
    } catch (error) {
      setActionError(error?.message || '예약 저장에 실패했습니다.');
    }
  };

  const handleDownloadAttachment = async (attachment) => {
    if (!selectedEmail) return;
    setActionError('');
    try {
      const result = await downloadAttachmentMutation.mutateAsync({
        emailId: selectedEmail.id,
        attachmentId: attachment.attachmentId || attachment.id,
        filename: attachment.filename,
      });
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename || attachment.filename || 'attachment';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setActionError(error?.message || '첨부파일 다운로드에 실패했습니다.');
    }
  };

  const handleDeleteSelectedDraft = async () => {
    if (!selectedDraftId || deleteDraftMutation.isPending) return;
    const draftId = selectedDraftId;
    requestConfirmation({
      title: '임시보관 메일 삭제',
      message: '이 임시보관 메일을 삭제할까요?',
      confirmLabel: '삭제',
      tone: 'danger',
    }, async () => {
      setActionError('');
      await deleteDraftMutation.mutateAsync(draftId);
      setSelectedDraftId(null);
      setComposer(null);
      setComposerDirty(false);
    });
  };

  const handleDeleteSelectedScheduled = async () => {
    if (!selectedScheduledId || scheduleMutation.isPending || deleteScheduledMutation.isPending || sendScheduledNowMutation.isPending) return;
    const scheduledId = selectedScheduledId;
    requestConfirmation({
      title: '예약 메일 삭제',
      message: '이 예약 메일을 삭제할까요?',
      confirmLabel: '삭제',
      tone: 'danger',
    }, async () => {
      setActionError('');
      await deleteScheduledMutation.mutateAsync(scheduledId);
      setSelectedScheduledId(null);
      setComposer(null);
      setComposerDirty(false);
    });
  };

  const handleSendSelectedScheduledNow = async () => {
    if (!selectedScheduledId || scheduleMutation.isPending || sendScheduledNowMutation.isPending || deleteScheduledMutation.isPending) return;
    setActionError('');
    try {
      await sendScheduledNowMutation.mutateAsync(selectedScheduledId);
      setSelectedScheduledId(null);
      setComposer(null);
      setComposerDirty(false);
    } catch (error) {
      setActionError(error?.message || '예약 메일 즉시 발송에 실패했습니다.');
    }
  };

  const handleRestore = async () => {
    if (!selectedEmail) return;
    if (!restoreFolderId) {
      setActionError('복구할 폴더를 선택하세요.');
      return;
    }
    setActionError('');
    try {
      const folder = restoreFolders.find((item) => String(item.folderId || item.id) === String(restoreFolderId));
      await restoreMutation.mutateAsync({
        id: selectedEmail.id,
        folderId: restoreFolderId,
        folderType: folder?.type || folder?.folderType || 'inbox',
        folderName: folder?.name || folder?.folderName,
      });
      setSelectedId(null);
    } catch (error) {
      setActionError(error?.message || '메일 복구에 실패했습니다.');
    }
  };

  const handleTrash = () => {
    if (!selectedEmail) return;
    const emailId = selectedEmail.id;
    requestConfirmation({
      title: '메일 삭제',
      message: '이 메일을 휴지통으로 이동할까요?',
      confirmLabel: '삭제',
      tone: 'danger',
    }, async () => {
      setActionError('');
      await trashMutation.mutateAsync(emailId);
      setSelectedId(null);
    });
  };

  const handleArchive = async () => {
    if (!selectedEmail) return;
    setActionError('');
    try {
      if (mailbox === 'archive') {
        await unarchiveMutation.mutateAsync(selectedEmail.id);
      } else {
        await archiveMutation.mutateAsync(selectedEmail.id);
      }
      setSelectedId(null);
    } catch (error) {
      setActionError(error?.message || (mailbox === 'archive' ? '메일 보관 해제에 실패했습니다.' : '메일 보관에 실패했습니다.'));
    }
  };

  const handlePermanentDelete = () => {
    if (!selectedEmail) return;
    const emailId = selectedEmail.id;
    requestConfirmation({
      title: '메일 영구 삭제',
      message: '이 메일을 영구 삭제할까요?',
      description: '이 작업은 되돌릴 수 없습니다.',
      confirmLabel: '영구 삭제',
      tone: 'danger',
    }, async () => {
      setActionError('');
      await permanentDeleteMutation.mutateAsync(emailId);
      setSelectedId(null);
    });
  };

  const openLabelSettings = () => {
    if (!selectedEmail) return;
    setSelectedLabelIds((selectedEmail.labels || []).map((label) => String(label.labelId || label.id)));
    setLabelModalOpen(true);
  };

  const toggleSelectedLabel = (nextLabelId) => {
    const normalizedId = String(nextLabelId);
    setSelectedLabelIds((current) => (
      current.includes(normalizedId)
        ? current.filter((id) => id !== normalizedId)
        : [...current, normalizedId]
    ));
  };

  const handleSaveLabels = async () => {
    if (!selectedEmail || labelSaving) return;
    const currentIds = new Set((selectedEmail.labels || []).map((label) => String(label.labelId || label.id)));
    const nextIds = new Set(selectedLabelIds.map(String));
    const addedIds = [...nextIds].filter((id) => !currentIds.has(id));
    const removedIds = [...currentIds].filter((id) => !nextIds.has(id));

    setActionError('');
    setLabelSaving(true);
    try {
      for (const nextLabelId of addedIds) {
        await addLabelMutation.mutateAsync({ id: selectedEmail.id, labelId: nextLabelId });
      }
      for (const nextLabelId of removedIds) {
        await removeLabelMutation.mutateAsync({ id: selectedEmail.id, labelId: nextLabelId });
      }
      setLabelModalOpen(false);
    } catch (error) {
      setActionError(error?.message || '라벨 설정 저장에 실패했습니다.');
    } finally {
      setLabelSaving(false);
    }
  };

  const handleFlag = async () => {
    if (!selectedEmail) return;
    setActionError('');
    try {
      await flagMutation.mutateAsync({ id: selectedEmail.id, starred: !selectedEmail.starred });
    } catch (error) {
      setActionError(error?.message || '중요 표시 변경에 실패했습니다.');
    }
  };

  const handleMarkResponded = async () => {
    if (!selectedEmail) return;
    setActionError('');
    try {
      await responseStateMutation.mutateAsync({ id: selectedEmail.id, responseState: 'responded' });
    } catch (error) {
      setActionError(error?.message || '응답 상태 변경에 실패했습니다.');
    }
  };

  const runActionMenuItem = (action) => {
    setActionsOpen(false);
    action();
  };

  const selectedHtml = content?.html || selectedEmail?.bodyHtml || '';
  const sanitizedSelectedHtml = useMemo(
    () => sanitizeEmailHtmlForDisplay(selectedHtml),
    [selectedHtml],
  );
  const selectedText = content?.text || selectedEmail?.bodyText || selectedEmail?.body || '';
  const translationEmail = selectedEmail && translatedEmailOverride?.id === selectedEmail.id
    ? { ...selectedEmail, ...translatedEmailOverride }
    : selectedEmail;
  const hasTranslation = translationEmail?.translationStatus === 'completed' && Boolean(translationEmail.translatedBody);
  const translationCanRetry = ['failed', 'disabled', 'not_required'].includes(translationEmail?.translationStatus);
  const translationBusy = translationEmail?.translationStatus === 'pending' || translateMutation.isPending;
  const sourceTextForTranslationCheck = selectedText || (selectedHtml ? htmlToPlainText(selectedHtml) : '');
  const likelyNonKorean = Boolean(selectedEmail && selectedEmail.direction !== 'outgoing' && looksNonKorean(`${selectedEmail.subject || ''}\n${sourceTextForTranslationCheck}`));
  const shouldShowTranslationControl =
    Boolean(selectedEmail) && (hasTranslation || translationBusy || likelyNonKorean || ['failed', 'disabled'].includes(translationEmail?.translationStatus));
  const displayedSubject = showTranslation && translationEmail?.translatedSubject ? translationEmail.translatedSubject : selectedEmail?.subject;
  const displayedText = showTranslation && hasTranslation ? translationEmail.translatedBody : selectedText;
  const isBusy = activeQuery.isLoading || activeQuery.isFetching;
  const composerBusy =
    sendMutation.isPending ||
    replyMutation.isPending ||
    saveDraftMutation.isPending ||
    sendDraftMutation.isPending ||
    scheduleMutation.isPending ||
    deleteDraftMutation.isPending ||
    deleteScheduledMutation.isPending ||
    sendScheduledNowMutation.isPending;
  const scheduledActionBusy = scheduleMutation.isPending || deleteScheduledMutation.isPending || sendScheduledNowMutation.isPending;
  const providerActionsSupported = !selectedEmail || (selectedEmail.source === 'zoho' && Boolean(selectedEmail.messageId));
  const canReply = canReplyToEmail(selectedEmail);
  const canFlag = !selectedEmail || (selectedEmail.capabilities?.flag ?? providerActionsSupported);
  const canArchive = !selectedEmail || (selectedEmail.capabilities?.archive ?? providerActionsSupported);
  const canTrash = !selectedEmail || (selectedEmail.capabilities?.trash ?? providerActionsSupported);
  const canLabel = !selectedEmail || (selectedEmail.capabilities?.labels ?? providerActionsSupported);
  const scheduledContentLocked = Boolean(composer?.scheduledId);

  const getTranslationButtonLabel = () => {
    if (showTranslation && hasTranslation) return '원문 보기';
    if (hasTranslation) return '번역 보기';
    if (translationBusy) return '번역 준비 중';
    if (translationEmail?.translationStatus === 'failed' || translationEmail?.translationStatus === 'disabled') return '번역 재시도';
    return '번역하기';
  };

  const handleTranslationClick = async () => {
    if (!selectedEmail) return;
    setActionError('');
    if (hasTranslation) {
      setShowTranslation((value) => !value);
      return;
    }
    if (!translationCanRetry || translationBusy) return;

    try {
      const translatedEmail = await translateMutation.mutateAsync(selectedEmail.id);
      if (translatedEmail?.translationStatus === 'completed') {
        setTranslatedEmailOverride(translatedEmail);
        setShowTranslation(true);
      } else if (translatedEmail?.translationError) {
        setActionError(`번역 실패: ${translatedEmail.translationError}`);
      }
    } catch (error) {
      setActionError(error?.message ? `번역 실패: ${error.message}` : '번역에 실패했습니다.');
    }
  };

  const handleCopyDisplayedBody = async () => {
    const textToCopy = showTranslation && hasTranslation
      ? translationEmail.translatedBody
      : (sanitizedSelectedHtml ? htmlToPlainText(sanitizedSelectedHtml) : selectedText);
    if (!textToCopy?.trim()) {
      setActionError('복사할 본문이 없습니다.');
      return;
    }

    const copied = await copyTextToClipboard(textToCopy);
    if (!copied) {
      setActionError('본문을 클립보드에 복사하지 못했습니다.');
      return;
    }

    setBodyCopyState('copied');
    if (bodyCopyTimerRef.current) window.clearTimeout(bodyCopyTimerRef.current);
    bodyCopyTimerRef.current = window.setTimeout(() => setBodyCopyState('idle'), 1600);
  };

  const handlePrintSelectedEmail = async () => {
    if (!selectedEmail) return;
    setActionError('');

    const printingTranslation = showTranslation && hasTranslation;
    const printDocument = buildEmailPrintDocument({
      email: selectedEmail,
      subject: displayedSubject || selectedEmail.subject || '(제목 없음)',
      sanitizedBodyHtml: printingTranslation ? '' : sanitizedSelectedHtml,
      bodyText: printingTranslation ? translationEmail?.translatedBody : displayedText,
      statusLabel: getStatusLabel(selectedEmail),
      dateText: formatFullDate(getMessageDate(selectedEmail)),
      printedAtText: formatFullDate(new Date()),
      isTranslated: printingTranslation,
      translatedAtText: printingTranslation && translationEmail?.translatedAt
        ? formatFullDate(translationEmail.translatedAt)
        : '',
      attachments,
    });

    try {
      await printHtmlDocument(printDocument);
    } catch (error) {
      setActionError(error?.message || '메일 출력에 실패했습니다.');
    }
  };

  return (
    <div className="email-client-page">
      <header className="email-client-header">
        <div>
          <h1>이메일 상담</h1>
          <p>메일함 기준으로 문의 메일을 확인하고 답변을 처리합니다.</p>
        </div>
        <div className="email-header-actions">
          {lastSyncMessage ? <span className="sync-note">{lastSyncMessage}</span> : null}
          {actionError ? <span className="action-error-note">{actionError}</span> : null}
          <button type="button" className="secondary-button" onClick={handleSync} disabled={syncMutation.isPending}>
            수동 동기화
          </button>
          <button type="button" className="primary-button" onClick={() => openCompose()}>
            새 메일 작성
          </button>
        </div>
      </header>

      <nav className="email-client-tabs" aria-label="메일함">
        {MAILBOXES.map((box) => (
          <button
            key={box.key}
            type="button"
            className={mailbox === box.key ? 'active' : ''}
            onClick={() => {
              setFiltersOpen(false);
              setMailbox(box.key);
            }}
          >
            <span className={`mailbox-icon ${box.key}`} aria-hidden="true" />
            {box.label}
            {box.key === 'inbox' && stats.unread ? <span className="mailbox-count">{stats.unread}</span> : null}
            {box.key === 'drafts' && stats.drafts ? <span className="mailbox-count">{stats.drafts}</span> : null}
          </button>
        ))}
      </nav>

      <main className="email-client-body">
        <section className="mail-list-pane" aria-label="메일 목록">
          <div className="mail-list-toolbar">
            <div className="mail-search-line">
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="메일 검색"
              />
              <div className="filter-menu" ref={filterMenuRef}>
                <button
                  type="button"
                  className={`filter-toggle ${filtersOpen ? 'active' : ''}`}
                  onClick={() => setFiltersOpen((value) => !value)}
                  disabled={!isMailMailbox}
                  aria-expanded={filtersOpen}
                  aria-haspopup="menu"
                >
                  필터
                  {activeFilterCount > 0 ? <strong>{activeFilterCount}</strong> : null}
                  <span aria-hidden="true">▾</span>
                </button>
                {filtersOpen ? (
                  <div className="filter-popover" role="menu" aria-label="메일 필터">
                    <div className="filter-section">
                      <span>읽음 상태</span>
                      <div className="filter-options">
                        {[
                          ['all', '전체'],
                          ['unread', '미확인'],
                          ['read', '확인'],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={readState === value ? 'active' : ''}
                            onClick={() => setReadState(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="filter-section">
                      <span>응답 상태</span>
                      <div className="filter-options">
                        {[
                          ['all', '전체'],
                          ['responded', '응답'],
                          ['pending', '보류'],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={responseState === value ? 'active' : ''}
                            onClick={() => setResponseState(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="filter-field">
                      라벨
                      <select value={labelId} onChange={(event) => setLabelId(event.target.value)}>
                        <option value="">라벨 전체</option>
                        {labels.map((label) => (
                          <option key={label.id} value={label.labelId || label.id}>{label.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="filter-checks">
                      <label>
                        <input
                          type="checkbox"
                          checked={hasAttachments}
                          onChange={(event) => setHasAttachments(event.target.checked)}
                        />
                        첨부 있음
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={starred}
                          onChange={(event) => setStarred(event.target.checked)}
                        />
                        중요 표시
                      </label>
                    </div>
                    <button
                      type="button"
                      className="filter-reset"
                      disabled={activeFilterCount === 0}
                      onClick={() => {
                        setReadState('all');
                        setResponseState('all');
                        setLabelId('');
                        setHasAttachments(false);
                        setStarred(false);
                      }}
                    >
                      필터 초기화
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mail-list-status">
            <span>{total || items.length}건</span>
            {isBusy ? <span>불러오는 중</span> : null}
          </div>

          <div className="mail-list">
            {activeQuery.isError ? (
              <div className="mail-empty">메일 목록을 불러오지 못했습니다.</div>
            ) : items.length === 0 && !isBusy ? (
              <div className="mail-empty">표시할 메일이 없습니다.</div>
            ) : null}
            {isMailMailbox && items.map((item) => (
              <MailRow
                key={item.id}
                item={item}
                active={String(selectedId) === String(item.id)}
                onClick={selectMail}
              />
            ))}
            {isDraftMailbox && items.map((item) => (
              <DraftRow
                key={item.id}
                item={item}
                active={String(selectedDraftId) === String(item.id)}
                onClick={selectDraft}
              />
            ))}
            {isScheduledMailbox && items.map((item) => (
              <DraftRow
                key={item.id}
                item={item}
                dateValue={item.scheduledAt || item.updatedAt || item.createdAt}
                dateFormatter={formatScheduledDate}
                active={String(selectedScheduledId) === String(item.id)}
                onClick={selectScheduled}
              />
            ))}
          </div>

          <div className="mail-pagination">
            <button type="button" className="ghost-button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>
              이전
            </button>
            <span>{page + 1}</span>
            <button type="button" className="ghost-button" onClick={() => setPage((value) => value + 1)} disabled={!hasNextPage}>
              다음
            </button>
          </div>
        </section>

        <section className="mail-reading-pane" aria-label="메일 상세">
          {composer ? (
            <div className="composer-shell standalone-composer-shell">
              <Composer
                composer={composer}
                onChange={updateComposer}
                onClose={closeComposer}
                onSend={handleSend}
                onSaveDraft={handleSaveDraft}
                onSchedule={handleSchedule}
                sending={composerBusy}
                contentLocked={scheduledContentLocked}
                lockMessage={scheduledContentLocked ? '예약 메일은 현재 예약 시간만 변경할 수 있습니다.' : ''}
                errorMessage={actionError}
                onError={setActionError}
              />
              {selectedDraftId ? (
                <button
                  type="button"
                  className="danger-button standalone-action"
                  onClick={handleDeleteSelectedDraft}
                  disabled={deleteDraftMutation.isPending || composerBusy}
                >
                  임시보관 삭제
                </button>
              ) : null}
              {selectedScheduledId ? (
                <div className="scheduled-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleSendSelectedScheduledNow}
                    disabled={scheduledActionBusy}
                  >
                    지금 발송
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={handleDeleteSelectedScheduled}
                    disabled={scheduledActionBusy}
                  >
                    예약 삭제
                  </button>
                </div>
              ) : null}
            </div>
          ) : isMailMailbox && selectedEmail ? (
            <>
              <div className="message-header">
                <div>
                  <h2>{displayedSubject || '(제목 없음)'}</h2>
                  <div className="message-meta-line">
                    <span>발신자 {formatNamedEmailAddress(selectedEmail.fromName, selectedEmail.from)}</span>
                    <span>수신자 {joinRecipients(selectedEmail.to) || '-'}</span>
                    <span>{formatFullDate(getMessageDate(selectedEmail))}</span>
                  </div>
                  <div className="message-labels">
                    <span className="mail-tag source">{selectedEmail.source || 'mail'}</span>
                    <span className="mail-tag state">{getStatusLabel(selectedEmail)}</span>
                    {getDeliveryLabel(selectedEmail) ? (
                      <span className={`mail-tag delivery ${selectedEmail.deliveryStatus || 'accepted'}`}>{getDeliveryLabel(selectedEmail)}</span>
                    ) : null}
                    {selectedEmail.labels?.map((label) => (
                      <span key={label.id || label.name} className="mail-tag">{label.name}</span>
                    ))}
                  </div>
                </div>
                <div className="message-actions" ref={actionMenuRef}>
                  {!providerActionsSupported ? (
                    <span className="message-warning compact">Zoho 원본 메일만 provider 액션을 지원합니다.</span>
                  ) : null}
                  <button
                    type="button"
                    className={`message-actions-trigger ${actionsOpen ? 'active' : ''}`}
                    onClick={() => setActionsOpen((value) => !value)}
                    aria-label="메일 작업 메뉴"
                    aria-haspopup="menu"
                    aria-expanded={actionsOpen}
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                  {actionsOpen ? (
                    <div className="message-actions-popover" role="menu" aria-label="메일 작업">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runActionMenuItem(handlePrintSelectedEmail)}
                      >
                        출력
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!canFlag}
                        onClick={() => runActionMenuItem(handleFlag)}
                      >
                        {selectedEmail.starred ? '중요 해제' : '중요 표시'}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!canLabel}
                        onClick={() => runActionMenuItem(openLabelSettings)}
                      >
                        라벨 설정
                      </button>
                      <button type="button" role="menuitem" onClick={() => runActionMenuItem(handleMarkResponded)}>
                        응답 처리
                      </button>
                      <div className="message-actions-divider" role="separator" />
                      <button type="button" role="menuitem" disabled={!canReply} onClick={() => runActionMenuItem(() => openReply('reply'))}>
                        답장
                      </button>
                      <button type="button" role="menuitem" disabled={!canReply} onClick={() => runActionMenuItem(() => openReply('replyAll'))}>
                        전체 답장
                      </button>
                      <button type="button" role="menuitem" onClick={() => runActionMenuItem(() => openReply('forward'))}>
                        전달
                      </button>
                      <div className="message-actions-divider" role="separator" />
                      {mailbox === 'trash' ? (
                        <>
                          <label className="message-restore-field">
                            <span>복구 위치</span>
                            <select
                              value={restoreFolderId}
                              onChange={(event) => setRestoreFolderId(event.target.value)}
                              disabled={!canTrash || restoreFolders.length === 0}
                            >
                              <option value="">복구 폴더</option>
                              {restoreFolders.map((folder) => (
                                <option key={folder.folderId || folder.id} value={folder.folderId || folder.id}>
                                  {folder.name || folder.folderName || folder.folderId || folder.id}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={!canTrash || !restoreFolderId}
                            onClick={() => runActionMenuItem(handleRestore)}
                          >
                            복구
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            onClick={() => runActionMenuItem(handlePermanentDelete)}
                          >
                            영구 삭제
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" role="menuitem" disabled={!canArchive} onClick={() => runActionMenuItem(handleArchive)}>
                            {mailbox === 'archive' ? '보관 해제' : '보관'}
                          </button>
                          <button type="button" role="menuitem" className="danger" disabled={!canTrash} onClick={() => runActionMenuItem(handleTrash)}>
                            삭제
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="message-scroll-area">
              {['failed', 'partial'].includes(selectedEmail.deliveryStatus) ? (
                <div className="delivery-warning" role="alert">
                  <strong>{selectedEmail.deliveryStatus === 'failed' ? '메일이 반송되었습니다.' : '일부 수신자에게 메일이 전달되지 않았습니다.'}</strong>
                  {(selectedEmail.deliveryDetails?.failures || []).map((failure) => (
                    <span key={`${failure.recipient}-${failure.bouncedAt || ''}`}>
                      {failure.recipient}: {failure.diagnostic || '수신 서버에서 거부했습니다.'}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="message-content-toolbar">
                <div>
                  <strong>{showTranslation && hasTranslation ? '번역 본문' : '메일 본문'}</strong>
                  {translationEmail?.translatedAt && showTranslation && hasTranslation ? (
                    <span>{formatFullDate(translationEmail.translatedAt)}</span>
                  ) : null}
                </div>
                <div className="message-content-actions">
                  {shouldShowTranslationControl ? (
                    <button
                      type="button"
                      className={`translation-button ${hasTranslation ? 'available' : ''}`}
                      onClick={handleTranslationClick}
                      disabled={translationBusy}
                      title={translationEmail?.translationError || ''}
                    >
                      {getTranslationButtonLabel()}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`body-copy-button ${bodyCopyState === 'copied' ? 'copied' : ''}`}
                    onClick={handleCopyDisplayedBody}
                  >
                    {bodyCopyState === 'copied' ? '복사됨' : '본문 복사'}
                  </button>
                </div>
              </div>

              <article className="message-body">
                {content?.unavailableReason ? <p className="message-warning">{content.unavailableReason}</p> : null}
                {showTranslation && hasTranslation ? (
                  <div className="message-html translated-message-body">
                    <pre>{translationEmail.translatedBody}</pre>
                  </div>
                ) : sanitizedSelectedHtml ? (
                  <div
                    className="message-html"
                    dangerouslySetInnerHTML={{ __html: sanitizedSelectedHtml }}
                  />
                ) : (
                  <pre>{displayedText || '본문이 없습니다.'}</pre>
                )}
              </article>

              {attachments.length > 0 ? (
                <div className="attachment-strip">
                  <strong>첨부파일 {attachments.length}개</strong>
                  <div>
                    {attachments.map((attachment) => (
                      <button
                        key={attachment.attachmentId || attachment.id}
                        type="button"
                        className="attachment-chip"
                        onClick={() => handleDownloadAttachment(attachment)}
                      >
                        {attachment.filename}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              </div>

            </>
          ) : (
            <div className="message-empty">
              <h2>메일을 선택하세요</h2>
              <p>목록에서 메일을 선택하면 본문과 처리 액션이 표시됩니다.</p>
            </div>
          )}
        </section>
      </main>

      <Modal
        isOpen={labelModalOpen}
        onClose={() => setLabelModalOpen(false)}
        title="라벨 설정"
        compact
        closeDisabled={labelSaving}
        closeOnBackdrop={!labelSaving}
      >
        <div className="email-label-settings">
          {labels.length > 0 ? (
            <div className="email-label-options">
              {labels.map((label) => {
                const currentLabelId = String(label.labelId || label.id);
                return (
                  <label key={currentLabelId} className="email-label-option">
                    <input
                      type="checkbox"
                      checked={selectedLabelIds.includes(currentLabelId)}
                      onChange={() => toggleSelectedLabel(currentLabelId)}
                      disabled={labelSaving}
                    />
                    <span className="email-label-color" style={{ backgroundColor: label.color || '#94a3b8' }} aria-hidden="true" />
                    <span>{label.name}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="email-label-empty">설정할 수 있는 라벨이 없습니다.</p>
          )}
          <div className="modal-actions">
            <button type="button" className="modal-btn secondary" onClick={() => setLabelModalOpen(false)} disabled={labelSaving}>
              취소
            </button>
            <button type="button" className="modal-btn primary" onClick={handleSaveLabels} disabled={labelSaving || labels.length === 0}>
              {labelSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirmDialog)}
        onClose={closeConfirmDialog}
        onConfirm={handleConfirmAction}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        description={confirmDialog?.description}
        confirmLabel={confirmDialog?.confirmLabel}
        tone={confirmDialog?.tone}
        isConfirming={Boolean(confirmDialog?.isConfirming)}
      />
    </div>
  );
}

export default EmailConsultationsPage;
