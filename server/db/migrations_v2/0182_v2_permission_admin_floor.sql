-- Preserve the final V2 permission administrator even when a legacy scoped
-- membership is deactivated during the reconstruction overlap.
ALTER TABLE v2_permission_organization_state ADD COLUMN admin_floor_enforced boolean NOT NULL DEFAULT false;
UPDATE v2_permission_organization_state state SET admin_floor_enforced=true
WHERE EXISTS (
  SELECT 1 FROM v2_staff_permission_set_assignments a JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active
  JOIN v2_permission_set_capabilities c ON c.permission_set_id=s.id AND c.organization_id=s.organization_id
  WHERE a.organization_id=state.organization_id AND a.active AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff')
  GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2
);
CREATE OR REPLACE FUNCTION v2_assert_permission_admin_floor() RETURNS trigger AS $$
DECLARE org_id varchar := COALESCE(NEW.organization_id, OLD.organization_id);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM v2_permission_organization_state WHERE organization_id=org_id AND admin_floor_enforced) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM v2_staff_permission_set_assignments a JOIN user_organizations m ON m.user_id=a.user_id AND m.organization_id=a.organization_id AND m.is_active=true JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active=true JOIN v2_permission_set_capabilities c ON c.permission_set_id=s.id AND c.organization_id=s.organization_id WHERE a.organization_id=org_id AND a.active AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff') GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2) THEN RAISE EXCEPTION 'v2 permission administrator floor would be violated for organization %',org_id USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER v2_permission_admin_floor_assignment AFTER INSERT OR UPDATE OR DELETE ON v2_staff_permission_set_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_assert_permission_admin_floor();
CREATE CONSTRAINT TRIGGER v2_permission_admin_floor_set AFTER UPDATE OF active ON v2_permission_sets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_assert_permission_admin_floor();
CREATE CONSTRAINT TRIGGER v2_permission_admin_floor_capability AFTER INSERT OR UPDATE OR DELETE ON v2_permission_set_capabilities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_assert_permission_admin_floor();
CREATE CONSTRAINT TRIGGER v2_permission_admin_floor_membership AFTER UPDATE OF is_active OR DELETE ON user_organizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_assert_permission_admin_floor();
