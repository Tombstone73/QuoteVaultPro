-- Durable, rate-limited invoice email delivery queue. Campaigns record a
-- single operator batch request; each job is one invoice-recipient outbound
-- message. This deliberately avoids grouped multi-invoice retries because the
-- canonical sender has one invoice PDF/audit record per message.

CREATE TABLE IF NOT EXISTS invoice_email_campaigns (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key varchar(255) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'completed_with_errors', 'failed', 'canceled')),
  requested_invoice_ids jsonb NOT NULL,
  selected_invoice_count integer NOT NULL CHECK (selected_invoice_count >= 0),
  queued_invoice_count integer NOT NULL DEFAULT 0 CHECK (queued_invoice_count >= 0),
  skipped_invoice_count integer NOT NULL DEFAULT 0 CHECK (skipped_invoice_count >= 0),
  recipient_group_count integer NOT NULL DEFAULT 0 CHECK (recipient_group_count >= 0),
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(requested_invoice_ids) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_email_campaigns_org_idempotency_uidx
  ON invoice_email_campaigns (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS invoice_email_campaigns_org_status_created_idx
  ON invoice_email_campaigns (organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS invoice_email_delivery_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id varchar NOT NULL REFERENCES invoice_email_campaigns(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_version integer NOT NULL CHECK (invoice_version > 0),
  recipient_email text NOT NULL,
  recipient_key text NOT NULL,
  idempotency_key varchar(255) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'retrying', 'sent', 'failed', 'canceled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claimed_by_worker_id varchar(128),
  provider_message_id text,
  failure_reason text,
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_email_delivery_jobs_org_idempotency_uidx
  ON invoice_email_delivery_jobs (organization_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_email_delivery_jobs_invoice_recipient_version_uidx
  ON invoice_email_delivery_jobs (organization_id, invoice_id, recipient_key, invoice_version);
CREATE INDEX IF NOT EXISTS invoice_email_delivery_jobs_claim_idx
  ON invoice_email_delivery_jobs (status, available_at, created_at)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS invoice_email_delivery_jobs_expired_claim_idx
  ON invoice_email_delivery_jobs (status, claim_expires_at)
  WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS invoice_email_delivery_jobs_org_campaign_idx
  ON invoice_email_delivery_jobs (organization_id, campaign_id);
