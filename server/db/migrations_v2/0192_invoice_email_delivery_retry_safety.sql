-- Invoice email retries must distinguish a proven pre-provider failure from
-- an uncertain provider outcome.  A terminal, retry-safe failure may create a
-- later delivery attempt; an uncertain outcome must keep blocking sends to
-- prevent duplicate customer email.

ALTER TABLE invoice_email_delivery_jobs
  DROP CONSTRAINT IF EXISTS invoice_email_delivery_jobs_status_check;

ALTER TABLE invoice_email_delivery_jobs
  ADD CONSTRAINT invoice_email_delivery_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'retrying', 'sent', 'failed', 'needs_review', 'canceled'));

-- These historical rows were explicitly recorded as ambiguous by the first
-- queue implementation. Preserve their duplicate guard during the upgrade.
UPDATE invoice_email_delivery_jobs
SET status = 'needs_review',
    updated_at = now()
WHERE status = 'failed'
  AND (
    failure_reason ILIKE 'Needs review:%'
    OR failure_reason ILIKE 'Outcome requires review before retry%'
  );

-- The original full-history uniqueness keys prevented any safe, explicit
-- retry. Retain historical rows and replace them with a live delivery guard.
DROP INDEX IF EXISTS invoice_email_delivery_jobs_org_idempotency_uidx;
DROP INDEX IF EXISTS invoice_email_delivery_jobs_invoice_recipient_version_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_email_delivery_jobs_active_guard_uidx
  ON invoice_email_delivery_jobs (organization_id, invoice_id, recipient_key, invoice_version)
  WHERE status IN ('queued', 'processing', 'retrying', 'needs_review');
