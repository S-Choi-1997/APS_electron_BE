/**
 * EmailConsultationsPage.jsx - 이메일 상담 전용 페이지
 *
 * 이메일로 접수된 상담 내역을 관리하는 페이지
 * Phase 1: Mock 데이터로 UI 구현
 * Phase 2: 실제 ZOHO Mail API 연동 예정
 */

import { useState, useEffect } from 'react';
import { fetchEmailInquiries, fetchEmailStats, updateEmailInquiry } from '../services/emailInquiryService';
import '../components/css/PageLayout.css';
import './EmailConsultationsPage.css';

function EmailConsultationsPage() {
  const [inquiries, setInquiries] = useState([]);
  const [stats, setStats] = useState({ total: 0, unread: 0, gmail: 0, zoho: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedSource, setSelectedSource] = useState('all'); // 'all', 'gmail', 'zoho'
  const [selectedStatus, setSelectedStatus] = useState('all'); // 'all', 'unread', 'read'

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

  // Filter inquiries
  const filteredInquiries = inquiries.filter(item => {
    if (selectedSource !== 'all' && item.source !== selectedSource) return false;
    if (selectedStatus === 'unread' && item.check) return false;
    if (selectedStatus === 'read' && !item.check) return false;
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
        <h1 className="page-title">이메일 상담</h1>
        <p className="page-subtitle">이메일로 접수된 상담 내역</p>
      </div>

      {/* Phase 1 Notice */}
      <div className="phase-notice">
        📌 Phase 1: Mock 데이터로 UI 테스트 중 (ZOHO API 연동 예정)
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
        <div className="stat-card">
          <div className="stat-label">Gmail</div>
          <div className="stat-value">{stats.gmail}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">ZOHO</div>
          <div className="stat-value">{stats.zoho}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-container">
        <div className="filter-group">
          <label>소스:</label>
          <select value={selectedSource} onChange={(e) => setSelectedSource(e.target.value)}>
            <option value="all">전체</option>
            <option value="gmail">Gmail</option>
            <option value="zoho">ZOHO</option>
          </select>
        </div>
        <div className="filter-group">
          <label>상태:</label>
          <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
            <option value="all">전체</option>
            <option value="unread">미확인</option>
            <option value="read">확인됨</option>
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
