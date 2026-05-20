import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import './UpdateProgressModal.css';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const unit = 1024;
  const labels = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(unit)), labels.length - 1);
  return `${Math.round((bytes / Math.pow(unit, index)) * 100) / 100} ${labels[index]}`;
}

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond) return '0 KB/s';
  const unit = 1024;
  const labels = ['B/s', 'KB/s', 'MB/s'];
  const index = Math.min(Math.floor(Math.log(bytesPerSecond) / Math.log(unit)), labels.length - 1);
  return `${Math.round((bytesPerSecond / Math.pow(unit, index)) * 100) / 100} ${labels[index]}`;
}

function formatTimeLeft(seconds) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `약 ${Math.ceil(seconds)}초`;
  if (seconds < 3600) return `약 ${Math.ceil(seconds / 60)}분`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return `약 ${hours}시간 ${minutes}분`;
}

function UpdateProgressModal({
  isVisible,
  onClose,
  initialUpdateInfo = null,
  initialDownloadProgress = null,
  initialIsDownloaded = false,
  initialIsDownloading = false,
  initialErrorMessage = null,
}) {
  const [updateInfo, setUpdateInfo] = useState(initialUpdateInfo);
  const [downloadProgress, setDownloadProgress] = useState(initialDownloadProgress);
  const [isDownloaded, setIsDownloaded] = useState(initialIsDownloaded);
  const [isDownloading, setIsDownloading] = useState(initialIsDownloading);
  const [estimatedTimeLeft, setEstimatedTimeLeft] = useState(null);
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage);

  useEffect(() => {
    if (initialUpdateInfo) setUpdateInfo(initialUpdateInfo);
  }, [initialUpdateInfo]);

  useEffect(() => {
    if (!initialDownloadProgress) return;
    setDownloadProgress(initialDownloadProgress);
    setIsDownloading(true);
  }, [initialDownloadProgress]);

  useEffect(() => {
    setIsDownloaded(Boolean(initialIsDownloaded));
  }, [initialIsDownloaded]);

  useEffect(() => {
    setIsDownloading(Boolean(initialIsDownloading));
  }, [initialIsDownloading]);

  useEffect(() => {
    setErrorMessage(initialErrorMessage || null);
  }, [initialErrorMessage]);

  useEffect(() => {
    if (!window.electron) return undefined;

    const cleanupAvailable = window.electron.onUpdateAvailable?.((info) => {
      setUpdateInfo(info);
      setIsDownloaded(false);
      setIsDownloading(false);
      setDownloadProgress(null);
      setErrorMessage(null);
    });

    const cleanupProgress = window.electron.onUpdateDownloadProgress?.((progress) => {
      setDownloadProgress(progress);
      setIsDownloading(true);
      setErrorMessage(null);

      if (progress.bytesPerSecond && progress.total && progress.transferred) {
        const remaining = progress.total - progress.transferred;
        setEstimatedTimeLeft(remaining / progress.bytesPerSecond);
      }
    });

    const cleanupDownloaded = window.electron.onUpdateDownloaded?.((info) => {
      if (info?.version) {
        setUpdateInfo((previous) => previous || info);
      }
      setIsDownloaded(true);
      setIsDownloading(false);
      setDownloadProgress({ percent: 100, transferred: 0, total: 0 });
      setErrorMessage(null);
    });

    const cleanupError = window.electron.onUpdateError?.((error) => {
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

  const handleStartDownload = async () => {
    setIsDownloading(true);
    setErrorMessage(null);

    try {
      const result = await window.electron?.downloadUpdate?.();
      if (result && result.success === false) {
        throw new Error(result.error || '다운로드를 시작하지 못했습니다.');
      }
    } catch (error) {
      setIsDownloading(false);
      setErrorMessage(error?.message || '다운로드를 시작하지 못했습니다.');
    }
  };

  const handleRetry = () => {
    setErrorMessage(null);
    handleStartDownload();
  };

  if (!isVisible || (!updateInfo && !errorMessage)) {
    return null;
  }

  if (errorMessage) {
    return (
      <div className="update-modal-overlay">
        <div className="update-modal">
          <div className="update-modal-header">
            <h2>업데이트 오류</h2>
          </div>
          <div className="update-modal-body">
            <div className="update-icon error">!</div>
            <p className="update-message">업데이트 중 오류가 발생했습니다.</p>
            <p className="update-submessage">{errorMessage}</p>
          </div>
          <div className="update-modal-footer">
            <button className="btn-secondary" onClick={onClose} type="button">닫기</button>
            {updateInfo && (
              <button className="btn-primary" onClick={handleRetry} type="button">다시 시도</button>
            )}
          </div>
        </div>
      </div>
    );
  }

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
            <p className="update-submessage">지금 다시 시작하면 업데이트를 적용합니다.</p>
          </div>
          <div className="update-modal-footer">
            <button className="btn-secondary" onClick={onClose} type="button">나중에</button>
            <button className="btn-primary" onClick={() => window.electron?.installUpdate?.()} type="button">
              지금 다시 시작
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            <h2>업데이트 다운로드 중</h2>
          </div>
          <div className="update-modal-body">
            <div className="update-version">v{updateInfo.version}</div>
            <div className="progress-bar-container">
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="progress-percent">{percent}%</div>
            </div>
            <div className="download-stats">
              <div className="stat-row">
                <span className="stat-label">다운로드</span>
                <span className="stat-value">{transferred} / {total}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">속도</span>
                <span className="stat-value">{speed}</span>
              </div>
              {timeLeft && (
                <div className="stat-row">
                  <span className="stat-label">남은 시간</span>
                  <span className="stat-value">{timeLeft}</span>
                </div>
              )}
            </div>
          </div>
          <div className="update-modal-footer">
            <button className="btn-secondary" onClick={onClose} type="button">백그라운드에서 계속</button>
          </div>
        </div>
      </div>
    );
  }

  if (isDownloading && !downloadProgress) {
    return (
      <div className="update-modal-overlay">
        <div className="update-modal">
          <div className="update-modal-header">
            <h2>다운로드 준비 중</h2>
          </div>
          <div className="update-modal-body">
            <div className="update-version">v{updateInfo.version}</div>
            <p className="update-message">다운로드를 시작하고 있습니다.</p>
            <div className="loading-spinner-container">
              <div className="loading-spinner" />
            </div>
          </div>
          <div className="update-modal-footer">
            <button className="btn-secondary" onClick={onClose} type="button">백그라운드에서 계속</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="update-modal-overlay">
      <div className="update-modal">
        <div className="update-modal-header">
          <h2>업데이트 발견</h2>
        </div>
        <div className="update-modal-body">
          <div className="update-icon info">!</div>
          <p className="update-message">
            새 버전 <strong>v{updateInfo.version}</strong>을 사용할 수 있습니다.
          </p>
          <p className="update-submessage">지금 다운로드하시겠습니까?</p>
          {updateInfo.releaseNotes && (
            <div
              className="release-notes"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(updateInfo.releaseNotes) }}
            />
          )}
        </div>
        <div className="update-modal-footer">
          <button className="btn-secondary" onClick={onClose} type="button">나중에</button>
          <button className="btn-primary" onClick={handleStartDownload} type="button">다운로드</button>
        </div>
      </div>
    </div>
  );
}

export default UpdateProgressModal;
