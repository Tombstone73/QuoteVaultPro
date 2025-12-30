-- Migration: Add order state transition timestamps
-- Purpose: Track when orders move through production lifecycle
-- Date: 2025-12-30

-- Add timestamp columns for state tracking
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS started_production_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS completed_production_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Add indexes for timestamp queries
CREATE INDEX IF NOT EXISTS orders_started_production_at_idx ON orders(started_production_at);
CREATE INDEX IF NOT EXISTS orders_completed_production_at_idx ON orders(completed_production_at);
CREATE INDEX IF NOT EXISTS orders_canceled_at_idx ON orders(canceled_at);
