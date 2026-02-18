-- Migration 0042: Add priced_at to order_line_items
-- This column was manually added to production; this migration ensures repo consistency
-- and prevents Drizzle drift in future deployments.

ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS priced_at timestamptz;
