/**
 * EmailConsultationsPage.jsx - 이메일 상담 전용 페이지
 *
 * 이메일로 접수된 상담 내역을 관리하는 페이지
 */

import { useState, useEffect } from 'react';
import { fetchEmailInquiries, fetchEmailStats, updateEmailInquiry, triggerZohoSync } from '../services/emailInquiryService';
import { getCurrentUser } from '../auth/authManager';
import '../components/css/PageLayout.css';
import './EmailConsultationsPage.css';

function EmailConsultationsPage() {
  const [inquiries, setInquiries] = useState([]);
  const [stats, setStats] = useState({ total: 0, unread: 0, gmail: 0, zoho: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('all'); // 'all', 'unread'

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

  // Handle check toggle
  const handleCheckToggle = async (id, currentCheck) => {
    try {
      await updateEmailInquiry(id, { check: !currentCheck });
      setInquiries(prev => prev.map(item =>
        item.id === id ? { ...item, check: !currentCheck } : item
      ));
    } catch (error) {
      console.error('Failed to update inquiry:', error);
      alert('업데이트 실패: ' + error.message);
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

      // Reload data after sync
      await loadData();

      alert(`동기화 완료!\n새로운 이메일: ${result.new || 0}개\n스킵: ${result.skipped || 0}개`);
    } catch (error) {
      console.error('[Email Sync] Failed:', error);
      alert('동기화 실패: ' + error.message);
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
                  <th className="col-check">확인</th>
                  <th className="col-source">소스</th>
                  <th className="col-from">발신자</th>
                  <th className="col-subject">제목</th>
                  <th className="col-date">날짜</th>
                </tr>
              </thead>
              <tbody>
                {filteredInquiries.map((item) => (
                  <tr key={item.id} className={item.check ? 'checked' : 'unchecked'}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={item.check}
                        onChange={() => handleCheckToggle(item.id, item.check)}
                      />
                    </td>
                    <td className="col-source">
                      <span className={`source-badge ${item.source}`}>
                        {item.source === 'gmail' ? 'Gmail' : 'ZOHO'}
                      </span>
                    </td>
                    <td className="col-from">{item.from}</td>
                    <td className="col-subject">
                      <div className="subject-cell">
                        <div className="subject-text">{item.subject}</div>
                        <div className="body-preview">{item.body.substring(0, 50)}...</div>
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
    </div>
  );
}

export default EmailConsultationsPage;
