/**
 * WebsiteConsultationsPage.jsx - website inquiry management page.
 */

import { useEffect, useState } from 'react';
import AlertModal from '../components/AlertModal';
import ConfirmModal from '../components/ConfirmModal';
import ConsultationModal from '../components/ConsultationModal';
import Pagination from '../components/Pagination';
import {
  useInquiryAttachments,
  useSendSmsResponse,
  useUpdateInquiry,
  useWebsiteInquiryPage,
  useWebsiteStats,
} from '../hooks/queries/useWebsiteInquiries';
import { INQUIRY_CATEGORY_BY_TYPE } from '../services/inquiryService';
import '../components/css/PageLayout.css';
import './WebsiteConsultationsPage.css';

const ITEMS_PER_PAGE = 10;
const TYPE_FILTERS = ['전체', '비자', '비영리단체', '기업 인허가', '민원 행정', '기타'];

function resolveStatus(consultation) {
  return consultation.status || (consultation.check ? 'responded' : 'unread');
}

function WebsiteConsultationsPage() {
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedConsultation, setSelectedConsultation] = useState(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [consultationToConfirm, setConsultationToConfirm] = useState(null);
  const [alertModal, setAlertModal] = useState({ isOpen: false, type: 'success', title: '', message: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('전체');
  const categoryFilter = typeFilter === '전체' ? undefined : INQUIRY_CATEGORY_BY_TYPE[typeFilter];
  const statusFilter = selectedStatus === 'all' ? undefined : selectedStatus;
  const listFilters = {
    limit: ITEMS_PER_PAGE,
    offset: (currentPage - 1) * ITEMS_PER_PAGE,
    status: statusFilter,
    category: categoryFilter,
  };

  const {
    data: inquiryPage = { items: [], total: 0, count: 0, limit: ITEMS_PER_PAGE, offset: 0, hasMore: false },
    isLoading,
    isError,
    error,
  } = useWebsiteInquiryPage(listFilters);
  const { data: stats = { total: 0, unread: 0, read: 0, responded: 0 } } = useWebsiteStats();
  const consultations = inquiryPage.items || [];
  const updateInquiryMutation = useUpdateInquiry();
  const sendSmsMutation = useSendSmsResponse();

  const selectedConsultationData = selectedConsultation
    ? consultations.find((item) => item.id === selectedConsultation.id) || selectedConsultation
    : null;
  const {
    data: attachments = [],
    isLoading: attachmentsLoading,
  } = useInquiryAttachments(selectedConsultationData?.id, {
    enabled: Boolean(selectedConsultationData),
  });

  const totalItems = inquiryPage.total || 0;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const currentConsultations = consultations;

  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!window.electron?.onWebSocketEvent) return undefined;

    return window.electron.onWebSocketEvent('consultation:created', (consultation) => {
      const nextStatus = resolveStatus(consultation);
      const matchesStatus = selectedStatus === 'all' || selectedStatus === nextStatus;
      const matchesCategory = !categoryFilter || consultation?.category === categoryFilter;

      if (matchesStatus && matchesCategory) {
        setCurrentPage(1);
      }
    });
  }, [categoryFilter, selectedStatus]);

  const handleStatusChange = (newStatus) => {
    setSelectedStatus(newStatus);
    setCurrentPage(1);
  };

  const handleTypeFilterChange = (newType) => {
    setTypeFilter(newType);
    setCurrentPage(1);
  };

  const handleRowClick = async (consultation) => {
    setSelectedConsultation(consultation);

    if (resolveStatus(consultation) !== 'unread') return;

    try {
      await updateInquiryMutation.mutateAsync({
        id: consultation.id,
        updates: { status: 'read' },
      });
    } catch (updateError) {
      console.error('Failed to update status to read:', updateError);
    }
  };

  const handleRespond = async (consultationId) => {
    if (sendSmsMutation.isPending) return;

    const consultation = consultations.find((item) => item.id === consultationId);
    if (!consultation) {
      setAlertModal({
        isOpen: true,
        type: 'error',
        title: '오류',
        message: '문의 항목을 찾을 수 없습니다.',
      });
      return;
    }

    if (!consultation.phone) {
      setAlertModal({
        isOpen: true,
        type: 'error',
        title: '전화번호 없음',
        message: '전화번호가 없어 문자를 보낼 수 없습니다.',
      });
      return;
    }

    setConsultationToConfirm(consultation);
    setConfirmModalOpen(true);
  };

  const handleConfirmSMS = async () => {
    if (!consultationToConfirm || sendSmsMutation.isPending) return;

    const smsMessage = `[APS 컨설팅]\n\n${consultationToConfirm.name}님의 문의가 확인되었습니다.\n담당자가 곧 연락드리겠습니다.`;

    try {
      setConfirmModalOpen(false);
      await sendSmsMutation.mutateAsync({
        inquiryId: consultationToConfirm.id,
        phone: consultationToConfirm.phone,
        message: smsMessage,
      });

      setSelectedConsultation(null);
      setConsultationToConfirm(null);
      setAlertModal({
        isOpen: true,
        type: 'success',
        title: '발송 완료',
        message: '확인 완료 및 문자가 발송되었습니다.',
      });
    } catch (smsError) {
      console.error('SMS response failed:', smsError);
      setAlertModal({
        isOpen: true,
        type: 'error',
        title: '발송 실패',
        message: `문자 발송에 실패했습니다. 상태가 되돌려졌습니다.\n\n${smsError.message}`,
      });
    } finally {
      setConsultationToConfirm(null);
    }
  };

  const formatDate = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '-';

    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.max(0, Math.floor(diffMs / 60000));
    const diffHours = Math.max(0, Math.floor(diffMs / 3600000));
    const diffDays = Math.max(0, Math.floor(diffMs / 86400000));

    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays < 7) return `${diffDays}일 전`;
    return d.toLocaleDateString('ko-KR');
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="header-left">
          <h1 className="page-title">웹사이트 상담</h1>
          <p className="page-subtitle">웹사이트로 접수된 상담 내역</p>
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
              {TYPE_FILTERS.map((type) => (
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
          <div className="stat-label">응답</div>
          <div className="stat-value responded">{stats.responded}</div>
        </div>
      </div>

      <div className="filters-container">
        <div className="filter-group">
          <label>상태:</label>
          <select value={selectedStatus} onChange={(e) => handleStatusChange(e.target.value)}>
            <option value="all">전체</option>
            <option value="unread">미확인</option>
            <option value="read">확인</option>
            <option value="responded">응답</option>
          </select>
        </div>
      </div>

      <div className="page-content">
        {isLoading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>상담 목록을 불러오는 중입니다.</p>
          </div>
        ) : isError ? (
          <div className="empty-state">
            <div className="empty-icon">!</div>
            <h2>상담 목록을 불러오지 못했습니다</h2>
            <p>{error?.message || '잠시 후 다시 시도해 주세요.'}</p>
          </div>
        ) : currentConsultations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">?</div>
            <h2>상담 내역이 없습니다</h2>
            <p>필터 조건을 변경하거나 새로운 상담을 기다려 주세요.</p>
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
                  const status = resolveStatus(item);
                  return (
                    <tr
                      key={item.id}
                      className={status}
                      onClick={() => handleRowClick(item)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="col-status">
                        <span className={`status-indicator status-${status}`}>
                          {status === 'unread' && '미확인'}
                          {status === 'read' && '확인'}
                          {status === 'responded' && '응답'}
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

            <div className="list-meta">
              전체 {totalItems}건 중 {inquiryPage.offset + 1}-{inquiryPage.offset + currentConsultations.length}건 표시
            </div>

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

      {selectedConsultationData && (
      <ConsultationModal
        consultation={selectedConsultationData}
        onClose={() => setSelectedConsultation(null)}
        onRespond={handleRespond}
        isResponding={sendSmsMutation.isPending}
        attachments={attachments}
        attachmentsLoading={attachmentsLoading}
      />
      )}

      <ConfirmModal
        isOpen={confirmModalOpen}
        onClose={() => {
          if (sendSmsMutation.isPending) return;
          setConfirmModalOpen(false);
          setConsultationToConfirm(null);
        }}
        onConfirm={handleConfirmSMS}
        consultation={consultationToConfirm}
        isConfirming={sendSmsMutation.isPending}
      />

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
