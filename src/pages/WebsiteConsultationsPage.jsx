/**
 * WebsiteConsultationsPage.jsx - 홈페이지 상담 전용 페이지
 *
 * 홈페이지로 접수된 상담 내역을 관리하는 페이지 (이메일 UI 스타일 적용)
 */

import { useState, useMemo } from 'react';
import ConsultationModal from '../components/ConsultationModal';
import Pagination from '../components/Pagination';
import '../components/css/PageLayout.css';
import './WebsiteConsultationsPage.css';

function WebsiteConsultationsPage({ consultations, setConsultations }) {
  const [selectedStatus, setSelectedStatus] = useState('all'); // 'all', 'unread'
  const [selectedConsultation, setSelectedConsultation] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('전체');
  const ITEMS_PER_PAGE = 10;

  // 기본 5가지 타입 필터 (항상 표시)
  const typeFilters = ['전체', '비자', '비영리단체', '기업 인허가', '민원 행정', '기타'];

  // Handle row click to open modal
  const handleRowClick = async (consultation) => {
    setSelectedConsultation(consultation);

    // Mark as read if unread
    if (!consultation.check) {
      // TODO: 백엔드 API 호출로 check 상태 업데이트
      const updatedConsultations = consultations.map(item =>
        item.id === consultation.id ? { ...item, check: true } : item
      );
      setConsultations(updatedConsultations);
    }
  };

  // Filter consultations
  const filteredConsultations = consultations.filter(item => {
    // 상태 필터
    if (selectedStatus === 'unread' && item.check) return false;

    // 타입 필터
    if (typeFilter !== '전체') {
      const itemType = item.type || '';
      if (itemType !== typeFilter) return false;
    }

    return true;
  });

  // Statistics
  const stats = {
    total: filteredConsultations.length,
    unread: filteredConsultations.filter(item => !item.check).length
  };

  // Pagination
  const totalPages = Math.ceil(filteredConsultations.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentConsultations = filteredConsultations.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  const handleStatusChange = (newStatus) => {
    setSelectedStatus(newStatus);
    setCurrentPage(1);
  };

  const handleTypeFilterChange = (newType) => {
    setTypeFilter(newType);
    setCurrentPage(1);
  };

  // Format date
  const formatDate = (date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays < 7) return `${diffDays}일 전`;
    return d.toLocaleDateString('ko-KR');
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="header-left">
          <h1 className="page-title">홈페이지 상담</h1>
          <p className="page-subtitle">홈페이지로 접수된 상담 내역</p>
        </div>
        <div className="header-right">
          <div className="filter-buttons">
            <button
              className={`pill-button ${selectedStatus === 'unread' ? 'active' : ''}`}
              onClick={() => handleStatusChange(selectedStatus === 'unread' ? 'all' : 'unread')}
            >
              미확인만 보기
            </button>
            <div className="type-filter-group">
              {typeFilters.map((type) => (
                <button
                  key={type}
                  className={`type-filter-btn ${typeFilter === type ? 'active' : ''}`}
                  onClick={() => handleTypeFilterChange(type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Statistics */}
      <div className="stats-container">
        <div className="stat-card">
          <div className="stat-label">전체</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">미확인</div>
          <div className="stat-value highlight">{stats.unread}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-container">
        <div className="filter-group">
          <label>상태:</label>
          <select value={selectedStatus} onChange={(e) => handleStatusChange(e.target.value)}>
            <option value="all">전체</option>
            <option value="unread">미확인</option>
          </select>
        </div>
      </div>

      {/* Consultation List */}
      <div className="page-content">
        {filteredConsultations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <h2>상담 내역이 없습니다</h2>
            <p>필터 조건을 변경하거나 새로운 상담을 기다려주세요.</p>
          </div>
        ) : (
          <div className="consultation-table-container">
            <table className="consultation-table">
              <thead>
                <tr>
                  <th className="col-status">상태</th>
                  <th className="col-type">유형</th>
                  <th className="col-name">이름</th>
                  <th className="col-phone">연락처</th>
                  <th className="col-content">문의 내용</th>
                  <th className="col-date">날짜</th>
                </tr>
              </thead>
              <tbody>
                {currentConsultations.map((item) => (
                  <tr
                    key={item.id}
                    className={item.check ? 'read' : 'unread'}
                    onClick={() => handleRowClick(item)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="col-status">
                      <span className={`status-indicator ${item.check ? 'read' : 'unread'}`}>
                        {item.check ? '✓' : '●'}
                      </span>
                    </td>
                    <td className="col-type">
                      <span className={`type-badge type-${(item.type || '기타').replace(/\s+/g, '-')}`}>
                        {item.type || '기타'}
                      </span>
                    </td>
                    <td className="col-name">
                      <div className="ellipsis-text">{item.name}</div>
                    </td>
                    <td className="col-phone">
                      <div className="ellipsis-text">{item.phone}</div>
                    </td>
                    <td className="col-content">
                      <div className="content-text">{item.message || item.content || ''}</div>
                    </td>
                    <td className="col-date">{formatDate(item.createdAt || item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            )}
          </div>
        )}
      </div>

      {/* Consultation Detail Modal */}
      {selectedConsultation && (
        <ConsultationModal
          consultation={selectedConsultation}
          onClose={() => setSelectedConsultation(null)}
          onRespond={() => {}}
        />
      )}
    </div>
  );
}

export default WebsiteConsultationsPage;
