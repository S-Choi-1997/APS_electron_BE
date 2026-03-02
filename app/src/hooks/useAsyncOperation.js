/**
 * useAsyncOperation.js - 비동기 작업 상태 관리 Custom Hook
 *
 * 여러 개의 loading, error state를 통합 관리하는 Hook
 *
 * 기존 패턴:
 * ```
 * const [loading, setLoading] = useState(false);
 * const [memosLoading, setMemosLoading] = useState(false);
 * const [schedulesLoading, setSchedulesLoading] = useState(false);
 * const [attachmentsLoading, setAttachmentsLoading] = useState(false);
 * const [smsLoading, setSmsLoading] = useState(false);
 * ```
 *
 * 개선된 패턴:
 * ```
 * const { execute, loading, error } = useAsyncOperation();
 * const result = await execute(async () => {
 *   return await fetchData();
 * });
 * ```
 *
 * @returns {Object} { execute, loading, error, data, reset }
 */

import { useState, useCallback } from 'react';

function useAsyncOperation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  /**
   * 비동기 함수 실행
   * @param {Function} asyncFn - 실행할 비동기 함수
   * @param {Object} options - 옵션
   * @param {Function} options.onSuccess - 성공 시 콜백
   * @param {Function} options.onError - 에러 시 콜백
   * @param {boolean} options.throwOnError - 에러 시 throw 여부 (기본 false)
   * @returns {Promise<any>} 비동기 함수의 결과
   */
  const execute = useCallback(async (asyncFn, options = {}) => {
    const { onSuccess, onError, throwOnError = false } = options;

    try {
      setLoading(true);
      setError(null);

      const result = await asyncFn();
      setData(result);

      if (onSuccess) {
        onSuccess(result);
      }

      return result;
    } catch (err) {
      console.error('[useAsyncOperation] Error:', err);
      setError(err);

      if (onError) {
        onError(err);
      }

      if (throwOnError) {
        throw err;
      }

      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 상태 초기화
   */
  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(null);
  }, []);

  return {
    execute,
    loading,
    error,
    data,
    reset,
  };
}

export default useAsyncOperation;
