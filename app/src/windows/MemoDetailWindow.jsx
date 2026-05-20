import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import {
  useCreateMemo,
  useDeleteMemo,
  useMemoDetail,
  useUpdateMemo,
} from '../hooks/queries/useMemos';
import './MemoDetailWindow.css';

function todayInputValue() {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
}

function toDateInputValue(value) {
  if (!value) return '';
  return String(value).split('T')[0];
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ko-KR');
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('ko-KR');
}

function buildTitle(title, content) {
  const trimmedTitle = title.trim();
  if (trimmedTitle) return trimmedTitle;

  const trimmedContent = content.trim();
  return trimmedContent.length > 20
    ? `${trimmedContent.substring(0, 20)}...`
    : trimmedContent;
}

function createInitialForm(mode, memo) {
  if (mode === 'create') {
    return {
      title: '',
      content: '',
      important: false,
      expire_date: todayInputValue(),
    };
  }

  return {
    title: memo?.title || '',
    content: memo?.content || '',
    important: Boolean(memo?.important),
    expire_date: toDateInputValue(memo?.expire_date),
  };
}

function linkifyContent(text) {
  if (!text) return '';

  const urlPattern = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
  const linkedText = text.replace(urlPattern, (url) => {
    const href = url.startsWith('www.') ? `https://${url}` : url;
    return `<a href="${href}" class="memo-window-external-link">${url}</a>`;
  });

  return DOMPurify.sanitize(linkedText, {
    ADD_ATTR: ['target', 'rel'],
  });
}

function closeWindow() {
  if (window.electron?.closeCurrentWindow) {
    window.electron.closeCurrentWindow();
  } else {
    window.close();
  }
}

function MemoDetailWindow({ mode = 'view' }) {
  const { id } = useParams();
  const isCreateMode = mode === 'create';
  const [isEditing, setIsEditing] = useState(isCreateMode);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [form, setForm] = useState(() => createInitialForm(mode, null));

  const {
    data: memo,
    isLoading,
    isError,
    error,
  } = useMemoDetail(id, {
    enabled: !isCreateMode && Boolean(id),
  });

  const createMemoMutation = useCreateMemo();
  const updateMemoMutation = useUpdateMemo();
  const deleteMemoMutation = useDeleteMemo();

  const isMutating = createMemoMutation.isPending
    || updateMemoMutation.isPending
    || deleteMemoMutation.isPending;

  useEffect(() => {
    document.body.classList.add('memo-window-body');
    return () => {
      document.body.classList.remove('memo-window-body');
    };
  }, []);

  useEffect(() => {
    if (!isCreateMode && memo) {
      setForm(createInitialForm('view', memo));
      setIsEditing(false);
    }
  }, [isCreateMode, memo]);

  useEffect(() => {
    const handleLinkClick = (event) => {
      const link = event.target.closest?.('a.memo-window-external-link');
      if (!link) return;

      event.preventDefault();
      const href = link.getAttribute('href');
      if (href && window.electron?.openExternal) {
        window.electron.openExternal(href);
      }
    };

    document.addEventListener('click', handleLinkClick);
    return () => document.removeEventListener('click', handleLinkClick);
  }, []);

  const notifyChange = useCallback(async (payload) => {
    try {
      await window.electron?.notifyMemoChanged?.(payload);
    } catch (notifyError) {
      console.error('[MemoDetailWindow] Failed to notify memo change:', notifyError);
    }
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');

    if (!form.content.trim()) {
      setErrorMessage('내용을 입력해 주세요.');
      return;
    }

    const payload = {
      title: buildTitle(form.title, form.content),
      content: form.content,
      important: Boolean(form.important),
      expire_date: form.expire_date || null,
    };

    try {
      if (isCreateMode) {
        const createdMemo = await createMemoMutation.mutateAsync(payload);
        await notifyChange({ action: 'created', id: createdMemo?.id || null });
      } else {
        await updateMemoMutation.mutateAsync({ id, updates: payload });
        await notifyChange({ action: 'updated', id });
      }

      closeWindow();
    } catch (submitError) {
      console.error('[MemoDetailWindow] Failed to save memo:', submitError);
      setErrorMessage(submitError.message || '메모 저장에 실패했습니다.');
    }
  };

  const handleDelete = async () => {
    if (!id || isMutating) return;
    setErrorMessage('');

    try {
      await deleteMemoMutation.mutateAsync(id);
      await notifyChange({ action: 'deleted', id });
      closeWindow();
    } catch (deleteError) {
      console.error('[MemoDetailWindow] Failed to delete memo:', deleteError);
      setErrorMessage(deleteError.message || '메모 삭제에 실패했습니다.');
      setShowDeleteConfirm(false);
    }
  };

  const windowTitle = useMemo(() => {
    if (isCreateMode) return '새 메모';
    if (isEditing) return '메모 수정';
    return '메모 상세';
  }, [isCreateMode, isEditing]);

  const detailContent = useMemo(() => linkifyContent(memo?.content || ''), [memo?.content]);
  const canShowDetail = !isCreateMode && !isEditing && memo;

  return (
    <div className="memo-window">
      <header className="memo-window-titlebar">
        <div className="memo-window-title">{windowTitle}</div>
        <button
          className="memo-window-close"
          type="button"
          aria-label="창 닫기"
          onClick={closeWindow}
        >
          x
        </button>
      </header>

      <main className="memo-window-main">
        {!isCreateMode && !id && (
          <div className="memo-window-state">메모 ID가 없습니다.</div>
        )}

        {!isCreateMode && isLoading && (
          <div className="memo-window-state">메모를 불러오는 중입니다.</div>
        )}

        {!isCreateMode && isError && (
          <div className="memo-window-state error">
            {error?.message || '메모를 불러오지 못했습니다.'}
          </div>
        )}

        {canShowDetail && (
          <section className="memo-window-detail">
            <div className="memo-window-detail-header">
              <h1>{memo.title}</h1>
              {memo.important && <span className="memo-window-badge">중요</span>}
            </div>

            <dl className="memo-window-meta">
              <div>
                <dt>작성자</dt>
                <dd>{memo.authorDisplayName || '-'}</dd>
              </div>
              <div>
                <dt>작성일</dt>
                <dd>{formatDateTime(memo.createdAt)}</dd>
              </div>
              {memo.expire_date && (
                <div>
                  <dt>만료일</dt>
                  <dd>{formatDate(memo.expire_date)}</dd>
                </div>
              )}
            </dl>

            <div
              className="memo-window-content"
              dangerouslySetInnerHTML={{ __html: detailContent }}
            />

            {errorMessage && <div className="memo-window-error">{errorMessage}</div>}

            <div className="memo-window-actions">
              <button
                type="button"
                className="memo-window-btn primary"
                onClick={() => {
                  setForm(createInitialForm('view', memo));
                  setIsEditing(true);
                  setErrorMessage('');
                }}
              >
                수정
              </button>
              <button
                type="button"
                className="memo-window-btn danger"
                onClick={() => setShowDeleteConfirm(true)}
              >
                삭제
              </button>
              <button
                type="button"
                className="memo-window-btn secondary"
                onClick={closeWindow}
              >
                닫기
              </button>
            </div>
          </section>
        )}

        {(isCreateMode || isEditing) && (
          <form className="memo-window-form" onSubmit={handleSubmit}>
            <label className="memo-window-field">
              <span>제목</span>
              <input
                type="text"
                value={form.title}
                placeholder="비워두면 내용 앞부분으로 자동 생성됩니다."
                onChange={(event) => setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))}
              />
            </label>

            <label className="memo-window-field content">
              <span>내용</span>
              <textarea
                value={form.content}
                rows={10}
                required
                placeholder="메모 내용을 입력해 주세요."
                onChange={(event) => setForm((current) => ({
                  ...current,
                  content: event.target.value,
                }))}
              />
            </label>

            <label className="memo-window-field">
              <span>만료일</span>
              <input
                type="date"
                value={form.expire_date}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  expire_date: event.target.value,
                }))}
              />
            </label>

            <label className="memo-window-check">
              <input
                type="checkbox"
                checked={form.important}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  important: event.target.checked,
                }))}
              />
              <span>중요 메모로 표시</span>
            </label>

            {errorMessage && <div className="memo-window-error">{errorMessage}</div>}

            <div className="memo-window-actions">
              <button
                type="button"
                className="memo-window-btn secondary"
                disabled={isMutating}
                onClick={() => {
                  if (isCreateMode) {
                    closeWindow();
                    return;
                  }

                  setForm(createInitialForm('view', memo));
                  setIsEditing(false);
                  setErrorMessage('');
                }}
              >
                취소
              </button>
              <button
                type="submit"
                className="memo-window-btn primary"
                disabled={isMutating}
              >
                {isMutating ? '저장 중' : '저장'}
              </button>
            </div>
          </form>
        )}
      </main>

      {showDeleteConfirm && (
        <div className="memo-window-dialog" role="dialog" aria-modal="true">
          <div className="memo-window-dialog-panel">
            <h2>메모 삭제</h2>
            <p>이 메모를 삭제하시겠습니까?</p>
            <div className="memo-window-actions">
              <button
                type="button"
                className="memo-window-btn secondary"
                disabled={isMutating}
                onClick={() => setShowDeleteConfirm(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="memo-window-btn danger"
                disabled={isMutating}
                onClick={handleDelete}
              >
                {deleteMemoMutation.isPending ? '삭제 중' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MemoDetailWindow;
