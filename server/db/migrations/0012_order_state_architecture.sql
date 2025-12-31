-- Migration: Add Order State/Status Architecture
-- Description: Split state vs status pill, add production_complete and closed states, add order_status_pills table

-- Add new state and payment_status columns to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS state VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_pill_value VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'unpaid';

-- Migrate existing status to state (backward compatibility)
-- Map old status values to new state values
UPDATE orders SET state = CASE 
  WHEN status IN ('new', 'in_production', 'on_hold') THEN 'open'
  WHEN status = 'ready_for_shipment' THEN 'production_complete'
  WHEN status = 'completed' THEN 'closed'
  WHEN status = 'canceled' THEN 'canceled'
  ELSE 'open'
END WHERE state IS NULL;

-- Make state NOT NULL after migration
ALTER TABLE orders ALTER COLUMN state SET NOT NULL;
ALTER TABLE orders ALTER COLUMN state SET DEFAULT 'open';

-- Add state transition timestamp columns
ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_completed_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_target VARCHAR(50); -- 'fulfillment' or 'invoicing'

-- Create order_status_pills table (org-configurable pills)
CREATE TABLE IF NOT EXISTS order_status_pills (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  state_scope VARCHAR(50) NOT NULL, -- 'open', 'production_complete', 'closed', 'canceled'
  name VARCHAR(100) NOT NULL,
  color VARCHAR(50), -- hex color or design token
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for order_status_pills
CREATE INDEX IF NOT EXISTS order_status_pills_org_id_idx ON order_status_pills(organization_id);
CREATE INDEX IF NOT EXISTS order_status_pills_state_scope_idx ON order_status_pills(state_scope);
CREATE INDEX IF NOT EXISTS order_status_pills_org_state_idx ON order_status_pills(organization_id, state_scope);

-- Unique constraint: one default per (org_id, state_scope)
CREATE UNIQUE INDEX IF NOT EXISTS order_status_pills_org_state_default_idx 
  ON order_status_pills(organization_id, state_scope) 
  WHERE is_default = true;

-- Index for orders.state
CREATE INDEX IF NOT EXISTS orders_state_idx ON orders(state);
CREATE INDEX IF NOT EXISTS orders_payment_status_idx ON orders(payment_status);

-- Seed default status pills for existing organizations
INSERT INTO order_status_pills (organization_id, state_scope, name, color, is_default, sort_order)
SELECT 
  id as organization_id,
  'open' as state_scope,
  'New' as name,
  '#3b82f6' as color,
  true as is_default,
  0 as sort_order
FROM organizations
ON CONFLICT DO NOTHING;

INSERT INTO order_status_pills (organization_id, state_scope, name, color, is_default, sort_order)
SELECT 
  id as organization_id,
  'open' as state_scope,
  'In Production' as name,
  '#f97316' as color,
  false as is_default,
  1 as sort_order
FROM organizations
ON CONFLICT DO NOTHING;

INSERT INTO order_status_pills (organization_id, state_scope, name, color, is_default, sort_order)
SELECT 
  id as organization_id,
  'open' as state_scope,
  'On Hold' as name,
  '#eab308' as color,
  false as is_default,
  2 as sort_order
FROM organizations
ON CONFLICT DO NOTHING;

INSERT INTO order_status_pills (organization_id, state_scope, name, color, is_default, sort_order)
SELECT 
  id as organization_id,
  'production_complete' as state_scope,
  'Ready' as name,
  '#10b981' as color,
  true as is_default,
  0 as sort_order
FROM organizations
ON CONFLICT DO NOTHING;

-- Add comments
COMMENT ON COLUMN orders.state IS 'Canonical workflow state: open, production_complete, closed, canceled';
COMMENT ON COLUMN orders.status IS 'Legacy field - kept for backward compatibility';
COMMENT ON COLUMN orders.status_pill_value IS 'Customizable status pill within current state';
COMMENT ON COLUMN orders.payment_status IS 'Payment tracking: unpaid, partial, paid';
COMMENT ON TABLE order_status_pills IS 'Org-configurable status pills scoped to order states';
