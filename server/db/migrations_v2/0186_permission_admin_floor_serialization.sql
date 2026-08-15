-- Serialize every deferred final-admin floor check on the owning organization.
-- This closes write-skew across direct assignment, set, capability, and legacy
-- membership reductions that bypass the application administration service.
CREATE OR REPLACE FUNCTION v2_assert_permission_admin_floor() RETURNS trigger AS $$
DECLARE org_id varchar;
BEGIN
  org_id := CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF NOT EXISTS (SELECT 1 FROM v2_permission_organization_state WHERE organization_id=org_id AND admin_floor_enforced) THEN RETURN NULL; END IF;
  PERFORM id FROM organizations WHERE id=org_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM v2_staff_permission_set_assignments a JOIN user_organizations m ON m.user_id=a.user_id AND m.organization_id=a.organization_id AND m.is_active=true JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active=true JOIN v2_permission_set_capabilities c ON c.permission_set_id=s.id AND c.organization_id=s.organization_id JOIN v2_permission_capabilities catalog ON catalog.id=c.capability_id AND catalog.active=true WHERE a.organization_id=org_id AND a.active AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff') GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2) THEN RAISE EXCEPTION 'v2 permission administrator floor would be violated for organization %',org_id USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

-- Legacy membership remains a live authority fact during reconstruction. Keep
-- the V2 optimistic authority revision coherent when that scoped fact changes.
CREATE OR REPLACE FUNCTION v2_advance_permission_membership_revision() RETURNS trigger AS $$
DECLARE org_id varchar;
BEGIN
  org_id := CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF TG_OP='UPDATE' AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN RETURN NULL; END IF;
  UPDATE v2_permission_organization_state SET authority_revision=authority_revision+1,updated_at=now() WHERE organization_id=org_id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS v2_permission_membership_authority_revision ON user_organizations;
CREATE CONSTRAINT TRIGGER v2_permission_membership_authority_revision
AFTER UPDATE OF is_active OR DELETE ON user_organizations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_advance_permission_membership_revision();
