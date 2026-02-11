-- Register migration 0038_add_pricing_engine in __drizzle_migrations table
-- This migration was manually applied and needs to be registered in Drizzle's tracking table
-- Run this after applying 0038_add_pricing_engine.sql to sync Drizzle bookkeeping

-- Insert the migration record
-- Note: Using fixed timestamp for consistency. Adjust if needed.
-- The hash is empty string as this repo doesn't use Drizzle hash-based tracking (all entries use when: 0)
INSERT INTO __drizzle_migrations (id, hash, created_at)
VALUES (
  (SELECT COALESCE(MAX(id), 0) + 1 FROM __drizzle_migrations),
  '0038_add_pricing_engine',
  EXTRACT(EPOCH FROM NOW()) * 1000
)
ON CONFLICT DO NOTHING;

-- Verify the insertion
SELECT id, hash, created_at 
FROM __drizzle_migrations 
WHERE hash = '0038_add_pricing_engine';
