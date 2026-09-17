CREATE TABLE IF NOT EXISTS customer_payment_batches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  method varchar(50) NOT NULL,
  allocation_mode varchar(32) NOT NULL CHECK (allocation_mode IN ('oldest_first', 'proportional', 'custom')),
  idempotency_key text NOT NULL,
  reference text, notes text, applied_at timestamptz NOT NULL,
  created_by_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_payment_batches_org_idempotency_uidx ON customer_payment_batches (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS customer_payment_batches_customer_idx ON customer_payment_batches (organization_id, customer_id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_payment_batch_id varchar REFERENCES customer_payment_batches(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS payments_customer_payment_batch_id_idx ON payments (customer_payment_batch_id);
