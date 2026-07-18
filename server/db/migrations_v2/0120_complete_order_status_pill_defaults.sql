-- Complete the tenant status-pill catalog introduced by 0119.
-- Existing rows, including inactive rows, win by stable key so tenant edits are preserved.

WITH canonical_mappings(key, prior_mapping, lifecycle_mapping) AS (
  VALUES
    ('new', 'open', 'intake'),
    ('needs_review', 'open', 'intake'),
    ('waiting_on_artwork', 'open', 'artwork'),
    ('design_needed', 'open', 'design'),
    ('proof_sent', 'open', 'proof'),
    ('waiting_on_approval', 'open', 'proof'),
    ('approved', 'open', 'order'),
    ('prepress', 'open', 'prepress'),
    ('in_production', 'open', 'production'),
    ('ready_for_pickup', 'production_complete', 'fulfillment'),
    ('ready_to_ship', 'production_complete', 'fulfillment'),
    ('shipped', 'production_complete', 'fulfillment'),
    ('picked_up', 'production_complete', 'fulfillment'),
    ('complete', 'closed', 'complete'),
    ('canceled', 'canceled', 'canceled')
)
UPDATE order_status_pills AS pills
SET lifecycle_mapping = canonical_mappings.lifecycle_mapping,
    updated_at = now()
FROM canonical_mappings
WHERE pills.key = canonical_mappings.key
  AND pills.lifecycle_mapping = canonical_mappings.prior_mapping;

WITH defaults(key, label, state_scope, color, category, lifecycle_mapping, wants_default, sort_order) AS (
  VALUES
    ('new', 'New', 'open', '#2563EB', 'intake', 'intake', true, 10),
    ('needs_review', 'Needs Review', 'open', '#7C3AED', 'intake', 'intake', false, 20),
    ('waiting_on_artwork', 'Waiting on Artwork', 'open', '#C2410C', 'artwork', 'artwork', false, 30),
    ('design_needed', 'Design Needed', 'open', '#9333EA', 'design', 'design', false, 40),
    ('proof_sent', 'Proof Sent', 'open', '#0369A1', 'proof', 'proof', false, 50),
    ('waiting_on_approval', 'Waiting on Approval', 'open', '#A16207', 'proof', 'proof', false, 60),
    ('approved', 'Approved', 'open', '#047857', 'order', 'order', false, 70),
    ('prepress', 'Prepress', 'open', '#0F766E', 'prepress', 'prepress', false, 80),
    ('in_production', 'In Production', 'open', '#C2410C', 'production', 'production', false, 90),
    ('fulfillment', 'Fulfillment', 'production_complete', '#0E7490', 'fulfillment', 'fulfillment', false, 100),
    ('ready_for_pickup', 'Ready for Pickup', 'production_complete', '#0369A1', 'fulfillment', 'fulfillment', true, 110),
    ('ready_to_ship', 'Ready to Ship', 'production_complete', '#0F766E', 'fulfillment', 'fulfillment', false, 120),
    ('shipped', 'Shipped', 'production_complete', '#475569', 'fulfillment', 'fulfillment', false, 130),
    ('picked_up', 'Picked Up', 'production_complete', '#475569', 'fulfillment', 'fulfillment', false, 140),
    ('invoiced', 'Invoiced', 'production_complete', '#4338CA', 'invoicing', 'invoicing', false, 150),
    ('paid', 'Paid', 'production_complete', '#15803D', 'payment', 'payment', false, 160),
    ('complete', 'Complete', 'closed', '#166534', 'complete', 'complete', true, 170),
    ('closed', 'Closed', 'closed', '#334155', 'closed', 'closed', false, 180),
    ('on_hold', 'On Hold', 'open', '#854D0E', 'hold', 'hold', false, 190),
    ('problem', 'Problem', 'open', '#B91C1C', 'exception', 'exception', false, 200),
    ('canceled', 'Canceled', 'canceled', '#475569', 'canceled', 'canceled', true, 210)
)
INSERT INTO order_status_pills (
  organization_id, key, name, state_scope, color, category, lifecycle_mapping,
  customer_visible, notification_trigger_eligible, is_default, is_active, sort_order
)
SELECT
  organizations.id,
  defaults.key,
  defaults.label,
  defaults.state_scope,
  defaults.color,
  defaults.category,
  defaults.lifecycle_mapping,
  false,
  true,
  defaults.wants_default AND NOT EXISTS (
    SELECT 1
    FROM order_status_pills scoped_default
    WHERE scoped_default.organization_id = organizations.id
      AND scoped_default.state_scope = defaults.state_scope
      AND scoped_default.is_default = true
  ),
  true,
  defaults.sort_order
FROM organizations
CROSS JOIN defaults
WHERE NOT EXISTS (
  SELECT 1
  FROM order_status_pills existing
  WHERE existing.organization_id = organizations.id
    AND existing.key = defaults.key
)
ON CONFLICT DO NOTHING;
