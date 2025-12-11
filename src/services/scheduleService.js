/**
 * scheduleService.js - 일정 API 서비스
 *
 * PostgreSQL 백엔드와 통신하는 일정 관련 API
 */

import { apiRequest, API_ENDPOINTS } from '../config/api.js';

/**
 * 일정 목록 조회
 * @param {Object} auth - 인증 정보 { currentUser }
 * @param {Object} options - 쿼리 옵션 { start_date, end_date, type, author, limit, offset }
 * @returns {Promise<Array>} 일정 목록
 */
export async function fetchSchedules(auth, options = {}) {
  const queryParams = new URLSearchParams();

  if (options.start_date) queryParams.append('start_date', options.start_date);
  if (options.end_date) queryParams.append('end_date', options.end_date);
  if (options.type) queryParams.append('type', options.type);
  if (options.author) queryParams.append('author', options.author);
  if (options.limit) queryParams.append('limit', options.limit);
  if (options.offset) queryParams.append('offset', options.offset);

  const endpoint = `/schedules${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

  const response = await apiRequest(endpoint, {
    method: 'GET',
  }, auth);

  return response.data || [];
}

/**
 * 일정 생성
 * @param {Object} scheduleData - { title, time, start_date, end_date, type, author }
 * @param {Object} auth - 인증 정보
 * @returns {Promise<Object>} 생성된 일정
 */
export async function createSchedule(scheduleData, auth) {
  const response = await apiRequest('/schedules', {
    method: 'POST',
    body: JSON.stringify(scheduleData),
  }, auth);

  return response.data;
}

/**
 * 일정 수정
 * @param {number} id - 일정 ID
 * @param {Object} updates - 수정할 필드 { title, time, start_date, end_date, type }
 * @param {Object} auth - 인증 정보
 * @returns {Promise<Object>} 수정된 일정
 */
export async function updateSchedule(id, updates, auth) {
  const response = await apiRequest(`/schedules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  }, auth);

  return response.data;
}

/**
 * 일정 삭제 (Soft Delete)
 * @param {number} id - 일정 ID
 * @param {Object} auth - 인증 정보
 * @returns {Promise<Object>} 삭제 결과
 */
export async function deleteSchedule(id, auth) {
  const response = await apiRequest(`/schedules/${id}`, {
    method: 'DELETE',
  }, auth);

  return response;
}
