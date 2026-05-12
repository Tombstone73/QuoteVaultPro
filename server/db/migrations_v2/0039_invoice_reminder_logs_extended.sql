ALTER TABLE invoice_reminder_logs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS message_id text,
  ADD COLUMN IF NOT EXISTS failure_reason text;

CREATE INDEX IF NOT EXISTS invoice_reminder_logs_org_sent_at_idx
  ON invoice_reminder_logs (organization_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS invoice_reminder_logs_status_idx
  ON invoice_reminder_logs (organization_id, invoice_id, status);
