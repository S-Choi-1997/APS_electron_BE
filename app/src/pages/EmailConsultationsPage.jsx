/**
 * EmailConsultationsPage.jsx - 이메일 상담 전용 페이지
 *
 * 이메일로 접수된 상담 내역을 관리하는 페이지
 */

import { useState } from 'react';
import { getCurrentUser } from '../auth/authManager';
import EmailConsultationModal from '../components/EmailConsultationModal';
import Pagination from '../components/Pagination';
import {
  useEmailInquiries,
  useAllEmailsForThread,
  useEmailStats,
  useUpdateEmailInquiry,
  useTriggerZohoSync,
  useSendEmailResponse
} from '../hooks/queries/useEmailInquiries';
import { EMAIL_STATUS } from '../services/emailInquiryService';
import '../components/css/PageLayout.css';
import './EmailConsultationsPage.css';

function EmailConsultationsPage() {
  const [selectedStatus, setSelectedStatus] = useState('all'); // 'all', 'unread'
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // React Query Hooks
  const { data: inquiries = [], isLoading, isError, error } = useEmailInquiries();
  const { data: allEmailsForThread = [] } = useAllEmailsForThread(); // 스레드용 (보낸 메일 포함)
  const { data: stats = { total: 0, unread: 0, read: 0, responded: 0, gmail: 0, zoho: 0 } } = useEmailStats();

  // Debug: 받아온 이메일 데이터 확인
  console.log('[EmailPage] Inquiries received:', inquiries.length, inquiries);
  console.log('[EmailPage] Selected status:', selectedStatus);
  console.log('[EmailPage] Stats:', stats);
  const updateMutation = useUpdateEmailInquiry();
  const syncMutation = useTriggerZohoSync();
  const responseMutation = useSendEmailResponse();

  // WebSocket 실시간 동기화는 AppRouter에서 전역으로 처리
  // EmailConsultationsPage에서는 별도 호출 불필요

  // Handle row click to open modal
  const handleRowClick = async (email) => {
    setSelectedEmail(email);

    // Mark as read if unread (Optimistic Update)
    if (email.status === EMAIL_STATUS.UNREAD) {
      updateMutation.mutate({ id: email.id, updates: { status: EMAIL_STATUS.READ } });
    }
  };

  // Handle email response
  const handleRespond = async (emailId, responseText) => {
    const email = inquiries.find(item => item.id === emailId);
    if (!email) {
      throw new Error('Email not found');
    }

    const originalEmail = {
      messageId: email.messageId,
      from: email.from,
      subject: email.subject
    };

    await responseMutation.mutateAsync({ emailId, responseText, originalEmail });
  };

  // Handle manual sync (all users allowed)
  const handleManualSync = async () => {
    const user = getCurrentUser();
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    syncMutation.mutate();
  };

  // Filter inquiries (only show incoming emails, not outgoing)
  const filteredInquiries = inquiries.filter(item => {
    // Don't show outgoing emails in the list
    if (item.isOutgoing) return false;

    // Status filtering
    if (selectedStatus === EMAIL_STATUS.UNREAD && item.status !== EMAIL_STATUS.UNREAD) return false;
    if (selectedStatus === EMAIL_STATUS.READ && item.status !== EMAIL_STATUS.READ) return false;
    if (selectedStatus === EMAIL_STATUS.RESPONDED && item.status !== EMAIL_STATUS.RESPONDED) return false;

    return true;
  });

  // Pagination
  const totalPages = Math.ceil(filteredInquiries.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentInquiries = filteredInquiries.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  const handleStatusChange = (newStatus) => {
    setSelectedStatus(newStatus);
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
          <h1 className="page-title">이메일 상담</h1>
          <p className="page-subtitle">이메일로 접수된 상담 내역</p>
        </div>
        <div className="header-right">
          <button
            className="sync-button"
            onClick={handleManualSync}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? '동기화 중...' : '🔄 수동 동기화'}
          </button>
        </div>
      </div>

      {/* Statistics */}
      <div className="stats-container">
        <div className="stat-card">
          <div className="stat-label">미확인</div>
          <div className="stat-value highlight">{isLoading ? '-' : stats.unread}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">확인</div>
          <div className="stat-value">{isLoading ? '-' : stats.read}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">응신</div>
          <div className="stat-value responded">{isLoading ? '-' : stats.responded}</div>
        </div>
      </div>

      {/* Email List */}
      <div className="page-content">
        {isError ? (
          <div className="error-state">
            <div className="empty-icon">❌</div>
            <h2>이메일 목록을 불러오는데 실패했습니다</h2>
            <p>{error?.message || '알 수 없는 오류가 발생했습니다.'}</p>
          </div>
        ) : isLoading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>이메일 목록을 불러오는 중입니다.</p>
          </div>
        ) : filteredInquiries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <h2>이메일이 없습니다</h2>
            <p>필터 조건을 변경하거나 새로운 이메일을 기다려주세요.</p>
          </div>
        ) : (
          <div className="email-table-container">
            <table className="email-table">
              <thead>
                <tr>
                  <th className="col-status">상태</th>
                  <th className="col-source">소스</th>
                  <th className="col-from">발신자</th>
                  <th className="col-subject">제목</th>
                  <th className="col-date">날짜</th>
                </tr>
              </thead>
              <tbody>
                {currentInquiries.map((item) => (
                  <tr
                    key={item.id}
                    className={`status-${item.status}`}
                    onClick={() => handleRowClick(item)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="col-status">
                      <span className={`status-badge status-${item.status}`}>
                        {item.status === EMAIL_STATUS.UNREAD && '미확인'}
                        {item.status === EMAIL_STATUS.READ && '확인'}
                        {item.status === EMAIL_STATUS.RESPONDED && '응신'}
                      </span>
                    </td>
                    <td className="col-source">
                      <span className={`source-badge ${item.source}`}>
                        {item.source === 'gmail' ? 'Gmail' : 'ZOHO'}
                      </span>
                    </td>
                    <td className="col-from">
                      <div className="from-cell">
                        <div className="from-name">{item.fromName || item.from}</div>
                        <div className="from-email">{item.from}</div>
                      </div>
                    </td>
                    <td className="col-subject">
                      <div className="subject-cell">
                        <div className="subject-text">{item.subject}</div>
                        <div className="body-preview">{item.body ? item.body.substring(0, 50) : ''}...</div>
                      </div>
                    </td>
                    <td className="col-date">{formatDate(item.receivedAt)}</td>
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

      {/* Email Detail Modal */}
      {selectedEmail && (
        <EmailConsultationModal
          email={selectedEmail}
          allEmails={allEmailsForThread}
          onClose={() => setSelectedEmail(null)}
          onRespond={handleRespond}
        />
      )}
    </div>
  );
}

export default EmailConsultationsPage;
