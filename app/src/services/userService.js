/**
 * userService.js - User API Service
 *
 * 사용자 정보 관리 API 호출 함수
 */

import { apiRequest, API_ENDPOINTS } from '../config/api.js';

/**
 * 현재 사용자 정보 조회
 * @param {Object} auth - 인증 정보 { currentUser }
 * @returns {Promise<Object>} 사용자 정보
 */
export async function getCurrentUserInfo(auth) {
  const response = await apiRequest(API_ENDPOINTS.USERS_ME, {
    method: 'GET',
  }, auth);

  return response.data;
}

/**
 * 현재 사용자의 displayName 업데이트
 * @param {string} displayName - 새로운 표시 이름
 * @param {Object} auth - 인증 정보 { currentUser }
 * @returns {Promise<Object>} 업데이트된 사용자 정보
 */
export async function updateDisplayName(displayName, auth) {
  const response = await apiRequest(API_ENDPOINTS.USERS_ME, {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
  }, auth);

  return response.data;
}
