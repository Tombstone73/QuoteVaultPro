-- V2 invoice email delivery is an integration concern, separate from Billing
-- state. Jobs model provider messages because one recipient may receive a
-- bounded group of invoices in a single email.

INSERT INTO v2_permission_capabilities(id,module,label)
VALUES ('invoice.send','billing','Send Invoice email') ON CONFLICT(id) DO NOTHING;

INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,'invoice.send' FROM v2_permission_set_templates
WHERE template_key IN ('owner','administrator','sales') ON CONFLICT DO NOTHING;

INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
SELECT organization_id,id,'invoice.send' FROM v2_permission_sets
WHERE source_template_key IN ('owner','administrator','sales') ON CONFLICT DO NOTHING;

CREATE TABLE v2_invoice_email_delivery_batches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_request_id varchar NOT NULL,
  requested_invoice_count integer NOT NULL,
  queued_invoice_count integer NOT NULL DEFAULT 0,
  queued_message_count integer NOT NULL DEFAULT 0,
  skipped_invoice_count integer NOT NULL DEFAULT 0,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(160) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_invoice_email_delivery_batches_count_chk CHECK (requested_invoice_count >= 0 AND queued_invoice_count >= 0 AND queued_message_count >= 0 AND skipped_invoice_count >= 0),
  CONSTRAINT v2_invoice_email_delivery_batches_result_object_chk CHECK (jsonb_typeof(result_json)='object'),
  CONSTRAINT v2_invoice_email_delivery_batches_request_uidx UNIQUE (organization_id,business_request_id)
);

CREATE TABLE v2_invoice_email_delivery_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id varchar NOT NULL REFERENCES v2_invoice_email_delivery_batches(id) ON DELETE RESTRICT,
  recipient_email varchar(320) NOT NULL,
  recipient_normalized varchar(320) NOT NULL,
  logical_send_key varchar(96) NOT NULL,
  state varchar(24) NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_by varchar(180),
  lease_expires_at timestamptz,
  provider_message_id varchar(255),
  last_error varchar(1000),
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_invoice_email_delivery_jobs_state_chk CHECK (state IN ('queued','processing','retry_wait','sent','failed','ambiguous')),
  CONSTRAINT v2_invoice_email_delivery_jobs_recipient_chk CHECK (recipient_normalized = lower(btrim(recipient_email)) AND recipient_normalized <> ''),
  CONSTRAINT v2_invoice_email_delivery_jobs_lease_chk CHECK ((state='processing' AND claimed_by IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state <> 'processing' AND claimed_by IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT v2_invoice_email_delivery_jobs_send_time_chk CHECK ((state='sent' AND provider_message_id IS NOT NULL AND sent_at IS NOT NULL AND completed_at IS NOT NULL) OR (state <> 'sent')),
  CONSTRAINT v2_invoice_email_delivery_jobs_logical_uidx UNIQUE (organization_id,logical_send_key)
);

CREATE TABLE v2_invoice_email_delivery_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id varchar NOT NULL REFERENCES v2_invoice_email_delivery_jobs(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_invoice_email_delivery_items_job_invoice_uidx UNIQUE (job_id,invoice_id),
  CONSTRAINT v2_invoice_email_delivery_items_invoice_tenant_fk FOREIGN KEY (invoice_id,organization_id) REFERENCES v2_billing_invoices(id,organization_id) ON DELETE RESTRICT
);

-- This tenant-scoped clock makes configured message spacing effective even
-- when multiple Railway replicas are running the same worker.
CREATE TABLE v2_invoice_email_delivery_rate_limits (
  organization_id varchar PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  next_available_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX v2_invoice_email_delivery_jobs_claim_idx
  ON v2_invoice_email_delivery_jobs(available_at,created_at)
  WHERE state IN ('queued','retry_wait','processing');
CREATE INDEX v2_invoice_email_delivery_jobs_org_state_idx
  ON v2_invoice_email_delivery_jobs(organization_id,state,updated_at DESC);
CREATE INDEX v2_invoice_email_delivery_items_invoice_idx
  ON v2_invoice_email_delivery_items(organization_id,invoice_id,created_at DESC);
