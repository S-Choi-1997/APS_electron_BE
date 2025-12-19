-- Migration: Create zoho_oauth_tokens table
-- Purpose: Store ZOHO Mail OAuth 2.0 tokens for API access
-- Date: 2025-12-19

CREATE TABLE IF NOT EXISTS zoho_oauth_tokens (
  id SERIAL PRIMARY KEY,

  -- OAuth tokens
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type VARCHAR(50) DEFAULT 'Bearer',

  -- Token expiration
  expires_at TIMESTAMP NOT NULL,

  -- ZOHO account info
  zoho_email VARCHAR(255) NOT NULL,
  zoho_user_id VARCHAR(255),

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Ensure only one active token per email
  UNIQUE(zoho_email)
);

-- Create index for faster token lookup
CREATE INDEX IF NOT EXISTS idx_zoho_tokens_email ON zoho_oauth_tokens(zoho_email);
CREATE INDEX IF NOT EXISTS idx_zoho_tokens_expires_at ON zoho_oauth_tokens(expires_at);

-- Add comments
COMMENT ON TABLE zoho_oauth_tokens IS 'ZOHO Mail OAuth 2.0 access and refresh tokens';
COMMENT ON COLUMN zoho_oauth_tokens.access_token IS 'Current access token for ZOHO Mail API';
COMMENT ON COLUMN zoho_oauth_tokens.refresh_token IS 'Refresh token to obtain new access tokens';
COMMENT ON COLUMN zoho_oauth_tokens.expires_at IS 'Timestamp when access token expires';
