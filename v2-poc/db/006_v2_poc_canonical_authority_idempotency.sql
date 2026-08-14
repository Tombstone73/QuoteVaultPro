-- Disposable V2 POC compatibility only. Non-staff principals must never be
-- fabricated as users; canonical attribution is retained privately instead.
ALTER TABLE orders ALTER COLUMN created_by_user_id DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN created_by_user_id DROP NOT NULL;
CREATE TABLE IF NOT EXISTS v2_poc_operation_attributions (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation varchar(64) NOT NULL, resource_type varchar(32) NOT NULL, resource_id varchar NOT NULL,
  principal_kind varchar(16) NOT NULL, principal_id varchar(160) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, operation, resource_type, resource_id)
);

-- Quote conversion had originally required a staff user for transport
-- idempotency and attribution.  The canonical V2 operation is principal
-- neutral: quote business uniqueness remains (organization, quote) while
-- request diagnostics retain the principal that made each attempt.
ALTER TABLE v2_poc_quote_conversion_requests ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE v2_poc_quote_conversion_requests ADD COLUMN IF NOT EXISTS principal_kind varchar(16) NOT NULL DEFAULT 'staff';
ALTER TABLE v2_poc_quote_conversion_requests ADD COLUMN IF NOT EXISTS principal_subject varchar(160) NOT NULL DEFAULT '';
ALTER TABLE v2_poc_quote_conversion_requests ADD COLUMN IF NOT EXISTS staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS v2_poc_quote_request_principal_unique
  ON v2_poc_quote_conversion_requests (organization_id, principal_kind, principal_subject, request_id);

ALTER TABLE v2_poc_quote_order_conversions ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE v2_poc_quote_order_conversions ADD COLUMN IF NOT EXISTS principal_kind varchar(16) NOT NULL DEFAULT 'staff';
ALTER TABLE v2_poc_quote_order_conversions ADD COLUMN IF NOT EXISTS principal_subject varchar(160) NOT NULL DEFAULT '';
ALTER TABLE v2_poc_quote_order_conversions ADD COLUMN IF NOT EXISTS staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL;
