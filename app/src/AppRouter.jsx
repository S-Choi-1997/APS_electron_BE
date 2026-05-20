/**
 * AppRouter.jsx - router shell for the Electron renderer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initializeAuthSession, onAuthStateChanged, setExternalAuthSession } from './auth/authManager';
import TitleBar from './components/TitleBar';
import LoginPage from './components/LoginPage';
import UnauthorizedPage from './components/UnauthorizedPage';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import WebsiteConsultationsPage from './pages/WebsiteConsultationsPage';
import EmailConsultationsPage from './pages/EmailConsultationsPage';
import MemoPage from './pages/MemoPage';
import SettingsPage from './pages/SettingsPage';
import UpdateProgressModal from './components/UpdateProgressModal';
import { ROUTES, WINDOW_ROUTES } from './constants/routes';
import { applyAppConfig, initializeAppConfig } from './config/api';
import { memoQueryKeys } from './hooks/queries/memoQueryKeys';
import useWebSocketSync from './hooks/useWebSocketSync';
import { showToastNotification } from './utils/notificationHelper';
import MemoDetailWindow from './windows/MemoDetailWindow';
import StickyWindow from './windows/StickyWindow';
import ToastNotificationWindow from './windows/ToastNotificationWindow';
import './App.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

function normalizeAppRoute(route) {
  const routeValue = typeof route === 'string' ? route.trim() : '';
  if (!routeValue) return '/';

  return routeValue.startsWith('/') ? routeValue : `/${routeValue}`;
}

function NavigationListener() {
  const navigate = useNavigate();
  const lastNavigationRef = useRef({ route: null, at: 0 });
  const navigateToAppRoute = useCallback((route) => {
    const normalizedRoute = normalizeAppRoute(route);
    const now = Date.now();
    const lastNavigation = lastNavigationRef.current;

    if (
      lastNavigation.route === normalizedRoute &&
      now - lastNavigation.at < 500
    ) {
      return;
    }

    lastNavigationRef.current = { route: normalizedRoute, at: now };
    console.log('[AppRouter] Navigating to route:', normalizedRoute);
    navigate(normalizedRoute);
  }, [navigate]);

  useEffect(() => {
    let canceled = false;

    window.electron?.consumePendingNavigationRoute?.()
      .then((route) => {
        if (!canceled && route) {
          navigateToAppRoute(route);
        }
      })
      .catch((error) => {
        console.error('[AppRouter] Failed to consume pending route:', error);
      });

    return () => {
      canceled = true;
    };
  }, [navigateToAppRoute]);

  useEffect(() => {
    if (!window.electron?.onNavigateToRoute) return undefined;

    return window.electron.onNavigateToRoute((route) => {
      navigateToAppRoute(route);
      window.electron?.consumePendingNavigationRoute?.().catch(() => {});
    });
  }, [navigateToAppRoute]);

  return null;
}

function isWindowRoute() {
  return window.location.hash.startsWith('#/window/');
}

function WindowAuthBoundary({ children }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let canceled = false;

    async function bootstrapWindow() {
      try {
        await initializeAppConfig();

        const authResult = await window.electron?.getAuthToken?.();
        let windowUser = null;

        if (authResult?.success && authResult.user) {
          windowUser = setExternalAuthSession(authResult.user, { persist: false, syncElectron: false });
        } else {
          windowUser = await initializeAuthSession();
        }

        if (!windowUser) {
          throw new Error('인증 정보를 확인하지 못했습니다. 메인 창에서 다시 로그인해 주세요.');
        }

        if (!canceled) {
          setError('');
          setReady(true);
        }
      } catch (bootstrapError) {
        console.error('[WindowAuthBoundary] Failed to bootstrap window:', bootstrapError);
        if (!canceled) {
          setError(bootstrapError.message || '보조창 초기화에 실패했습니다.');
          setReady(true);
        }
      }
    }

    bootstrapWindow();

    return () => {
      canceled = true;
    };
  }, [retryKey]);

  if (!ready) {
    return (
      <div className="window-loading">
        <div className="loading-spinner"></div>
        <p>창을 준비하고 있습니다.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="window-loading">
        <p>{error}</p>
        <div className="window-loading-actions">
          <button type="button" onClick={() => {
            setReady(false);
            setError('');
            setRetryKey((value) => value + 1);
          }}>
            다시 시도
          </button>
          <button type="button" onClick={() => window.electron?.closeCurrentWindow?.()}>
            창 닫기
          </button>
        </div>
      </div>
    );
  }

  return children;
}

function WindowRoutes() {
  return (
    <Router>
      <Routes>
        <Route path={WINDOW_ROUTES.TOAST} element={<ToastNotificationWindow />} />
        <Route path={WINDOW_ROUTES.MEMO_NEW} element={<WindowAuthBoundary><MemoDetailWindow mode="create" /></WindowAuthBoundary>} />
        <Route path="/window/memo/:id" element={<WindowAuthBoundary><MemoDetailWindow mode="view" /></WindowAuthBoundary>} />
        <Route path="/window/sticky/:type" element={<WindowAuthBoundary><StickyWindow /></WindowAuthBoundary>} />
        <Route path="*" element={<ToastNotificationWindow />} />
      </Routes>
    </Router>
  );
}

function AppShell({ user }) {
  const location = useLocation();
  const isEmailRoute = location.pathname === ROUTES.EMAIL_CONSULTATIONS || location.pathname === ROUTES.EMAIL;

  return (
    <div className="app-container">
      <TitleBar />
      <div className="app-content-wrapper">
        <Sidebar user={user} />

        <div className="main-wrapper">
          <main className={`main-content ${isEmailRoute ? 'email-client-shell' : ''}`}>
            <Routes>
              <Route path={ROUTES.DASHBOARD} element={<Dashboard user={user} />} />
              <Route path={ROUTES.WEBSITE_CONSULTATIONS} element={<WebsiteConsultationsPage />} />
              <Route path={ROUTES.EMAIL_CONSULTATIONS} element={<EmailConsultationsPage />} />
              <Route path={ROUTES.MEMO} element={<MemoPage user={user} />} />
              <Route path={ROUTES.SETTINGS} element={<SettingsPage />} />
              <Route path="*" element={<Navigate to={ROUTES.DASHBOARD} replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showUnauthorized, setShowUnauthorized] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateModalState, setUpdateModalState] = useState({
    info: null,
    progress: null,
    isDownloaded: false,
    isDownloading: false,
    errorMessage: null,
  });
  const [configReady, setConfigReady] = useState(false);

  const applyUpdateState = useCallback((state) => {
    if (!state || !['available', 'downloading', 'downloaded', 'error'].includes(state.status)) {
      return;
    }

    const shouldShowError = state.status === 'error' && state.info;
    if (state.status === 'error' && !shouldShowError) {
      return;
    }

    setUpdateModalState({
      info: state.info || null,
      progress: state.progress || null,
      isDownloaded: Boolean(state.isDownloaded || state.status === 'downloaded'),
      isDownloading: Boolean(state.isDownloading || state.status === 'downloading'),
      errorMessage: state.errorMessage || null,
    });
    setShowUpdateModal(true);
  }, []);

  useEffect(() => {
    let cleanupConfigListener;
    let canceled = false;

    initializeAppConfig()
      .catch((error) => {
        console.error('[AppRouter] Failed to initialize backend config:', error);
      })
      .finally(() => {
        if (!canceled) setConfigReady(true);
      });

    if (window.electron?.onAppConfigChanged) {
      cleanupConfigListener = window.electron.onAppConfigChanged((config) => {
        applyAppConfig(config);
        queryClient.clear();
      });
    }

    return () => {
      canceled = true;
      cleanupConfigListener?.();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged((currentUser) => {
      setUser(currentUser);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!configReady) return undefined;

    let canceled = false;
    setAuthLoading(true);

    initializeAuthSession()
      .then((currentUser) => {
        if (!canceled) {
          setUser(currentUser);
        }
      })
      .catch((error) => {
        console.error('[AppRouter] Failed to initialize auth session:', error);
        if (!canceled) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!canceled) {
          setAuthLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [configReady]);

  useEffect(() => {
    if (!window.electron) return undefined;

    window.electron.getUpdateState?.()
      .then((state) => {
        applyUpdateState(state);
      })
      .catch((error) => {
        console.error('[AppRouter] Failed to get update state:', error);
      });

    const cleanupUpdateAvailable = window.electron.onUpdateAvailable?.((info) => {
      setUpdateModalState({
        info,
        progress: null,
        isDownloaded: false,
        isDownloading: false,
        errorMessage: null,
      });
      setShowUpdateModal(true);
    });

    const cleanupUpdateProgress = window.electron.onUpdateDownloadProgress?.((progress) => {
      setUpdateModalState((previous) => ({
        ...previous,
        progress,
        isDownloaded: false,
        isDownloading: true,
        errorMessage: null,
      }));
      setShowUpdateModal(true);
    });

    const cleanupUpdateDownloaded = window.electron.onUpdateDownloaded?.((info) => {
      setUpdateModalState((previous) => ({
        ...previous,
        info: previous.info || info,
        progress: { percent: 100, transferred: 0, total: 0 },
        isDownloaded: true,
        isDownloading: false,
        errorMessage: null,
      }));
      setShowUpdateModal(true);
    });

    const cleanupUpdateError = window.electron.onUpdateError?.((error) => {
      setUpdateModalState((previous) => ({
        ...previous,
        isDownloading: false,
        errorMessage: error?.message || '업데이트 중 오류가 발생했습니다.',
      }));
      setShowUpdateModal(true);
    });

    return () => {
      cleanupUpdateAvailable?.();
      cleanupUpdateProgress?.();
      cleanupUpdateDownloaded?.();
      cleanupUpdateError?.();
    };
  }, [applyUpdateState]);

  useEffect(() => {
    if (!window.electron?.onMemoWindowChanged) return undefined;

    return window.electron.onMemoWindowChanged(() => {
      queryClient.invalidateQueries({ queryKey: memoQueryKeys.all });
    });
  }, []);

  useWebSocketSync({
    enabled: Boolean(user && configReady),
  });

  useEffect(() => {
    if (!user || !configReady || !window.electron?.onWebSocketEvent) return undefined;

    const cleanups = [];

    const consultationCleanup = window.electron.onWebSocketEvent('consultation:created', () => {
      showToastNotification(
        'consultation',
        '새 홈페이지 상담이 접수되었습니다.',
        { route: ROUTES.WEBSITE_CONSULTATIONS, duration: 7000 }
      );
    });
    if (consultationCleanup) cleanups.push(consultationCleanup);

    const emailCleanup = window.electron.onWebSocketEvent('email:created', (email) => {
      if (email?.isOutgoing || email?.is_outgoing) return;

      showToastNotification(
        'email',
        '새 이메일 상담이 도착했습니다.',
        { route: ROUTES.EMAIL_CONSULTATIONS, duration: 7000 }
      );
    });
    if (emailCleanup) cleanups.push(emailCleanup);

    return () => {
      cleanups.forEach((cleanup) => cleanup?.());
    };
  }, [user, configReady]);

  const updateModalElement = (
    <UpdateProgressModal
      isVisible={showUpdateModal}
      onClose={() => setShowUpdateModal(false)}
      initialUpdateInfo={updateModalState.info}
      initialDownloadProgress={updateModalState.progress}
      initialIsDownloaded={updateModalState.isDownloaded}
      initialIsDownloading={updateModalState.isDownloading}
      initialErrorMessage={updateModalState.errorMessage}
    />
  );

  if (!configReady || authLoading) {
    return (
      <>
        <div className="app">
          <div className="auth-loading">
            <div className="loading-spinner"></div>
            <p>로그인 상태를 확인하고 있습니다.</p>
          </div>
        </div>
        {updateModalElement}
      </>
    );
  }

  if (showUnauthorized) {
    return (
      <>
        <UnauthorizedPage onBackToLogin={() => setShowUnauthorized(false)} />
        {updateModalElement}
      </>
    );
  }

  if (!user) {
    return (
      <>
        <LoginPage
          onLoginSuccess={setUser}
          onUnauthorized={() => setShowUnauthorized(true)}
        />
        {updateModalElement}
      </>
    );
  }

  return (
    <Router>
      <NavigationListener />
      <AppShell user={user} />
      {updateModalElement}
    </Router>
  );
}

function AppRouter() {
  useEffect(() => {
    const isElectron = window.electron && window.electron.isElectron;
    if (!isElectron) {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><h1>이 앱은 APS 관리자 프로그램에서만 실행할 수 있습니다.</h1></div>';
      throw new Error('이 앱은 Electron 환경에서만 실행할 수 있습니다.');
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {isWindowRoute() ? <WindowRoutes /> : <AppContent />}
    </QueryClientProvider>
  );
}

export default AppRouter;
