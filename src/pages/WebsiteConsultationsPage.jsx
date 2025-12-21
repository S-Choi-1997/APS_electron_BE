/**
 * WebsiteConsultationsPage.jsx - 홈페이지 상담 전용 페이지
 *
 * 홈페이지로 접수된 상담 내역을 관리하는 페이지 (이메일 UI 스타일 적용)
 */

import { useState, useMemo } from 'react';
import ConsultationModal from '../components/ConsultationModal';
import ConfirmModal from '../components/ConfirmModal';
import AlertModal from '../components/AlertModal';
import Pagination from '../components/Pagination';
import '../components/css/PageLayout.css';
import './WebsiteConsultationsPage.css';

function WebsiteConsultationsPage({ consultations, setConsultations }) {
  const [selectedStatus, setSelectedStatus] = useState('all'); // 'all', 'unread', 'read', 'responded'
  const [selectedConsultation, setSelectedConsultation] = useState(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [consultationToConfirm, setConsultationToConfirm] = useState(null);
  const [alertModal, setAlertModal] = useState({ isOpen: false, type: 'success', title: '', message: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('전체');
  const ITEMS_PER_PAGE = 10;

  // 기본 5가지 타입 필터 (항상 표시)
  const typeFilters = ['전체', '비자', '비영리단체', '기업 인허가', '민원 행정', '기타'];

  // Handle row click to open modal
  const handleRowClick = async (consultation) => {
    setSelectedConsultation(consultation);

    // Mark as read (not responded) if unread
    const currentStatus = consultation.status || (consultation.check ? 'responded' : 'unread');
    if (currentStatus === 'unread') {
      // Update to 'read' status (just opened, not responded yet)
      try {
        const { updateInquiry } = await import('../services/inquiryService');
        const { getCurrentUser } = await import('../auth/authManager');

        await updateInquiry(consultation.id, { status: 'read' }, { currentUser: getCurrentUser() });

        // Update local state
        const updatedConsultations = consultations.map(item =>
          item.id === consultation.id ? { ...item, status: 'read' } : item
        );
        setConsultations(updatedConsultations);
      } catch (error) {
        console.error('Failed to update status to read:', error);
      }
    }
  };

  // Handle SMS response - Show confirmation modal
  const handleRespond = async (consultationId) => {
    const consultation = consultations.find(c => c.id === consultationId);
    if (!consultation) {
      setAlertModal({
        isOpen: true,
        type: 'error',
        title: '오류',
        message: '문의를 찾을 수 없습니다.'
      });
      return;
    }

    if (!consultation.phone) {
      setAlertModal({
        isOpen: true,
        type: 'error',
        title: '전화번호 없음',
        message: '전화번호가 없어 문자를 보낼 수 없습니다.'
      });
      return;
    }

    setConsultationToConfirm(consultation);
    setConfirmModalOpen(true);
  };

  // Confirm and send SMS
  const handleConfirmSMS = async () => {
    if (!consultationToConfirm) return;

    const consultationId = consultationToConfirm.id;

    try {
      setConfirmModalOpen(false);

      const { updateInquiry } = await import('../services/inquiryService');
      const { sendSMS } = await import('../services/smsService');
      const { getCurrentUser } = await import('../auth/authManager');

      const currentUser = getCurrentUser();

      // 1. Update status to 'responded' first
      await updateInquiry(consultationId, { status: 'responded' }, { currentUser });

      // 2. Send SMS
      try {
        const smsMessage = `[APS 컨설팅]\n\n${consultationToConfirm.name}님의 문의가 확인되었습니다.\n담당자가 곧 연락드리겠습니다.`;

        await sendSMS({
          receiver: consultationToConfirm.phone,
          msg: smsMessage,
        }, { currentUser });

        // 3. Update local state
        const updatedConsultations = consultations.map(item =>
          item.id === consultationId ? { ...item, status: 'responded', check: true } : item
        );
        setConsultations(updatedConsultations);

        // Close modal and reset
        setSelectedConsultation(null);
        setConsultationToConfirm(null);

        setAlertModal({
          isOpen: true,
          type: 'success',
          title: '발송 완료',
          message: '확인 완료 및 문자가 발송되었습니다.'
        });
      } catch (smsError) {
        console.error('SMS 발송 실패:', smsError);

        // Rollback status on SMS failure
        try {
          await updateInquiry(consultationId, { status: 'unread' }, { currentUser });
          setAlertModal({
            isOpen: true,
            type: 'error',
            title: '발송 실패',
            message: `문자 발송에 실패했습니다. 상태가 되돌려졌습니다.\n\n${smsError.message}`
          });
        } catch (rollbackError) {
          console.error('상태 롤백 실패:', rollbackError);
          setAlertModal({
            isOpen: true,
            type: 'error',
            title: '오류 발생',
            message: '문자 발송 및 상태 되돌리기에 실패했습니다. 페이지를 새로고침해주세요.'
          });
        }
      }
    } catch (error) {
      console.error('Failed to send SMS response:', error);
      setAlertModal({
        isOpen: true,
        type: 'error',
        title: '오류',
        message: `SMS 응신에 실패했습니다: ${error.message}`
      });
    } finally {
      setConsultationToConfirm(null);
    }
  };

  // Filter consultations
  const filteredConsultations = consultations.filter(item => {
    // 상태 필터 - status 기반
    if (selectedStatus !== 'all') {
      const status = item.status || (item.check ? 'responded' : 'unread');
      if (status !== selectedStatus) return false;
    }

    // 타입 필터
    if (typeFilter !== '전체') {
      const itemType = item.type || '';
      if (itemType !== typeFilter) return false;
    }

    return true;
  });

  // Statistics - status 기반 3단계
  const stats = useMemo(() => {
    let unread = 0;
    let read = 0;
    let responded = 0;

    consultations.forEach((c) => {
      const status = c.status || (c.check ? 'responded' : 'unread');
      if (status === 'unread') unread++;
      else if (status === 'read') read++;
      else if (status === 'responded') responded++;
    });

    return { total: consultations.length, unread, read, responded };
  }, [consultations]);

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

      {/* Statistics - 3단계 (클릭 가능한 필터) */}
      <div className="stats-container">
        <div
          className={`stat-card ${selectedStatus === 'unread' ? 'active' : ''}`}
          onClick={() => handleStatusChange(selectedStatus === 'unread' ? 'all' : 'unread')}
          style={{ cursor: 'pointer' }}
        >
          <div className="stat-label">미확인</div>
          <div className="stat-value highlight">{stats.unread}</div>
        </div>
        <div
          className={`stat-card ${selectedStatus === 'read' ? 'active' : ''}`}
          onClick={() => handleStatusChange(selectedStatus === 'read' ? 'all' : 'read')}
          style={{ cursor: 'pointer' }}
        >
          <div className="stat-label">확인</div>
          <div className="stat-value">{stats.read}</div>
        </div>
        <div
          className={`stat-card ${selectedStatus === 'responded' ? 'active' : ''}`}
          onClick={() => handleStatusChange(selectedStatus === 'responded' ? 'all' : 'responded')}
          style={{ cursor: 'pointer' }}
        >
          <div className="stat-label">응신</div>
          <div className="stat-value responded">{stats.responded}</div>
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
                {currentConsultations.map((item) => {
                  const status = item.status || (item.check ? 'responded' : 'unread');
                  return (
                    <tr
                      key={item.id}
                      className={status}
                      onClick={() => handleRowClick(item)}
                      style={{ cursor: 'pointer' }}
                    >
                    <td className="col-status">
                      <span className={`status-indicator status-${item.status || (item.check ? 'responded' : 'unread')}`}>
                        {(() => {
                          const status = item.status || (item.check ? 'responded' : 'unread');
                          if (status === 'unread') return '●';
                          if (status === 'read') return '○';
                          if (status === 'responded') return '✓';
                          return '●';
                        })()}
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
                  );
                })}
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
          onRespond={handleRespond}
        />
      )}

      {/* SMS Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModalOpen}
        onClose={() => {
          setConfirmModalOpen(false);
          setConsultationToConfirm(null);
        }}
        onConfirm={handleConfirmSMS}
        consultation={consultationToConfirm}
      />

      {/* Alert Modal */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal({ ...alertModal, isOpen: false })}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
      />
    </div>
  );
}

export default WebsiteConsultationsPage;
