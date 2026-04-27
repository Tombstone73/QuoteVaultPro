-- Migration 0062: Add source document number snapshots for traceability
--
-- orders.source_quote_number — immutable snapshot of the quote number at time of conversion.
--   Allows displaying "From Quote #1234" even if the quote FK (quote_id) is later nulled.
--
-- invoices.source_order_number — immutable snapshot of the order number at time of invoice creation.
--   Allows displaying "From Order #5000" without a join.
--
-- Both columns are nullable — existing rows have null (legacy data). No backfill needed.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_quote_number INTEGER;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_order_number INTEGER;
