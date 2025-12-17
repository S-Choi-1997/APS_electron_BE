/**
 * consultationTypes.js - 상담 타입 관련 상수
 */

// 기본 상담 타입 목록 (항상 표시)
export const BASE_CONSULTATION_TYPES = [
  '전체',
  '비자',
  '비영리단체',
  '기업 인허가',
  '민원 행정',
  '기타'
];

// 상담 타입별 색상 코드
export const CONSULTATION_TYPE_COLORS = {
  '비자': '#2563eb',           // blue
  '비영리단체': '#dc2626',      // red
  '기업 인허가': '#f59e0b',     // yellow
  '민원 행정': '#16a34a',       // green
  '기타': '#6b7280',            // gray
};
