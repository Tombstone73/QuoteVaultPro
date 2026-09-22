-- A grouped portal card payment uses the existing staff customer-payment
-- batch as its durable container. Invoice-level payment rows remain normal
-- staff-allocator effects; this parent owns the one provider collection.
ALTER TABLE customer_payment_batches ADD COLUMN IF NOT EXISTS provider varchar(20) NOT NULL DEFAULT 'manual';
ALTER TABLE customer_payment_batches ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'succeeded';
ALTER TABLE customer_payment_batches ADD COLUMN IF NOT EXISTS currency varchar(8) NOT NULL DEFAULT 'USD';
ALTER TABLE customer_payment_batches ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE customer_payment_batches ADD COLUMN IF NOT EXISTS stripe_account_id text;
ALTER TABLE customer_payment_batches ADD COLUMN IF NOT EXISTS provider_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE customer_payment_batches ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS customer_payment_batches_org_stripe_intent_uidx ON customer_payment_batches (organization_id, stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
