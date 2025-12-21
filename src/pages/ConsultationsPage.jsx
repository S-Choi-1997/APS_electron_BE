/**
 * ConsultationsPage.jsx - 문의 목록 페이지
 *
 * useConsultations Hook을 사용하여 상담 관리 로직을 단순화
 * (기존 App.jsx의 중복 코드 제거)
 */

import SearchBar from '../components/SearchBar';
import ConsultationTable from '../components/ConsultationTable';
import ConsultationModal from '../components/ConsultationModal';
import ConfirmModal from '../components/ConfirmModal';
import AlertModal from '../components/AlertModal';
import Pagination from '../components/Pagination';
import useConsultations from '../hooks/useConsultations';
import { INQUIRY_STATUS } from '../services/inquiryService';
import '../components/css/PageLayout.css';
import './ConsultationsPage.css';

function ConsultationsPage({ consultations, setConsultations, type = 'website' }) {
  // Custom Hook으로 모든 상담 관리 로직 처리 (400+ 줄 → 1줄)
  const {
    // 검색 및 필터
    searchTerm,
    setSearchTerm,
    selectedStatus,
    setSelectedStatus,
    showUnreadOnly,
    setShowUnreadOnly,
    typeFilter,
    setTypeFilter,
    typeFilters,

    // 필터링된 데이터
    filteredConsultations,
    currentConsultations,
    stats,
    uncheckedCount,

    // 페이지네이션
    currentPage,
    setCurrentPage,
    totalPages,

    // 선택
    selectedIds,
    handleSelectAll,
    handleToggleSelect,

    // 모달
    selectedConsultation,
    confirmModalOpen,
    setConfirmModalOpen,
    consultationToConfirm,
    setConsultationToConfirm,
    alertModal,
    setAlertModal,

    // 첨부파일
    attachmentMap,
    attachmentsLoading,

    // SMS 로딩
    smsLoading,

    // 핸들러
    handleRespond,
    handleConfirmSMS,
    handleRowClick,
    handleCloseModal,
    handleDelete,
    handleBulkConfirm,
    handleBulkDelete,
  } = useConsultations(consultations, setConsultations);

  const pageTitle = type === 'email' ? '이메일 문의' : '홈페이지 문의';

  return (
    <div className="page-container">
      <div className="page-header">
        {/* 좌측: 제목 */}
        <div className="header-left">
          <h1 className="page-title">{pageTitle}</h1>
          <p className="page-subtitle">홈페이지로 접수된 상담 내역</p>
        </div>

        {/* 우측: 일괄 처리 버튼 */}
        <div className="header-right">
          <div className="bulk-actions">
            <button
              className="bulk-button"
              onClick={handleBulkConfirm}
              disabled={selectedIds.size === 0}
            >
              선택 확인문자
            </button>
            <button
              className="bulk-button danger"
              onClick={handleBulkDelete}
              disabled={selectedIds.size === 0}
            >
              선택 삭제
            </button>
          </div>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="stats-container">
        <div className="stat-card">
          <div className="stat-label">미확인</div>
          <div className="stat-value highlight">{stats.unread}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">확인</div>
          <div className="stat-value">{stats.read}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">응신</div>
          <div className="stat-value responded">{stats.responded}</div>
        </div>
      </div>

      {/* 상태 필터 탭 */}
      <div className="status-tabs">
        <button
          className={`tab-btn ${selectedStatus === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedStatus('all')}
        >
          전체
        </button>
        <button
          className={`tab-btn ${selectedStatus === INQUIRY_STATUS.UNREAD ? 'active' : ''}`}
          onClick={() => setSelectedStatus(INQUIRY_STATUS.UNREAD)}
        >
          미확인
        </button>
        <button
          className={`tab-btn ${selectedStatus === INQUIRY_STATUS.READ ? 'active' : ''}`}
          onClick={() => setSelectedStatus(INQUIRY_STATUS.READ)}
        >
          확인
        </button>
        <button
          className={`tab-btn ${selectedStatus === INQUIRY_STATUS.RESPONDED ? 'active' : ''}`}
          onClick={() => setSelectedStatus(INQUIRY_STATUS.RESPONDED)}
        >
          응신
        </button>
      </div>

      {/* 검색 및 타입 필터 */}
      <div className="filter-bar">
        <SearchBar searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        <div className="type-filter-group">
          {typeFilters.map((type) => (
            <button
              key={type}
              className={`type-filter-btn ${typeFilter === type ? 'active' : ''}`}
              onClick={() => setTypeFilter(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="page-content">
      {filteredConsultations.length === 0 ? (
        <div className="empty-state">
          <p>검색 결과에 해당하는 문의가 없습니다.</p>
        </div>
      ) : (
        <>
          <ConsultationTable
            consultations={currentConsultations}
            onRowClick={handleRowClick}
            onRespond={handleRespond}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onDelete={handleDelete}
          />

          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}

      {selectedConsultation && (
        <ConsultationModal
          consultation={selectedConsultation}
          attachments={attachmentMap[selectedConsultation.id]}
          attachmentsLoading={attachmentsLoading && !attachmentMap[selectedConsultation.id]}
          onClose={handleCloseModal}
          onRespond={handleRespond}
        />
      )}

      <ConfirmModal
        isOpen={confirmModalOpen}
        onClose={() => {
          setConfirmModalOpen(false);
          setConsultationToConfirm(null);
        }}
        onConfirm={handleConfirmSMS}
        consultation={consultationToConfirm}
      />

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal({ ...alertModal, isOpen: false })}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
      />

      {smsLoading && (
        <div className="sms-loading-overlay">
          <div className="sms-loading-spinner">
            <div className="spinner"></div>
            <p>문자 발송 중...</p>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default ConsultationsPage;
