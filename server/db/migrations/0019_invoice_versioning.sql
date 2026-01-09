-- Add lightweight invoice versioning + sent/sync metadata
-- Safe additive migration for existing data.

ALTER TABLE IF EXISTS public.invoices
  ADD COLUMN IF NOT EXISTS invoice_version integer NOT NULL DEFAULT 1;

ALTER TABLE IF EXISTS public.invoices
  ADD COLUMN IF NOT EXISTS last_sent_version integer NULL;

ALTER TABLE IF EXISTS public.invoices
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz NULL;

ALTER TABLE IF EXISTS public.invoices
  ADD COLUMN IF NOT EXISTS last_sent_via text NULL;

ALTER TABLE IF EXISTS public.invoices
  ADD COLUMN IF NOT EXISTS last_qb_synced_version integer NULL;
