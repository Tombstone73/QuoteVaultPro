-- Customer statements preserve a frozen canonical projection for queued email
-- delivery. The durable queue remains the existing email queue; this migration
-- only adds a typed statement target alongside invoice targets.
CREATE TABLE IF NOT EXISTS customer_statement_snapshots (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  idempotency_key varchar(255) NOT NULL,
  statement_date varchar(10) NOT NULL,
  payload jsonb NOT NULL,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_statement_snapshots_customer_idx ON customer_statement_snapshots (organization_id, customer_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS customer_statement_snapshots_org_idempotency_uidx ON customer_statement_snapshots (organization_id, idempotency_key);

CREATE TABLE IF NOT EXISTS customer_statement_email_logs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  statement_snapshot_id varchar NOT NULL REFERENCES customer_statement_snapshots(id) ON DELETE RESTRICT,
  recipient_email text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'sent',
  message_id text,
  sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_statement_email_logs_snapshot_idx ON customer_statement_email_logs (organization_id, statement_snapshot_id, sent_at);

ALTER TABLE invoice_email_delivery_jobs ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE invoice_email_delivery_jobs ADD COLUMN IF NOT EXISTS delivery_type varchar(40) NOT NULL DEFAULT 'invoice';
ALTER TABLE invoice_email_delivery_jobs ADD COLUMN IF NOT EXISTS customer_statement_snapshot_id varchar REFERENCES customer_statement_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE invoice_email_delivery_jobs DROP CONSTRAINT IF EXISTS invoice_email_delivery_jobs_target_check;
ALTER TABLE invoice_email_delivery_jobs ADD CONSTRAINT invoice_email_delivery_jobs_target_check CHECK (
  (delivery_type = 'invoice' AND invoice_id IS NOT NULL AND customer_statement_snapshot_id IS NULL)
  OR (delivery_type = 'customer_statement' AND invoice_id IS NULL AND customer_statement_snapshot_id IS NOT NULL)
);
DROP INDEX IF EXISTS invoice_email_delivery_jobs_active_guard_uidx;
CREATE UNIQUE INDEX invoice_email_delivery_jobs_active_guard_uidx ON invoice_email_delivery_jobs
  (organization_id, delivery_type, coalesce(invoice_id, ''), coalesce(customer_statement_snapshot_id, ''), recipient_key, invoice_version)
  WHERE status IN ('queued', 'processing', 'retrying', 'needs_review');
