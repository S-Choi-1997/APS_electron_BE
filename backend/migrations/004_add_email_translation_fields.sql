-- Migration: Add precomputed email translation fields
-- Purpose: Store Korean AI translations for non-Korean email inquiries

ALTER TABLE email_inquiries
  ADD COLUMN IF NOT EXISTS detected_language VARCHAR(32),
  ADD COLUMN IF NOT EXISTS translation_status VARCHAR(20) DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS translated_subject TEXT,
  ADD COLUMN IF NOT EXISTS translated_body_text TEXT,
  ADD COLUMN IF NOT EXISTS translation_model VARCHAR(120),
  ADD COLUMN IF NOT EXISTS translation_error TEXT,
  ADD COLUMN IF NOT EXISTS translated_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_inquiries_translation_status_check'
  ) THEN
    ALTER TABLE email_inquiries
      ADD CONSTRAINT email_inquiries_translation_status_check
      CHECK (translation_status IN ('not_required', 'pending', 'completed', 'failed', 'disabled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_inquiries_translation_status
  ON email_inquiries(translation_status);
