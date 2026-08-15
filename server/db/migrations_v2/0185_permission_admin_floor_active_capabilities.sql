-- Final-admin authority uses the same active-capability semantics as issuance.
CREATE OR REPLACE FUNCTION v2_assert_permission_admin_floor() RETURNS trigger AS $$
DECLARE org_id varchar;
BEGIN
  org_id := CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF NOT EXISTS (SELECT 1 FROM v2_permission_organization_state WHERE organization_id=org_id AND admin_floor_enforced) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM v2_staff_permission_set_assignments a JOIN user_organizations m ON m.user_id=a.user_id AND m.organization_id=a.organization_id AND m.is_active=true JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active=true JOIN v2_permission_set_capabilities c ON c.permission_set_id=s.id AND c.organization_id=s.organization_id JOIN v2_permission_capabilities catalog ON catalog.id=c.capability_id AND catalog.active=true WHERE a.organization_id=org_id AND a.active AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff') GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2) THEN RAISE EXCEPTION 'v2 permission administrator floor would be violated for organization %',org_id USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
