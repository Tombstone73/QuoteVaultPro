-- Canonical non-admin staff role. Existing templates, grants and assignments
-- are deliberately unchanged. Organization copies are managed built-in sets.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM v2_permission_set_templates WHERE template_key='operations' AND (name<>'Operations' OR principal_kind<>'staff'))
    OR EXISTS (SELECT 1 FROM v2_permission_sets WHERE normalized_name='operations' AND (source_template_key IS DISTINCT FROM 'operations' OR principal_kind<>'staff'))
  THEN RAISE EXCEPTION 'Operations is reserved by an incompatible permission set; resolve the name collision explicitly'; END IF;
END $$;

INSERT INTO v2_permission_set_templates(template_key,name,principal_kind,description)
VALUES('operations','Operations','staff','Day-to-day job lifecycle operations without tenant, permission or provider administration.')
ON CONFLICT(template_key) DO NOTHING;

INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT t.id,c.capability_id FROM v2_permission_set_templates t CROSS JOIN (VALUES
  ('customer.view'),
  ('customer.edit'),
  ('quote.view'),
  ('quote.create'),
  ('quote.edit'),
  ('quote.send'),
  ('quote.convert'),
  ('quote.overridePrice'),
  ('order.view'),
  ('order.create'),
  ('order.edit'),
  ('order.overridePrice'),
  ('product.view'),
  ('pricing.preview'),
  ('artwork.view'),
  ('artwork.adopt'),
  ('artwork.assign'),
  ('proof.view'),
  ('proof.prepare'),
  ('proof.issue'),
  ('prepress.view'),
  ('prepress.work'),
  ('prepress.complete'),
  ('production.view'),
  ('production.work'),
  ('production.run.create'),
  ('production.run.execute'),
  ('production.complete'),
  ('production.hold'),
  ('production.note'),
  ('production.rework'),
  ('production.output.reject'),
  ('fulfillment.view'),
  ('fulfillment.pickup'),
  ('fulfillment.ship'),
  ('fulfillment.replace'),
  ('fulfillment.shipping.cost'),
  ('fulfillment.shipping.price'),
  ('invoice.view'),
  ('invoice.editDraft'),
  ('invoice.editIssued'),
  ('invoice.issue'),
  ('invoice.send'),
  ('payment.view'),
  ('route.view'),
  ('route.advance')
) c(capability_id) WHERE t.template_key='operations'
ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO v2_permission_sets(organization_id,name,normalized_name,description,source_template_key,principal_kind)
  SELECT o.id,t.name,lower(t.name),t.description,t.template_key,t.principal_kind
  FROM organizations o CROSS JOIN v2_permission_set_templates t WHERE t.template_key='operations'
  ON CONFLICT DO NOTHING RETURNING organization_id
)
UPDATE v2_permission_organization_state s SET authority_revision=s.authority_revision+1,updated_at=now()
WHERE s.organization_id IN (SELECT organization_id FROM inserted);

WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT ps.organization_id,ps.id,tc.capability_id
  FROM v2_permission_sets ps
  JOIN v2_permission_set_templates t ON t.template_key=ps.source_template_key
  JOIN v2_permission_set_template_capabilities tc ON tc.template_id=t.id
  WHERE ps.source_template_key='operations'
  ON CONFLICT DO NOTHING RETURNING organization_id
)
UPDATE v2_permission_organization_state s SET authority_revision=s.authority_revision+1,updated_at=now()
WHERE s.organization_id IN (SELECT organization_id FROM inserted);
