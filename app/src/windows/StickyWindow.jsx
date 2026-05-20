import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { useQueryClient } from '@tanstack/react-query';
import { memoQueryKeys } from '../hooks/queries/memoQueryKeys';
import { ROUTES } from '../constants/routes';
import { useEmailStats } from '../hooks/queries/useEmailInquiries';
import { useActiveMemos } from '../hooks/queries/useMemos';
import { useSchedules } from '../hooks/queries/useSchedules';
import { useWebsiteStats } from '../hooks/queries/useWebsiteInquiries';
import './StickyWindow.css';

const WINDOW_WIDTH = 300;
const MIN_WINDOW_HEIGHT = 170;

function getTodayString(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function toDateString(value) {
  if (!value) return '';
  if (value instanceof Date) return getTodayString(value);
  return String(value).split('T')[0];
}

function isScheduleToday(schedule, todayString) {
  const startDate = toDateString(schedule.start_date);
  if (!startDate) return false;
  const endDate = toDateString(schedule.end_date) || startDate;
  return todayString >= startDate && todayString <= endDate;
}

function isCompanySchedule(schedule) {
  const type = String(schedule.type || '').toLowerCase();
  return type === 'company' || type === '회사';
}

function linkifyContent(text) {
  if (!text) return '';
  const urlPattern = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
  const linkedText = text.replace(urlPattern, (url) => {
    const href = url.startsWith('www.') ? `https://${url}` : url;
    return `<a href="${href}" class="sticky-window-link">${url}</a>`;
  });
  return DOMPurify.sanitize(linkedText);
}

function Section({ title, count, action, children }) {
  return (
    <section className="sticky-window-section">
      <header className="sticky-window-section-header">
        <div className="sticky-window-section-title">
          {title}
          <span className="sticky-window-section-count">{count}</span>
        </div>
        {action}
      </header>
      <div className="sticky-window-section-body">{children}</div>
    </section>
  );
}

function EmptyState({ children }) {
  return <div className="sticky-window-empty">{children}</div>;
}

function StickyWindow() {
  const { type = 'dashboard' } = useParams();
  const queryClient = useQueryClient();
  const containerRef = useRef(null);
  const [opacityValue, setOpacityValue] = useState(100);
  const [todayString, setTodayString] = useState(() => getTodayString());

  const normalizedType = String(type || 'dashboard').toLowerCase();
  const showSchedules = ['dashboard', 'summary', 'schedule', 'schedules'].includes(normalizedType);
  const showStats = ['dashboard', 'summary', 'stats', 'stat', 'consultation', 'consultations'].includes(normalizedType);
  const showMemos = ['dashboard', 'summary', 'memo', 'memos'].includes(normalizedType);

  const todayScheduleFilters = useMemo(() => ({
    start_date: todayString,
    end_date: todayString,
  }), [todayString]);

  const {
    data: memos = [],
    isLoading: memosLoading,
    isError: memosError,
    error: memosErrorDetail,
    refetch: refetchMemos,
  } = useActiveMemos({}, { enabled: showMemos });
  const {
    data: schedules = [],
    isLoading: schedulesLoading,
    isError: schedulesError,
    error: schedulesErrorDetail,
    refetch: refetchSchedules,
  } = useSchedules(todayScheduleFilters, { enabled: showSchedules });
  const { data: websiteStats = {}, refetch: refetchWebsiteStats } = useWebsiteStats({ enabled: showStats });
  const { data: emailStats = {}, refetch: refetchEmailStats } = useEmailStats({ enabled: showStats });

  const todaySchedules = useMemo(() => {
    return schedules.filter((schedule) => isScheduleToday(schedule, todayString));
  }, [schedules, todayString]);

  const companySchedules = useMemo(
    () => todaySchedules.filter((schedule) => isCompanySchedule(schedule)),
    [todaySchedules]
  );
  const personalSchedules = useMemo(
    () => todaySchedules.filter((schedule) => !isCompanySchedule(schedule)),
    [todaySchedules]
  );

  const websiteCount = websiteStats.website ?? websiteStats.unread ?? 0;
  const emailCount = emailStats.unread || 0;
  const pendingCount = websiteCount + emailCount;
  const hasPending = pendingCount > 0;

  const resizeWindow = useCallback(async () => {
    const container = containerRef.current;
    if (!container || !window.electron?.resizeStickyWindow) return;

    const height = Math.max(MIN_WINDOW_HEIGHT, Math.ceil(container.scrollHeight));
    await window.electron.resizeStickyWindow(WINDOW_WIDTH, height);
    await window.electron?.showStickyWindow?.();
  }, []);

  useEffect(() => {
    document.body.classList.add('sticky-window-body');
    return () => document.body.classList.remove('sticky-window-body');
  }, []);

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setDate(nextMidnight.getDate() + 1);
    nextMidnight.setHours(0, 0, 0, 0);

    const timer = setTimeout(() => {
      setTodayString(getTodayString());
    }, nextMidnight.getTime() - now.getTime());

    return () => clearTimeout(timer);
  }, [todayString]);

  useEffect(() => {
    let canceled = false;
    window.electron?.getWindowOpacity?.()
      .then((opacity) => {
        if (!canceled && typeof opacity === 'number') {
          setOpacityValue(Math.round(opacity * 100));
        }
      })
      .catch((error) => {
        console.error('[StickyWindow] Failed to load opacity:', error);
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    resizeWindow();
    const observer = new ResizeObserver(resizeWindow);
    observer.observe(container);
    return () => observer.disconnect();
  }, [resizeWindow, showMemos, showSchedules, showStats]);

  useEffect(() => {
    if (!window.electron?.onMemoWindowChanged) return undefined;
    return window.electron.onMemoWindowChanged(() => {
      queryClient.invalidateQueries({ queryKey: memoQueryKeys.all });
    });
  }, [queryClient]);

  useEffect(() => {
    if (!window.electron?.onWebSocketEvent) return undefined;

    const cleanups = [
      window.electron.onWebSocketEvent('consultation:created', refetchWebsiteStats),
      window.electron.onWebSocketEvent('consultation:updated', refetchWebsiteStats),
      window.electron.onWebSocketEvent('consultation:deleted', refetchWebsiteStats),
      window.electron.onWebSocketEvent('email:created', refetchEmailStats),
      window.electron.onWebSocketEvent('email:updated', refetchEmailStats),
      window.electron.onWebSocketEvent('email:deleted', refetchEmailStats),
      window.electron.onWebSocketEvent('memo:created', refetchMemos),
      window.electron.onWebSocketEvent('memo:updated', refetchMemos),
      window.electron.onWebSocketEvent('memo:deleted', refetchMemos),
      window.electron.onWebSocketEvent('schedule:created', refetchSchedules),
      window.electron.onWebSocketEvent('schedule:updated', refetchSchedules),
      window.electron.onWebSocketEvent('schedule:deleted', refetchSchedules),
    ].filter(Boolean);

    return () => cleanups.forEach((cleanup) => cleanup?.());
  }, [refetchEmailStats, refetchMemos, refetchSchedules, refetchWebsiteStats]);

  useEffect(() => {
    if (!window.electron?.onWebSocketStatusChanged) return undefined;

    return window.electron.onWebSocketStatusChanged((status) => {
      if (!status?.connected) return;
      refetchMemos();
      refetchSchedules();
      refetchWebsiteStats();
      refetchEmailStats();
    });
  }, [refetchEmailStats, refetchMemos, refetchSchedules, refetchWebsiteStats]);

  useEffect(() => {
    const handleLinkClick = (event) => {
      const link = event.target.closest?.('a.sticky-window-link');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href');
      if (href) window.electron?.openExternal?.(href);
    };

    document.addEventListener('click', handleLinkClick);
    return () => document.removeEventListener('click', handleLinkClick);
  }, []);

  const refreshAll = () => {
    refetchMemos();
    refetchSchedules();
    refetchWebsiteStats();
    refetchEmailStats();
  };

  const handleOpacityChange = async (event) => {
    const nextValue = Number(event.target.value);
    setOpacityValue(nextValue);
    await window.electron?.setWindowOpacity?.(nextValue / 100);
  };

  return (
    <div className="sticky-window-shell" ref={containerRef}>
      <div className="sticky-window-shadow" />
      <div className="sticky-window-wrapper">
        <header className="sticky-window-titlebar">
          <div className="sticky-window-title">알림창</div>
          <div className="sticky-window-controls">
            <label className="sticky-window-opacity">
              <span>투명도</span>
              <input type="range" min="20" max="100" value={opacityValue} onChange={handleOpacityChange} />
            </label>
            <button
              className="sticky-window-close"
              type="button"
              aria-label="닫기"
              onClick={() => window.electron?.closeCurrentWindow?.()}
            >
              ×
            </button>
          </div>
        </header>

        <main className="sticky-window-content">
          {showSchedules && (
            <Section title="오늘 일정" count={todaySchedules.length}>
              {schedulesLoading ? (
                <EmptyState>일정을 불러오는 중입니다</EmptyState>
              ) : schedulesError ? (
                <EmptyState>{schedulesErrorDetail?.message || '일정을 불러오지 못했습니다'}</EmptyState>
              ) : todaySchedules.length === 0 ? (
                <EmptyState>오늘 일정이 없습니다</EmptyState>
              ) : (
                <>
                  {companySchedules.length > 0 && (
                    <div className="sticky-window-schedule-group company">
                      <div className="sticky-window-schedule-title">회사</div>
                      {companySchedules.map((schedule) => (
                        <div className="sticky-window-schedule-item" key={schedule.id}>
                          <span className="sticky-window-schedule-time">{schedule.time || '시간 미정'}</span>
                          <span className="sticky-window-schedule-name">{schedule.title || ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {personalSchedules.length > 0 && (
                    <div className="sticky-window-schedule-group personal">
                      <div className="sticky-window-schedule-title">개인</div>
                      {personalSchedules.map((schedule) => {
                        const authorName = schedule.authorDisplayName || '';
                        const displayTitle = authorName ? `${authorName} - ${schedule.title || ''}` : schedule.title || '';
                        return (
                          <div className="sticky-window-schedule-item" key={schedule.id}>
                            <span className="sticky-window-schedule-time">{schedule.time || '시간 미정'}</span>
                            <span className="sticky-window-schedule-name">{displayTitle}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </Section>
          )}

          {showStats && (
            <section className={`sticky-window-section sticky-window-section-pending${hasPending ? ' has-items' : ''}`}>
              <header className="sticky-window-section-header">
                <div className="sticky-window-section-title">
                  미확인 상담 요청
                  <span className="sticky-window-section-count">{pendingCount}</span>
                </div>
              </header>
              <div className="sticky-window-pending-bar">
                <button type="button" className={`sticky-window-pending-item email${emailCount > 0 ? ' has-items' : ''}`} onClick={() => window.electron?.focusMainWindow?.(ROUTES.EMAIL_CONSULTATIONS)}>
                  <span>이메일</span>
                  <strong>{emailCount}</strong>
                </button>
                <button type="button" className={`sticky-window-pending-item website${websiteCount > 0 ? ' has-items' : ''}`} onClick={() => window.electron?.focusMainWindow?.(ROUTES.WEBSITE_CONSULTATIONS)}>
                  <span>홈페이지</span>
                  <strong>{websiteCount}</strong>
                </button>
              </div>
            </section>
          )}

          {showMemos && (
            <Section
              title="팀 메모"
              count={memos.length}
              action={<button type="button" className="sticky-window-add" onClick={() => window.electron?.openMemoSubWindow?.('create')}>+ 추가</button>}
            >
              {memosLoading ? (
                <EmptyState>메모를 불러오는 중입니다</EmptyState>
              ) : memosError ? (
                <EmptyState>{memosErrorDetail?.message || '메모를 불러오지 못했습니다'}</EmptyState>
              ) : memos.length === 0 ? (
                <EmptyState>메모가 없습니다</EmptyState>
              ) : (
                <div className="sticky-window-memo-list">
                  {memos.map((memo) => (
                    <button type="button" className="sticky-window-memo" key={memo.id} onClick={() => window.electron?.openMemoSubWindow?.('view', memo.id)}>
                      <div className="sticky-window-memo-header">
                        {memo.important && <span className="sticky-window-memo-badge">중요</span>}
                        <span className="sticky-window-memo-title">{memo.title || ''}</span>
                        {memo.authorDisplayName && <span className="sticky-window-memo-author">{memo.authorDisplayName}</span>}
                      </div>
                      <div className="sticky-window-memo-content" dangerouslySetInnerHTML={{ __html: linkifyContent(memo.content) }} />
                    </button>
                  ))}
                </div>
              )}
            </Section>
          )}

          <button type="button" className="sticky-window-refresh" onClick={refreshAll}>
            새로고침
          </button>
        </main>
      </div>
    </div>
  );
}

export default StickyWindow;
