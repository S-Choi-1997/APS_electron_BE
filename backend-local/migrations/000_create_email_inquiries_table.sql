-- Migration: Create email_inquiries table
-- Purpose: Store email consultations from Gmail and ZOHO Mail
-- Date: 2025-12-19

CREATE TABLE IF NOT EXISTS email_inquiries (
  id SERIAL PRIMARY KEY,

  -- Email identification
  message_id VARCHAR(255) UNIQUE NOT NULL,
  source VARCHAR(20) DEFAULT 'gmail' CHECK (source IN ('gmail', 'zoho')),

  -- Sender information
  from_email VARCHAR(255) NOT NULL,
  from_name VARCHAR(255),

  -- Recipient information
  to_email VARCHAR(255) NOT NULL,
  cc_emails TEXT[],

  -- Email content
  subject VARCHAR(500),
  body_text TEXT,
  body_html TEXT,

  -- Attachments
  has_attachments BOOLEAN DEFAULT false,

  -- Status
  "check" BOOLEAN DEFAULT false,

  -- Timestamps
  received_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_email_inquiries_source ON email_inquiries(source);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_check ON email_inquiries("check");
CREATE INDEX IF NOT EXISTS idx_email_inquiries_received_at ON email_inquiries(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_from_email ON email_inquiries(from_email);

-- Add comments
COMMENT ON TABLE email_inquiries IS 'Email consultation inquiries from Gmail and ZOHO Mail';
COMMENT ON COLUMN email_inquiries.message_id IS 'Unique message identifier from email provider';
COMMENT ON COLUMN email_inquiries.source IS 'Email source: gmail or zoho';
COMMENT ON COLUMN email_inquiries."check" IS 'Whether the inquiry has been reviewed';
