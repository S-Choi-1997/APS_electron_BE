/**
 * notificationTypes.js
 *
 * 알림 타입 정의 파일
 * 새로운 알림 타입을 추가하려면 이 파일에 새 항목을 추가하면 됩니다.
 */

export const NOTIFICATION_TYPES = {
  CONSULTATION: {
    key: 'consultation',
    icon: '🔔',
    title: '새 상담 요청',
    enabled: true,        // 개발자가 코드로 제어 (true: 활성화, false: 비활성화)
    sound: 'notification.mp3',  // 추후 사운드 구현 시 사용
    route: '/consultations'     // 클릭 시 이동할 라우트
  },

  MEMO: {
    key: 'memo',
    icon: '📝',
    title: '팀 메모 추가됨',
    enabled: true,
    sound: 'memo.mp3',
    route: '/dashboard'
  },

  PERSONAL_SCHEDULE: {
    key: 'personalSchedule',
    icon: '📅',
    title: '개인 일정',
    enabled: true,
    sound: 'schedule.mp3',
    route: '/dashboard'
  },

  TEAM_SCHEDULE: {
    key: 'teamSchedule',
    icon: '👥',
    title: '단체 일정',
    enabled: true,
    sound: 'schedule.mp3',
    route: '/dashboard'
  }
};

/**
 * 알림 타입 키로 설정 가져오기
 * @param {string} typeKey - 알림 타입 키 (예: 'consultation', 'memo')
 * @returns {Object|null} 알림 타입 설정 객체 또는 null
 */
export function getNotificationTypeConfig(typeKey) {
  const found = Object.values(NOTIFICATION_TYPES).find(type => type.key === typeKey);
  return found || null;
}

/**
 * 활성화된 알림 타입만 가져오기
 * @returns {Array} 활성화된 알림 타입 배열
 */
export function getEnabledNotificationTypes() {
  return Object.values(NOTIFICATION_TYPES).filter(type => type.enabled);
}
