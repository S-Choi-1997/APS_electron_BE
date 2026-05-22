/**
 * Dashboard.jsx - 메인 대시보드 화면
 *
 * 협업툴 스타일의 메인 화면
 * - 우측: 캘린더 (상단 ~ 중앙)
 * - 좌측 상단: 팀 메모
 * - 좌측 하단: 미확인 상담 요청 (이메일/홈페이지)
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import Modal from './Modal';
import { useEmailStats } from '../hooks/queries/useEmailInquiries';
import {
  useActiveMemos,
  useCreateMemo,
  useDeleteMemo,
  useUpdateMemo,
} from '../hooks/queries/useMemos';
import {
  useCreateSchedule,
  useDeleteSchedule,
  useSchedules,
  useUpdateSchedule,
} from '../hooks/queries/useSchedules';
import { useAllWebsiteInquiries, useWebsiteStats } from '../hooks/queries/useWebsiteInquiries';
import { ROUTES } from '../constants/routes';
import {
  getKoreanPublicHolidaysForDate,
  hasKoreanPublicHolidayDataForYear,
} from '../utils/koreanHolidays';
import './Dashboard.css';
import './css/PageLayout.css';
import './css/DashboardLayout.css';
import './css/DashboardNotice.css';
import './css/DashboardPending.css';
import './css/DashboardCalendar.css';

function getDateInputValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function getMonthQueryRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start_date: getDateInputValue(start),
    end_date: getDateInputValue(end),
  };
}

function isCompanyScheduleType(type) {
  return type === 'company' || type === '회사';
}

function Dashboard({ user }) {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const scheduleRange = useMemo(() => getMonthQueryRange(currentDate), [currentDate]);
  const { data: consultations = [] } = useAllWebsiteInquiries(scheduleRange, { enabled: !!user });
  const { data: websiteStats = {} } = useWebsiteStats({ enabled: !!user });
  const { data: emailStats = {} } = useEmailStats({ enabled: !!user });

  const {
    data: memos = [],
    isLoading: memosLoading,
    isError: memosError,
    error: memosErrorDetail,
    refetch: refetchMemos,
  } = useActiveMemos({}, { enabled: !!user });
  const {
    data: schedules = [],
    isLoading: schedulesLoading,
    isError: schedulesError,
    error: schedulesErrorDetail,
    refetch: refetchSchedules,
  } = useSchedules(scheduleRange, { enabled: !!user });
  const createMemoMutation = useCreateMemo();
  const updateMemoMutation = useUpdateMemo();
  const deleteMemoMutation = useDeleteMemo();
  const createScheduleMutation = useCreateSchedule();
  const updateScheduleMutation = useUpdateSchedule();
  const deleteScheduleMutation = useDeleteSchedule();

  // 모달 상태
  const [showMemoCreateModal, setShowMemoCreateModal] = useState(false);
  const [showMemoEditModal, setShowMemoEditModal] = useState(false);
  const [showMemoDetailModal, setShowMemoDetailModal] = useState(false);
  const [showScheduleCreateModal, setShowScheduleCreateModal] = useState(false);
  const [showScheduleEditModal, setShowScheduleEditModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [selectedMemo, setSelectedMemo] = useState(null);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // 메모 폼 상태
  const [memoForm, setMemoForm] = useState({
    title: '',
    content: '',
    important: false,
    expire_date: '',
  });

  // 일정 폼 상태 (날짜는 YYYY-MM-DD 문자열로 관리)
  const [scheduleForm, setScheduleForm] = useState({
    title: '',
    time: '',
    start_date: '', // YYYY-MM-DD 형식의 문자열
    end_date: '', // YYYY-MM-DD 형식의 문자열
    type: '회사', // 기본값: 회사
    author: '',
    multiDay: false, // 여러 날 일정 체크박스
    hasTime: false, // 시간 지정 체크박스
  });

  // 미확인 상담 요청 통계 (API stats 사용)
  const uncheckedConsultations = consultations.filter(c => !c.check);
  // 이메일은 현재 로직 없음 (0건), 홈페이지는 미확인(check=false) 건수
  const emailCount = emailStats.unread || 0;
  const websiteCount = websiteStats.website ?? websiteStats.unread ?? uncheckedConsultations.length;
  const dashboardMemos = useMemo(
    () => [...memos].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [memos]
  );

  // 캘린더 생성 로직
  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];

    // 이전 달의 빈 칸
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // 현재 달의 날짜
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  };

  const days = getDaysInMonth(currentDate);

  const moveVisibleMonth = (monthOffset) => {
    const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + monthOffset, 1);
    setCurrentDate(nextMonth);
    setSelectedDate(nextMonth);
  };

  const handlePrevMonth = () => {
    moveVisibleMonth(-1);
  };

  const handleNextMonth = () => {
    moveVisibleMonth(1);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  const isToday = (date) => {
    if (!date) return false;
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isSelected = (date) => {
    if (!date) return false;
    return date.toDateString() === selectedDate.toDateString();
  };

  // 해당 날짜의 문의 건수
  const getInquiriesCount = (date) => {
    if (!date) return 0;
    return consultations.filter(c => {
      const createdDate = new Date(c.createdAt);
      return createdDate.toDateString() === date.toDateString();
    }).length;
  };

  // 해당 날짜의 일정 가져오기 (날짜 범위 체크)
  const getSchedulesForDate = (date) => {
    if (!date) return [];
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return schedules.filter(s => {
      const startDate = new Date(s.start_date.getFullYear(), s.start_date.getMonth(), s.start_date.getDate());
      const endDate = new Date(s.end_date.getFullYear(), s.end_date.getMonth(), s.end_date.getDate());
      return dateOnly >= startDate && dateOnly <= endDate;
    });
  };

  // 선택된 날짜의 일정
  const selectedDateSchedules = getSchedulesForDate(selectedDate);
  const selectedDateHolidays = getKoreanPublicHolidaysForDate(selectedDate);
  const hasHolidayDataForDisplayedYear = hasKoreanPublicHolidayDataForYear(currentDate.getFullYear());


  // 메모 관련 핸들러
  const handleMemoCreate = async () => {
    if (!memoForm.content.trim()) return;

    let finalTitle = memoForm.title.trim();

    // 제목이 없을 때만 자동 생성 (내용이 20자 이상이면 "..." 추가)
    if (!finalTitle) {
      const content = memoForm.content.trim();
      finalTitle = content.length > 20 ? content.substring(0, 20) + '...' : content;
    }

    const memoData = {
      title: finalTitle,
      content: memoForm.content,
      important: memoForm.important,
      expire_date: memoForm.expire_date || null,
      // author is automatically set by backend using req.user.email
    };

    createMemoMutation.mutate(memoData, {
      onSuccess: (createdMemo) => {
        console.log('[Dashboard] Memo created successfully:', createdMemo.id);
        setMemoForm({ title: '', content: '', important: false, expire_date: '' });
        setShowMemoCreateModal(false);
      },
      onError: (error) => {
        console.error('[Dashboard] Memo creation failed:', error);
        alert('메모 생성에 실패했습니다: ' + error.message);
      },
    });
  };

  const handleMemoClick = (memo) => {
    setSelectedMemo(memo);
    setShowMemoDetailModal(true);
  };

  const handleMemoEdit = (memo) => {
    setSelectedMemo(memo);
    setMemoForm({
      title: memo.title,
      content: memo.content,
      important: memo.important,
      expire_date: memo.expire_date || '',
    });
    setShowMemoDetailModal(false);
    setShowMemoEditModal(true);
  };


  const handleMemoUpdate = async () => {
    if (!memoForm.content.trim()) return;

    let finalTitle = memoForm.title.trim();

    if (!finalTitle) {
      const content = memoForm.content.trim();
      finalTitle = content.length > 20 ? content.substring(0, 20) + '...' : content;
    }

    const updates = {
      title: finalTitle,
      content: memoForm.content,
      important: memoForm.important,
      expire_date: memoForm.expire_date || null,
    };

    updateMemoMutation.mutate({ id: selectedMemo.id, updates }, {
      onSuccess: () => {
        console.log('[Dashboard] Memo updated successfully');
        setMemoForm({ title: '', content: '', important: false, expire_date: '' });
        setShowMemoEditModal(false);
        setSelectedMemo(null);
      },
      onError: (error) => {
        console.error('[Dashboard] Memo update failed:', error);
        alert('메모 수정에 실패했습니다: ' + error.message);
      },
    });
  };

  const handleMemoDelete = async () => {
    if (deleteTarget && deleteTarget.type === 'memo') {
      const memoId = deleteTarget.id;

      // 모달 닫기
      setShowMemoDetailModal(false);
      setShowDeleteConfirmModal(false);
      setDeleteTarget(null);

      // React Query Mutation 실행 (낙관적 업데이트 + 서버 동기화 자동 처리)
      deleteMemoMutation.mutate(memoId, {
        onSuccess: () => {
          console.log('[Dashboard] Memo deleted successfully:', memoId);
        },
        onError: (error) => {
          console.error('[Dashboard] Memo deletion failed:', error);
          alert('메모 삭제에 실패했습니다: ' + error.message);
        },
      });
    }
  };

  // 일정 관련 핸들러
  const handleScheduleCreate = async () => {
    if (!scheduleForm.title.trim()) return; // 제목만 필수

    try {
      const scheduleData = {
        title: scheduleForm.title,
        time: scheduleForm.hasTime ? scheduleForm.time : null, // 시간 지정 체크 시에만
        start_date: scheduleForm.start_date, // 이미 YYYY-MM-DD 형식
        end_date: scheduleForm.multiDay ? scheduleForm.end_date : scheduleForm.start_date, // 여러 날 체크 시에만 end_date 다르게
        type: scheduleForm.type === '회사' ? 'company' : 'personal',
        // author is automatically set by backend using req.user.email
      };

      await createScheduleMutation.mutateAsync(scheduleData);

      // Toast 알림은 WebSocket 이벤트 핸들러에서 처리됨 (중복 방지)

      setScheduleForm({ title: '', time: '', start_date: '', end_date: '', type: '회사', author: '', multiDay: false, hasTime: false });
      setShowScheduleCreateModal(false);

      // WebSocket 이벤트가 자동으로 모든 창에 전파됨 (Main Process를 통해)
    } catch (error) {
      console.error('일정 생성 실패:', error);
      alert('일정 생성에 실패했습니다: ' + error.message);
    }
  };

  const handleScheduleEdit = (schedule) => {
    setSelectedSchedule(schedule);
    const isMultiDay = schedule.start_date.getTime() !== schedule.end_date.getTime();
    const hasTime = schedule.time && schedule.time.trim() !== '';

    // Date 객체를 YYYY-MM-DD 문자열로 변환
    const formatDateString = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    setScheduleForm({
      title: schedule.title,
      time: schedule.time || '',
      start_date: formatDateString(schedule.start_date),
      end_date: formatDateString(schedule.end_date),
      type: schedule.type,
      author: schedule.author,
      multiDay: isMultiDay,
      hasTime: hasTime,
    });
    setShowScheduleEditModal(true);
  };

  const handleScheduleUpdate = async () => {
    if (!scheduleForm.title.trim()) return; // 제목만 필수

    try {
      const scheduleData = {
        title: scheduleForm.title,
        time: scheduleForm.hasTime ? scheduleForm.time : null,
        start_date: scheduleForm.start_date, // 이미 YYYY-MM-DD 형식
        end_date: scheduleForm.multiDay ? scheduleForm.end_date : scheduleForm.start_date,
        type: scheduleForm.type === '회사' ? 'company' : 'personal',
      };

      await updateScheduleMutation.mutateAsync({ id: selectedSchedule.id, updates: scheduleData });

      setScheduleForm({ title: '', time: '', start_date: '', end_date: '', type: '회사', author: '', multiDay: false, hasTime: false });
      setShowScheduleEditModal(false);
      setSelectedSchedule(null);

      // WebSocket 이벤트가 자동으로 모든 창에 전파됨 (Main Process를 통해)
    } catch (error) {
      console.error('일정 수정 실패:', error);
      alert('일정 수정에 실패했습니다: ' + error.message);
    }
  };

  const handleScheduleDelete = async () => {
    if (deleteTarget && deleteTarget.type === 'schedule') {
      try {
        await deleteScheduleMutation.mutateAsync(deleteTarget.id);

        setShowDeleteConfirmModal(false);
        setDeleteTarget(null);

        // WebSocket 이벤트가 자동으로 모든 창에 전파됨 (Main Process를 통해)
      } catch (error) {
        console.error('일정 삭제 실패:', error);
        alert('일정 삭제에 실패했습니다: ' + error.message);
      }
    }
  };

  const confirmDelete = (item, type) => {
    setDeleteTarget({ ...item, type });
    setShowDeleteConfirmModal(true);
  };

  // 시간 옵션 생성 (30분 단위, 오전/오후 그룹화)
  const generateTimeOptions = () => {
    const options = [];

    // 오전 (09:00 ~ 11:30)
    for (let h = 9; h <= 11; h++) {
      options.push({ value: `${String(h).padStart(2, '0')}:00`, label: `${h}:00`, period: '오전' });
      if (h < 11 || h === 11) {
        options.push({ value: `${String(h).padStart(2, '0')}:30`, label: `${h}:30`, period: '오전' });
      }
    }

    // 오후 (12:00 ~ 18:00)
    for (let h = 12; h <= 18; h++) {
      const displayHour = h > 12 ? h - 12 : h;
      options.push({ value: `${String(h).padStart(2, '0')}:00`, label: `${displayHour}:00`, period: '오후' });
      if (h < 18) {
        options.push({ value: `${String(h).padStart(2, '0')}:30`, label: `${displayHour}:30`, period: '오후' });
      }
    }

    return options;
  };

  const timeOptions = generateTimeOptions();

  // 기본 시간 설정 (현재 시간 기준 다음 30분 단위)
  const getDefaultTime = () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    let nextHour = currentHour;
    let nextMinute = currentMinute < 30 ? 30 : 0;

    if (nextMinute === 0) {
      nextHour += 1;
    }

    // 영업 시간 범위로 제한 (9:00 ~ 18:00)
    if (nextHour < 9) {
      nextHour = 9;
      nextMinute = 0;
    } else if (nextHour >= 18) {
      nextHour = 9;
      nextMinute = 0;
    }

    return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
  };

  // WebSocket 이벤트 리스너 제거됨
  // NOTE: useWebSocketSync Hook이 Main Process의 WebSocket 이벤트를 처리
  // Dashboard는 React Query만 사용하여 상태 관리

  // 자정(날짜 변경) 감지 - 메모 만료 처리를 위한 자동 새로고침
  useEffect(() => {
    const checkMidnight = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const msUntilMidnight = tomorrow.getTime() - now.getTime();

      console.log(`[Dashboard] 다음 자정까지 ${Math.floor(msUntilMidnight / 1000 / 60)}분 남음`);

      const timer = setTimeout(() => {
        console.log('[Dashboard] 날짜 변경 감지 - 메모 및 일정 새로고침');
        refetchMemos();
        refetchSchedules();

        // 다음 자정을 위해 재귀 호출
        checkMidnight();
      }, msUntilMidnight);

      return timer;
    };

    const timer = checkMidnight();

    // 컴포넌트 언마운트 시 타이머 정리
    return () => clearTimeout(timer);
  }, [refetchMemos, refetchSchedules]);

  // 일정 폼이 열릴 때 기본 시간 설정
  useEffect(() => {
    if (showScheduleCreateModal && !scheduleForm.time) {
      setScheduleForm(prev => ({ ...prev, time: getDefaultTime() }));
    }
  }, [showScheduleCreateModal]);

  // 로그인 시 알림창 자동 열기
  useEffect(() => {
    if (!user || !window.electron) return;

    // 메모와 일정 데이터가 모두 로드된 후 알림창 열기
    if (!memosLoading && !schedulesLoading) {
      const openStickyOnLogin = async () => {
        try {
          // 이미 열려있는지 확인
          const isOpen = await window.electron.isStickyWindowOpen('dashboard');

          // 이미 열려있으면 무시
          if (isOpen) return;

          // 캐시 데이터 준비
          // 알림창 열기 (리셋 모드 아님)
          await window.electron.openStickyWindow('dashboard', '알림창', false);
        } catch (error) {
          console.error('[Dashboard] Failed to auto-open sticky window:', error);
        }
      };

      openStickyOnLogin();
    }
  }, [user, memosLoading, schedulesLoading]);

  // 메모 날짜별 그룹화 함수
  const groupMemosByDate = (memos) => {
    const sorted = [...memos].sort((a, b) => b.createdAt - a.createdAt);
    const groups = [];
    let currentDate = null;

    sorted.forEach(memo => {
      const memoDate = memo.createdAt.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      if (memoDate !== currentDate) {
        groups.push({ type: 'divider', date: memoDate });
        currentDate = memoDate;
      }

      groups.push({ type: 'memo', data: memo });
    });

    return groups;
  };

  // URL 자동 링크 변환 함수 - 카드용 (클릭 불가)
  const linkifyContentCard = (text) => {
    if (!text) return '';
    const urlPattern = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
    const linkedText = text.replace(urlPattern, (url) => {
      return `<span class="link-text" style="color: #667eea; text-decoration: underline; cursor: default;">${url}</span>`;
    });
    return DOMPurify.sanitize(linkedText);
  };

  // URL 자동 링크 변환 함수 - 모달용 (클릭 가능, 외부 브라우저)
  const linkifyContentModal = (text) => {
    if (!text) return '';
    const urlPattern = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
    const linkedText = text.replace(urlPattern, (url) => {
      const href = url.startsWith('www.') ? `https://${url}` : url;
      return `<a href="${href}" class="external-link-modal" data-clickable="true" style="color: #667eea; text-decoration: underline; cursor: pointer;">${url}</a>`;
    });
    return DOMPurify.sanitize(linkedText);
  };

  // 외부 링크를 기본 브라우저에서 열기
  useEffect(() => {
    const handleLinkClick = async (e) => {
      if (e.target.tagName === 'A' && e.target.dataset.clickable === 'true') {
        e.preventDefault();
        const href = e.target.getAttribute('href');
        if (window.electron && window.electron.openExternal) {
          try {
            await window.electron.openExternal(href);
          } catch (error) {
            console.error('[Dashboard] Failed to open external link:', error);
          }
        }
      }
    };
    document.addEventListener('click', handleLinkClick);
    return () => document.removeEventListener('click', handleLinkClick);
  }, []);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="header-row">
          <h1 className="page-title">대시보드</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="add-btn"
              onClick={async () => {
                if (!window.electron) return;
                try {
                  // 이미 열려있는지 확인
                  const isOpen = await window.electron.isStickyWindowOpen('dashboard');
                  // 캐시 데이터: 메모, 일정, 미확인 상담
                  // 열려있으면 포커스, 아니면 열기
                  await window.electron.openStickyWindow('dashboard', '알림창', false);
                } catch (error) {
                  console.error('[Dashboard] Failed to open sticky window:', error);
                }
              }}
              title="알림창 띄우기"
            >
              알림창
            </button>
            <button
              className="add-btn"
              onClick={async () => {
                if (!window.electron) return;
                try {
                  // 캐시 데이터: 메모, 일정, 미확인 상담
                  // 리셋 모드로 열기
                  await window.electron.openStickyWindow('dashboard', '알림창', true);
                } catch (error) {
                  console.error('[Dashboard] Failed to reset sticky window:', error);
                }
              }}
              title="알림창 위치 초기화"
            >
              ⟲
            </button>
          </div>
        </div>
      </div>

      <div className="page-content dashboard-layout">
        {/* 좌측 캘린더 영역 */}
        <div className="dashboard-left">
          <div className="dashboard-card calendar-card">
            <div className="card-header">
              <h2>캘린더</h2>
              <button type="button" className="today-btn" onClick={handleToday}>오늘</button>
            </div>

            <div className="calendar">
              <div className="calendar-header">
                <button type="button" className="nav-btn" onClick={handlePrevMonth} aria-label="이전 달">‹</button>
                <h3>
                  {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월
                </h3>
                <button type="button" className="nav-btn" onClick={handleNextMonth} aria-label="다음 달">›</button>
              </div>

              <div className="calendar-grid">
                <div className="calendar-day-header">일</div>
                <div className="calendar-day-header">월</div>
                <div className="calendar-day-header">화</div>
                <div className="calendar-day-header">수</div>
                <div className="calendar-day-header">목</div>
                <div className="calendar-day-header">금</div>
                <div className="calendar-day-header">토</div>

                {days.map((date, index) => {
                  const dateSchedules = date ? getSchedulesForDate(date) : [];
                  const dateHolidays = date ? getKoreanPublicHolidaysForDate(date) : [];
                  const holidayLabel = dateHolidays.map((holiday) => holiday.name).join(', ');
                  const companyCount = dateSchedules.filter(s => s.type === '회사').length;
                  const personalCount = dateSchedules.filter(s => s.type === '개인').length;
                  const dayOfWeek = date ? date.getDay() : null;
                  const isSaturday = dayOfWeek === 6;
                  const isSunday = dayOfWeek === 0;
                  const calendarDayLabel = date
                    ? [
                      `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`,
                      holidayLabel ? `공휴일 ${holidayLabel}` : '',
                      companyCount > 0 ? `회사 일정 ${companyCount}건` : '',
                      personalCount > 0 ? `개인 일정 ${personalCount}건` : '',
                      isSelected(date) ? '선택됨' : '선택',
                    ].filter(Boolean).join(', ')
                    : undefined;

                  return (
                    <button
                      key={index}
                      type="button"
                      className={`calendar-day ${!date ? 'empty' : ''} ${isSaturday ? 'saturday' : ''} ${isSunday ? 'sunday' : ''} ${dateHolidays.length > 0 ? 'holiday' : ''} ${isToday(date) ? 'today' : ''} ${isSelected(date) ? 'selected' : ''} ${dateSchedules.length > 0 ? 'has-schedules' : ''}`}
                      onClick={() => date && setSelectedDate(date)}
                      disabled={!date}
                      aria-label={calendarDayLabel}
                      aria-pressed={date ? isSelected(date) : undefined}
                      title={holidayLabel || undefined}
                    >
                      {date && (
                        <>
                          <span className="day-number">{date.getDate()}</span>
                          {dateHolidays.length > 0 && (
                            <span className="holiday-label">
                              {dateHolidays[0].shortName || dateHolidays[0].name}
                              {dateHolidays.length > 1 ? ` 외 ${dateHolidays.length - 1}` : ''}
                            </span>
                          )}
                          {dateSchedules.length > 0 && (
                            <span className="schedule-indicators">
                              {companyCount > 0 && <span className="schedule-indicator company">{companyCount}</span>}
                              {personalCount > 0 && <span className="schedule-indicator personal">{personalCount}</span>}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
              {!hasHolidayDataForDisplayedYear ? (
                <div className="holiday-data-notice">
                  {currentDate.getFullYear()}년 한국 공휴일 데이터가 아직 내장되어 있지 않습니다.
                </div>
              ) : null}
            </div>

            {/* 선택된 날짜 정보 및 일정 */}
            <div className="selected-date-info">
              <div className="selected-date-header">
                <h3>
                  {selectedDate.getFullYear()}년 {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일
                </h3>
                <button type="button" className="add-schedule-btn" onClick={() => {
                  const year = selectedDate.getFullYear();
                  const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
                  const day = String(selectedDate.getDate()).padStart(2, '0');
                  const dateString = `${year}-${month}-${day}`;

                  setScheduleForm({
                    title: '',
                    time: '',
                    start_date: dateString,
                    end_date: dateString,
                    type: '회사',
                    author: '',
                    multiDay: false,
                    hasTime: false
                  });
                  setShowScheduleCreateModal(true);
                }}>
                  + 일정
                </button>
              </div>

              {selectedDateHolidays.length > 0 ? (
                <div className="selected-date-holidays" aria-label="한국 공휴일">
                  {selectedDateHolidays.map((holiday) => (
                    <span className="selected-date-holiday" key={`${holiday.date}-${holiday.name}`}>
                      {holiday.name}
                    </span>
                  ))}
                </div>
              ) : null}

              {schedulesError ? (
                <div className="schedule-empty-state error">
                  {schedulesErrorDetail?.message || '일정을 불러오지 못했습니다.'}
                </div>
              ) : selectedDateSchedules.length === 0 ? (
                <div className="schedule-empty-state">선택한 날짜의 일정이 없습니다.</div>
              ) : (
                <div className="schedule-list">
                  {selectedDateSchedules.map(schedule => (
                    <div key={schedule.id} className={`schedule-item schedule-${schedule.type === '회사' ? 'company' : 'personal'}`}>
                      <span className="schedule-type-badge">{schedule.type}</span>
                      <span className="schedule-time">{schedule.time}</span>
                      <span className="schedule-title">
                        {schedule.type === '개인' && <span className="schedule-author">{schedule.authorDisplayName || '사용자'} - </span>}
                        {schedule.title}
                      </span>
                      <div className="schedule-actions">
                        <button
                          type="button"
                          className="schedule-edit-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleScheduleEdit(schedule);
                          }}
                          title="수정"
                          aria-label={`${schedule.title} 일정 수정`}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="schedule-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(schedule, 'schedule');
                          }}
                          title="삭제"
                          aria-label={`${schedule.title} 일정 삭제`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 우측 메모+미확인 영역 */}
        <div className="dashboard-right">
          {/* 팀 메모 */}
          <div className="dashboard-card memo-card">
            <div className="card-header">
              <h2>📝 팀 메모</h2>
              <button className="add-btn" onClick={() => {
                // 만료일을 당일로 기본 설정
                const today = new Date();
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, '0');
                const day = String(today.getDate()).padStart(2, '0');
                const todayString = `${year}-${month}-${day}`;

                setMemoForm({ title: '', content: '', important: false, expire_date: todayString });
                setShowMemoCreateModal(true);
              }}>
                + 메모 추가
              </button>
            </div>
            <div className="memo-list">
              {memosLoading ? (
                <div className="memo-empty-state">메모를 불러오는 중입니다.</div>
              ) : memosError ? (
                <div className="memo-empty-state error">
                  {memosErrorDetail?.message || '메모를 불러오지 못했습니다.'}
                </div>
              ) : dashboardMemos.length === 0 ? (
                <div className="memo-empty-state">표시할 활성 메모가 없습니다.</div>
              ) : dashboardMemos.map((memo) => (
                  <div key={memo.id} className="memo-item" onClick={() => handleMemoClick(memo)}>
                    <div className="memo-card-header">
                      {memo.important && <span className="memo-badge important">중요</span>}
                      <h4 className="memo-card-title">{memo.title}</h4>
                      <span className="memo-card-author">{memo.authorDisplayName || '사용자'}</span>
                    </div>
                    <div className="memo-card-content" dangerouslySetInnerHTML={{ __html: linkifyContentCard(memo.content) }} />
                    <div className="memo-card-date">{memo.createdAt.toLocaleDateString()}</div>
                  </div>
              ))}
            </div>
          </div>

          {/* 미확인 상담 요청 */}
          <div className="dashboard-card pending-card">
            <div className="card-header">
              <h2>⏳ 미확인 상담 요청</h2>
            </div>
            <div className="pending-stats">
              <button type="button" className={`pending-item email${emailCount > 0 ? ' has-items' : ''}`} onClick={() => navigate(ROUTES.EMAIL_CONSULTATIONS)}>
                <div className="pending-icon">✉️</div>
                <div className="pending-info">
                  <span className="pending-label">이메일</span>
                  <span className="pending-count">{emailCount}건</span>
                </div>
              </button>
              <button type="button" className={`pending-item web${websiteCount > 0 ? ' has-items' : ''}`} onClick={() => navigate(ROUTES.WEBSITE_CONSULTATIONS)}>
                <div className="pending-icon">🌐</div>
                <div className="pending-info">
                  <span className="pending-label">홈페이지</span>
                  <span className="pending-count">{websiteCount}건</span>
                </div>
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* 메모 생성 모달 */}
      <Modal
        isOpen={showMemoCreateModal}
        onClose={() => setShowMemoCreateModal(false)}
        title="메모 추가"
      >
        <form className="modal-form" onSubmit={(e) => { e.preventDefault(); handleMemoCreate(); }}>
          <div className="form-group">
            <label>제목 (선택)</label>
            <input
              type="text"
              value={memoForm.title}
              onChange={(e) => setMemoForm({ ...memoForm, title: e.target.value })}
              placeholder="제목을 입력하세요 (비워두면 내용 일부가 제목이 됩니다)"
            />
          </div>
          <div className="form-group">
            <label>내용</label>
            <textarea
              value={memoForm.content}
              onChange={(e) => setMemoForm({ ...memoForm, content: e.target.value })}
              placeholder="메모 내용을 입력하세요"
              required
              rows="6"
            />
          </div>
          <div className="form-group">
            <label>만료일 (선택)</label>
            <input
              type="date"
              value={memoForm.expire_date}
              onChange={(e) => setMemoForm({ ...memoForm, expire_date: e.target.value })}
              placeholder="만료일을 설정하세요 (기본: 당일)"
            />
          </div>
          <div className="form-checkbox">
            <input
              type="checkbox"
              id="important"
              checked={memoForm.important}
              onChange={(e) => setMemoForm({ ...memoForm, important: e.target.checked })}
            />
            <label htmlFor="important">중요 메모로 표시</label>
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-btn secondary" onClick={() => setShowMemoCreateModal(false)}>
              취소
            </button>
            <button type="submit" className="modal-btn primary">
              추가
            </button>
          </div>
        </form>
      </Modal>

      {/* 메모 수정 모달 */}
      <Modal
        isOpen={showMemoEditModal}
        onClose={() => {
          setShowMemoEditModal(false);
          setMemoForm({ title: '', content: '', important: false, expire_date: '' });
        }}
        title="메모 수정"
      >
        <form className="modal-form" onSubmit={(e) => { e.preventDefault(); handleMemoUpdate(); }}>
          <div className="form-group">
            <label>제목 (선택)</label>
            <input
              type="text"
              value={memoForm.title}
              onChange={(e) => setMemoForm({ ...memoForm, title: e.target.value })}
              placeholder="제목을 입력하세요 (비워두면 내용 일부가 제목이 됩니다)"
            />
          </div>
          <div className="form-group">
            <label>내용</label>
            <textarea
              value={memoForm.content}
              onChange={(e) => setMemoForm({ ...memoForm, content: e.target.value })}
              placeholder="메모 내용을 입력하세요"
              required
              rows="6"
            />
          </div>
          <div className="form-group">
            <label>만료일 (선택)</label>
            <input
              type="date"
              value={memoForm.expire_date}
              onChange={(e) => setMemoForm({ ...memoForm, expire_date: e.target.value })}
              placeholder="만료일을 설정하세요"
            />
          </div>
          <div className="form-checkbox">
            <input
              type="checkbox"
              id="important-edit"
              checked={memoForm.important}
              onChange={(e) => setMemoForm({ ...memoForm, important: e.target.checked })}
            />
            <label htmlFor="important-edit">중요 메모로 표시</label>
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-btn secondary" onClick={() => {
              setShowMemoEditModal(false);
              setMemoForm({ title: '', content: '', important: false, expire_date: '' });
            }}>
              취소
            </button>
            <button type="submit" className="modal-btn primary">
              저장
            </button>
          </div>
        </form>
      </Modal>

      {/* 메모 상세 모달 */}
      <Modal
        isOpen={showMemoDetailModal}
        onClose={() => setShowMemoDetailModal(false)}
        title="메모 상세"
      >
        {selectedMemo && (
          <div className="memo-detail-view">
            <div className="detail-title">
              {selectedMemo.important && <span className="detail-badge">중요</span>}
              {selectedMemo.title}
            </div>
            <div className="detail-meta">
              <span className="detail-meta-item">
                <span className="detail-meta-label">작성자:</span> {selectedMemo.authorDisplayName || '사용자'}
              </span>
              <span className="detail-meta-item">
                <span className="detail-meta-label">작성일:</span> {selectedMemo.createdAt.toLocaleString('ko-KR')}
              </span>
              {selectedMemo.expire_date && (
                <span className="detail-meta-item">
                  <span className="detail-meta-label">만료일:</span> {new Date(selectedMemo.expire_date).toLocaleDateString('ko-KR')}
                </span>
              )}
            </div>
            <div
              className="detail-content"
              dangerouslySetInnerHTML={{ __html: linkifyContentModal(selectedMemo.content) }}
            />
            <div className="memo-detail-actions">
              <button
                className="modal-btn primary"
                onClick={() => handleMemoEdit(selectedMemo)}
              >
                수정
              </button>
              <button
                className="modal-btn danger"
                onClick={() => confirmDelete(selectedMemo, 'memo')}
              >
                삭제
              </button>
              <button
                className="modal-btn secondary"
                onClick={() => setShowMemoDetailModal(false)}
              >
                닫기
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 일정 생성 모달 */}
      <Modal
        isOpen={showScheduleCreateModal}
        onClose={() => setShowScheduleCreateModal(false)}
        title="일정 추가"
        size="large"
      >
        <form className="modal-form" onSubmit={(e) => { e.preventDefault(); handleScheduleCreate(); }}>
          <div className="form-group">
            <label>일정 제목</label>
            <input
              type="text"
              value={scheduleForm.title}
              onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
              placeholder="일정 제목을 입력하세요"
              required
            />
          </div>

          {/* 시간 지정 체크박스 */}
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={scheduleForm.hasTime}
                onChange={(e) => setScheduleForm({ ...scheduleForm, hasTime: e.target.checked, time: e.target.checked ? scheduleForm.time : '' })}
              />
              <span>시간 지정</span>
            </label>
          </div>

          {/* 시간 선택 (체크박스 선택 시에만 표시) */}
          {scheduleForm.hasTime && (
            <div className="form-group">
              <label>시간</label>
              <select
                value={scheduleForm.time}
                onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                required={scheduleForm.hasTime}
                className="time-select"
              >
                <option value="">시간 선택</option>
                <optgroup label="오전 (9:00 ~ 11:30)">
                  {timeOptions.filter(t => t.period === '오전').map(time => (
                    <option key={time.value} value={time.value}>{time.label}</option>
                  ))}
                </optgroup>
                <optgroup label="오후 (12:00 ~ 6:00)">
                  {timeOptions.filter(t => t.period === '오후').map(time => (
                    <option key={time.value} value={time.value}>{time.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          )}

          {/* 여러 날 일정 체크박스 */}
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={scheduleForm.multiDay}
                onChange={(e) => setScheduleForm({ ...scheduleForm, multiDay: e.target.checked, end_date: e.target.checked ? scheduleForm.end_date : scheduleForm.start_date })}
              />
              <span>여러 날 일정</span>
            </label>
          </div>

          <div className="form-group">
            <label>시작 날짜</label>
            <input
              type="date"
              value={scheduleForm.start_date}
              onChange={(e) => {
                setScheduleForm({ ...scheduleForm, start_date: e.target.value });
              }}
              required
            />
          </div>

          {/* 종료 날짜 (여러 날 일정 체크 시에만 표시) */}
          {scheduleForm.multiDay && (
            <div className="form-group">
              <label>종료 날짜</label>
              <input
                type="date"
                value={scheduleForm.end_date}
                onChange={(e) => {
                  setScheduleForm({ ...scheduleForm, end_date: e.target.value });
                }}
                min={scheduleForm.start_date}
                required
              />
            </div>
          )}
          <div className="form-group">
            <label>일정 타입</label>
            <div className="radio-group">
              <label className="radio-label">
                <input
                  type="radio"
                  name="scheduleType"
                  value="회사"
                  checked={scheduleForm.type === '회사'}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value })}
                />
                <span>회사</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="scheduleType"
                  value="개인"
                  checked={scheduleForm.type === '개인'}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value })}
                />
                <span>개인</span>
              </label>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-btn secondary" onClick={() => setShowScheduleCreateModal(false)}>
              취소
            </button>
            <button type="submit" className="modal-btn primary">
              추가
            </button>
          </div>
        </form>
      </Modal>

      {/* 일정 수정 모달 */}
      <Modal
        isOpen={showScheduleEditModal}
        onClose={() => {
          setShowScheduleEditModal(false);
          setSelectedSchedule(null);
        }}
        title="일정 수정"
        size="large"
      >
        <form className="modal-form" onSubmit={(e) => { e.preventDefault(); handleScheduleUpdate(); }}>
          <div className="form-group">
            <label>일정 제목</label>
            <input
              type="text"
              value={scheduleForm.title}
              onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
              placeholder="일정 제목을 입력하세요"
              required
            />
          </div>

          {/* 시간 지정 체크박스 */}
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={scheduleForm.hasTime}
                onChange={(e) => setScheduleForm({ ...scheduleForm, hasTime: e.target.checked })}
              />
              <span>시간 지정</span>
            </label>
          </div>

          {/* 시간 선택 (체크 시만 표시) */}
          {scheduleForm.hasTime && (
            <div className="form-group">
              <label>시간</label>
              <select
                value={scheduleForm.time}
                onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                required={scheduleForm.hasTime}
                className="time-select"
              >
                <option value="">시간 선택</option>
                <optgroup label="오전 (9:00 ~ 11:30)">
                  {timeOptions.filter(t => t.period === '오전').map(time => (
                    <option key={time.value} value={time.value}>{time.label}</option>
                  ))}
                </optgroup>
                <optgroup label="오후 (12:00 ~ 6:00)">
                  {timeOptions.filter(t => t.period === '오후').map(time => (
                    <option key={time.value} value={time.value}>{time.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          )}

          {/* 여러 날 일정 체크박스 */}
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={scheduleForm.multiDay}
                onChange={(e) => setScheduleForm({ ...scheduleForm, multiDay: e.target.checked, end_date: e.target.checked ? scheduleForm.end_date : scheduleForm.start_date })}
              />
              <span>여러 날 일정</span>
            </label>
          </div>

          <div className="form-group">
            <label>시작 날짜</label>
            <input
              type="date"
              value={scheduleForm.start_date}
              onChange={(e) => setScheduleForm({ ...scheduleForm, start_date: e.target.value })}
              required
            />
          </div>

          {/* 종료 날짜 (여러 날 일정 체크 시에만 표시) */}
          {scheduleForm.multiDay && (
            <div className="form-group">
              <label>종료 날짜</label>
              <input
                type="date"
                value={scheduleForm.end_date}
                onChange={(e) => setScheduleForm({ ...scheduleForm, end_date: e.target.value })}
                min={scheduleForm.start_date}
                required
              />
            </div>
          )}

          <div className="form-group">
            <label>일정 타입</label>
            <div className="radio-group">
              <label className="radio-label">
                <input
                  type="radio"
                  name="scheduleTypeEdit"
                  value="회사"
                  checked={scheduleForm.type === '회사'}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value })}
                />
                <span>회사</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="scheduleTypeEdit"
                  value="개인"
                  checked={scheduleForm.type === '개인'}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value })}
                />
                <span>개인</span>
              </label>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-btn secondary" onClick={() => {
              setShowScheduleEditModal(false);
              setSelectedSchedule(null);
            }}>
              취소
            </button>
            <button type="submit" className="modal-btn primary">
              수정
            </button>
          </div>
        </form>
      </Modal>

      {/* 삭제 확인 모달 */}
      <Modal
        isOpen={showDeleteConfirmModal}
        onClose={() => setShowDeleteConfirmModal(false)}
        title="삭제 확인"
        compact
      >
        <div className="delete-confirm">
          <p>정말 삭제하시겠습니까?</p>
          <p className="delete-confirm-subtitle">이 작업은 되돌릴 수 없습니다.</p>
          <div className="modal-actions">
            <button
              className="modal-btn danger"
              onClick={() => {
                if (deleteTarget?.type === 'memo') handleMemoDelete();
                if (deleteTarget?.type === 'schedule') handleScheduleDelete();
              }}
            >
              삭제
            </button>
            <button
              className="modal-btn secondary"
              onClick={() => setShowDeleteConfirmModal(false)}
            >
              취소
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default Dashboard;
