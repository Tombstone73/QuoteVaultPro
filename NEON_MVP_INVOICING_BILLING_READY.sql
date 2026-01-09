-- QuoteVaultPro MVP: Invoicing + Payments + Order Billing Ready
-- Idempotent, additive-only, schema-qualified (public.)
-- Safe to run multiple times. No drops, no deletes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- A) Orders: billing readiness + manual override
-- ============================================================
ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS billing_status varchar(20) NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS billing_ready_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_ready_override_note text,
  ADD COLUMN IF NOT EXISTS billing_ready_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_ready_override_by_user_id varchar;

-- ============================================================
-- B) Invoices (table names match current codebase)
--    public.invoices, public.invoice_line_items, public.payments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoices (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL,
  invoice_number integer NOT NULL,
  order_id varchar,
  customer_id varchar NOT NULL,
  status varchar(50) NOT NULL DEFAULT 'draft',
  terms varchar(50) NOT NULL DEFAULT 'due_on_receipt',
  custom_terms varchar(255),
  issue_date timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  due_date timestamptz,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  subtotal_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  shipping_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  currency varchar(8) NOT NULL DEFAULT 'USD',
  amount_paid numeric(10,2) NOT NULL DEFAULT 0,
  balance_due numeric(10,2) NOT NULL DEFAULT 0,
  notes_public text,
  notes_internal text,
  created_by_user_id varchar NOT NULL,
  external_accounting_id varchar,
  sync_status varchar(50) NOT NULL DEFAULT 'pending',
  sync_error text,
  synced_at timestamptz,
  qb_invoice_id text,
  qb_sync_status varchar(20) NOT NULL DEFAULT 'pending',
  qb_last_error text,
  modified_after_billing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.invoices
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS subtotal_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency varchar(8) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS qb_invoice_id text,
  ADD COLUMN IF NOT EXISTS qb_sync_status varchar(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qb_last_error text,
  ADD COLUMN IF NOT EXISTS modified_after_billing boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id varchar NOT NULL,
  order_line_item_id varchar,
  product_id varchar NOT NULL,
  product_variant_id varchar,
  product_type varchar(50) NOT NULL DEFAULT 'wide_roll',
  name text,
  sku varchar(100),
  description text NOT NULL,
  width numeric(10,2),
  height numeric(10,2),
  quantity integer NOT NULL,
  sqft numeric(10,2),
  unit_price numeric(10,2) NOT NULL,
  total_price numeric(10,2) NOT NULL,
  unit_price_cents integer NOT NULL DEFAULT 0,
  line_total_cents integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  specs_json jsonb,
  selected_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.invoice_line_items
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS sku varchar(100),
  ADD COLUMN IF NOT EXISTS unit_price_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.payments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id varchar NOT NULL,
  amount numeric(10,2) NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  method varchar(50) NOT NULL DEFAULT 'other',
  notes text,
  note text,
  paid_at timestamptz,
  applied_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id varchar NOT NULL,
  external_accounting_id varchar,
  sync_status varchar(50) NOT NULL DEFAULT 'pending',
  sync_error text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.payments
  ADD COLUMN IF NOT EXISTS amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- ============================================================
-- C) Minimal indexes only (per MVP)
-- ============================================================
CREATE INDEX IF NOT EXISTS invoices_org_order_idx ON public.invoices (organization_id, order_id);
CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_id_idx ON public.invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON public.payments (invoice_id);
