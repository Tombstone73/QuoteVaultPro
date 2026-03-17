-- Migration 0015: Add canonical routing intent fields to quote_line_items
--
-- These fields allow quote line items to carry explicit routing truth so that
-- quote-to-order conversion can preserve mixed routing intent (design / prepress /
-- production-direct) rather than hardcoding requiresDesign=false at conversion time.
--
-- Schema semantics:
--   requires_design  BOOLEAN NOT NULL DEFAULT false
--     true  = this line item needs a design step before anything else
--     false = skip design station (may still go through prepress)
--
--   requires_prepress  BOOLEAN NULL
--     true  = requires prepress
--     false = skip prepress, go directly to production
--     NULL  = not explicitly set; conversion falls back to productType / org default
--
-- NULL for requires_prepress is intentional:
--   existing quote line items get NULL, which triggers the existing product-type
--   / org-level fallback in the conversion path, preserving current behavior.

ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS requires_design  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_prepress BOOLEAN NULL;
