/**
 * schedule.js - 일정 관련 상수
 */

// 일정 타입
export const SCHEDULE_TYPES = {
  COMPANY: 'company',
  PERSONAL: 'personal',
};

// 일정 타입 한글 매핑
export const SCHEDULE_TYPE_LABELS = {
  [SCHEDULE_TYPES.COMPANY]: '회사',
  [SCHEDULE_TYPES.PERSONAL]: '개인',
};

// 영업 시간 범위
export const BUSINESS_HOURS = {
  START: 9,   // 오전 9시
  END: 18,    // 오후 6시
};

// 시간 간격 (분)
export const TIME_INTERVAL_MINUTES = 30;
