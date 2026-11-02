-- Durable provider identities, not email bodies or provider credentials.
CREATE TABLE public.inbound_email_import_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mailbox_id varchar NOT NULL REFERENCES inbound_email_mailboxes(id) ON DELETE CASCADE,
  provider varchar(40) NOT NULL,
  provider_account varchar(320) NOT NULL,
  work_kind varchar(16) NOT NULL DEFAULT 'message' CHECK (work_kind IN ('message','discovery')),
  discovery_json jsonb,
  provider_message_id text NOT NULL,
  provider_thread_id text,
  inbound_record_id varchar REFERENCES inbound_order_records(id) ON DELETE SET NULL,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  status varchar(32) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','importing','retrying','complete','needs_attention','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token varchar,
  claim_expires_at timestamptz,
  error_code varchar(80),
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'importing') = (claim_token IS NOT NULL AND claim_expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX inbound_import_message_uidx ON public.inbound_email_import_jobs(organization_id,mailbox_id,provider,provider_message_id);
CREATE INDEX inbound_import_claim_idx ON public.inbound_email_import_jobs(status,next_attempt_at,claim_expires_at);
CREATE INDEX inbound_import_record_idx ON public.inbound_email_import_jobs(organization_id,inbound_record_id);
CREATE INDEX inbound_import_thread_idx ON public.inbound_email_import_jobs(organization_id,mailbox_id,provider_thread_id);
CREATE UNIQUE INDEX inbound_import_open_discovery_uidx ON public.inbound_email_import_jobs(organization_id,mailbox_id)
  WHERE work_kind = 'discovery' AND status NOT IN ('complete','skipped');
