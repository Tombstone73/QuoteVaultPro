-- A custom role archive preserves permission-set identity and historical
-- assignment/audit evidence while removing the role from normal operation.
ALTER TABLE v2_permission_sets ADD COLUMN archived_at timestamptz;
ALTER TABLE v2_permission_sets ADD COLUMN archived_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE v2_permission_sets ADD CONSTRAINT v2_permission_sets_archive_inactive_chk CHECK (archived_at IS NULL OR active=false);

-- Archived role names can be reused by a future custom role. Built-in names
-- remain protected because their non-archived template-backed set remains live.
ALTER TABLE v2_permission_sets DROP CONSTRAINT v2_permission_sets_name_uidx;
CREATE UNIQUE INDEX v2_permission_sets_live_name_uidx ON v2_permission_sets(organization_id,normalized_name) WHERE archived_at IS NULL;
CREATE INDEX v2_permission_sets_org_archive_idx ON v2_permission_sets(organization_id,archived_at) WHERE archived_at IS NOT NULL;

-- The live bootstrap function must not target the retired full-name constraint.
CREATE OR REPLACE FUNCTION v2_bootstrap_permission_organization(target_org_id varchar) RETURNS void AS $$
BEGIN
  INSERT INTO v2_permission_organization_state(organization_id) VALUES(target_org_id) ON CONFLICT DO NOTHING;
  INSERT INTO v2_permission_sets(organization_id,name,normalized_name,source_template_key,principal_kind)
  SELECT target_org_id,t.name,lower(t.name),t.template_key,t.principal_kind FROM v2_permission_set_templates t
  ON CONFLICT DO NOTHING;
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT ps.organization_id,ps.id,tc.capability_id FROM v2_permission_sets ps
  JOIN v2_permission_set_templates t ON t.template_key=ps.source_template_key
  JOIN v2_permission_set_template_capabilities tc ON tc.template_id=t.id
  WHERE ps.organization_id=target_org_id ON CONFLICT DO NOTHING;
  INSERT INTO v2_organization_portal_capability_defaults(organization_id,capability_id)
  SELECT target_org_id,c.capability_id FROM (VALUES ('quote.view'),('order.view'),('invoice.view'),('proof.respond'),('payment.view'),('payment.record')) c(capability_id)
  ON CONFLICT DO NOTHING;
END $$ LANGUAGE plpgsql;
