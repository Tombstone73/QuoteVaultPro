-- Migration 0060: Pre-go-live cleanup of order_line_items.status
-- Canonical lifecycle: new, in_production, complete, canceled
-- Remove all station-like and legacy statuses from order_line_items.status.

-- 1. Change column default from 'queued' to 'new'
ALTER TABLE order_line_items ALTER COLUMN status SET DEFAULT 'new';

-- 2. Normalize any non-canonical statuses to canonical values.
--    Since system is not live, this is a clean correction.
UPDATE order_line_items
SET status = 'new', updated_at = NOW()
WHERE status IN ('queued', 'pending_prepress');

UPDATE order_line_items
SET status = 'in_production', updated_at = NOW()
WHERE status IN ('in_prepress', 'prepress_complete', 'print_ready', 'printing', 'finishing');

UPDATE order_line_items
SET status = 'complete', updated_at = NOW()
WHERE status = 'done';
