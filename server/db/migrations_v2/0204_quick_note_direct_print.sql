-- Global Quick Notes are durable direct-print jobs, but intentionally have no
-- order relationship. Keep the existing FK when an order is present.
ALTER TABLE direct_print_jobs
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE printer_profiles
  ADD COLUMN IF NOT EXISTS receipt_width_mm numeric(7,2) NOT NULL DEFAULT 80;
