/**
 * EmailConsultationsPage.jsx - 이메일 상담 전용 페이지
 *
 * 이메일로 접수된 상담 내역을 관리하는 페이지
 */

import { useState, useEffect } from 'react';
import { fetchEmailInquiries, fetchEmailStats, updateEmailInquiry, triggerZohoSync, sendEmailResponse } from '../services/emailInquiryService';
import { getCurrentUser } from '../auth/authManager';
import EmailConsultationModal from '../components/EmailConsultationModal';
import '../components/css/PageLayout.css';
import './EmailConsultationsPage.css';

function EmailConsultationsPage() {
  const [inquiries, setInquiries] = useState([]);
  const [stats, setStats] = useState({ total: 0, unread: 0, gmail: 0, zoho: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('all'); // 'all', 'unread'
  const [selectedEmail, setSelectedEmail] = useState(null);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [inquiriesData, statsData] = await Promise.all([
        fetchEmailInquiries(),
        fetchEmailStats()
      ]);
      setInquiries(inquiriesData);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load email data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle row click to open modal
  const handleRowClick = async (email) => {
    setSelectedEmail(email);

    // Mark as read if unread
    if (!email.check) {
      try {
        await updateEmailInquiry(email.id, { check: true });
        setInquiries(prev => prev.map(item =>
          item.id === email.id ? { ...item, check: true } : item
        ));
      } catch (error) {
        console.error('Failed to mark as read:', error);
      }
    }
  };

  // Handle email response
  const handleRespond = async (emailId, responseText) => {
    try {
      console.log('[Email Response] Sending response to email:', emailId);

      // Find the email in our local state
      const email = inquiries.find(item => item.id === emailId);
      if (!email) {
        throw new Error('Email not found');
      }

      // Prepare original email data for threading
      const originalEmail = {
        messageId: email.messageId,
        from: email.from,
        subject: email.subject
      };

      // Send response via API
      await sendEmailResponse(emailId, responseText, originalEmail);

      console.log('[Email Response] Response sent successfully');
    } catch (error) {
      console.error('[Email Response] Failed to send response:', error);
      throw error;
    }
  };

  // Handle manual sync (admin only)
  const handleManualSync = async () => {
    // Check if user is admin
    const user = getCurrentUser();
    if (!user || user.role !== 'admin') {
      alert('관리자만 동기화를 실행할 수 있습니다.');
      return;
    }

    try {
      setSyncing(true);
      console.log('[Email Sync] Starting manual sync...');
      const result = await triggerZohoSync();
      console.log('[Email Sync] Sync completed:', result);
      console.log(`[Email Sync] 새로운 이메일: ${result.new || 0}개, 스킵: ${result.skipped || 0}개`);

      // Reload data after sync
      await loadData();
    } catch (error) {
      console.error('[Email Sync] Failed:', error);
    } finally {
      setSyncing(false);
    }
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

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-content">
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>이메일 목록을 불러오는 중입니다.</p>
          </div>
        </div>
      </div>
    );
  }

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
            disabled={syncing}
          >
            {syncing ? '동기화 중...' : '🔄 수동 동기화'}
          </button>
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
          <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
            <option value="all">전체</option>
            <option value="unread">미확인</option>
          </select>
        </div>
      </div>

      {/* Email List */}
      <div className="page-content">
        {filteredInquiries.length === 0 ? (
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
