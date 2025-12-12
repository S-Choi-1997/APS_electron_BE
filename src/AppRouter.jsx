/**
 * AppRouter.jsx - 라우터 통합 컴포넌트
 *
 * App.jsx의 기존 로직을 유지하면서 라우팅 기능 추가
 */

import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { auth, onAuthStateChanged } from './auth/authManager';
import TitleBar from './components/TitleBar';
import LoginPage from './components/LoginPage';
import UnauthorizedPage from './components/UnauthorizedPage';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ConsultationsPage from './pages/ConsultationsPage';
import MemoPage from './pages/MemoPage';
import SettingsPage from './pages/SettingsPage';
import { fetchInquiries } from './services/inquiryService';
import { apiRequest } from './config/api';
import './App.css';

function AppRouter() {
  // Electron 환경 체크
  useEffect(() => {
    const isElectron = window.electron && window.electron.isElectron;
    if (!isElectron) {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><h1>이 애플리케이션은 Electron 앱에서만 실행됩니다.</h1></div>';
      throw new Error('This app can only run in Electron');
    }
  }, []);

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showUnauthorized, setShowUnauthorized] = useState(false);
  const [consultations, setConsultations] = useState([]);
  const [stats, setStats] = useState({ website: 0, email: 0 });
  const [loading, setLoading] = useState(true);

  // 인증 상태 감지
  useEffect(() => {
    const unsubscribe = onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 통계 불러오기
  const loadStats = async () => {
    try {
      const response = await apiRequest('/inquiries/stats', {
        method: 'GET',
      }, auth);

      if (response.data) {
        setStats(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  // 문의 목록 불러오기
  useEffect(() => {
    if (!user) {
      setConsultations([]);
      setStats({ website: 0, email: 0 });
      setLoading(false);
      return;
    }

    const loadInquiries = async () => {
      const loadStartTime = performance.now();
      console.log('[App Performance] Starting to load inquiries...');
      try {
        setLoading(true);
        const data = await fetchInquiries(auth);
        const fetchDuration = performance.now() - loadStartTime;
        console.log(`[App Performance] fetchInquiries completed in ${fetchDuration.toFixed(0)}ms`);

        setConsultations(data);

        // 통계도 함께 로드
        await loadStats();

        const totalDuration = performance.now() - loadStartTime;
        console.log(`[App Performance] Total loadInquiries (including state updates) completed in ${totalDuration.toFixed(0)}ms`);
      } catch (error) {
        console.error('Failed to fetch inquiries:', error);

        // 토큰 에러 체크
        if (error.message.includes('Invalid or expired token') ||
            error.message.includes('unauthorized') ||
            error.message.includes('Invalid token')) {
          setLoading(false);
          auth.signOut();
          return;
        }

        // 권한 없음 에러 체크
        if (error.message.includes('Access denied') ||
            error.message.includes('unauthorized email') ||
            error.message.includes('forbidden')) {
          setLoading(false);
          setShowUnauthorized(true);
          auth.signOut();
          return;
        }

        alert('상담 목록을 불러오지 못했습니다: ' + error.message);
      } finally {
        setLoading(false);
      }
    };

    loadInquiries();
  }, [user]);

  // 로딩 중
  if (authLoading) {
    return (
      <div className="app">
        <div className="auth-loading">
          <div className="loading-spinner"></div>
          <p>로그인 상태를 확인하고 있습니다.</p>
        </div>
      </div>
    );
  }

  // 권한 없음
  if (showUnauthorized) {
    return <UnauthorizedPage onBackToLogin={() => setShowUnauthorized(false)} />;
  }

  // 로그인 안 됨
  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={setUser}
        onUnauthorized={() => setShowUnauthorized(true)}
      />
    );
  }

  // 로그인 됨 - 메인 앱
  return (
    <Router>
      <div className="app-container">
        <TitleBar />
        <div className="app-content-wrapper">
          <Sidebar user={user} stats={stats} />

          <div className="main-wrapper">
            <main className="main-content">
              {loading ? (
                <div className="loading-state">
                  <div className="loading-spinner"></div>
                  <p>문의 목록을 불러오는 중입니다.</p>
                </div>
              ) : (
                <Routes>
                  <Route
                    path="/"
                    element={<Dashboard user={user} consultations={consultations} />}
                  />
                  <Route
                    path="/consultations"
                    element={<Navigate to="/consultations/website" replace />}
                  />
                  <Route
                    path="/consultations/website"
                    element={
                      <ConsultationsPage
                        consultations={consultations}
                        setConsultations={setConsultations}
                        type="website"
                      />
                    }
                  />
                  <Route
                    path="/consultations/email"
                    element={
                      <ConsultationsPage
                        consultations={consultations}
                        setConsultations={setConsultations}
                        type="email"
                      />
                    }
                  />
                  <Route
                    path="/memo"
                    element={<MemoPage user={user} />}
                  />
                  <Route
                    path="/settings"
                    element={<SettingsPage />}
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              )}
            </main>
          </div>
        </div>
      </div>
    </Router>
  );
}

export default AppRouter;
