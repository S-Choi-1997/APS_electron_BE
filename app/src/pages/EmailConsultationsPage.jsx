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
import { htmlToPlainText } from '../utils/clipboard';
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
  scheduledAt: '',
  attachments: [],
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitRecipients(value) {
  return String(value || '')
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinRecipients(value) {
  return Array.isArray(value) ? value.join(', ') : String(value || '');
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

function normalizeDraftLike(item) {
  return {
    originalEmailId: item?.originalEmailId || item?.original_email_id || null,
    to: joinRecipients(item?.to),
    cc: joinRecipients(item?.cc),
    bcc: joinRecipients(item?.bcc),
    subject: item?.subject || '',
    body: item?.body || item?.bodyText || '',
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
  if (requireContent && !composer.body.trim()) return '본문을 입력하세요.';

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
          <span className={`mail-tag state ${label === '응답' ? 'done' : ''}`}>{label}</span>
        </span>
      </span>
    </button>
  );
}

function DraftRow({ item, active, onClick }) {
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
          <span className="mail-row-date">{formatDate(item.updatedAt || item.createdAt || item.scheduledAt)}</span>
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
  const attachments = Array.isArray(composer.attachments) ? composer.attachments : [];
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

  const addAttachmentFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    try {
      const nextAttachments = await Promise.all(files.map(readAttachmentFile));
      const mergedAttachments = [...attachments, ...nextAttachments];
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
      attachments: attachments.filter((_, itemIndex) => itemIndex !== index),
    });
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
        <label>
          받는사람
          <input
            value={composer.to}
            onChange={(event) => onChange({ to: event.target.value })}
            disabled={contentLocked}
            placeholder="받는 사람 이메일"
          />
        </label>
        <label>
          참조
          <input
            value={composer.cc}
            onChange={(event) => onChange({ cc: event.target.value })}
            disabled={contentLocked}
            placeholder="참조 이메일"
          />
        </label>
        <label>
          숨은참조
          <input
            value={composer.bcc}
            onChange={(event) => onChange({ bcc: event.target.value })}
            disabled={contentLocked}
            placeholder="숨은참조 이메일"
          />
        </label>
        <label>
          제목
          <input
            value={composer.subject}
            onChange={(event) => onChange({ subject: event.target.value })}
            disabled={contentLocked}
            placeholder="메일 제목"
          />
        </label>
      </div>
      {lockMessage ? <p className="composer-notice">{lockMessage}</p> : null}
      <textarea
        className="composer-body"
        value={composer.body}
        onChange={(event) => onChange({ body: event.target.value })}
        placeholder="메일 내용을 입력하세요."
        disabled={contentLocked}
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
  } = useEmailPageState();
  const filterMenuRef = useRef(null);
  const debouncedSearch = useDebounce(searchTerm, 300);

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
    if (!filtersOpen) return undefined;

    const handlePointerDown = (event) => {
      if (filterMenuRef.current?.contains(event.target)) return;
      setFiltersOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [filtersOpen]);

  useEffect(() => {
    if (!composerDirty) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [composerDirty]);

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

  const confirmDiscardComposer = () => {
    if (!composer || !composerDirty) return true;
    return window.confirm('작성 중인 내용이 있습니다. 닫을까요?');
  };

  const closeComposer = () => {
    if (!confirmDiscardComposer()) return;
    setComposer(null);
    setComposerDirty(false);
    setActionError('');
  };

  const updateComposer = (patch) => {
    setActionError('');
    setComposerDirty(true);
    setComposer((current) => ({ ...(current || EMPTY_COMPOSER), ...patch }));
  };

  const openCompose = (patch = {}) => {
    if (!confirmDiscardComposer()) return;
    setSelectedDraftId(null);
    setSelectedScheduledId(null);
    setComposer({ ...EMPTY_COMPOSER, ...patch });
    setComposerDirty(false);
    setActionError('');
  };

  const selectMail = (item) => {
    if (!confirmDiscardComposer()) return;
    setSelectedId(item.id);
    setSelectedDraftId(null);
    setSelectedScheduledId(null);
    setActionError('');
    setComposer(null);
    setComposerDirty(false);
    if (item.status === EMAIL_STATUS.UNREAD || item.readState === EMAIL_STATUS.UNREAD) {
      markReadMutation.mutate({ id: item.id, readState: EMAIL_STATUS.READ });
    }
  };

  const selectDraft = (item) => {
    if (!confirmDiscardComposer()) return;
    setSelectedId(null);
    setSelectedDraftId(item.id);
    setSelectedScheduledId(null);
    setComposer({ ...EMPTY_COMPOSER, mode: 'draft', draftId: item.id, ...normalizeDraftLike(item) });
    setComposerDirty(false);
    setActionError('');
  };

  const selectScheduled = (item) => {
    if (!confirmDiscardComposer()) return;
    setSelectedId(null);
    setSelectedDraftId(null);
    setSelectedScheduledId(item.id);
    setComposer({ ...EMPTY_COMPOSER, mode: 'scheduled', scheduledId: item.id, ...normalizeDraftLike(item) });
    setComposerDirty(false);
    setActionError('');
  };

  const openReply = (mode) => {
    if (!selectedEmail) return;
    if ((mode === 'reply' || mode === 'replyAll') && !canReplyToEmail(selectedEmail)) {
      setActionError('이 메일은 답장을 지원하지 않습니다. 보낸 메일이나 원본 ID가 없는 메일은 전달만 사용할 수 있습니다.');
      return;
    }
    const recipients = mode === 'forward' ? '' : selectedEmail.from;
    const visibleReplyAllCc = mode === 'replyAll' ? joinRecipients(selectedEmail.cc || selectedEmail.ccEmails || []) : '';
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
    if (!selectedDraftId) return;
    if (!window.confirm('이 임시보관 메일을 삭제할까요?')) return;
    setActionError('');
    try {
      await deleteDraftMutation.mutateAsync(selectedDraftId);
      setSelectedDraftId(null);
      setComposer(null);
      setComposerDirty(false);
    } catch (error) {
      setActionError(error?.message || '임시보관 삭제에 실패했습니다.');
    }
  };

  const handleDeleteSelectedScheduled = async () => {
    if (!selectedScheduledId) return;
    if (!window.confirm('이 예약 메일을 삭제할까요?')) return;
    setActionError('');
    try {
      await deleteScheduledMutation.mutateAsync(selectedScheduledId);
      setSelectedScheduledId(null);
      setComposer(null);
      setComposerDirty(false);
    } catch (error) {
      setActionError(error?.message || '예약 삭제에 실패했습니다.');
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

  const handleTrash = async () => {
    if (!selectedEmail) return;
    if (!window.confirm('이 메일을 휴지통으로 이동할까요?')) return;
    setActionError('');
    try {
      await trashMutation.mutateAsync(selectedEmail.id);
      setSelectedId(null);
    } catch (error) {
      setActionError(error?.message || '메일 삭제에 실패했습니다.');
    }
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

  const handlePermanentDelete = async () => {
    if (!selectedEmail || !window.confirm('이 메일을 영구 삭제할까요?')) return;
    setActionError('');
    try {
      await permanentDeleteMutation.mutateAsync(selectedEmail.id);
      setSelectedId(null);
    } catch (error) {
      setActionError(error?.message || '메일 영구 삭제에 실패했습니다.');
    }
  };

  const handleApplyLabel = async (nextLabelId) => {
    if (!selectedEmail || !nextLabelId) return;
    setActionError('');
    try {
      await addLabelMutation.mutateAsync({ id: selectedEmail.id, labelId: nextLabelId });
    } catch (error) {
      setActionError(error?.message || '라벨 적용에 실패했습니다.');
    }
  };

  const handleRemoveLabel = async (nextLabelId) => {
    if (!selectedEmail || !nextLabelId) return;
    setActionError('');
    try {
      await removeLabelMutation.mutateAsync({ id: selectedEmail.id, labelId: nextLabelId });
    } catch (error) {
      setActionError(error?.message || '라벨 해제에 실패했습니다.');
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
  const composerBusy = sendMutation.isPending || replyMutation.isPending || saveDraftMutation.isPending || scheduleMutation.isPending;
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
            onClick={() => setMailbox(box.key)}
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
                <button type="button" className="danger-button standalone-action" onClick={handleDeleteSelectedDraft}>
                  임시보관 삭제
                </button>
              ) : null}
              {selectedScheduledId ? (
                <div className="scheduled-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={async () => {
                      setActionError('');
                      try {
                        await sendScheduledNowMutation.mutateAsync(selectedScheduledId);
                        setSelectedScheduledId(null);
                        setComposer(null);
                        setComposerDirty(false);
                      } catch (error) {
                        setActionError(error?.message || '예약 메일 즉시 발송에 실패했습니다.');
                      }
                    }}
                  >
                    지금 발송
                  </button>
                  <button type="button" className="danger-button" onClick={handleDeleteSelectedScheduled}>
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
                    <span>발신자 {selectedEmail.fromName || selectedEmail.from || '-'}</span>
                    <span>수신자 {joinRecipients(selectedEmail.to) || '-'}</span>
                    <span>{formatFullDate(getMessageDate(selectedEmail))}</span>
                  </div>
                  <div className="message-labels">
                    <span className="mail-tag source">{selectedEmail.source || 'mail'}</span>
                    <span className="mail-tag state">{getStatusLabel(selectedEmail)}</span>
                    {selectedEmail.labels?.map((label) => (
                      <span key={label.id || label.name} className="mail-tag">{label.name}</span>
                    ))}
                  </div>
                </div>
                <div className="message-actions">
                  {!providerActionsSupported ? (
                    <span className="message-warning compact">Zoho 원본 메일만 provider 액션을 지원합니다.</span>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={!canFlag}
                    onClick={handleFlag}
                  >
                    {selectedEmail.starred ? '중요 해제' : '중요'}
                  </button>
                  <button type="button" className="ghost-button" onClick={handleMarkResponded}>
                    응답 처리
                  </button>
                  <button type="button" className="ghost-button" disabled={!canReply} onClick={() => openReply('reply')}>답장</button>
                  <button type="button" className="ghost-button" disabled={!canReply} onClick={() => openReply('replyAll')}>전체 답장</button>
                  <button type="button" className="ghost-button" onClick={() => openReply('forward')}>전달</button>
                  {mailbox === 'trash' ? (
                    <>
                      <select
                        className="toolbar-select"
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
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!canTrash || !restoreFolderId}
                        onClick={handleRestore}
                      >
                        복구
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={handlePermanentDelete}
                      >
                        영구 삭제
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="secondary-button" disabled={!canArchive} onClick={handleArchive}>
                        {mailbox === 'archive' ? '보관 해제' : '보관'}
                      </button>
                      <button type="button" className="danger-button" disabled={!canTrash} onClick={handleTrash}>삭제</button>
                    </>
                  )}
                </div>
              </div>

              <div className="message-scroll-area">
              <div className="label-toolbar">
                <select
                  className="toolbar-select"
                  defaultValue=""
                  disabled={!canLabel}
                  onChange={(event) => {
                    handleApplyLabel(event.target.value);
                    event.target.value = '';
                  }}
                >
                  <option value="">라벨 적용</option>
                  {labels.map((label) => (
                    <option key={label.id} value={label.labelId || label.id}>{label.name}</option>
                  ))}
                </select>
                {selectedEmail.labels?.map((label) => (
                  <button
                    key={label.id || label.name}
                    type="button"
                    className="label-remove-button"
                    disabled={!canLabel}
                    title={`${label.name} 해제`}
                    onClick={() => handleRemoveLabel(label.labelId || label.id)}
                  >
                    {label.name} 해제
                  </button>
                ))}
              </div>

              <div className="message-content-toolbar">
                <div>
                  <strong>{showTranslation && hasTranslation ? '번역 본문' : '메일 본문'}</strong>
                  {translationEmail?.translatedAt && showTranslation && hasTranslation ? (
                    <span>{formatFullDate(translationEmail.translatedAt)}</span>
                  ) : null}
                </div>
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
    </div>
  );
}

export default EmailConsultationsPage;
