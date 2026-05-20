import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import './ToastNotificationWindow.css';

const DEFAULT_DURATION_MS = 5000;
const FADE_OUT_MS = 500;

function parseDuration(value) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DURATION_MS;
}

function ToastNotificationWindow() {
  const [searchParams] = useSearchParams();
  const [isClosing, setIsClosing] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const closeTimerRef = useRef(null);
  const closeDelayRef = useRef(null);
  const searchKey = searchParams.toString();

  const notification = useMemo(() => {
    const params = new URLSearchParams(searchKey);
    return {
      icon: params.get('icon') || '🔔',
      title: params.get('title') || '알림',
      message: params.get('message') || '새로운 알림이 도착했습니다.',
      route: params.get('route') || '',
      duration: parseDuration(params.get('duration')),
    };
  }, [searchKey]);

  const clearTimers = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (closeDelayRef.current) {
      clearTimeout(closeDelayRef.current);
      closeDelayRef.current = null;
    }
  }, []);

  const closeNotification = useCallback(() => {
    if (isClosing) return;

    setIsClosing(true);
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    closeDelayRef.current = setTimeout(() => {
      if (window.electron?.closeNotification) {
        window.electron.closeNotification();
      } else {
        window.close();
      }
    }, FADE_OUT_MS);
  }, [isClosing]);

  useEffect(() => {
    document.body.classList.add('toast-window-body');
    return () => {
      document.body.classList.remove('toast-window-body');
      clearTimers();
    };
  }, [clearTimers]);

  useEffect(() => {
    console.log('[Toast] Notification displayed:', notification);
  }, [notification]);

  useEffect(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (!isHovering && !isClosing) {
      closeTimerRef.current = setTimeout(() => {
        closeNotification();
      }, notification.duration);
    }

    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [closeNotification, isClosing, isHovering, notification.duration]);

  const navigateToRoute = useCallback(() => {
    if (notification.route && window.electron?.navigateFromNotification) {
      window.electron.navigateFromNotification(notification.route);
    }
    closeNotification();
  }, [closeNotification, notification.route]);

  const handleMouseEnter = () => {
    setIsHovering(true);
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
  };

  return (
    <div
      className={`toast-container${isClosing ? ' fade-out' : ''}`}
      onClick={navigateToRoute}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        className="toast-window-close-btn"
        type="button"
        aria-label="알림 닫기"
        onClick={(event) => {
          event.stopPropagation();
          closeNotification();
        }}
      >
        ×
      </button>

      <div className="toast-window-header">
        <span className="toast-window-icon">{notification.icon}</span>
        <span className="toast-window-title">{notification.title}</span>
      </div>

      <div className="toast-window-message">
        {notification.message}
      </div>
    </div>
  );
}

export default ToastNotificationWindow;
