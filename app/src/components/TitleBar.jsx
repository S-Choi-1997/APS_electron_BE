import React from 'react';
import './css/TitleBar.css';

function TitleBar() {
  const handleMinimize = () => {
    if (window.electron) {
      window.electron.windowMinimize();
    }
  };

  const handleMaximize = () => {
    if (window.electron) {
      window.electron.windowMaximize();
    }
  };

  const handleClose = () => {
    if (window.electron) {
      window.electron.windowClose();
    }
  };

  return (
    <div className="app-titlebar">
      <div className="titlebar-drag-region">
        <div className="titlebar-title">APS Admin</div>
      </div>
      <div className="titlebar-window-controls">
        <button
          className="titlebar-control-btn minimize"
          onClick={handleMinimize}
          title="최소화"
        >
          −
        </button>
        <button
          className="titlebar-control-btn maximize"
          onClick={handleMaximize}
          title="최대화"
        >
          □
        </button>
        <button
          className="titlebar-control-btn close"
          onClick={handleClose}
          title="닫기"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
