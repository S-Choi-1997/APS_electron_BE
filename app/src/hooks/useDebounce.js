/**
 * useDebounce.js - 디바운싱 Custom Hook
 *
 * 검색어 입력 등에서 성능 최적화를 위해 사용
 * 사용자가 입력을 멈춘 후 일정 시간이 지나면 값을 업데이트
 *
 * @param {any} value - 디바운싱할 값
 * @param {number} delay - 지연 시간 (밀리초, 기본 300ms)
 * @returns {any} 디바운싱된 값
 *
 * @example
 * const [searchTerm, setSearchTerm] = useState('');
 * const debouncedSearchTerm = useDebounce(searchTerm, 300);
 *
 * useEffect(() => {
 *   // debouncedSearchTerm이 변경될 때만 실행
 *   performSearch(debouncedSearchTerm);
 * }, [debouncedSearchTerm]);
 */

import { useState, useEffect } from 'react';

function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    // 타이머 설정: delay 시간 후에 값 업데이트
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // cleanup: 값이 변경되면 이전 타이머 취소
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export default useDebounce;
