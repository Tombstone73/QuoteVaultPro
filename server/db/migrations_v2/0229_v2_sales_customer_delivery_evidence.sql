-- M6: customer Quote delivery is a durable Sales fact.  PDF bytes remain
-- deterministic/on-demand; this table records exactly which frozen document
-- fingerprint was handed to the configured provider.
CREATE TABLE v2_sales_quote_delivery_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_document_id varchar NOT NULL,
  quote_checkpoint_id varchar,
  operation_request_id varchar NOT NULL,
  recipient_email varchar(255) NOT NULL,
  document_sha256 varchar(80) NOT NULL,
  transport varchar(64) NOT NULL DEFAULT 'gmail',
  provider_message_id varchar(255),
  delivery_state varchar(24) NOT NULL DEFAULT 'pending',
  failure_message varchar(500),
  initiated_principal_kind varchar(32) NOT NULL,
  initiated_principal_subject varchar(255) NOT NULL,
  initiated_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT v2_sales_quote_delivery_attempts_quote_fk FOREIGN KEY (quote_document_id, organization_id)
    REFERENCES v2_sales_quote_details(document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_quote_delivery_attempts_checkpoint_fk FOREIGN KEY (quote_checkpoint_id, organization_id, quote_document_id)
    REFERENCES v2_sales_quote_checkpoints(id, organization_id, quote_document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_quote_delivery_attempts_request_fk FOREIGN KEY (operation_request_id, organization_id)
    REFERENCES v2_operation_requests(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_quote_delivery_attempts_state_chk CHECK (delivery_state IN ('pending','succeeded','failed','uncertain')),
  CONSTRAINT v2_sales_quote_delivery_attempts_recipient_chk CHECK (length(btrim(recipient_email)) > 3),
  CONSTRAINT v2_sales_quote_delivery_attempts_document_chk CHECK (document_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT v2_sales_quote_delivery_attempts_completion_chk CHECK (
    (delivery_state='pending' AND completed_at IS NULL AND provider_message_id IS NULL AND failure_message IS NULL)
    OR (delivery_state='succeeded' AND completed_at IS NOT NULL AND provider_message_id IS NOT NULL AND failure_message IS NULL)
    OR (delivery_state='failed' AND completed_at IS NOT NULL AND provider_message_id IS NULL AND failure_message IS NOT NULL)
    OR (delivery_state='uncertain' AND completed_at IS NOT NULL AND failure_message IS NOT NULL)
  ),
  CONSTRAINT v2_sales_quote_delivery_attempts_operation_uidx UNIQUE (organization_id, operation_request_id)
);
CREATE UNIQUE INDEX v2_sales_quote_delivery_attempts_one_success_uidx
  ON v2_sales_quote_delivery_attempts (organization_id, quote_document_id)
  WHERE delivery_state='succeeded';
CREATE INDEX v2_sales_quote_delivery_attempts_quote_idx
  ON v2_sales_quote_delivery_attempts (organization_id, quote_document_id, attempted_at DESC);
