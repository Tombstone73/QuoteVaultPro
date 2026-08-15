-- Harden assignment subject kind and repair the deferred trigger's DELETE path.
ALTER TABLE v2_permission_sets ADD COLUMN principal_kind varchar(16) NOT NULL DEFAULT 'staff';
UPDATE v2_permission_sets ps SET principal_kind=t.principal_kind FROM v2_permission_set_templates t WHERE t.template_key=ps.source_template_key;
ALTER TABLE v2_permission_sets ADD CONSTRAINT v2_permission_sets_principal_kind_chk CHECK (principal_kind IN ('staff','portal'));

CREATE OR REPLACE FUNCTION v2_assert_permission_admin_floor() RETURNS trigger AS $$
DECLARE org_id varchar;
BEGIN
  org_id := CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF NOT EXISTS (SELECT 1 FROM v2_permission_organization_state WHERE organization_id=org_id AND admin_floor_enforced) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM v2_staff_permission_set_assignments a JOIN user_organizations m ON m.user_id=a.user_id AND m.organization_id=a.organization_id AND m.is_active=true JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active=true JOIN v2_permission_set_capabilities c ON c.permission_set_id=s.id AND c.organization_id=s.organization_id WHERE a.organization_id=org_id AND a.active AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff') GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2) THEN RAISE EXCEPTION 'v2 permission administrator floor would be violated for organization %',org_id USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION v2_validate_permission_assignment_kind() RETURNS trigger AS $$
DECLARE expected_kind varchar := CASE WHEN TG_TABLE_NAME='v2_staff_permission_set_assignments' THEN 'staff' ELSE 'portal' END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM v2_permission_sets WHERE id=NEW.permission_set_id AND organization_id=NEW.organization_id AND principal_kind=expected_kind) THEN
    RAISE EXCEPTION 'permission set kind does not match assignment subject' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_staff_permission_assignment_kind BEFORE INSERT OR UPDATE OF permission_set_id,organization_id ON v2_staff_permission_set_assignments FOR EACH ROW EXECUTE FUNCTION v2_validate_permission_assignment_kind();
CREATE TRIGGER v2_portal_permission_assignment_kind BEFORE INSERT OR UPDATE OF permission_set_id,organization_id ON v2_portal_permission_set_assignments FOR EACH ROW EXECUTE FUNCTION v2_validate_permission_assignment_kind();
