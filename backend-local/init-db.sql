-- APS Admin PostgreSQL Database Schema
-- 생성일: 2025-12-11

-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. Users Table (사용자 정보)
-- ============================================
CREATE TABLE users (
  email VARCHAR(255) PRIMARY KEY,
  display_name VARCHAR(255),
  provider VARCHAR(50) DEFAULT 'local',  -- 'local' | 'google' | 'naver'
  password_hash VARCHAR(255),  -- bcrypt hash (local auth only)
  role VARCHAR(50) DEFAULT 'user',  -- 'admin' | 'user'
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- Firestore 동기화 시간
);

CREATE INDEX idx_users_active ON users(active);
CREATE INDEX idx_users_role ON users(role);

-- ============================================
-- 2. Email Inquiries Table (이메일 문의 - Gmail API)
-- ============================================
CREATE TABLE email_inquiries (
  id VARCHAR(255) PRIMARY KEY,  -- Gmail message ID
  subject VARCHAR(500),  -- 이메일 제목
  from_email VARCHAR(255) NOT NULL,  -- 발신자 이메일
  from_name VARCHAR(255),  -- 발신자 이름
  body_text TEXT,  -- 본문 (일반 텍스트)
  body_html TEXT,  -- 본문 (HTML)
  attachments JSONB,  -- 첨부파일 메타데이터 [{filename, mimeType, size, url}]
  received_at TIMESTAMP NOT NULL,  -- 이메일 수신 시간
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- 로컬 동기화 시간
  checked BOOLEAN DEFAULT false,
  checked_by VARCHAR(255) REFERENCES users(email),
  checked_at TIMESTAMP,
  notes TEXT,  -- 관리자 메모
  labels JSONB,  -- Gmail 라벨
  thread_id VARCHAR(255)  -- Gmail 스레드 ID (대화 추적)
);

CREATE INDEX idx_email_inquiries_checked ON email_inquiries(checked);
CREATE INDEX idx_email_inquiries_received_at ON email_inquiries(received_at DESC);
CREATE INDEX idx_email_inquiries_from_email ON email_inquiries(from_email);
CREATE INDEX idx_email_inquiries_thread_id ON email_inquiries(thread_id);

-- ============================================
-- 3. Web Form Inquiries Table (웹 상담폼 문의 - Firestore)
-- ============================================
CREATE TABLE web_form_inquiries (
  id VARCHAR(255) PRIMARY KEY,  -- Firestore document ID
  name VARCHAR(255) NOT NULL,  -- 문의자 이름
  email VARCHAR(255),  -- 문의자 이메일 (선택)
  phone VARCHAR(50) NOT NULL,  -- 문의자 전화번호
  consultation_type VARCHAR(100),  -- 상담 유형 (예: 비자, 이민, 기타)
  content TEXT NOT NULL,  -- 문의 내용
  preferred_contact VARCHAR(50),  -- 선호 연락 방법 ('email' | 'phone' | 'kakao')
  consent_privacy BOOLEAN DEFAULT false,  -- 개인정보 동의
  created_at TIMESTAMP NOT NULL,  -- Firestore createdAt
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- 로컬 동기화 시간
  checked BOOLEAN DEFAULT false,
  checked_by VARCHAR(255) REFERENCES users(email),
  checked_at TIMESTAMP,
  notes TEXT,  -- 관리자 메모
  ip_address VARCHAR(45),  -- 접속 IP (보안/스팸 방지)
  user_agent TEXT  -- 브라우저 정보
);

CREATE INDEX idx_web_inquiries_checked ON web_form_inquiries(checked);
CREATE INDEX idx_web_inquiries_created_at ON web_form_inquiries(created_at DESC);
CREATE INDEX idx_web_inquiries_email ON web_form_inquiries(email);
CREATE INDEX idx_web_inquiries_phone ON web_form_inquiries(phone);
CREATE INDEX idx_web_inquiries_type ON web_form_inquiries(consultation_type);

-- ============================================
-- 3. Memos Table (팀 메모 - 로컬 전용)
-- ============================================
CREATE TABLE memos (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  important BOOLEAN DEFAULT false,
  author VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expire_date DATE DEFAULT CURRENT_DATE,  -- 만료일 (기본: 당일)
  deleted_at TIMESTAMP  -- Soft delete
);

CREATE INDEX idx_memos_created_at ON memos(created_at DESC);
CREATE INDEX idx_memos_author ON memos(author);
CREATE INDEX idx_memos_expire_date ON memos(expire_date);
CREATE INDEX idx_memos_important ON memos(important);
CREATE INDEX idx_memos_deleted_at ON memos(deleted_at);  -- Soft delete 조회용

-- Full-text search index for memos
CREATE INDEX idx_memos_search ON memos USING gin(to_tsvector('simple', title || ' ' || content));

-- ============================================
-- 4. Schedules Table (일정 - 로컬 전용)
-- ============================================
CREATE TABLE schedules (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  time VARCHAR(10),  -- 'HH:MM' format
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,  -- 기간 설정 (단일 날짜면 start_date = end_date)
  type VARCHAR(20) NOT NULL,  -- 'company' | 'personal'
  author VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP  -- Soft delete
);

CREATE INDEX idx_schedules_start_date ON schedules(start_date);
CREATE INDEX idx_schedules_end_date ON schedules(end_date);
CREATE INDEX idx_schedules_author ON schedules(author);
CREATE INDEX idx_schedules_type ON schedules(type);
CREATE INDEX idx_schedules_deleted_at ON schedules(deleted_at);

-- ============================================
-- 5. Sync Status Table (동기화 상태 추적)
-- ============================================
CREATE TABLE sync_status (
  id SERIAL PRIMARY KEY,
  source_type VARCHAR(50) NOT NULL,  -- 'gmail' | 'web_form_firestore'
  last_sync_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_synced_id VARCHAR(255),  -- 마지막으로 동기화된 ID
  status VARCHAR(50) DEFAULT 'idle',  -- 'idle' | 'syncing' | 'error'
  error_message TEXT,
  synced_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX idx_sync_status_source ON sync_status(source_type);

-- ============================================
-- Functions and Triggers
-- ============================================

-- Updated_at 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Users 테이블 updated_at 트리거
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Memos 테이블 updated_at 트리거
CREATE TRIGGER update_memos_updated_at
  BEFORE UPDATE ON memos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Schedules 테이블 updated_at 트리거
CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Initial Data
-- ============================================
INSERT INTO sync_status (source_type, status) VALUES
  ('gmail', 'idle'),
  ('web_form_firestore', 'idle');

-- ============================================
-- Views (편의 쿼리)
-- ============================================

-- 활성 메모만 조회 (만료되지 않고 삭제되지 않은 메모)
CREATE VIEW active_memos AS
SELECT *
FROM memos
WHERE deleted_at IS NULL
  AND expire_date >= CURRENT_DATE
ORDER BY created_at DESC;

-- 활성 일정만 조회 (삭제되지 않은 일정)
CREATE VIEW active_schedules AS
SELECT *
FROM schedules
WHERE deleted_at IS NULL
ORDER BY start_date DESC, time;

-- 미처리 이메일 문의
CREATE VIEW unchecked_email_inquiries AS
SELECT *
FROM email_inquiries
WHERE checked = false
ORDER BY received_at DESC;

-- 미처리 웹 폼 문의
CREATE VIEW unchecked_web_inquiries AS
SELECT *
FROM web_form_inquiries
WHERE checked = false
ORDER BY created_at DESC;

-- 통합 미처리 문의 조회 (UNION)
CREATE VIEW all_unchecked_inquiries AS
SELECT
  'email' AS inquiry_type,
  id,
  from_name AS customer_name,
  from_email AS customer_email,
  NULL AS phone,
  subject AS title,
  body_text AS content,
  received_at AS inquiry_date,
  checked,
  checked_by,
  checked_at
FROM email_inquiries
WHERE checked = false
UNION ALL
SELECT
  'web_form' AS inquiry_type,
  id,
  name AS customer_name,
  email AS customer_email,
  phone,
  consultation_type AS title,
  content,
  created_at AS inquiry_date,
  checked,
  checked_by,
  checked_at
FROM web_form_inquiries
WHERE checked = false
ORDER BY inquiry_date DESC;

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE users IS '사용자 정보 (관리자 계정)';
COMMENT ON TABLE email_inquiries IS '이메일 문의 (Gmail API 폴링)';
COMMENT ON TABLE web_form_inquiries IS '웹 상담폼 문의 (Firestore 폴링)';
COMMENT ON TABLE memos IS '팀 메모 (로컬 전용)';
COMMENT ON TABLE schedules IS '일정 (로컬 전용)';
COMMENT ON TABLE sync_status IS '동기화 상태 추적 (Gmail, Firestore)';
