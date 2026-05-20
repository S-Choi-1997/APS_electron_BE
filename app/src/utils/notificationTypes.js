import { ROUTES } from '../constants/routes';

export const NOTIFICATION_TYPES = {
  CONSULTATION: {
    key: 'consultation',
    icon: '!',
    title: '상담 요청',
    enabled: true,
    sound: 'notification.mp3',
    route: ROUTES.WEBSITE_CONSULTATIONS,
  },
  MEMO: {
    key: 'memo',
    icon: 'M',
    title: '메모',
    enabled: true,
    sound: 'memo.mp3',
    route: ROUTES.DASHBOARD,
  },
  PERSONAL_SCHEDULE: {
    key: 'personalSchedule',
    icon: 'P',
    title: '개인 일정',
    enabled: true,
    sound: 'schedule.mp3',
    route: ROUTES.DASHBOARD,
  },
  TEAM_SCHEDULE: {
    key: 'teamSchedule',
    icon: 'T',
    title: '팀 일정',
    enabled: true,
    sound: 'schedule.mp3',
    route: ROUTES.DASHBOARD,
  },
  EMAIL: {
    key: 'email',
    icon: '@',
    title: '이메일',
    enabled: true,
    sound: 'notification.mp3',
    route: ROUTES.EMAIL_CONSULTATIONS,
  },
};

export function getNotificationTypeConfig(typeKey) {
  return Object.values(NOTIFICATION_TYPES).find((type) => type.key === typeKey) || null;
}

export function getEnabledNotificationTypes() {
  return Object.values(NOTIFICATION_TYPES).filter((type) => type.enabled);
}
