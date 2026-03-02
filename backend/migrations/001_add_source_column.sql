-- Migration: Add source column to email_inquiries table
-- Purpose: Support multiple email sources (Gmail, ZOHO Mail)
-- Date: 2025-12-19

-- NOTE: This migration is no longer needed as source column is now created in 000_create_email_inquiries_table.sql
-- Keeping this file for historical reference, but it will be skipped

-- No-op query to avoid errors
SELECT 1 WHERE FALSE;
