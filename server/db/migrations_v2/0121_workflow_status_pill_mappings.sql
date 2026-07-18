-- Tenant-configurable workflow signals mapped to stable status-pill keys.
-- Canonical lifecycle remains authoritative; missing/disabled mappings are fail-soft.

CREATE TABLE IF NOT EXISTS workflow_status_pill_mappings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trigger_key VARCHAR(100) NOT NULL,
  target_status_key VARCHAR(100) NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'system',
  is_active BOOLEAN NOT NULL DEFAULT true,
  overwrite_exception_status BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workflow_status_pill_mappings_source_check CHECK (source IN ('system', 'automation')),
  CONSTRAINT workflow_status_pill_mappings_trigger_check CHECK (trigger_key IN (
    'order_created', 'order_needs_review', 'artwork_requested', 'proof_sent', 'proof_approved',
    'sent_to_prepress', 'sent_to_production', 'production_started', 'production_completed',
    'sent_to_fulfillment', 'ready_for_pickup', 'ready_to_ship', 'shipped', 'picked_up',
    'invoice_created', 'invoice_finalized', 'payment_received', 'order_completed',
    'order_closed', 'order_canceled', 'order_on_hold', 'order_problem'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_status_pill_mappings_org_trigger_uidx
  ON workflow_status_pill_mappings(organization_id, trigger_key);
CREATE INDEX IF NOT EXISTS workflow_status_pill_mappings_org_target_idx
  ON workflow_status_pill_mappings(organization_id, target_status_key);

WITH defaults(trigger_key, target_status_key, source, overwrite_exception_status) AS (
  VALUES
    ('order_created', 'new', 'system', false),
    ('sent_to_prepress', 'prepress', 'system', false),
    ('sent_to_production', 'in_production', 'system', false),
    ('sent_to_fulfillment', 'fulfillment', 'system', false),
    ('ready_for_pickup', 'ready_for_pickup', 'system', false),
    ('ready_to_ship', 'ready_to_ship', 'system', false),
    ('shipped', 'shipped', 'system', false),
    ('picked_up', 'picked_up', 'system', false),
    ('invoice_finalized', 'invoiced', 'system', false),
    ('payment_received', 'paid', 'system', false),
    ('order_completed', 'complete', 'system', true),
    ('order_closed', 'closed', 'system', true),
    ('order_canceled', 'canceled', 'system', true),
    ('order_on_hold', 'on_hold', 'system', true),
    ('order_problem', 'problem', 'system', true)
)
INSERT INTO workflow_status_pill_mappings (
  organization_id, trigger_key, target_status_key, source, is_active, overwrite_exception_status
)
SELECT
  organizations.id,
  defaults.trigger_key,
  defaults.target_status_key,
  defaults.source,
  true,
  defaults.overwrite_exception_status
FROM organizations
CROSS JOIN defaults
ON CONFLICT (organization_id, trigger_key) DO NOTHING;
