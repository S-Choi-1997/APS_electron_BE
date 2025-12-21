/**
 * Dashboard.jsx - 메인 대시보드 화면
 *
 * 협업툴 스타일의 메인 화면
 * - 우측: 캘린더 (상단 ~ 중앙)
 * - 좌측 상단: 공지사항
 * - 좌측 하단: 미처리 상담 요청 (이메일/홈페이지)
 */

import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import Modal from './Modal';
import { auth } from '../auth/authManager';
import { fetchMemos, createMemo, updateMemo, deleteMemo } from '../services/memoService';
import { fetchSchedules, createSchedule, updateSchedule, deleteSchedule } from '../services/scheduleService';
import { showToastNotification } from '../utils/notificationHelper';
import { getSocket } from '../services/websocketService';
import './Dashboard.css';
import './css/PageLayout.css';
import './css/DashboardLayout.css';
import './css/DashboardNotice.css';
import './css/DashboardPending.css';
import './css/DashboardCalendar.css';

function Dashboard({ user, consultations, stats = { website: 0, email: 0 } }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // 일정 데이터 (API 연동)
  const [schedules, setSchedules] = useState([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);

  // 메모 데이터 (API 연동)
  const [memos, setMemos] = useState([]);
  const [memosLoading, setMemosLoading] = useState(true);

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

  // 미처리 상담 요청 통계 (API stats 사용)
  const uncheckedConsultations = consultations.filter(c => !c.check);
  // 이메일은 현재 로직 없음 (0건), 홈페이지는 미확인(check=false) 건수
  const emailCount = stats.email || 0;
  const websiteCount = stats.website || 0;

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

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
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

  // 메모 관련 핸들러
  const handleMemoCreate = async () => {
    if (!memoForm.content.trim()) return;

    try {
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

      const createdMemo = await createMemo(memoData, auth);

      // 메모 목록 새로고침
      await loadMemos();

      // 다른 창들에게 메모 생성 알림 (알림창 등)
      if (window.electron && window.electron.broadcastMemoCreated) {
        window.electron.broadcastMemoCreated(createdMemo);
      }

      // Toast 알림은 WebSocket 이벤트 핸들러에서 처리됨 (중복 방지)

      // 중요 메모일 경우 알림창 자동으로 열기
      if (memoForm.important && window.electron && window.electron.openStickyWindow) {
        try {
          await window.electron.openStickyWindow('memo', '중요 메모', createdMemo);
        } catch (error) {
          console.error('알림창 열기 실패:', error);
        }
      }

      setMemoForm({ title: '', content: '', important: false, expire_date: '' });
      setShowMemoCreateModal(false);
    } catch (error) {
      console.error('메모 생성 실패:', error);
      alert('메모 생성에 실패했습니다: ' + error.message);
    }
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

    try {
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

      await updateMemo(selectedMemo.id, updates, auth);

      // 메모 목록 새로고침
      await loadMemos();

      setMemoForm({ title: '', content: '', important: false, expire_date: '' });
      setShowMemoEditModal(false);
      setSelectedMemo(null);
    } catch (error) {
      console.error('메모 수정 실패:', error);
      alert('메모 수정에 실패했습니다: ' + error.message);
    }
  };

  const handleMemoDelete = async () => {
    if (deleteTarget && deleteTarget.type === 'memo') {
      try {
        const memoId = deleteTarget.id;
        await deleteMemo(memoId, auth);

        // WebSocket 이벤트가 자동으로 메모 목록을 새로고침하므로 loadMemos() 호출 불필요

        // 다른 창들에게 메모 삭제 알림 (알림창 등)
        if (window.electron && window.electron.broadcastMemoDeleted) {
          window.electron.broadcastMemoDeleted(memoId);
        }

        setShowMemoDetailModal(false);
        setShowDeleteConfirmModal(false);
        setDeleteTarget(null);
      } catch (error) {
        console.error('메모 삭제 실패:', error);
        alert('메모 삭제에 실패했습니다: ' + error.message);
      }
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

      const createdSchedule = await createSchedule(scheduleData, auth);

      // 일정 목록 새로고침
      await loadSchedules();

      // Toast 알림은 WebSocket 이벤트 핸들러에서 처리됨 (중복 방지)

      setScheduleForm({ title: '', time: '', start_date: '', end_date: '', type: '회사', author: '', multiDay: false, hasTime: false });
      setShowScheduleCreateModal(false);

      // 다른 창들에게 상담 업데이트 브로드캐스트 (일정도 상담 데이터)
      if (window.electron && window.electron.broadcastConsultationUpdated) {
        await window.electron.broadcastConsultationUpdated();
      }
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
        type: scheduleForm.type,
      };

      await updateSchedule(selectedSchedule.id, scheduleData, auth);

      // 일정 목록 새로고침
      await loadSchedules();

      setScheduleForm({ title: '', time: '', start_date: '', end_date: '', type: '회사', author: '', multiDay: false, hasTime: false });
      setShowScheduleEditModal(false);
      setSelectedSchedule(null);

      // 다른 창들에게 상담 업데이트 브로드캐스트 (일정도 상담 데이터)
      if (window.electron && window.electron.broadcastConsultationUpdated) {
        await window.electron.broadcastConsultationUpdated();
      }
    } catch (error) {
      console.error('일정 수정 실패:', error);
      alert('일정 수정에 실패했습니다: ' + error.message);
    }
  };

  const handleScheduleDelete = async () => {
    if (deleteTarget && deleteTarget.type === 'schedule') {
      try {
        await deleteSchedule(deleteTarget.id, auth);

        // 일정 목록 새로고침
        await loadSchedules();

        setShowDeleteConfirmModal(false);
        setDeleteTarget(null);

        // 다른 창들에게 상담 업데이트 브로드캐스트 (일정도 상담 데이터)
        if (window.electron && window.electron.broadcastConsultationUpdated) {
          await window.electron.broadcastConsultationUpdated();
        }
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

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    loadMemos();
    loadSchedules();
  }, []);

  // Electron IPC 이벤트 리스너 - 알림창에서 메모 생성 시 자동 새로고침
  useEffect(() => {
    if (window.electron && window.electron.onMemoCreated) {
      const cleanup = window.electron.onMemoCreated((newMemo) => {
        console.log('[Dashboard] 메모 생성 이벤트 수신:', newMemo);
        // 메모 목록 새로고침
        loadMemos();
      });

      // 컴포넌트 언마운트 시 리스너 정리
      return cleanup;
    }
  }, []);

  // Electron IPC 이벤트 리스너 - 알림창에서 메모 삭제 시 자동 새로고침
  useEffect(() => {
    if (window.electron && window.electron.onMemoDeleted) {
      const cleanup = window.electron.onMemoDeleted((memoId) => {
        console.log('[Dashboard] 메모 삭제 이벤트 수신:', memoId);
        // 메모 목록 새로고침
        loadMemos();
      });

      // 컴포넌트 언마운트 시 리스너 정리
      return cleanup;
    }
  }, []);

  // WebSocket 이벤트 리스너 - 메모/일정 실시간 동기화
  // NOTE: AppRouter에서 useWebSocketSync로 중앙 관리됨
  // Dashboard는 데이터 새로고침만 수행
  useEffect(() => {
    if (!user) return;

    const socket = getSocket();
    if (!socket) return;

    // 메모 생성 이벤트 - 데이터 새로고침
    socket.on('memo:created', (newMemo) => {
      console.log('[Dashboard] Memo created event received:', newMemo.id);
      loadMemos();
    });

    // 메모 삭제 이벤트 - 데이터 새로고침
    socket.on('memo:deleted', (data) => {
      console.log('[Dashboard] Memo deleted event received:', data.id);
      loadMemos();
    });

    // 일정 생성 이벤트 - 데이터 새로고침
    socket.on('schedule:created', (newSchedule) => {
      console.log('[Dashboard] Schedule created event received:', newSchedule.id);
      loadSchedules();
    });

    // 일정 수정 이벤트 - 데이터 새로고침
    socket.on('schedule:updated', (data) => {
      console.log('[Dashboard] Schedule updated event received:', data.id);
      loadSchedules();
    });

    // 일정 삭제 이벤트 - 데이터 새로고침
    socket.on('schedule:deleted', (data) => {
      console.log('[Dashboard] Schedule deleted event received:', data.id);
      loadSchedules();
    });

    return () => {
      socket.off('memo:created');
      socket.off('memo:deleted');
      socket.off('schedule:created');
      socket.off('schedule:updated');
      socket.off('schedule:deleted');
    };
  }, [user]);

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
        loadMemos(); // 만료된 메모 필터링
        loadSchedules(); // 일정도 함께 새로고침

        // 다음 자정을 위해 재귀 호출
        checkMidnight();
      }, msUntilMidnight);

      return timer;
    };

    const timer = checkMidnight();

    // 컴포넌트 언마운트 시 타이머 정리
    return () => clearTimeout(timer);
  }, []);

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
          const uncheckedConsultations = consultations.filter(c => !c.check);
          const cachedData = {
            memos,
            schedules,
            consultations: uncheckedConsultations
          };

          // 알림창 열기 (리셋 모드 아님)
          await window.electron.openStickyWindow('dashboard', '알림창', cachedData, false);
        } catch (error) {
          console.error('[Dashboard] Failed to auto-open sticky window:', error);
        }
      };

      openStickyOnLogin();
    }
  }, [user, memosLoading, schedulesLoading, memos, schedules, consultations]);

  // 메모 데이터 로드
  const loadMemos = async () => {
    try {
      setMemosLoading(true);
      const data = await fetchMemos(auth);

      // API 응답을 프론트엔드 형식으로 변환
      const formattedMemos = data.map(memo => ({
        id: memo.id,
        title: memo.title,
        content: memo.content,
        important: memo.important,
        createdAt: new Date(memo.created_at),
        author: memo.author,
        author_name: memo.author_name,
        expire_date: memo.expire_date,
      }));

      // 만료되지 않은 메모만 표시
      const activeMemos = formattedMemos.filter(memo => {
        if (!memo.expire_date) return true; // 만료일 없으면 항상 표시
        const expireDate = new Date(memo.expire_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return expireDate >= today;
      });

      setMemos(activeMemos);
    } catch (error) {
      console.error('메모 로드 실패:', error);
      // 에러 발생 시 빈 배열 유지
      setMemos([]);
    } finally {
      setMemosLoading(false);
    }
  };

  // 일정 데이터 로드
  const loadSchedules = async () => {
    try {
      setSchedulesLoading(true);
      const data = await fetchSchedules(auth);

      // API 응답을 프론트엔드 형식으로 변환
      const formattedSchedules = data.map(schedule => ({
        id: schedule.id,
        title: schedule.title,
        time: schedule.time,
        start_date: new Date(schedule.start_date),
        end_date: new Date(schedule.end_date),
        type: schedule.type === 'company' ? '회사' : '개인',
        author: schedule.author,
        author_name: schedule.author_name,
      }));

      setSchedules(formattedSchedules);
    } catch (error) {
      console.error('일정 로드 실패:', error);
      // 에러 발생 시 빈 배열 유지
      setSchedules([]);
    } finally {
      setSchedulesLoading(false);
    }
  };

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
    const handleLinkClick = (e) => {
      if (e.target.tagName === 'A' && e.target.dataset.clickable === 'true') {
        e.preventDefault();
        const href = e.target.getAttribute('href');
        if (window.electron && window.electron.openExternal) {
          window.electron.openExternal(href);
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
                // 이미 열려있는지 확인
                const isOpen = await window.electron.isStickyWindowOpen('dashboard');
                // 캐시 데이터: 메모, 일정, 미확인 상담
                const cachedData = {
                  memos,
                  schedules,
                  consultations: uncheckedConsultations
                };
                // 열려있으면 포커스, 아니면 열기
                await window.electron.openStickyWindow('dashboard', '알림창', cachedData, false);
              }}
              title="알림창 띄우기"
            >
              알림창
            </button>
            <button
              className="add-btn"
              onClick={async () => {
                if (!window.electron) return;
                // 캐시 데이터: 메모, 일정, 미확인 상담
                const cachedData = {
                  memos,
                  schedules,
                  consultations: uncheckedConsultations
                };
                // 리셋 모드로 열기
                await window.electron.openStickyWindow('dashboard', '알림창', cachedData, true);
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
              <button className="today-btn" onClick={handleToday}>오늘</button>
            </div>

            <div className="calendar">
              <div className="calendar-header">
                <button className="nav-btn" onClick={handlePrevMonth}>‹</button>
                <h3>
                  {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월
                </h3>
                <button className="nav-btn" onClick={handleNextMonth}>›</button>
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
                  const companyCount = dateSchedules.filter(s => s.type === '회사').length;
                  const personalCount = dateSchedules.filter(s => s.type === '개인').length;
                  const dayOfWeek = date ? date.getDay() : null;
                  const isSaturday = dayOfWeek === 6;
                  const isSunday = dayOfWeek === 0;

                  // 디버깅
                  if (date && isToday(date)) {
                    console.log('=== 오늘 날짜 디버깅 ===');
                    console.log('날짜:', date.toDateString());
                    console.log('전체 일정:', dateSchedules);
                    console.log('회사 일정 수:', companyCount);
                    console.log('개인 일정 수:', personalCount);
                  }

                  return (
                    <div
                      key={index}
                      className={`calendar-day ${!date ? 'empty' : ''} ${isSaturday ? 'saturday' : ''} ${isSunday ? 'sunday' : ''} ${isToday(date) ? 'today' : ''} ${isSelected(date) ? 'selected' : ''} ${dateSchedules.length > 0 ? 'has-schedules' : ''}`}
                      onClick={() => date && setSelectedDate(date)}
                    >
                      {date && (
                        <>
                          <span className="day-number">{date.getDate()}</span>
                          {dateSchedules.length > 0 && (
                            <div className="schedule-indicators">
                              {companyCount > 0 && <span className="schedule-indicator company">{companyCount}</span>}
                              {personalCount > 0 && <span className="schedule-indicator personal">{personalCount}</span>}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 선택된 날짜 정보 및 일정 */}
            <div className="selected-date-info">
              <div className="selected-date-header">
                <h3>
                  {selectedDate.getFullYear()}년 {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일
                </h3>
                <button className="add-schedule-btn" onClick={() => {
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

              {selectedDateSchedules.length > 0 && (
                <div className="schedule-list">
                  {selectedDateSchedules.map(schedule => (
                    <div key={schedule.id} className={`schedule-item schedule-${schedule.type === '회사' ? 'company' : 'personal'}`}>
                      <span className="schedule-type-badge">{schedule.type}</span>
                      <span className="schedule-time">{schedule.time}</span>
                      <span className="schedule-title">
                        {schedule.type === '개인' && schedule.author && <span className="schedule-author">{schedule.author_name || schedule.author || '사용자'} - </span>}
                        {schedule.title}
                      </span>
                      <div className="schedule-actions">
                        <button
                          className="schedule-edit-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleScheduleEdit(schedule);
                          }}
                          title="수정"
                        >
                          ✎
                        </button>
                        <button
                          className="schedule-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(schedule, 'schedule');
                          }}
                          title="삭제"
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

        {/* 우측 메모+미처리 영역 */}
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
              {memos
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 5)
                .map((memo) => (
                  <div key={memo.id} className="memo-item" onClick={() => handleMemoClick(memo)}>
                    <div className="memo-card-header">
                      {memo.important && <span className="memo-badge important">중요</span>}
                      <h4 className="memo-card-title">{memo.title}</h4>
                      <span className="memo-card-author">{memo.author_name || memo.author || '사용자'}</span>
                    </div>
                    <div className="memo-card-content" dangerouslySetInnerHTML={{ __html: linkifyContentCard(memo.content) }} />
                    <div className="memo-card-date">{memo.createdAt.toLocaleDateString()}</div>
                  </div>
                ))}
            </div>
          </div>

          {/* 미처리 상담 요청 */}
          <div className="dashboard-card pending-card">
            <div className="card-header">
              <h2>⏳ 미처리 상담 요청</h2>
            </div>
            <div className="pending-stats">
              <div className="pending-item email">
                <div className="pending-icon">✉️</div>
                <div className="pending-info">
                  <span className="pending-label">이메일</span>
                  <span className="pending-count">{emailCount}건</span>
                </div>
              </div>
              <div className="pending-item web">
                <div className="pending-icon">🌐</div>
                <div className="pending-info">
                  <span className="pending-label">홈페이지</span>
                  <span className="pending-count">{websiteCount}건</span>
                </div>
              </div>
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
                <span className="detail-meta-label">작성자:</span> {selectedMemo.author || '사용자'}
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
              className="modal-btn secondary"
              onClick={() => setShowDeleteConfirmModal(false)}
            >
              취소
            </button>
            <button
              className="modal-btn danger"
              onClick={() => {
                if (deleteTarget?.type === 'memo') handleMemoDelete();
                if (deleteTarget?.type === 'schedule') handleScheduleDelete();
              }}
            >
              삭제
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default Dashboard;
