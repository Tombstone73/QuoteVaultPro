-- Canonical customer-held-value ledger.  This is deliberately independent of
-- legacy customers.current_balance and invoice-linked cash payment batches.
CREATE TABLE IF NOT EXISTS customer_account_credits (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  source_type varchar(40) NOT NULL CHECK (source_type IN ('customer_advance', 'issued_credit', 'refund_to_account', 'credit_memo', 'migration')),
  original_amount_cents integer NOT NULL CHECK (original_amount_cents > 0),
  currency varchar(8) NOT NULL DEFAULT 'USD',
  received_method varchar(50), received_at timestamptz,
  source_invoice_id varchar REFERENCES invoices(id) ON DELETE RESTRICT,
  reference text, reason varchar(100), notes text,
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fully_applied', 'reversed')),
  accounting_status varchar(50) NOT NULL DEFAULT 'accounting_review_required',
  idempotency_key text NOT NULL,
  created_by_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz, reversed_by_user_id varchar REFERENCES users(id) ON DELETE RESTRICT, reversal_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_account_credits_org_idempotency_uidx ON customer_account_credits (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS customer_account_credits_customer_idx ON customer_account_credits (organization_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS customer_account_credits_invoice_idx ON customer_account_credits (organization_id, source_invoice_id) WHERE source_invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_account_credit_application_batches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE RESTRICT, allocation_mode varchar(32) NOT NULL,
  idempotency_key text NOT NULL, applied_at timestamptz NOT NULL, created_by_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_account_credit_application_batches_org_idempotency_uidx ON customer_account_credit_application_batches (organization_id, idempotency_key);

CREATE TABLE IF NOT EXISTS customer_account_credit_applications (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_account_credit_id varchar NOT NULL REFERENCES customer_account_credits(id) ON DELETE RESTRICT,
  application_batch_id varchar NOT NULL REFERENCES customer_account_credit_application_batches(id) ON DELETE RESTRICT,
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE RESTRICT, invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0), applied_at timestamptz NOT NULL,
  applied_by_user_id varchar REFERENCES users(id) ON DELETE RESTRICT, status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  created_at timestamptz NOT NULL DEFAULT now(), reversed_at timestamptz, reversed_by_user_id varchar REFERENCES users(id) ON DELETE RESTRICT, reversal_reason text
);
CREATE INDEX IF NOT EXISTS customer_account_credit_applications_credit_idx ON customer_account_credit_applications (organization_id, customer_account_credit_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS customer_account_credit_applications_invoice_idx ON customer_account_credit_applications (organization_id, invoice_id) WHERE status = 'active';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_account_credit_application_id varchar REFERENCES customer_account_credit_applications(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS payments_customer_account_credit_application_uidx ON payments (customer_account_credit_application_id) WHERE customer_account_credit_application_id IS NOT NULL;
