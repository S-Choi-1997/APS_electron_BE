import './Footer.css';

function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="aps-footer">
      <div className="footer-container">
        <div className="footer-left">
          <p className="copyright">© {currentYear} APS 컨설팅 · 이민/비자 행정업무 All rights reserved.</p>
        </div>
        <div className="footer-right">
          <p className="footer-text">상담 관리 서비스 v1.0</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
