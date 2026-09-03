-- Track provider acceptance and asynchronous delivery failures for outgoing mail.

ALTER TABLE email_inquiries
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivery_details JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_updated_at TIMESTAMP;

UPDATE email_inquiries
SET delivery_status = 'accepted',
    delivery_details = COALESCE(delivery_details, '{}'::jsonb),
    delivery_updated_at = COALESCE(delivery_updated_at, received_at)
WHERE is_outgoing = true
  AND delivery_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_inquiries_delivery_status_check'
  ) THEN
    ALTER TABLE email_inquiries
      ADD CONSTRAINT email_inquiries_delivery_status_check
      CHECK (delivery_status IS NULL OR delivery_status IN ('accepted', 'partial', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_inquiries_delivery_status
  ON email_inquiries(delivery_status)
  WHERE is_outgoing = true;
