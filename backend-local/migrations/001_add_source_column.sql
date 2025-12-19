-- Migration: Add source column to email_inquiries table
-- Purpose: Support multiple email sources (Gmail, ZOHO Mail)
-- Date: 2025-12-19

-- Add source column with default value 'gmail' and CHECK constraint
ALTER TABLE email_inquiries
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'gmail'
CHECK (source IN ('gmail', 'zoho'));

-- Create index for faster filtering by source
CREATE INDEX IF NOT EXISTS idx_email_inquiries_source ON email_inquiries(source);

-- Add comment to document the column
COMMENT ON COLUMN email_inquiries.source IS 'Email source: gmail or zoho';
