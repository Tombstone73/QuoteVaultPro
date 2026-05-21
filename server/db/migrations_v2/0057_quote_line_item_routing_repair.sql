-- Migration 0057: Repair quote_line_items routing/design columns
--
-- Production drift was observed where migrations_v2 had recorded the older
-- quote-line routing migration, but quote_line_items.requires_design was absent.
-- Current quote creation intentionally persists routing/design/proof snapshots,
-- so do not drop these fields in code. Reassert the expected columns safely.

ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS requires_design boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_prepress boolean,
  ADD COLUMN IF NOT EXISTS requires_proof_approval boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS production_notes text,
  ADD COLUMN IF NOT EXISTS requires_design_snapshot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS design_brief_required_snapshot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_design_minutes_snapshot integer,
  ADD COLUMN IF NOT EXISTS included_design_minutes_snapshot integer,
  ADD COLUMN IF NOT EXISTS design_pricing_mode_snapshot varchar(50) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS flat_fee_amount_snapshot decimal(10, 2),
  ADD COLUMN IF NOT EXISTS hourly_rate_snapshot decimal(10, 2),
  ADD COLUMN IF NOT EXISTS requires_design boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_prepress boolean,
  ADD COLUMN IF NOT EXISTS requires_proof_approval boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS production_notes text,
  ADD COLUMN IF NOT EXISTS overage_rate_snapshot decimal(10, 2),
  ADD COLUMN IF NOT EXISTS internal_labor_rate_snapshot decimal(10, 2),
  ADD COLUMN IF NOT EXISTS needs_design_override boolean;

COMMENT ON COLUMN quote_line_items.requires_design IS
  'Quote-time effective design routing flag; preserved through quote-to-order conversion.';

COMMENT ON COLUMN quote_line_items.requires_prepress IS
  'Quote-time explicit prepress routing intent; NULL falls back to product/org defaults at conversion.';

COMMENT ON COLUMN quote_line_items.requires_proof_approval IS
  'Quote-time proof approval snapshot captured from product configuration.';
