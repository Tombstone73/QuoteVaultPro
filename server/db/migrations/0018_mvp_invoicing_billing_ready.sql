-- MVP Invoicing + Payments + Order Billing Readiness
-- Additive-only migration (safe to apply once in a clean migration history)

-- Orders: billing readiness fields
ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS billing_status varchar(20) NOT NULL DEFAULT 'not_ready';

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS billing_ready_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_ready_override_note text,
  ADD COLUMN IF NOT EXISTS billing_ready_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_ready_override_by_user_id varchar;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_billing_ready_override_by_user_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_billing_ready_override_by_user_id_fkey
      FOREIGN KEY (billing_ready_override_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    -- In case users table name differs in some environments; skip FK
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS orders_billing_status_idx ON orders (billing_status);

-- Invoices: MVP billing + QB sync fields + cents snapshot
ALTER TABLE IF EXISTS invoices
  ADD COLUMN IF NOT EXISTS issued_at timestamptz;

ALTER TABLE IF EXISTS invoices
  ADD COLUMN IF NOT EXISTS subtotal_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency varchar(8) NOT NULL DEFAULT 'USD';

ALTER TABLE IF EXISTS invoices
  ADD COLUMN IF NOT EXISTS qb_invoice_id text,
  ADD COLUMN IF NOT EXISTS qb_sync_status varchar(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qb_last_error text,
  ADD COLUMN IF NOT EXISTS modified_after_billing boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS invoices_qb_sync_status_idx ON invoices (qb_sync_status);

-- Invoice line items: cents + sort order + optional name/sku
ALTER TABLE IF EXISTS invoice_line_items
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS sku varchar(100),
  ADD COLUMN IF NOT EXISTS unit_price_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_id_sort_order_idx ON invoice_line_items (invoice_id, sort_order);

-- Payments: cents + paid_at + note
ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS note text;

CREATE INDEX IF NOT EXISTS payments_invoice_id_paid_at_idx ON payments (invoice_id, paid_at);
