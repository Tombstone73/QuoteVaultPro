-- Migration 0051: Prepress Default System with Product Type Overrides
-- GOAL: Make prepress required by default with product type override capability

-- ============================================================
-- PHASE 1: Add org-level prepress default setting
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations'
    AND column_name = 'prepress_default_enabled'
  ) THEN
    ALTER TABLE organizations
    ADD COLUMN prepress_default_enabled boolean NOT NULL DEFAULT true;
  END IF;
END $$;

COMMENT ON COLUMN organizations.prepress_default_enabled IS 'When true, all line items require prepress by default unless overridden by product type';

-- ============================================================
-- PHASE 2: Add product type prepress override field
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_types'
    AND column_name = 'requires_prepress_override'
  ) THEN
    ALTER TABLE product_types
    ADD COLUMN requires_prepress_override boolean NULL;
  END IF;
END $$;

COMMENT ON COLUMN product_types.requires_prepress_override IS 'Prepress override: null=inherit org default, true=force prepress, false=skip prepress';

-- ============================================================
-- PHASE 3: Add line item prepress snapshot field (TEMP→PERMANENT)
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_line_items'
    AND column_name = 'requires_prepress'
  ) THEN
    ALTER TABLE order_line_items
    ADD COLUMN requires_prepress boolean NOT NULL DEFAULT true;
  END IF;
END $$;

COMMENT ON COLUMN order_line_items.requires_prepress IS 'Snapshot of prepress requirement at production entry time (TEMP→PERMANENT contract)';

-- ============================================================
-- PHASE 4: Add index for filtering prepress-required jobs
-- ============================================================

CREATE INDEX IF NOT EXISTS order_line_items_requires_prepress_idx ON order_line_items(requires_prepress);

-- ============================================================
-- PHASE 5: Backfill existing line items
-- ============================================================

-- Existing line items default to true (safer for backward compat)
-- This ensures no existing jobs accidentally skip prepress
UPDATE order_line_items
SET requires_prepress = true
WHERE requires_prepress IS NULL;

-- ============================================================
-- PHASE 6: Migration notes
-- ============================================================

-- Usage pattern:
--
-- 1) On production entry (order approved / line item created):
--    requiresPrepress = productType.requiresPrepressOverride ?? org.prepressDefaultEnabled
--
-- 2) If requiresPrepress = true:
--    - Set lineItem.status = 'pending_prepress'
--    - Snapshot lineItem.requires_prepress = true
--    - Job appears in /production/prepress queue
--    - After prepress complete: route to productType.defaultStation
--
-- 3) If requiresPrepress = false:
--    - Set lineItem.status = routing rule default (e.g., 'print_ready')
--    - Snapshot lineItem.requires_prepress = false
--    - Route directly to productType.defaultStation
--    - Job skips prepress queue
--
-- 4) Filtering guardrails:
--    - Prepress queue: requires_prepress = true AND status IN ('pending_prepress', 'in_prepress')
--    - Roll/Flatbed boards: requires_prepress = false OR status >= 'prepress_complete'
--
-- End of migration 0051
