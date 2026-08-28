-- M6 Team & Access: new organizations and accepted existing invitations adopt
-- the established V2 permission authority automatically. No user identity or
-- second membership model is introduced.
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
  SELECT target_org_id,c.capability_id FROM (VALUES ('quote.view'),('order.view'),('invoice.view'),('proof.respond')) c(capability_id)
  ON CONFLICT DO NOTHING;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION v2_bootstrap_permission_organization_trigger() RETURNS trigger AS $$
BEGIN PERFORM v2_bootstrap_permission_organization(NEW.id); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION v2_bootstrap_permission_membership() RETURNS trigger AS $$
DECLARE template_key varchar;
BEGIN
  IF TG_OP='UPDATE' AND (OLD.is_active OR NOT NEW.is_active) THEN RETURN NEW; END IF;
  PERFORM v2_bootstrap_permission_organization(NEW.organization_id);
  template_key := CASE NEW.role::text WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'administrator' WHEN 'manager' THEN 'manager' ELSE 'staff_basic' END;
  INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id,active,assignment_source,bootstrap_legacy_role)
  SELECT NEW.organization_id,NEW.user_id,ps.id,true,'legacy_role_bootstrap',NEW.role::text FROM v2_permission_sets ps
  WHERE ps.organization_id=NEW.organization_id AND ps.source_template_key=template_key
  ON CONFLICT(organization_id,user_id,permission_set_id) DO UPDATE SET active=true,updated_at=now();
  UPDATE v2_permission_organization_state state SET admin_floor_enforced=EXISTS(
    SELECT 1 FROM v2_staff_permission_set_assignments a JOIN user_organizations m ON m.organization_id=a.organization_id AND m.user_id=a.user_id AND m.is_active
    JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active
    JOIN v2_permission_set_capabilities c ON c.organization_id=s.organization_id AND c.permission_set_id=s.id
    WHERE a.organization_id=NEW.organization_id AND a.active AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff')
    GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2
  ),authority_revision=authority_revision+1,updated_at=now() WHERE organization_id=NEW.organization_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS v2_permission_organization_bootstrap ON organizations;
CREATE TRIGGER v2_permission_organization_bootstrap AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION v2_bootstrap_permission_organization_trigger();
DROP TRIGGER IF EXISTS v2_permission_membership_bootstrap ON user_organizations;
CREATE TRIGGER v2_permission_membership_bootstrap AFTER INSERT OR UPDATE OF is_active ON user_organizations
FOR EACH ROW EXECUTE FUNCTION v2_bootstrap_permission_membership();

SELECT v2_bootstrap_permission_organization(id) FROM organizations;
INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id,active,assignment_source,bootstrap_legacy_role)
SELECT uo.organization_id,uo.user_id,ps.id,true,'legacy_role_bootstrap',uo.role::text FROM user_organizations uo
JOIN v2_permission_sets ps ON ps.organization_id=uo.organization_id AND ps.source_template_key=CASE uo.role::text WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'administrator' WHEN 'manager' THEN 'manager' ELSE 'staff_basic' END
WHERE uo.is_active ON CONFLICT(organization_id,user_id,permission_set_id) DO UPDATE SET active=true,updated_at=now();

UPDATE v2_permission_organization_state state SET admin_floor_enforced=EXISTS(
  SELECT 1 FROM v2_staff_permission_set_assignments a JOIN user_organizations m ON m.organization_id=a.organization_id AND m.user_id=a.user_id AND m.is_active
  JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active
  JOIN v2_permission_set_capabilities c ON c.organization_id=s.organization_id AND c.permission_set_id=s.id
  WHERE a.organization_id=state.organization_id AND a.active AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff')
  GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2
),updated_at=now();
