/**
 * AppRouter.jsx - 라우터 통합 컴포넌트
 *
 * App.jsx의 기존 로직을 유지하면서 라우팅 기능 추가
 */

import { useEffect, useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { auth, onAuthStateChanged } from './auth/authManager';
import TitleBar from './components/TitleBar';
import LoginPage from './components/LoginPage';
import UnauthorizedPage from './components/UnauthorizedPage';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ConsultationsPage from './pages/ConsultationsPage';
import EmailConsultationsPage from './pages/EmailConsultationsPage';
import MemoPage from './pages/MemoPage';
import SettingsPage from './pages/SettingsPage';
import { fetchInquiries } from './services/inquiryService';
import { apiRequest } from './config/api';
import useWebSocketSync from './hooks/useWebSocketSync';
import './App.css';

// React Query Client 생성
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5분: 이 시간 동안은 fresh 상태 유지
      gcTime: 10 * 60 * 1000,        // 10분: 캐시 보관 시간 (구 cacheTime)
      refetchOnWindowFocus: false,   // 탭 전환 시 자동 refetch 비활성화
      refetchOnReconnect: true,      // 재연결 시 refetch
      retry: 1,                      // 실패 시 1번 재시도
    },
  },
});

// 라우팅 이벤트를 처리하는 컴포넌트
function NavigationListener() {
  const navigate = useNavigate();

  useEffect(() => {
    // 기존 onNavigateToRoute 이벤트
    if (window.electron && window.electron.onNavigateToRoute) {
      const cleanup = window.electron.onNavigateToRoute((route) => {
        console.log('[AppRouter] Navigating to route:', route);
        navigate(route);
      });

      return cleanup;
    }
  }, [navigate]);

  useEffect(() => {
    // Toast 알림에서 navigate-to 이벤트
    if (window.electron && window.electron.onNavigateTo) {
      const cleanup = window.electron.onNavigateTo((route) => {
        console.log('[AppRouter] Navigating from notification:', route);
        navigate(route);
      });

      return cleanup;
    }
  }, [navigate]);

  return null;
}

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

  // WebSocket 실시간 동기화 (Custom Hook으로 간소화)
  useWebSocketSync(user, {
    // 상담 생성
    onConsultationCreated: useCallback((newConsultation) => {
      setConsultations(prev => [newConsultation, ...prev]);
    }, []),

    // 상담 업데이트
    onConsultationUpdated: useCallback((data) => {
      setConsultations(prev => {
        const existing = prev.find(c => c.id === data.id);
        // 이미 같은 상태면 업데이트 스킵 (리렌더링 방지)
        if (existing && existing.check === data.updates.check) {
          return prev;
        }
        return prev.map(c => c.id === data.id ? { ...c, ...data.updates } : c);
      });
    }, []),

    // 상담 삭제
    onConsultationDeleted: useCallback((data) => {
      setConsultations(prev => prev.filter(c => c.id !== data.id));
    }, []),

    // 메모 생성 (Dashboard에서 자동 새로고침을 위해 필요)
    onMemoCreated: useCallback((newMemo) => {
      console.log('[AppRouter] Memo created:', newMemo.id);
      // Dashboard 컴포넌트가 자체적으로 메모를 관리하므로 여기서는 로그만 출력
    }, []),

    // 메모 삭제
    onMemoDeleted: useCallback((data) => {
      console.log('[AppRouter] Memo deleted:', data.id);
    }, []),

    // 일정 생성
    onScheduleCreated: useCallback((newSchedule) => {
      console.log('[AppRouter] Schedule created:', newSchedule.id);
    }, []),

    // 일정 수정
    onScheduleUpdated: useCallback((data) => {
      console.log('[AppRouter] Schedule updated:', data.id);
    }, []),

    // 일정 삭제
    onScheduleDeleted: useCallback((data) => {
      console.log('[AppRouter] Schedule deleted:', data.id);
    }, []),

    // 통계 새로고침
    loadStats: loadStats,

    // 재연결 시 데이터 동기화
    onReconnect: useCallback(async () => {
      try {
        const data = await fetchInquiries(auth);
        setConsultations(data);
        await loadStats();
      } catch (error) {
        console.error('[WebSocket] Failed to reload data on reconnect:', error);
      }
    }, []),
  });

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
    <QueryClientProvider client={queryClient}>
      <Router>
        <NavigationListener />
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
                      element={<Dashboard user={user} consultations={consultations} stats={stats} />}
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
                      element={<EmailConsultationsPage />}
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
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default AppRouter;
