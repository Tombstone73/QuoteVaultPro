ALTER TABLE products
  ADD COLUMN IF NOT EXISTS workflow_intent varchar(32) NOT NULL DEFAULT 'standard_production',
  ADD COLUMN IF NOT EXISTS allow_zero_price boolean NOT NULL DEFAULT false;

-- This is a known fulfillment SKU with no finished-size input. Keep this mapping
-- intentionally narrow; other products retain their explicitly configured mode.
UPDATE products
SET measurement_mode = 'quantity_only',
    workflow_intent = 'fulfillment_only',
    requires_production_job = false,
    requires_proof_approval = false,
    artwork_policy = 'not_required'
WHERE lower(trim(name)) = 'economy yard sign stakes';

-- Semantically clear fulfillment/accessory families only. Printed/custom
-- products retain the safe standard-production default.
UPDATE products p
SET workflow_intent = 'fulfillment_only',
    requires_production_job = false,
    requires_proof_approval = false,
    artwork_policy = 'not_required'
WHERE p.workflow_intent = 'standard_production'
  AND (
    lower(trim(coalesce(p.category, ''))) IN ('fulfillment items', 'accessories', 'hardware', 'packaging')
    OR lower(trim(p.name)) = 'economy yard sign stakes'
  );

UPDATE products p
SET workflow_intent = 'fulfillment_only',
    requires_production_job = false,
    requires_proof_approval = false,
    artwork_policy = 'not_required'
FROM product_types pt
WHERE p.product_type_id = pt.id
  AND p.workflow_intent = 'standard_production'
  AND lower(trim(pt.name)) IN ('fulfillment items', 'fulfillment', 'accessories', 'hardware', 'packaging');

UPDATE products
SET workflow_intent = 'service_fee',
    requires_production_job = false,
    requires_proof_approval = false,
    artwork_policy = 'not_required'
WHERE workflow_intent = 'standard_production'
  AND is_service = true;

-- Correct active operational records while leaving completed/cancelled history intact.
UPDATE order_line_items li
SET requires_design = false,
    requires_prepress = false,
    requires_proof_approval = false,
    workflow_state = CASE
      WHEN li.workflow_state IN ('needs_design', 'in_design', 'awaiting_proof_approval', 'ready_for_prepress', 'in_prepress') THEN 'ready_for_production'
      ELSE li.workflow_state
    END,
    updated_at = now()
FROM products p
WHERE li.product_id = p.id
  AND p.workflow_intent IN ('fulfillment_only', 'service_fee')
  AND lower(coalesce(li.workflow_state, 'new')) NOT IN ('completed', 'complete', 'canceled', 'cancelled');
