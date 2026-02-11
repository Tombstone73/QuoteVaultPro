-- SQL to register migration 0037 in Drizzle migrations table
-- Run this in your Neon SQL editor AFTER the migration 0037_pbv2_activation_governance.sql has been applied

-- Insert the migration record
INSERT INTO public.__drizzle_migrations (name, created_at)
VALUES ('0037_pbv2_activation_governance', NOW())
ON CONFLICT DO NOTHING;

-- Verify it was inserted
SELECT id, name, created_at 
FROM public.__drizzle_migrations 
WHERE name = '0037_pbv2_activation_governance';
