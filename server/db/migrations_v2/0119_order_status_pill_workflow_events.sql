-- Stable, tenant-scoped operational status pills and durable pill-change events.
-- Canonical order lifecycle remains independent from these operational signals.

ALTER TABLE order_status_pills ADD COLUMN IF NOT EXISTS key VARCHAR(100);
ALTER TABLE order_status_pills ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE order_status_pills ADD COLUMN IF NOT EXISTS lifecycle_mapping VARCHAR(50);
ALTER TABLE order_status_pills ADD COLUMN IF NOT EXISTS customer_visible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE order_status_pills ADD COLUMN IF NOT EXISTS notification_trigger_eligible BOOLEAN NOT NULL DEFAULT true;

WITH normalized AS (
  SELECT
    id,
    LEFT(COALESCE(NULLIF(TRIM(BOTH '_' FROM REGEXP_REPLACE(LOWER(name), '[^a-z0-9]+', '_', 'g')), ''), 'status_' || LEFT(id, 8)), 100) AS base_key
  FROM order_status_pills
  WHERE key IS NULL
)
UPDATE order_status_pills AS pills
SET key = normalized.base_key
FROM normalized
WHERE pills.id = normalized.id;

WITH collisions AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY organization_id, key ORDER BY created_at, id) AS collision_number
  FROM order_status_pills
)
UPDATE order_status_pills AS pills
SET key = LEFT(pills.key, 90) || '_' || LEFT(MD5(pills.id), 8)
FROM collisions
WHERE pills.id = collisions.id
  AND collisions.collision_number > 1;

ALTER TABLE order_status_pills ALTER COLUMN key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS order_status_pills_org_key_uidx
  ON order_status_pills(organization_id, key);

WITH defaults(key, label, state_scope, color, category, lifecycle_mapping, is_default, sort_order) AS (
  VALUES
    ('new', 'New', 'open', '#2563EB', 'intake', 'open', true, 10),
    ('needs_review', 'Needs Review', 'open', '#7C3AED', 'intake', 'open', false, 20),
    ('waiting_on_artwork', 'Waiting on Artwork', 'open', '#C2410C', 'blocked', 'open', false, 30),
    ('design_needed', 'Design Needed', 'open', '#9333EA', 'design', 'open', false, 40),
    ('proof_sent', 'Proof Sent', 'open', '#0369A1', 'proofing', 'open', false, 50),
    ('waiting_on_approval', 'Waiting on Approval', 'open', '#A16207', 'blocked', 'open', false, 60),
    ('approved', 'Approved', 'open', '#047857', 'proofing', 'open', false, 70),
    ('prepress', 'Prepress', 'open', '#0F766E', 'production', 'open', false, 80),
    ('in_production', 'In Production', 'open', '#C2410C', 'production', 'open', false, 90),
    ('on_hold', 'On Hold', 'open', '#854D0E', 'exception', 'open', false, 100),
    ('problem', 'Problem', 'open', '#B91C1C', 'exception', 'open', false, 110),
    ('ready_for_pickup', 'Ready for Pickup', 'production_complete', '#0369A1', 'fulfillment', 'production_complete', true, 120),
    ('ready_to_ship', 'Ready to Ship', 'production_complete', '#0F766E', 'fulfillment', 'production_complete', false, 130),
    ('shipped', 'Shipped', 'production_complete', '#475569', 'fulfillment', 'production_complete', false, 140),
    ('picked_up', 'Picked Up', 'production_complete', '#475569', 'fulfillment', 'production_complete', false, 150),
    ('complete', 'Complete', 'closed', '#166534', 'terminal', 'closed', true, 160),
    ('canceled', 'Canceled', 'canceled', '#475569', 'terminal', 'canceled', true, 170)
)
INSERT INTO order_status_pills (
  organization_id, key, name, state_scope, color, category, lifecycle_mapping,
  customer_visible, notification_trigger_eligible, is_default, is_active, sort_order
)
SELECT
  organizations.id, defaults.key, defaults.label, defaults.state_scope, defaults.color,
  defaults.category, defaults.lifecycle_mapping, false, true, defaults.is_default, true, defaults.sort_order
FROM organizations
CROSS JOIN defaults
WHERE NOT EXISTS (
  SELECT 1 FROM order_status_pills existing WHERE existing.organization_id = organizations.id
)
ON CONFLICT (organization_id, key) DO NOTHING;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_pill_id VARCHAR REFERENCES order_status_pills(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_pill_assigned_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_pill_assigned_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_pill_reason TEXT;
CREATE INDEX IF NOT EXISTS orders_status_pill_id_idx ON orders(status_pill_id);

UPDATE orders
SET status_pill_id = (
  SELECT pill.id
  FROM order_status_pills pill
  WHERE pill.organization_id = orders.organization_id
    AND pill.name = orders.status_pill_value
  ORDER BY pill.is_active DESC, pill.updated_at DESC, pill.id
  LIMIT 1
)
WHERE orders.status_pill_value IS NOT NULL
  AND orders.status_pill_id IS NULL
  AND EXISTS (
    SELECT 1 FROM order_status_pills pill
    WHERE pill.organization_id = orders.organization_id
      AND pill.name = orders.status_pill_value
  );

ALTER TABLE order_status_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(50) NOT NULL DEFAULT 'workflow_status_changed';
ALTER TABLE order_status_events ADD COLUMN IF NOT EXISTS from_status_pill_id VARCHAR REFERENCES order_status_pills(id) ON DELETE SET NULL;
ALTER TABLE order_status_events ADD COLUMN IF NOT EXISTS to_status_pill_id VARCHAR REFERENCES order_status_pills(id) ON DELETE SET NULL;
ALTER TABLE order_status_events ADD COLUMN IF NOT EXISTS from_status_key VARCHAR(100);
ALTER TABLE order_status_events ADD COLUMN IF NOT EXISTS to_status_key VARCHAR(100);
ALTER TABLE order_status_events ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'user';
ALTER TABLE order_status_events ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE order_status_events ADD COLUMN IF NOT EXISTS metadata JSONB;
CREATE INDEX IF NOT EXISTS order_status_events_org_type_idx
  ON order_status_events(organization_id, event_type, changed_at);
CREATE INDEX IF NOT EXISTS order_status_events_to_pill_idx
  ON order_status_events(organization_id, to_status_pill_id, changed_at);
