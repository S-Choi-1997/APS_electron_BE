/**
 * MemoPage.jsx - 팀 메모 전용 페이지
 *
 * 메모 저장소 역할
 * - 날짜별 구분선
 * - 무한 스크롤 (추후)
 * - 검색 기능 (추후)
 * - 만료일 설정
 */

import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import Modal from '../components/Modal';
import { auth } from '../auth/authManager';
import { fetchMemos, createMemo, updateMemo, deleteMemo } from '../services/memoService';
import '../components/css/PageLayout.css';
import './MemoPage.css';

function MemoPage({ user }) {
  // 메모 데이터 (API 연동)
  const [memos, setMemos] = useState([]);
  const [memosLoading, setMemosLoading] = useState(true);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedMemo, setSelectedMemo] = useState(null);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [memoForm, setMemoForm] = useState({
    title: '',
    content: '',
    important: false,
    expire_date: '',
  });

  // 컴포넌트 마운트 시 메모 로드
  useEffect(() => {
    loadMemos();
  }, []);

  // 자정(날짜 변경) 감지 - 메모 만료 처리를 위한 자동 새로고침
  useEffect(() => {
    const checkMidnight = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const msUntilMidnight = tomorrow.getTime() - now.getTime();

      console.log(`[MemoPage] 다음 자정까지 ${Math.floor(msUntilMidnight / 1000 / 60)}분 남음`);

      const timer = setTimeout(() => {
        console.log('[MemoPage] 날짜 변경 감지 - 메모 새로고침');
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

  // 메모 데이터 로드
  const loadMemos = async () => {
    try {
      setMemosLoading(true);
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

      setMemos(formattedMemos);
    } catch (error) {
      console.error('메모 로드 실패:', error);
      setMemos([]);
    } finally {
      setMemosLoading(false);
    }
  };

  // URL 자동 링크 변환 함수 (XSS 방지)
  const linkifyContent = (text) => {
    if (!text) return '';
    const urlPattern = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
    const linkedText = text.replace(urlPattern, (url) => {
      const href = url.startsWith('www.') ? `https://${url}` : url;
      return `<a href="${href}" class="external-link" style="color: #667eea; text-decoration: underline;">${url}</a>`;
    });
    return DOMPurify.sanitize(linkedText);
  };

  // 외부 링크를 기본 브라우저에서 열기
  useEffect(() => {
    const handleLinkClick = (e) => {
      if (e.target.tagName === 'A' && e.target.classList.contains('external-link')) {
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

  // 메모 날짜별 그룹화 함수
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

  // 메모 생성
  const handleMemoCreate = async () => {
    if (!memoForm.content.trim()) return;

    try {
      let finalTitle = memoForm.title.trim();

      // 제목이 없을 때만 자동 생성 (내용이 20자 이상이면 "..." 추가)
      if (!finalTitle) {
        const content = memoForm.content.trim();
        finalTitle = content.length > 20 ? content.substring(0, 20) + '...' : content;
      }

      const memoData = {
        title: finalTitle,
        content: memoForm.content,
        important: memoForm.important,
        expire_date: memoForm.expire_date || null,
        // author is automatically set by backend using req.user.email
      };

      await createMemo(memoData, auth);

      // 메모 목록 새로고침
      await loadMemos();

      setMemoForm({ title: '', content: '', important: false, expire_date: '' });
      setShowCreateModal(false);
    } catch (error) {
      console.error('메모 생성 실패:', error);
      alert('메모 생성에 실패했습니다: ' + error.message);
    }
  };

  // 메모 수정 시작
  const handleMemoEdit = (memo) => {
    setSelectedMemo(memo);
    setMemoForm({
      title: memo.title,
      content: memo.content,
      important: memo.important,
      expire_date: memo.expire_date || '',
    });
    setShowDetailModal(false);
    setShowEditModal(true);
  };

  // 메모 수정 저장
  const handleMemoUpdate = async () => {
    if (!memoForm.content.trim()) return;

    try {
      let finalTitle = memoForm.title.trim();

      // 제목이 없을 때만 자동 생성
      if (!finalTitle) {
        const content = memoForm.content.trim();
        finalTitle = content.length > 20 ? content.substring(0, 20) + '...' : content;
      }

      const updates = {
        title: finalTitle,
        content: memoForm.content,
        important: memoForm.important,
        expire_date: memoForm.expire_date || null,
      };

      await updateMemo(selectedMemo.id, updates, auth);

      // 메모 목록 새로고침
      await loadMemos();

      setMemoForm({ title: '', content: '', important: false, expire_date: '' });
      setShowEditModal(false);
      setSelectedMemo(null);
    } catch (error) {
      console.error('메모 수정 실패:', error);
      alert('메모 수정에 실패했습니다: ' + error.message);
    }
  };

  // 메모 클릭
  const handleMemoClick = (memo) => {
    setSelectedMemo(memo);
    setShowDetailModal(true);
  };

  // 메모 삭제
  const handleMemoDelete = async () => {
    if (deleteTarget) {
      try {
        await deleteMemo(deleteTarget.id, auth);

        // 메모 목록 새로고침
        await loadMemos();

        setShowDetailModal(false);
        setShowDeleteConfirmModal(false);
        setDeleteTarget(null);
      } catch (error) {
        console.error('메모 삭제 실패:', error);
        alert('메모 삭제에 실패했습니다: ' + error.message);
      }
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">팀 메모</h1>
        <button className="memo-add-btn" onClick={() => {
          // 만료일을 당일로 기본 설정
          const today = new Date();
          const year = today.getFullYear();
          const month = String(today.getMonth() + 1).padStart(2, '0');
          const day = String(today.getDate()).padStart(2, '0');
          const todayString = `${year}-${month}-${day}`;

          setMemoForm({ title: '', content: '', important: false, expire_date: todayString });
          setShowCreateModal(true);
        }}>
          + 메모 추가
        </button>
      </div>

      <div className="memo-page-content">
        <div className="memo-list-container">
          {groupMemosByDate(memos).map((item, index) => {
            if (item.type === 'divider') {
              return (
                <div key={`divider-${index}`} className="date-divider">
                  ━━━━━━ {item.date} ━━━━━━
                </div>
              );
            }
            const memo = item.data;
            return (
              <div key={memo.id} className="memopage-card" onClick={() => handleMemoClick(memo)}>
                <div className="memopage-card-header">
                  <div className="memopage-card-title">
                    {memo.important && <span className="memo-badge important">중요</span>}
                    {memo.title}
                  </div>
                  <span className="memo-author">작성자: {memo.author_name || memo.author || '사용자'}</span>
                </div>
                <div className="memopage-card-content" dangerouslySetInnerHTML={{ __html: linkifyContent(memo.content) }} />
                <div className="memopage-card-footer">
                  <span className="memo-date">{memo.createdAt.toLocaleDateString('ko-KR')}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 메모 생성 모달 */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="메모 추가"
      >
        <form className="modal-form" onSubmit={(e) => { e.preventDefault(); handleMemoCreate(); }}>
          <div className="form-group">
            <label>제목 (선택)</label>
            <input
              type="text"
              value={memoForm.title}
              onChange={(e) => setMemoForm({ ...memoForm, title: e.target.value })}
              placeholder="제목을 입력하세요 (비워두면 내용 일부가 제목이 됩니다)"
            />
          </div>
          <div className="form-group">
            <label>내용</label>
            <textarea
              value={memoForm.content}
              onChange={(e) => setMemoForm({ ...memoForm, content: e.target.value })}
              placeholder="메모 내용을 입력하세요"
              required
              rows="6"
            />
          </div>
          <div className="form-group">
            <label>만료일 (선택)</label>
            <input
              type="date"
              value={memoForm.expire_date}
              onChange={(e) => setMemoForm({ ...memoForm, expire_date: e.target.value })}
              placeholder="만료일을 설정하세요 (기본: 당일)"
            />
          </div>
          <div className="form-group checkbox-group">
            <input
              type="checkbox"
              id="important"
              checked={memoForm.important}
              onChange={(e) => setMemoForm({ ...memoForm, important: e.target.checked })}
            />
            <label htmlFor="important">중요 메모로 표시</label>
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-btn secondary" onClick={() => setShowCreateModal(false)}>
              취소
            </button>
            <button type="submit" className="modal-btn primary">
              추가
            </button>
          </div>
        </form>
      </Modal>

      {/* 메모 수정 모달 */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setMemoForm({ title: '', content: '', important: false, expire_date: '' });
        }}
        title="메모 수정"
      >
        <form className="modal-form" onSubmit={(e) => { e.preventDefault(); handleMemoUpdate(); }}>
          <div className="form-group">
            <label>제목 (선택)</label>
            <input
              type="text"
              value={memoForm.title}
              onChange={(e) => setMemoForm({ ...memoForm, title: e.target.value })}
              placeholder="제목을 입력하세요 (비워두면 내용 일부가 제목이 됩니다)"
            />
          </div>
          <div className="form-group">
            <label>내용</label>
            <textarea
              value={memoForm.content}
              onChange={(e) => setMemoForm({ ...memoForm, content: e.target.value })}
              placeholder="메모 내용을 입력하세요"
              required
              rows="6"
            />
          </div>
          <div className="form-group">
            <label>만료일 (선택)</label>
            <input
              type="date"
              value={memoForm.expire_date}
              onChange={(e) => setMemoForm({ ...memoForm, expire_date: e.target.value })}
              placeholder="만료일을 설정하세요"
            />
          </div>
          <div className="form-group checkbox-group">
            <input
              type="checkbox"
              id="important-edit"
              checked={memoForm.important}
              onChange={(e) => setMemoForm({ ...memoForm, important: e.target.checked })}
            />
            <label htmlFor="important-edit">중요 메모로 표시</label>
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-btn secondary" onClick={() => {
              setShowEditModal(false);
              setMemoForm({ title: '', content: '', important: false, expire_date: '' });
            }}>
              취소
            </button>
            <button type="submit" className="modal-btn primary">
              저장
            </button>
          </div>
        </form>
      </Modal>

      {/* 메모 상세보기 모달 */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title={selectedMemo?.title || '메모'}
      >
        {selectedMemo && (
          <div className="memo-detail">
            <div className="memo-detail-content" dangerouslySetInnerHTML={{ __html: linkifyContent(selectedMemo.content) }} />
            <div className="memo-detail-meta">
              <div className="meta-item">
                <span className="meta-label">작성자:</span>
                <span>{selectedMemo.author}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">작성일:</span>
                <span>{selectedMemo.createdAt.toLocaleDateString('ko-KR')}</span>
              </div>
              {selectedMemo.expire_date && (
                <div className="meta-item">
                  <span className="meta-label">만료일:</span>
                  <span>{new Date(selectedMemo.expire_date).toLocaleDateString('ko-KR')}</span>
                </div>
              )}
              {selectedMemo.important && (
                <div className="meta-item">
                  <span className="important-badge">⭐ 중요</span>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn primary"
                onClick={() => handleMemoEdit(selectedMemo)}
              >
                수정
              </button>
              <button
                className="modal-btn danger"
                onClick={() => {
                  setDeleteTarget(selectedMemo);
                  setShowDeleteConfirmModal(true);
                }}
              >
                삭제
              </button>
              <button className="modal-btn secondary" onClick={() => setShowDetailModal(false)}>
                닫기
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 삭제 확인 모달 */}
      <Modal
        isOpen={showDeleteConfirmModal}
        onClose={() => setShowDeleteConfirmModal(false)}
        title="메모 삭제"
      >
        <div className="confirm-dialog">
          <p>이 메모를 삭제하시겠습니까?</p>
          <div className="modal-actions">
            <button className="modal-btn danger" onClick={handleMemoDelete}>
              삭제
            </button>
            <button className="modal-btn secondary" onClick={() => setShowDeleteConfirmModal(false)}>
              취소
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default MemoPage;
