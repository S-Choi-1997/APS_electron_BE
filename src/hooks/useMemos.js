/**
 * useMemos.js - 메모 관리 Custom Hook
 *
 * Dashboard.jsx와 MemoPage.jsx에 중복되어 있던
 * 메모 데이터 로딩 및 관리 로직을 통합한 Hook
 *
 * 기능:
 * - 메모 데이터 로딩 (API 연동)
 * - 만료된 메모 필터링
 * - 자정 감지 및 자동 새로고침
 * - 날짜별 그룹화
 * - URL 자동 링크 변환
 *
 * @returns {Object} 메모 관리에 필요한 state와 functions
 */

import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { fetchMemos } from '../services/memoService';
import { getCurrentUser } from '../auth/authManager';

function useMemos() {
  const [memos, setMemos] = useState([]);
  const [memosLoading, setMemosLoading] = useState(true);

  // ========== 메모 데이터 로드 ==========
  const loadMemos = async () => {
    try {
      setMemosLoading(true);
      const auth = { currentUser: getCurrentUser() };
      const data = await fetchMemos(auth);

      // API 응답을 프론트엔드 형식으로 변환
      const formattedMemos = data.map(memo => ({
        id: memo.id,
        title: memo.title,
        content: memo.content,
        important: memo.important,
        createdAt: new Date(memo.created_at),
        author: memo.author,
        author_name: memo.author_name,
        expire_date: memo.expire_date,
      }));

      // 만료되지 않은 메모만 표시
      const activeMemos = formattedMemos.filter(memo => {
        if (!memo.expire_date) return true; // 만료일 없으면 항상 표시
        const expireDate = new Date(memo.expire_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return expireDate >= today;
      });

      setMemos(activeMemos);
    } catch (error) {
      console.error('메모 로드 실패:', error);
      setMemos([]);
    } finally {
      setMemosLoading(false);
    }
  };

  // ========== 컴포넌트 마운트 시 메모 로드 ==========
  useEffect(() => {
    loadMemos();
  }, []);

  // ========== 자정(날짜 변경) 감지 - 메모 만료 처리를 위한 자동 새로고침 ==========
  useEffect(() => {
    const checkMidnight = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const msUntilMidnight = tomorrow.getTime() - now.getTime();

      console.log(`[useMemos] 다음 자정까지 ${Math.floor(msUntilMidnight / 1000 / 60)}분 남음`);

      const timer = setTimeout(() => {
        console.log('[useMemos] 날짜 변경 감지 - 메모 새로고침');
        loadMemos(); // 만료된 메모 필터링

        // 다음 자정을 위해 재귀 호출
        checkMidnight();
      }, msUntilMidnight);

      return timer;
    };

    const timer = checkMidnight();

    // 컴포넌트 언마운트 시 타이머 정리
    return () => clearTimeout(timer);
  }, []);

  // ========== 메모 날짜별 그룹화 함수 ==========
  const groupMemosByDate = (memos) => {
    const sorted = [...memos].sort((a, b) => b.createdAt - a.createdAt);
    const groups = [];
    let currentDate = null;

    sorted.forEach(memo => {
      const memoDate = memo.createdAt.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      if (memoDate !== currentDate) {
        groups.push({ type: 'divider', date: memoDate });
        currentDate = memoDate;
      }

      groups.push({ type: 'memo', data: memo });
    });

    return groups;
  };

  // ========== URL 자동 링크 변환 함수 (XSS 방지) ==========
  const linkifyContent = (text) => {
    if (!text) return '';
    const urlPattern = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
    const linkedText = text.replace(urlPattern, (url) => {
      const href = url.startsWith('www.') ? `https://${url}` : url;
      return `<a href="${href}" class="external-link" style="color: #667eea; text-decoration: underline;">${url}</a>`;
    });
    return DOMPurify.sanitize(linkedText);
  };

  // ========== URL 자동 링크 변환 함수 - 카드용 (클릭 불가) ==========
  const linkifyContentCard = (text) => {
    if (!text) return '';
    const urlPattern = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
    const linkedText = text.replace(urlPattern, (url) => {
      return `<span class="link-text" style="color: #667eea; text-decoration: underline; cursor: default;">${url}</span>`;
    });
    return DOMPurify.sanitize(linkedText);
  };

  // ========== URL 자동 링크 변환 함수 - 모달용 (클릭 가능, 외부 브라우저) ==========
  const linkifyContentModal = (text) => {
    if (!text) return '';
    const urlPattern = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
    const linkedText = text.replace(urlPattern, (url) => {
      const href = url.startsWith('www.') ? `https://${url}` : url;
      return `<a href="${href}" class="external-link-modal" data-clickable="true" style="color: #667eea; text-decoration: underline; cursor: pointer;">${url}</a>`;
    });
    return DOMPurify.sanitize(linkedText);
  };

  // ========== 외부 링크를 기본 브라우저에서 열기 ==========
  useEffect(() => {
    const handleLinkClick = (e) => {
      if (e.target.tagName === 'A' && (e.target.classList.contains('external-link') || e.target.dataset.clickable === 'true')) {
        e.preventDefault();
        const href = e.target.getAttribute('href');
        if (window.electron && window.electron.openExternal) {
          window.electron.openExternal(href);
        }
      }
    };
    document.addEventListener('click', handleLinkClick);
    return () => document.removeEventListener('click', handleLinkClick);
  }, []);

  // ========== 반환값 ==========
  return {
    memos,
    memosLoading,
    loadMemos,
    groupMemosByDate,
    linkifyContent,
    linkifyContentCard,
    linkifyContentModal,
  };
}

export default useMemos;
