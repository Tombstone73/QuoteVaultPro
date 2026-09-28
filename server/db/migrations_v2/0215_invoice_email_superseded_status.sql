-- Preserve all historical rows; extend only the terminal delivery outcomes.
ALTER TABLE invoice_email_delivery_jobs DROP CONSTRAINT IF EXISTS invoice_email_delivery_jobs_status_check;
ALTER TABLE invoice_email_delivery_jobs ADD CONSTRAINT invoice_email_delivery_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'retrying', 'sent', 'failed', 'needs_review', 'canceled', 'superseded'));
