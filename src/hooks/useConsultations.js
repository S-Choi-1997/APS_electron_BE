/**
 * useConsultations.js - 상담 관리 Custom Hook
 *
 * App.jsx, AppRouter.jsx, ConsultationsPage.jsx에 중복되어 있던
 * 상담 데이터 관리 로직을 통합한 Hook
 *
 * 기능:
 * - 검색 및 필터링 (이름, 전화번호, 이메일)
 * - 타입 필터링 (비자, 비영리단체, 기업 인허가 등)
 * - 미확인 필터링
 * - 페이지네이션
 * - 선택 관리 (체크박스)
 * - 첨부파일 로딩
 * - SMS 발송 및 확인 처리
 * - 삭제 (단일/일괄)
 *
 * @param {Array} consultations - 전체 상담 목록
 * @param {Function} setConsultations - 상담 목록 업데이트 함수
 * @returns {Object} 상담 관리에 필요한 모든 state와 handlers
 */

import { useState, useEffect, useMemo } from 'react';
import { updateInquiry, fetchAttachmentUrls, deleteInquiry, INQUIRY_STATUS } from '../services/inquiryService';
import { sendSMS } from '../services/smsService';
import { getCurrentUser } from '../auth/authManager';
import useDebounce from './useDebounce';
import { ITEMS_PER_PAGE, BASE_CONSULTATION_TYPES } from '../constants';

function useConsultations(consultations, setConsultations) {
  // ========== 검색 및 필터링 ==========
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all'); // 'all', 'unread', 'read', 'responded'
  const [showUnreadOnly, setShowUnreadOnly] = useState(false); // Backward compatibility
  const [typeFilter, setTypeFilter] = useState('전체');

  // 디바운싱된 검색어 (성능 최적화)
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // ========== 페이지네이션 ==========
  const [currentPage, setCurrentPage] = useState(1);

  // ========== 선택 관리 ==========
  const [selectedIds, setSelectedIds] = useState(new Set());

  // ========== 모달 상태 ==========
  const [selectedConsultation, setSelectedConsultation] = useState(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [consultationToConfirm, setConsultationToConfirm] = useState(null);
  const [alertModal, setAlertModal] = useState({ isOpen: false, type: 'success', title: '', message: '' });

  // ========== 첨부파일 ==========
  const [attachmentMap, setAttachmentMap] = useState({});
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  // ========== SMS 로딩 ==========
  const [smsLoading, setSmsLoading] = useState(false);

  // ========== 타입 필터 목록 생성 ==========
  const typeFilters = useMemo(() => {
    const dynamic = Array.from(new Set(consultations.map((c) => c.type).filter(Boolean)));
    const merged = [...BASE_CONSULTATION_TYPES];
    dynamic.forEach((type) => {
      if (!merged.includes(type)) {
        merged.push(type);
      }
    });
    return merged;
  }, [consultations]);

  // ========== 필터링된 상담 목록 ==========
  const filteredConsultations = useMemo(() => {
    let filtered = consultations;

    // 검색어 필터링 (디바운싱된 값 사용)
    if (debouncedSearchTerm.trim() !== '') {
      const lower = debouncedSearchTerm.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(lower) ||
          c.phone.includes(debouncedSearchTerm) ||
          c.email.toLowerCase().includes(lower)
      );
    }

    // 상태 필터링 (status 기반)
    if (selectedStatus !== 'all') {
      filtered = filtered.filter((c) => {
        const status = c.status || (c.check ? INQUIRY_STATUS.RESPONDED : INQUIRY_STATUS.UNREAD);
        return status === selectedStatus;
      });
    }

    // 미확인 필터링 (Backward compatibility)
    if (showUnreadOnly) {
      filtered = filtered.filter((c) => {
        const status = c.status || (c.check ? INQUIRY_STATUS.RESPONDED : INQUIRY_STATUS.UNREAD);
        return status === INQUIRY_STATUS.UNREAD;
      });
    }

    // 타입 필터링
    if (typeFilter !== '전체') {
      filtered = filtered.filter((c) => c.type === typeFilter);
    }

    return filtered;
  }, [consultations, debouncedSearchTerm, selectedStatus, showUnreadOnly, typeFilter]);

  // ========== 필터 변경 시 페이지 초기화 ==========
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, selectedStatus, showUnreadOnly, typeFilter]);

  // ========== 페이지네이션 계산 ==========
  const totalPages = Math.ceil(filteredConsultations.length / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentConsultations = filteredConsultations.slice(startIndex, endIndex);

  // ========== 통계 계산 (status별) ==========
  const stats = useMemo(() => {
    let unread = 0;
    let read = 0;
    let responded = 0;

    consultations.forEach((c) => {
      const status = c.status || (c.check ? INQUIRY_STATUS.RESPONDED : INQUIRY_STATUS.UNREAD);
      if (status === INQUIRY_STATUS.UNREAD) unread++;
      else if (status === INQUIRY_STATUS.READ) read++;
      else if (status === INQUIRY_STATUS.RESPONDED) responded++;
    });

    return {
      total: consultations.length,
      unread,
      read,
      responded,
      // Backward compatibility
      uncheckedCount: unread
    };
  }, [consultations]);

  // Backward compatibility
  const uncheckedCount = stats.unread;

  // ========== 핸들러: 확인 버튼 클릭 ==========
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

  // ========== 핸들러: SMS 발송 확인 ==========
  const handleConfirmSMS = async () => {
    if (!consultationToConfirm) return;

    const id = consultationToConfirm.id;

    try {
      setConfirmModalOpen(false);
      setConsultationToConfirm(null);
      setSmsLoading(true);

      // 1. 먼저 상태 업데이트 (SMS 발송 = 응신)
      const auth = { currentUser: getCurrentUser() };
      await updateInquiry(id, { status: INQUIRY_STATUS.RESPONDED }, auth);

      // 2. SMS 발송
      try {
        const smsMessage = `[APS 컨설팅]

${consultationToConfirm.name}님의 문의가 확인되었습니다.
담당자가 곧 연락드리겠습니다.`;

        await sendSMS({
          receiver: consultationToConfirm.phone,
          msg: smsMessage,
        }, { currentUser: getCurrentUser() });

        // 3. 로컬 상태 업데이트
        setConsultations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: INQUIRY_STATUS.RESPONDED, check: true } : c))
        );

        setSelectedConsultation((prev) =>
          prev && prev.id === id ? { ...prev, status: INQUIRY_STATUS.RESPONDED, check: true } : prev
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
          await updateInquiry(id, { status: INQUIRY_STATUS.UNREAD }, { currentUser: getCurrentUser() });
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

  // ========== 핸들러: 상담 행 클릭 (상세보기) ==========
  const handleRowClick = async (consultation) => {
    setSelectedConsultation(consultation);

    // 이미 첨부파일을 로드했으면 스킵
    if (attachmentMap[consultation.id]) {
      return;
    }

    // 첨부파일이 없으면 빈 배열로 설정
    if (!consultation.attachments || consultation.attachments.length === 0) {
      setAttachmentMap((prev) => ({ ...prev, [consultation.id]: [] }));
      return;
    }

    // 첨부파일 로드
    try {
      setAttachmentsLoading(true);
      const auth = { currentUser: getCurrentUser() };
      const urls = await fetchAttachmentUrls(consultation.id, auth);
      setAttachmentMap((prev) => ({ ...prev, [consultation.id]: urls }));
    } catch (error) {
      console.error('Failed to fetch attachments:', error);
      alert('첨부파일을 불러오는 데 실패했습니다: ' + error.message);
    } finally {
      setAttachmentsLoading(false);
    }
  };

  // ========== 핸들러: 모달 닫기 ==========
  const handleCloseModal = () => {
    setSelectedConsultation(null);
  };

  // ========== 핸들러: 전체 선택 ==========
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

  // ========== 핸들러: 개별 선택 토글 ==========
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

  // ========== 핸들러: 단일 삭제 ==========
  const handleDelete = async (id) => {
    const target = consultations.find((c) => c.id === id);
    const confirmDelete = window.confirm(
      target?.name ? `${target.name} 문의를 삭제하시겠습니까?` : '선택한 문의를 삭제하시겠습니까?'
    );
    if (!confirmDelete) return;

    try {
      const auth = { currentUser: getCurrentUser() };
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

  // ========== 핸들러: 일괄 확인 ==========
  const handleBulkConfirm = async () => {
    if (selectedIds.size === 0) return;
    try {
      const auth = { currentUser: getCurrentUser() };
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

  // ========== 핸들러: 일괄 삭제 ==========
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmDelete = window.confirm(`${selectedIds.size}건의 문의를 삭제하시겠습니까?`);
    if (!confirmDelete) return;

    try {
      const auth = { currentUser: getCurrentUser() };
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

  // ========== 반환값 ==========
  return {
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
    uncheckedCount, // Backward compatibility

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
  };
}

export default useConsultations;
