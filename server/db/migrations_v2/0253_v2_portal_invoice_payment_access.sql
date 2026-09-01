-- Customer card payments are a deliberately narrow portal capability. The
-- portal HTTP boundary is the only route that may exercise payment.record.
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT t.id,c.capability_id FROM v2_permission_set_templates t
CROSS JOIN (VALUES ('payment.view'),('payment.record')) c(capability_id)
WHERE t.template_key='customer_full_portal'
ON CONFLICT DO NOTHING;

INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
SELECT ps.organization_id,ps.id,c.capability_id FROM v2_permission_sets ps
CROSS JOIN (VALUES ('payment.view'),('payment.record')) c(capability_id)
WHERE ps.source_template_key='customer_full_portal'
ON CONFLICT DO NOTHING;

-- Defaults are a ceiling only when a Customer has not been explicitly
-- restricted. Existing explicit customer policies remain authoritative.
INSERT INTO v2_organization_portal_capability_defaults(organization_id,capability_id)
SELECT o.id,c.capability_id FROM organizations o
CROSS JOIN (VALUES ('payment.view'),('payment.record')) c(capability_id)
ON CONFLICT DO NOTHING;

INSERT INTO v2_portal_permission_set_assignments(organization_id,portal_access_id,permission_set_id,active)
SELECT a.organization_id,a.id,ps.id,true FROM customer_portal_access a
JOIN v2_permission_sets ps ON ps.organization_id=a.organization_id AND ps.source_template_key='customer_full_portal'
WHERE a.status='ACTIVE' AND NOT EXISTS (
  SELECT 1 FROM v2_portal_permission_set_assignments x
  WHERE x.organization_id=a.organization_id AND x.portal_access_id=a.id AND x.active
)
ON CONFLICT(organization_id,portal_access_id,permission_set_id) DO UPDATE SET active=true,updated_at=now();

UPDATE v2_permission_organization_state SET authority_revision=authority_revision+1,updated_at=now();

CREATE OR REPLACE FUNCTION v2_bootstrap_permission_organization(target_org_id varchar) RETURNS void AS $$
BEGIN
  INSERT INTO v2_permission_organization_state(organization_id) VALUES(target_org_id) ON CONFLICT DO NOTHING;
  INSERT INTO v2_permission_sets(organization_id,name,normalized_name,source_template_key,principal_kind)
  SELECT target_org_id,t.name,lower(t.name),t.template_key,t.principal_kind FROM v2_permission_set_templates t
  ON CONFLICT(organization_id,normalized_name) DO NOTHING;
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT ps.organization_id,ps.id,tc.capability_id FROM v2_permission_sets ps
  JOIN v2_permission_set_templates t ON t.template_key=ps.source_template_key
  JOIN v2_permission_set_template_capabilities tc ON tc.template_id=t.id
  WHERE ps.organization_id=target_org_id ON CONFLICT DO NOTHING;
  INSERT INTO v2_organization_portal_capability_defaults(organization_id,capability_id)
  SELECT target_org_id,c.capability_id FROM (VALUES ('quote.view'),('order.view'),('invoice.view'),('proof.respond'),('payment.view'),('payment.record')) c(capability_id)
  ON CONFLICT DO NOTHING;
END $$ LANGUAGE plpgsql;
