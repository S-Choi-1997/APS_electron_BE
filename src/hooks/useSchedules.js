/**
 * useSchedules.js - 일정 관리 Custom Hook
 *
 * Dashboard.jsx에 있던 일정 데이터 로딩 및 관리 로직을 추출한 Hook
 *
 * 기능:
 * - 일정 데이터 로딩 (API 연동)
 * - 날짜별 일정 필터링
 * - 시간 옵션 생성 (30분 단위)
 * - 기본 시간 설정 (현재 시간 기준)
 *
 * @returns {Object} 일정 관리에 필요한 state와 functions
 */

import { useState, useEffect } from 'react';
import { fetchSchedules } from '../services/scheduleService';
import { getCurrentUser } from '../auth/authManager';
import { BUSINESS_HOURS, TIME_INTERVAL_MINUTES, SCHEDULE_TYPE_LABELS } from '../constants';

function useSchedules() {
  const [schedules, setSchedules] = useState([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);

  // ========== 일정 데이터 로드 ==========
  const loadSchedules = async () => {
    try {
      setSchedulesLoading(true);
      const auth = { currentUser: getCurrentUser() };
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
      setSchedules([]);
    } finally {
      setSchedulesLoading(false);
    }
  };

  // ========== 컴포넌트 마운트 시 일정 로드 ==========
  useEffect(() => {
    loadSchedules();
  }, []);

  // ========== 해당 날짜의 일정 가져오기 (날짜 범위 체크) ==========
  const getSchedulesForDate = (date) => {
    if (!date) return [];
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return schedules.filter(s => {
      const startDate = new Date(s.start_date.getFullYear(), s.start_date.getMonth(), s.start_date.getDate());
      const endDate = new Date(s.end_date.getFullYear(), s.end_date.getMonth(), s.end_date.getDate());
      return dateOnly >= startDate && dateOnly <= endDate;
    });
  };

  // ========== 시간 옵션 생성 (상수 기반) ==========
  const generateTimeOptions = () => {
    const options = [];
    const { START, END } = BUSINESS_HOURS;

    // 시작 시간부터 종료 시간까지 순회
    for (let h = START; h <= END; h++) {
      const displayHour = h > 12 ? h - 12 : h;
      const period = h < 12 ? '오전' : '오후';

      // 정각
      options.push({
        value: `${String(h).padStart(2, '0')}:00`,
        label: `${displayHour}:00`,
        period
      });

      // 30분 (종료 시간의 30분은 제외)
      if (h < END) {
        options.push({
          value: `${String(h).padStart(2, '0')}:30`,
          label: `${displayHour}:30`,
          period
        });
      }
    }

    return options;
  };

  // ========== 기본 시간 설정 (현재 시간 기준 다음 30분 단위) ==========
  const getDefaultTime = () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const { START, END } = BUSINESS_HOURS;

    let nextHour = currentHour;
    let nextMinute = currentMinute < TIME_INTERVAL_MINUTES ? TIME_INTERVAL_MINUTES : 0;

    if (nextMinute === 0) {
      nextHour += 1;
    }

    // 영업 시간 범위로 제한
    if (nextHour < START) {
      nextHour = START;
      nextMinute = 0;
    } else if (nextHour >= END) {
      nextHour = START;
      nextMinute = 0;
    }

    return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
  };

  // ========== 반환값 ==========
  return {
    schedules,
    schedulesLoading,
    loadSchedules,
    getSchedulesForDate,
    generateTimeOptions,
    getDefaultTime,
  };
}

export default useSchedules;
