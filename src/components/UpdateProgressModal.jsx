/**
 * UpdateProgressModal.jsx - 업데이트 다운로드 진행 모달
 *
 * Main Process에서 전달되는 업데이트 관련 이벤트를 표시
 * - update-available: 업데이트 발견 (확인 화면)
 * - update-download-progress: 다운로드 진행 중
 * - update-downloaded: 다운로드 완료
 */

import { useState, useEffect } from 'react';
import './UpdateProgressModal.css';

function UpdateProgressModal({ isVisible, onClose }) {
  const [updateInfo, setUpdateInfo] = useState(null); // { version, releaseNotes }
  const [downloadProgress, setDownloadProgress] = useState(null); // { percent, bytesPerSecond, transferred, total }
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false); // 다운로드 시작 여부
  const [estimatedTimeLeft, setEstimatedTimeLeft] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null); // 에러 메시지

  useEffect(() => {
    if (!window.electron) return;

    // 업데이트 발견 이벤트
    const cleanupAvailable = window.electron.onUpdateAvailable?.((info) => {
      console.log('[UpdateModal] Update available:', info);
      setUpdateInfo(info);
      setIsDownloaded(false);
      setIsDownloading(false);
      setDownloadProgress(null);
    });

    // 다운로드 진행 이벤트
    const cleanupProgress = window.electron.onUpdateDownloadProgress?.((progress) => {
      console.log('[UpdateModal] Download progress:', progress.percent);
      setDownloadProgress(progress);
      setIsDownloading(true);

      // 남은 시간 계산
      if (progress.bytesPerSecond && progress.total && progress.transferred) {
        const remaining = progress.total - progress.transferred;
        const secondsLeft = remaining / progress.bytesPerSecond;
        setEstimatedTimeLeft(secondsLeft);
      }
    });

    // 다운로드 완료 이벤트
    const cleanupDownloaded = window.electron.onUpdateDownloaded?.((info) => {
      console.log('[UpdateModal] Update downloaded:', info);
      setIsDownloaded(true);
      setIsDownloading(false);
      setDownloadProgress({ percent: 100, transferred: 0, total: 0 });
      setErrorMessage(null);
    });

    // 업데이트 에러 이벤트
    const cleanupError = window.electron.onUpdateError?.((error) => {
      console.error('[UpdateModal] Update error:', error);
      setErrorMessage(error?.message || '업데이트 중 오류가 발생했습니다.');
      setIsDownloading(false);
    });

    return () => {
      cleanupAvailable?.();
      cleanupProgress?.();
      cleanupDownloaded?.();
      cleanupError?.();
    };
  }, []);

  // 다운로드 시작 핸들러
  const handleStartDownload = async () => {
    setIsDownloading(true);
    setErrorMessage(null);
    try {
      await window.electron?.downloadUpdate?.();
    } catch (error) {
      console.error('[UpdateModal] Download failed:', error);
      setIsDownloading(false);
      setErrorMessage(error?.message || '다운로드 시작에 실패했습니다.');
    }
  };

  // 다시 시도 핸들러
  const handleRetry = () => {
    setErrorMessage(null);
    handleStartDownload();
  };

  if (!isVisible || !updateInfo) {
    return null;
  }

  // 에러 상태
  if (errorMessage) {
    return (
      <div className="update-modal-overlay">
        <div className="update-modal">
          <div className="update-modal-header">
            <h2>업데이트 오류</h2>
          </div>
          <div className="update-modal-body">
            <div className="update-icon error">✕</div>
            <p className="update-message">
              업데이트 중 오류가 발생했습니다.
            </p>
            <p className="update-submessage">
              {errorMessage}
            </p>
          </div>
          <div className="update-modal-footer">
            <button className="btn-secondary" onClick={onClose}>
              닫기
            </button>
            <button className="btn-primary" onClick={handleRetry}>
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 다운로드 완료 상태
  if (isDownloaded) {
    return (
      <div className="update-modal-overlay">
        <div className="update-modal">
          <div className="update-modal-header">
            <h2>업데이트 준비 완료</h2>
          </div>
          <div className="update-modal-body">
            <div className="update-icon success">✓</div>
            <p className="update-message">
              버전 <strong>{updateInfo.version}</strong> 다운로드가 완료되었습니다.
            </p>
            <p className="update-submessage">
              지금 재시작하여 업데이트를 적용하시겠습니까?
            </p>
          </div>
          <div className="update-modal-footer">
            <button className="btn-secondary" onClick={onClose}>
              나중에
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                window.electron?.installUpdate?.();
              }}
            >
              지금 재시작
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 다운로드 중 상태
  if (isDownloading && downloadProgress) {
    const percent = Math.floor(downloadProgress.percent || 0);
    const transferred = formatBytes(downloadProgress.transferred || 0);
    const total = formatBytes(downloadProgress.total || 0);
    const speed = formatSpeed(downloadProgress.bytesPerSecond || 0);
    const timeLeft = formatTimeLeft(estimatedTimeLeft);

    return (
      <div className="update-modal-overlay">
        <div className="update-modal">
          <div className="update-modal-header">
            <h2>업데이트 다운로드 중...</h2>
          </div>
          <div className="update-modal-body">
            <div className="update-version">
              v{updateInfo.version} 다운로드 중
            </div>

            {/* 진행률 바 */}
            <div className="progress-bar-container">
              <div className="progress-bar-bg">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="progress-percent">{percent}%</div>
            </div>

            {/* 다운로드 정보 */}
            <div className="download-stats">
              <div className="stat-row">
                <span className="stat-label">다운로드:</span>
                <span className="stat-value">{transferred} / {total}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">속도:</span>
                <span className="stat-value">{speed}</span>
              </div>
              {timeLeft && (
                <div className="stat-row">
                  <span className="stat-label">남은 시간:</span>
                  <span className="stat-value">{timeLeft}</span>
                </div>
              )}
            </div>
          </div>
          <div className="update-modal-footer">
            <button className="btn-secondary" onClick={onClose}>
              백그라운드에서 계속
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 다운로드 준비 중 (다운로드 시작했지만 progress 아직 없음)
  if (isDownloading && !downloadProgress) {
    return (
      <div className="update-modal-overlay">
        <div className="update-modal">
          <div className="update-modal-header">
            <h2>다운로드 준비 중...</h2>
          </div>
          <div className="update-modal-body">
            <div className="update-version">
              v{updateInfo.version}
            </div>
            <div className="update-message">
              다운로드를 시작하고 있습니다...
            </div>
            <div className="loading-spinner-container">
              <div className="loading-spinner"></div>
            </div>
          </div>
          <div className="update-modal-footer">
            <button className="btn-secondary" onClick={onClose}>
              백그라운드에서 계속
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 업데이트 발견 - 다운로드 확인 화면 (NEW!)
  return (
    <div className="update-modal-overlay">
      <div className="update-modal">
        <div className="update-modal-header">
          <h2>새 업데이트 발견</h2>
        </div>
        <div className="update-modal-body">
          <div className="update-icon info">!</div>
          <p className="update-message">
            새 버전 <strong>v{updateInfo.version}</strong>을 사용할 수 있습니다.
          </p>
          <p className="update-submessage">
            지금 다운로드하시겠습니까?
          </p>
          {updateInfo.releaseNotes && (
            <div className="release-notes">
              <p>{updateInfo.releaseNotes}</p>
            </div>
          )}
        </div>
        <div className="update-modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            나중에
          </button>
          <button className="btn-primary" onClick={handleStartDownload}>
            다운로드
          </button>
        </div>
      </div>
    </div>
  );
}

// 유틸리티 함수들
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond === 0) return '0 KB/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s'];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  return Math.round(bytesPerSecond / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatTimeLeft(seconds) {
  if (!seconds || seconds <= 0) return null;

  if (seconds < 60) {
    return `약 ${Math.ceil(seconds)}초`;
  } else if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return `약 ${minutes}분`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.ceil((seconds % 3600) / 60);
    return `약 ${hours}시간 ${minutes}분`;
  }
}

export default UpdateProgressModal;
