-- APS Admin PostgreSQL Database Schema
-- Updated: 2025-12-21

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Email Inquiries Table
-- ============================================
CREATE TABLE IF NOT EXISTS email_inquiries (
  id SERIAL PRIMARY KEY,
  message_id VARCHAR(255) UNIQUE NOT NULL,
  folder_id VARCHAR(100),
  source VARCHAR(20) DEFAULT 'gmail' CHECK (source IN ('gmail', 'zoho')),
  from_email VARCHAR(255) NOT NULL,
  from_name VARCHAR(255),
  to_email VARCHAR(255) NOT NULL,
  cc_emails TEXT[],
  subject VARCHAR(500),
  body_text TEXT,
  body_html TEXT,
  has_attachments BOOLEAN DEFAULT false,
  "check" BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'responded')),
  in_reply_to VARCHAR(255),
  "references" TEXT[],
  thread_id VARCHAR(255),
  is_outgoing BOOLEAN DEFAULT false,
  received_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_inquiries_source ON email_inquiries(source);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_check ON email_inquiries("check");
CREATE INDEX IF NOT EXISTS idx_email_inquiries_status ON email_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_received_at ON email_inquiries(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_from_email ON email_inquiries(from_email);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_thread_id ON email_inquiries(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_in_reply_to ON email_inquiries(in_reply_to);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_is_outgoing ON email_inquiries(is_outgoing);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_folder_id ON email_inquiries(folder_id);

-- ============================================
-- Users Table (Synced from Firestore admins collection)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  email VARCHAR(255) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  provider VARCHAR(50) DEFAULT 'local',
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active BOOLEAN DEFAULT true,
  password_hash TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

-- ============================================
-- ZOHO OAuth Tokens Table
-- ============================================
CREATE TABLE IF NOT EXISTS zoho_oauth_tokens (
  id SERIAL PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type VARCHAR(50) DEFAULT 'Bearer',
  expires_at TIMESTAMP NOT NULL,
  zoho_email VARCHAR(255) NOT NULL,
  zoho_user_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(zoho_email)
);

CREATE INDEX IF NOT EXISTS idx_zoho_tokens_email ON zoho_oauth_tokens(zoho_email);
CREATE INDEX IF NOT EXISTS idx_zoho_tokens_expires_at ON zoho_oauth_tokens(expires_at);

-- ============================================
-- Refresh Tokens Table (JWT Auto-Login)
-- ============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_agent TEXT,
  ip_address VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_email ON refresh_tokens(email);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- ============================================
-- Memos Table
-- ============================================
CREATE TABLE IF NOT EXISTS memos (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  important BOOLEAN DEFAULT false,
  author VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expire_date DATE DEFAULT CURRENT_DATE,
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memos_created_at ON memos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memos_author ON memos(author);
CREATE INDEX IF NOT EXISTS idx_memos_expire_date ON memos(expire_date);
CREATE INDEX IF NOT EXISTS idx_memos_important ON memos(important);
CREATE INDEX IF NOT EXISTS idx_memos_deleted_at ON memos(deleted_at);

-- ============================================
-- Schedules Table
-- ============================================
CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  time VARCHAR(10),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  type VARCHAR(20) NOT NULL,
  author VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schedules_start_date ON schedules(start_date);
CREATE INDEX IF NOT EXISTS idx_schedules_end_date ON schedules(end_date);
CREATE INDEX IF NOT EXISTS idx_schedules_author ON schedules(author);
CREATE INDEX IF NOT EXISTS idx_schedules_type ON schedules(type);
CREATE INDEX IF NOT EXISTS idx_schedules_deleted_at ON schedules(deleted_at);

-- ============================================
-- Views
-- ============================================
CREATE OR REPLACE VIEW active_memos AS
SELECT * FROM memos
WHERE deleted_at IS NULL AND expire_date >= CURRENT_DATE
ORDER BY created_at DESC;

CREATE OR REPLACE VIEW active_schedules AS
SELECT * FROM schedules
WHERE deleted_at IS NULL
ORDER BY start_date DESC, time;
