-- Migration 0100: Product and material AI parsing descriptions
--
-- Adds internal AI-facing description hints directly to canonical products
-- and materials. These fields are for inbound interpretation only and are
-- not customer-facing storefront copy.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ai_parsing_description text,
  ADD COLUMN IF NOT EXISTS ai_parsing_description_linked_to_description boolean NOT NULL DEFAULT false;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS ai_parsing_description text,
  ADD COLUMN IF NOT EXISTS ai_parsing_description_linked_to_description boolean NOT NULL DEFAULT false;
