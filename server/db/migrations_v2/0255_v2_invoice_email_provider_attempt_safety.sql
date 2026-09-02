-- External email delivery is not exactly-once. Persist the provider boundary
-- before calling Gmail so an interrupted worker attempt is held for operator
-- reconciliation instead of being silently lease-retried as a new send.
ALTER TABLE v2_invoice_email_delivery_jobs
  ADD COLUMN provider_attempted_at timestamptz;

-- Existing in-flight rows predate the durable marker. Treat them as uncertain
-- at rollout; this is conservative and prevents a possibly delivered message
-- from being duplicated by the upgraded worker.
UPDATE v2_invoice_email_delivery_jobs
SET state='ambiguous',
    provider_attempted_at=COALESCE(provider_attempted_at,now()),
    last_error=COALESCE(last_error,'Provider outcome is uncertain after an interrupted worker upgrade. Verify delivery before intentional retry.'),
    claimed_by=NULL,
    lease_expires_at=NULL,
    completed_at=now(),
    updated_at=now()
WHERE state='processing';
