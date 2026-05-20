/**
 * memoService.js - 메모 API 서비스
 *
 * PostgreSQL 백엔드와 통신하는 메모 관련 API
 */

import { apiRequest } from '../config/api.js';

/**
 * 메모 목록 조회
 * @param {Object} auth - 인증 정보 { currentUser }
 * @param {Object} options - 쿼리 옵션 { search, author, important, limit, offset }
 * @returns {Promise<Array>} 메모 목록
 */
export async function fetchMemos(auth, options = {}) {
  const pageSize = Number(options.pageSize || options.limit || 500);
  const allMemos = [];
  let offset = Number(options.offset || 0);

  while (true) {
    const page = await fetchMemoPage(auth, {
      ...options,
      limit: pageSize,
      offset,
    });

    allMemos.push(...page.items);
    if (!page.hasMore) break;
    offset += page.limit || pageSize;
  }

  return allMemos;
}

export async function fetchMemoPage(auth, options = {}) {
  const queryParams = new URLSearchParams();

  if (options.search) queryParams.append('search', options.search);
  if (options.author) queryParams.append('author', options.author);
  if (options.important !== undefined) queryParams.append('important', options.important);
  if (options.active !== undefined) queryParams.append('active', options.active);
  if (options.limit) queryParams.append('limit', options.limit);
  if (options.offset !== undefined) queryParams.append('offset', options.offset);

  const endpoint = `/memos${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

  const response = await apiRequest(endpoint, {
    method: 'GET',
  }, auth);

  const items = response.data || [];
  return {
    items,
    total: Number(response.total ?? response.count ?? items.length),
    count: Number(response.count ?? items.length),
    limit: Number(response.limit ?? options.limit ?? items.length),
    offset: Number(response.offset ?? options.offset ?? 0),
    hasMore: Boolean(response.hasMore),
  };
}

/**
 * 메모 상세 조회
 * @param {number|string} id - 메모 ID
 * @param {Object} auth - 인증 정보 { currentUser }
 * @returns {Promise<Object>} 메모 상세
 */
export async function fetchMemo(id, auth) {
  const response = await apiRequest(`/memos/${id}`, {
    method: 'GET',
  }, auth);

  return response.data;
}

/**
 * 메모 생성
 * @param {Object} memoData - { title, content, important, expire_date }
 * @param {Object} auth - 인증 정보
 * @returns {Promise<Object>} 생성된 메모
 */
export async function createMemo(memoData, auth) {
  const response = await apiRequest('/memos', {
    method: 'POST',
    body: JSON.stringify(memoData),
  }, auth);

  return response.data;
}

/**
 * 메모 수정
 * @param {number} id - 메모 ID
 * @param {Object} updates - 수정할 필드 { title, content, important, expire_date }
 * @param {Object} auth - 인증 정보
 * @returns {Promise<Object>} 수정된 메모
 */
export async function updateMemo(id, updates, auth) {
  const response = await apiRequest(`/memos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  }, auth);

  return response.data;
}

/**
 * 메모 삭제 (Soft Delete)
 * @param {number} id - 메모 ID
 * @param {Object} auth - 인증 정보
 * @returns {Promise<Object>} 삭제 결과
 */
export async function deleteMemo(id, auth) {
  const response = await apiRequest(`/memos/${id}`, {
    method: 'DELETE',
  }, auth);

  return response;
}
