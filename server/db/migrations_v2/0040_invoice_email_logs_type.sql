-- Migration 0040: Add type column to invoice_email_logs
-- This distinguishes original invoice sends from reminder sends.
-- Without this, the reminder job writing to invoice_email_logs would falsely
-- mark invoices as "sent_current" even if the original invoice was never emailed.

ALTER TABLE invoice_email_logs
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'invoice_send';

CREATE INDEX IF NOT EXISTS invoice_email_logs_type_idx
  ON invoice_email_logs (organization_id, type, sent_at DESC);
