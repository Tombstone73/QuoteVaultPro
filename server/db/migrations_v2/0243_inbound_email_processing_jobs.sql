-- Local durable work only. No mailbox activation, provider writes, or Order creation.
CREATE TABLE inbound_email_processing_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbound_record_id varchar NOT NULL REFERENCES inbound_order_records(id) ON DELETE CASCADE,
  evidence_fingerprint varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'processing', 'review_ready', 'needs_attention', 'failed', 'superseded')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token varchar,
  claim_expires_at timestamptz,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  error_code varchar(80),
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'processing') = (claim_token IS NOT NULL AND claim_expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX inbound_email_processing_evidence_uidx ON inbound_email_processing_jobs(organization_id, inbound_record_id, evidence_fingerprint);
CREATE INDEX inbound_email_processing_claim_idx ON inbound_email_processing_jobs(status, next_attempt_at, claim_expires_at);
CREATE INDEX inbound_email_processing_record_idx ON inbound_email_processing_jobs(organization_id, inbound_record_id);
