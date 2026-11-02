-- Outbox for NEW explicitly enrolled, evidence-covered Order resolutions only.
CREATE TABLE public.inbound_gmail_acknowledgements (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbound_record_id varchar NOT NULL REFERENCES inbound_order_records(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id),
  mailbox_id varchar NOT NULL REFERENCES inbound_email_mailboxes(id),
  provider_account varchar(320) NOT NULL,
  evidence_fingerprint varchar(128) NOT NULL,
  message_ids jsonb NOT NULL CHECK (jsonb_typeof(message_ids) = 'array' AND jsonb_array_length(message_ids) > 0),
  status varchar(32) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','processing','retrying','succeeded','failed','reconnect_required','needs_attention')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token varchar,
  claim_expires_at timestamptz,
  error_code varchar(80),
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'processing') = (claim_token IS NOT NULL AND claim_expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX inbound_gmail_ack_evidence_uidx ON public.inbound_gmail_acknowledgements(organization_id,inbound_record_id,mailbox_id,evidence_fingerprint);
CREATE INDEX inbound_gmail_ack_claim_idx ON public.inbound_gmail_acknowledgements(status,next_attempt_at,claim_expires_at);
CREATE INDEX inbound_gmail_ack_mailbox_idx ON public.inbound_gmail_acknowledgements(organization_id,mailbox_id,status);
