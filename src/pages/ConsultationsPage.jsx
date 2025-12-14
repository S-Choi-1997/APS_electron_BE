/**
 * ConsultationsPage.jsx - 문의 목록 페이지
 *
 * 기존 App.jsx의 문의 목록 화면을 별도 페이지로 분리
 */

import { useState, useEffect, useMemo } from 'react';
import SearchBar from '../components/SearchBar';
import ConsultationTable from '../components/ConsultationTable';
import ConsultationModal from '../components/ConsultationModal';
import ConfirmModal from '../components/ConfirmModal';
import AlertModal from '../components/AlertModal';
import Pagination from '../components/Pagination';
import { updateInquiry, fetchAttachmentUrls, deleteInquiry } from '../services/inquiryService';
import { sendSMS } from '../services/smsService';
import { auth } from '../auth/authManager';
import '../components/css/PageLayout.css';
import './ConsultationsPage.css';

const ITEMS_PER_PAGE = 10;
const BASE_TYPES = ['전체', '비자', '비영리단체', '기업 인허가', '민원 행정', '기타'];

function ConsultationsPage({ consultations, setConsultations, type = 'website' }) {
  const [filteredConsultations, setFilteredConsultations] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedConsultation, setSelectedConsultation] = useState(null);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState('전체');
  const [attachmentMap, setAttachmentMap] = useState({});
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [consultationToConfirm, setConsultationToConfirm] = useState(null);
  const [alertModal, setAlertModal] = useState({ isOpen: false, type: 'success', title: '', message: '' });
  const [smsLoading, setSmsLoading] = useState(false);

  const typeFilters = useMemo(() => {
    const dynamic = Array.from(new Set(consultations.map((c) => c.type).filter(Boolean)));
    const merged = [...BASE_TYPES];
    dynamic.forEach((type) => {
      if (!merged.includes(type)) {
        merged.push(type);
      }
    });
    return merged;
  }, [consultations]);

  useEffect(() => {
    let filtered = consultations;

    if (searchTerm.trim() !== '') {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(lower) ||
          c.phone.includes(searchTerm) ||
          c.email.toLowerCase().includes(lower)
      );
    }

    if (showUnreadOnly) {
      filtered = filtered.filter((c) => !c.check);
    }

    if (typeFilter !== '전체') {
      filtered = filtered.filter((c) => c.type === typeFilter);
    }

    setFilteredConsultations(filtered);
    setCurrentPage(1);
  }, [searchTerm, consultations, showUnreadOnly, typeFilter]);

  const totalPages = Math.ceil(filteredConsultations.length / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentConsultations = filteredConsultations.slice(startIndex, endIndex);

  const handleRespond = async (id, check) => {
    try {
      if (check) {
        alert('이미 확인된 문의입니다. 문자가 발송되었으므로 취소할 수 없습니다.');
        return;
      }

      const consultation = consultations.find(c => c.id === id);
      if (!consultation) {
        throw new Error('문의를 찾을 수 없습니다.');
      }

      if (!consultation.phone) {
        alert('전화번호가 없어 문자를 보낼 수 없습니다.');
        return;
      }

      setConsultationToConfirm(consultation);
      setConfirmModalOpen(true);
    } catch (error) {
      console.error('Failed to prepare confirmation:', error);
      alert('확인 준비 중 오류가 발생했습니다: ' + error.message);
    }
  };

  const handleConfirmSMS = async () => {
    if (!consultationToConfirm) return;

    const id = consultationToConfirm.id;

    try {
      setConfirmModalOpen(false);
      setConsultationToConfirm(null);
      setSmsLoading(true);

      await updateInquiry(id, { check: true }, auth);

      try {
        const smsMessage = `[APS 컨설팅]

${consultationToConfirm.name}님의 문의가 확인되었습니다.
담당자가 곧 연락드리겠습니다.`;

        await sendSMS({
          receiver: consultationToConfirm.phone,
          msg: smsMessage,
        }, auth);

        setConsultations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, check: true } : c))
        );

        setSelectedConsultation((prev) =>
          prev && prev.id === id ? { ...prev, check: true } : prev
        );

        setSmsLoading(false);
        setAlertModal({
          isOpen: true,
          type: 'success',
          title: '발송 완료',
          message: '확인 완료 및 문자가 발송되었습니다.'
        });

        // 다른 창들에게 상담 업데이트 브로드캐스트
        if (window.electron && window.electron.broadcastConsultationUpdated) {
          await window.electron.broadcastConsultationUpdated();
        }
      } catch (smsError) {
        console.error('SMS 발송 실패:', smsError);
        setSmsLoading(false);

        try {
          await updateInquiry(id, { check: false }, auth);
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
      console.error('Failed to update inquiry:', error);
      setSmsLoading(false);
      alert('상담 상태를 업데이트하지 못했습니다: ' + error.message);
    }
  };

  const handleRowClick = async (consultation) => {
    setSelectedConsultation(consultation);

    if (attachmentMap[consultation.id]) {
      return;
    }

    if (!consultation.attachments || consultation.attachments.length === 0) {
      setAttachmentMap((prev) => ({ ...prev, [consultation.id]: [] }));
      return;
    }

    try {
      setAttachmentsLoading(true);
      const urls = await fetchAttachmentUrls(consultation.id, auth);
      setAttachmentMap((prev) => ({ ...prev, [consultation.id]: urls }));
    } catch (error) {
      console.error('Failed to fetch attachments:', error);
      alert('첨부파일을 불러오는 데 실패했습니다: ' + error.message);
    } finally {
      setAttachmentsLoading(false);
    }
  };

  const handleCloseModal = () => {
    setSelectedConsultation(null);
  };

  const handleSelectAll = (pageItems, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pageItems.forEach((item) => {
        if (checked) {
          next.add(item.id);
        } else {
          next.delete(item.id);
        }
      });
      return next;
    });
  };

  const handleToggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDelete = async (id) => {
    const target = consultations.find((c) => c.id === id);
    const confirmDelete = window.confirm(
      target?.name ? `${target.name} 문의를 삭제하시겠습니까?` : '선택한 문의를 삭제하시겠습니까?'
    );
    if (!confirmDelete) return;

    try {
      await deleteInquiry(id, auth);
      setConsultations((prev) => prev.filter((c) => c.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setAttachmentMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSelectedConsultation((prev) => (prev && prev.id === id ? null : prev));

      // 다른 창들에게 상담 업데이트 브로드캐스트
      if (window.electron && window.electron.broadcastConsultationUpdated) {
        await window.electron.broadcastConsultationUpdated();
      }
    } catch (error) {
      console.error('Failed to delete inquiry:', error);
      alert('문의 삭제에 실패했습니다: ' + error.message);
    }
  };

  const handleBulkConfirm = async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => updateInquiry(id, { check: true }, auth))
      );
      setConsultations((prev) =>
        prev.map((c) => (selectedIds.has(c.id) ? { ...c, check: true } : c))
      );
      setSelectedConsultation((prev) => (prev && selectedIds.has(prev.id) ? { ...prev, check: true } : prev));

      // 다른 창들에게 상담 업데이트 브로드캐스트
      if (window.electron && window.electron.broadcastConsultationUpdated) {
        await window.electron.broadcastConsultationUpdated();
      }
    } catch (error) {
      console.error('Failed to bulk update inquiries:', error);
      alert('선택한 문의 확인 처리에 실패했습니다: ' + error.message);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmDelete = window.confirm(`${selectedIds.size}건의 문의를 삭제하시겠습니까?`);
    if (!confirmDelete) return;

    try {
      await Promise.all(Array.from(selectedIds).map((id) => deleteInquiry(id, auth)));
      setConsultations((prev) => prev.filter((c) => !selectedIds.has(c.id)));
      setAttachmentMap((prev) => {
        const next = { ...prev };
        Array.from(selectedIds).forEach((id) => {
          delete next[id];
        });
        return next;
      });
      setSelectedConsultation((prev) => (prev && selectedIds.has(prev.id) ? null : prev));
      setSelectedIds(new Set());

      // 다른 창들에게 상담 업데이트 브로드캐스트
      if (window.electron && window.electron.broadcastConsultationUpdated) {
        await window.electron.broadcastConsultationUpdated();
      }
    } catch (error) {
      console.error('Failed to bulk delete inquiries:', error);
      alert('선택한 문의 삭제에 실패했습니다: ' + error.message);
    }
  };

  const uncheckedCount = consultations.filter((c) => !c.check).length;

  const pageTitle = type === 'email' ? '이메일 문의' : '홈페이지 문의';

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">{pageTitle}</h1>
        <div className="stats">
          <span className="stat-item">
            <span className="stat-label">전체</span>
            <span className="stat-value">{filteredConsultations.length}</span>
          </span>
          <span className="stat-divider">|</span>
          <span className="stat-item">
            <span className="stat-label">미확인</span>
            <span className="stat-value unread">{uncheckedCount}</span>
          </span>
        </div>
      </div>

      <div className="page-content">
        <div className="consultations-controls">
          <div className="filter-row">
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
            <button
              className={`pill-button ${showUnreadOnly ? 'active' : ''}`}
              onClick={() => setShowUnreadOnly((prev) => !prev)}
            >
              미확인만 보기
            </button>
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
          <SearchBar searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        </div>
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
