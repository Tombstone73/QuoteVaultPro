-- Store the billing automation trigger in organizations.settings.preferences.
-- Existing organizations default to manual_only in application code. The known
-- DEV/Titan primary org is opted into the shop workflow requested for this pass.

UPDATE organizations
SET
  settings = jsonb_set(
    COALESCE(settings, '{}'::jsonb),
    '{preferences,billingInvoiceTriggerPolicy}',
    '"ready_for_pickup_or_ready_to_ship"'::jsonb,
    true
  ),
  updated_at = now()
WHERE id = 'org_titan_001'
  AND COALESCE(settings #>> '{preferences,billingInvoiceTriggerPolicy}', '') = '';
