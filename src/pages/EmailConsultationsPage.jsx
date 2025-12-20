/**
 * EmailConsultationsPage.jsx - 이메일 상담 전용 페이지
 *
 * 이메일로 접수된 상담 내역을 관리하는 페이지
 */

import { useState } from 'react';
import { getCurrentUser } from '../auth/authManager';
import EmailConsultationModal from '../components/EmailConsultationModal';
import {
  useEmailInquiries,
  useEmailStats,
  useUpdateEmailInquiry,
  useTriggerZohoSync,
  useSendEmailResponse
} from '../hooks/queries/useEmailInquiries';
import useWebSocketSync from '../hooks/useWebSocketSync';
import '../components/css/PageLayout.css';
import './EmailConsultationsPage.css';

function EmailConsultationsPage() {
  const [selectedStatus, setSelectedStatus] = useState('all'); // 'all', 'unread'
  const [selectedEmail, setSelectedEmail] = useState(null);

  // React Query Hooks
  const { data: inquiries = [], isLoading, isError } = useEmailInquiries();
  const { data: stats = { total: 0, unread: 0, gmail: 0, zoho: 0 } } = useEmailStats();
  const updateMutation = useUpdateEmailInquiry();
  const syncMutation = useTriggerZohoSync();
  const responseMutation = useSendEmailResponse();

  // WebSocket 실시간 동기화
  const user = getCurrentUser();
  useWebSocketSync(user, {});

  // Handle row click to open modal
  const handleRowClick = async (email) => {
    setSelectedEmail(email);

    // Mark as read if unread (Optimistic Update)
    if (!email.check) {
      updateMutation.mutate({ id: email.id, updates: { check: true } });
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

  // Handle manual sync (admin only)
  const handleManualSync = async () => {
    const user = getCurrentUser();
    if (!user || user.role !== 'admin') {
      alert('관리자만 동기화를 실행할 수 있습니다.');
      return;
    }

    syncMutation.mutate();
  };

  // Filter inquiries
  const filteredInquiries = inquiries.filter(item => {
    if (selectedStatus === 'unread' && item.check) return false;
    return true;
  });

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
          <div className="stat-label">전체</div>
          <div className="stat-value">{isLoading ? '-' : stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">미확인</div>
          <div className="stat-value highlight">{isLoading ? '-' : stats.unread}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-container">
        <div className="filter-group">
          <label>상태:</label>
          <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
            <option value="all">전체</option>
            <option value="unread">미확인</option>
          </select>
        </div>
      </div>

      {/* Email List */}
      <div className="page-content">
        {isError ? (
          <div className="error-state">
            <p>이메일 목록을 불러오는데 실패했습니다.</p>
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
                {filteredInquiries.map((item) => (
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
                    <td className="col-source">
                      <span className={`source-badge ${item.source}`}>
                        {item.source === 'gmail' ? 'Gmail' : 'ZOHO'}
                      </span>
                    </td>
                    <td className="col-from">{item.fromName || item.from}</td>
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
          </div>
        )}
      </div>

      {/* Email Detail Modal */}
      {selectedEmail && (
        <EmailConsultationModal
          email={selectedEmail}
          onClose={() => setSelectedEmail(null)}
          onRespond={handleRespond}
        />
      )}
    </div>
  );
}

export default EmailConsultationsPage;
