-- Email mail-client backend fields and support tables.

ALTER TABLE email_inquiries
  ADD COLUMN IF NOT EXISTS bcc_emails TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS folder_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS folder_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS read_state VARCHAR(20) DEFAULT 'unread',
  ADD COLUMN IF NOT EXISTS response_state VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS flag_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS starred BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS provider_deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_provider_sync_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS provider_raw JSONB DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_inquiries_read_state_check'
  ) THEN
    ALTER TABLE email_inquiries
      ADD CONSTRAINT email_inquiries_read_state_check
      CHECK (read_state IN ('unread', 'read'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_inquiries_response_state_check'
  ) THEN
    ALTER TABLE email_inquiries
      ADD CONSTRAINT email_inquiries_response_state_check
      CHECK (response_state IN ('pending', 'responded'));
  END IF;
END $$;

UPDATE email_inquiries
SET
  read_state = CASE WHEN status = 'unread' THEN 'unread' ELSE 'read' END,
  response_state = CASE WHEN status = 'responded' THEN 'responded' ELSE 'pending' END,
  folder_type = CASE WHEN is_outgoing THEN 'sent' ELSE 'inbox' END,
  folder_name = CASE WHEN is_outgoing THEN 'Sent' ELSE 'Inbox' END,
  labels = COALESCE(labels, '[]'::jsonb),
  provider_raw = COALESCE(provider_raw, '{}'::jsonb)
WHERE read_state IS NULL
   OR response_state IS NULL
   OR folder_type IS NULL
   OR folder_name IS NULL
   OR labels IS NULL
   OR provider_raw IS NULL;

UPDATE email_inquiries
SET
  read_state = CASE WHEN status = 'unread' THEN 'unread' ELSE 'read' END,
  response_state = CASE WHEN status = 'responded' THEN 'responded' ELSE 'pending' END
WHERE status IN ('unread', 'read', 'responded')
  AND (
    read_state IS DISTINCT FROM CASE WHEN status = 'unread' THEN 'unread' ELSE 'read' END
    OR response_state IS DISTINCT FROM CASE WHEN status = 'responded' THEN 'responded' ELSE 'pending' END
  );

CREATE TABLE IF NOT EXISTS email_folders (
  folder_id VARCHAR(100) PRIMARY KEY,
  folder_name VARCHAR(120) NOT NULL,
  folder_type VARCHAR(30) DEFAULT 'custom',
  path TEXT,
  unread_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  provider_raw JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_labels (
  label_id VARCHAR(100) PRIMARY KEY,
  label_name VARCHAR(120) NOT NULL,
  color VARCHAR(50),
  provider_raw JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_drafts (
  id SERIAL PRIMARY KEY,
  provider_draft_id VARCHAR(255),
  original_email_id INTEGER REFERENCES email_inquiries(id) ON DELETE SET NULL,
  to_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  cc_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  bcc_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  subject VARCHAR(500),
  body_text TEXT,
  body_html TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'sent', 'deleted')),
  provider_raw JSONB DEFAULT '{}'::jsonb,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scheduled_emails (
  id SERIAL PRIMARY KEY,
  provider_schedule_id VARCHAR(255),
  original_email_id INTEGER REFERENCES email_inquiries(id) ON DELETE SET NULL,
  to_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  cc_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  bcc_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  subject VARCHAR(500),
  body_text TEXT,
  body_html TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  scheduled_at TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'scheduled',
  sent_email_id INTEGER REFERENCES email_inquiries(id) ON DELETE SET NULL,
  provider_raw JSONB DEFAULT '{}'::jsonb,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE scheduled_emails
  DROP CONSTRAINT IF EXISTS scheduled_emails_status_check;

ALTER TABLE scheduled_emails
  ADD CONSTRAINT scheduled_emails_status_check
  CHECK (status IN ('scheduled', 'processing', 'sent', 'cancelled', 'failed'));

CREATE TABLE IF NOT EXISTS email_provider_operations (
  id SERIAL PRIMARY KEY,
  operation_type VARCHAR(50) NOT NULL,
  target_type VARCHAR(30) NOT NULL DEFAULT 'message',
  target_id VARCHAR(255) NOT NULL,
  provider VARCHAR(20) NOT NULL DEFAULT 'zoho',
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
  request_payload JSONB DEFAULT '{}'::jsonb,
  response_payload JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO email_folders (folder_id, folder_name, folder_type, total_count, unread_count, provider_raw)
SELECT
  COALESCE(folder_id, CASE WHEN is_outgoing THEN 'sent-local' ELSE 'inbox-local' END),
  CASE WHEN is_outgoing THEN 'Sent' ELSE 'Inbox' END,
  CASE WHEN is_outgoing THEN 'sent' ELSE 'inbox' END,
  COUNT(*)::int,
  COUNT(*) FILTER (WHERE COALESCE(read_state, 'unread') = 'unread')::int,
  '{}'::jsonb
FROM email_inquiries
GROUP BY 1, 2, 3
ON CONFLICT (folder_id) DO UPDATE SET
  total_count = EXCLUDED.total_count,
  unread_count = EXCLUDED.unread_count,
  updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_email_inquiries_folder_type ON email_inquiries(folder_type);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_read_state ON email_inquiries(read_state);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_response_state ON email_inquiries(response_state);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_starred ON email_inquiries(starred);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_labels_gin ON email_inquiries USING GIN(labels);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_archived_at ON email_inquiries(archived_at);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_trashed_at ON email_inquiries(trashed_at);
CREATE INDEX IF NOT EXISTS idx_email_inquiries_provider_deleted_at ON email_inquiries(provider_deleted_at);
CREATE INDEX IF NOT EXISTS idx_email_folders_type ON email_folders(folder_type);
CREATE INDEX IF NOT EXISTS idx_email_labels_name ON email_labels(label_name);
CREATE INDEX IF NOT EXISTS idx_email_drafts_status ON email_drafts(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_status ON scheduled_emails(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_scheduled_at ON scheduled_emails(scheduled_at);

ALTER TABLE email_drafts
  DROP CONSTRAINT IF EXISTS email_drafts_status_check;

ALTER TABLE email_drafts
  ADD CONSTRAINT email_drafts_status_check
  CHECK (status IN ('draft', 'processing', 'sent', 'deleted'));
CREATE INDEX IF NOT EXISTS idx_email_provider_operations_target ON email_provider_operations(target_type, target_id);
