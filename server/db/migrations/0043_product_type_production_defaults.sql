-- Migration: Product Type → Production Routing Defaults
-- Adds default station, step, and auto-send flag to product_types.
-- These are nullable/defaulted so all existing rows are unaffected.

ALTER TABLE product_types
  ADD COLUMN IF NOT EXISTS default_station_key varchar(40),
  ADD COLUMN IF NOT EXISTS default_step_key    varchar(40),
  ADD COLUMN IF NOT EXISTS send_to_production_default boolean NOT NULL DEFAULT false;
