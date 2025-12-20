-- Migration: Add thread tracking and status fields to email_inquiries
-- Description: Adds fields for email threading (in_reply_to, references, thread_id),
--              outgoing email tracking (is_outgoing), and 3-tier status management (status)

-- Add thread-related fields
ALTER TABLE email_inquiries
  ADD COLUMN IF NOT EXISTS in_reply_to VARCHAR(255),
  ADD COLUMN IF NOT EXISTS references TEXT[],
  ADD COLUMN IF NOT EXISTS thread_id VARCHAR(255);

-- Add outgoing email flag
ALTER TABLE email_inquiries
  ADD COLUMN IF NOT EXISTS is_outgoing BOOLEAN DEFAULT false;

-- Add new status field (3-tier: unread, read, responded)
ALTER TABLE email_inquiries
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unread';

-- Add check constraint for status values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_inquiries_status_check'
  ) THEN
    ALTER TABLE email_inquiries
      ADD CONSTRAINT email_inquiries_status_check
      CHECK (status IN ('unread', 'read', 'responded'));
  END IF;
END$$;

-- Migrate existing check values to new status field
UPDATE email_inquiries
SET status = CASE
  WHEN "check" = true THEN 'read'
  ELSE 'unread'
END
WHERE status = 'unread'; -- Only update records that haven't been set yet

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_inquiries_status ON email_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_thread_id ON email_inquiries(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_in_reply_to ON email_inquiries(in_reply_to);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_is_outgoing ON email_inquiries(is_outgoing);

-- Note: The 'check' column is kept for backward compatibility
-- It can be removed in a future migration once all code is updated
