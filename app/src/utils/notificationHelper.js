/**
 * notificationHelper.js
 *
 * 알림 관련 헬퍼 함수 모음
 */

import { getNotificationTypeConfig } from './notificationTypes';

// localStorage 키
const SETTINGS_KEY = 'aps-notification-settings';

// 기본 설정
const DEFAULT_SETTINGS = {
  enabled: true,  // 전체 알림 ON/OFF
  sound: false    // 사운드 ON/OFF (추후 구현)
};

/**
 * 알림 설정 가져오기
 * @returns {Object} 알림 설정 객체
 */
export function getNotificationSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('[Notification] Failed to parse settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * 알림 설정 저장
 * @param {Object} settings - 저장할 설정 객체
 */
export function updateNotificationSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    console.log('[Notification] Settings updated:', settings);
  } catch (error) {
    console.error('[Notification] Failed to save settings:', error);
  }
}

/**
 * 알림 표시 여부 확인
 * @param {string} notificationType - 알림 타입 키 (예: 'consultation', 'memo')
 * @returns {boolean} 표시 가능 여부
 */
export function shouldShowNotification(notificationType) {
  // 1. 사용자 설정 체크 (전체 알림 ON/OFF)
  const settings = getNotificationSettings();
  if (!settings.enabled) {
    console.log('[Notification] Global notification disabled');
    return false;
  }

  // 2. 개발자 설정 체크 (타입별 enabled 플래그)
  const typeConfig = getNotificationTypeConfig(notificationType);
  if (!typeConfig) {
    console.warn('[Notification] Unknown notification type:', notificationType);
    return false;
  }

  if (!typeConfig.enabled) {
    console.log('[Notification] Notification type disabled:', notificationType);
    return false;
  }

  return true;
}

/**
 * 토스트 알림 표시
 * @param {string} notificationType - 알림 타입 키
 * @param {string} message - 알림 메시지
 * @param {Object} options - 추가 옵션 (route, duration 등)
 */
export function showToastNotification(notificationType, message, options = {}) {
  // 알림 표시 가능 여부 확인
  if (!shouldShowNotification(notificationType)) {
    return;
  }

  // Electron 환경이 아니면 무시
  if (!window.electron || !window.electron.showToastNotification) {
    console.warn('[Notification] Not in Electron environment');
    return;
  }

  // 타입 설정 가져오기
  const typeConfig = getNotificationTypeConfig(notificationType);
  if (!typeConfig) {
    console.error('[Notification] Invalid notification type:', notificationType);
    return;
  }

  // 알림 데이터 구성
  const notificationData = {
    icon: typeConfig.icon,
    title: typeConfig.title,
    message: message,
    route: options.route || typeConfig.route,
    duration: options.duration || 5000
  };

  // 사운드 재생 (추후 구현)
  const settings = getNotificationSettings();
  if (settings.sound && typeConfig.sound) {
    playNotificationSound(typeConfig.sound);
  }

  // IPC를 통해 알림 표시
  window.electron.showToastNotification(notificationData);

  console.log('[Notification] Displayed:', notificationType, message);
}

/**
 * 알림 사운드 재생 (추후 구현)
 * @param {string} soundFile - 사운드 파일명
 */
export function playNotificationSound(soundFile) {
  // 추후 구현 예정
  // const audio = new Audio(`/sounds/${soundFile}`);
  // audio.play().catch(err => console.log('Sound play failed:', err));
  console.log('[Notification] Sound would play:', soundFile);
}

/**
 * Debounce 유틸리티 (알림 스팸 방지)
 * @param {Function} func - 실행할 함수
 * @param {number} wait - 대기 시간 (ms)
 * @returns {Function} Debounced 함수
 */
export function debounce(func, wait = 1000) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
