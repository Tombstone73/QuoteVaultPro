-- Register migration 0050_manual_prepress_production in Drizzle migrations table
-- Run this AFTER applying the migration SQL

INSERT INTO __drizzle_migrations (hash, created_at)
VALUES (
  '0050_manual_prepress_production',
  (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
)
ON CONFLICT DO NOTHING;
