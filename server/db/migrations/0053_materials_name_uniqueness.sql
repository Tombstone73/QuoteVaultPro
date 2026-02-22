-- Migration 0053: enforce org-scoped unique material names (trimmed, case-insensitive)
-- Concurrency-safe duplicate prevention for material creation/update.

CREATE UNIQUE INDEX IF NOT EXISTS materials_org_normalized_name_uidx
  ON materials (organization_id, lower(btrim(name)));
