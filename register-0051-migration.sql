-- Register migration 0051 in the migrations table
INSERT INTO migrations (id, name, applied_at)
VALUES (51, '0051_prepress_default_system', NOW())
ON CONFLICT (id) DO NOTHING;
