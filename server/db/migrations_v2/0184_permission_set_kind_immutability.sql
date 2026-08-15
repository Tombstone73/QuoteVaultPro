-- A set's subject kind is fixed at creation; assignments must never change
-- meaning because a Staff set is later relabeled as a Portal set (or inverse).
CREATE OR REPLACE FUNCTION v2_reject_permission_set_kind_change() RETURNS trigger AS $$
BEGIN
  IF NEW.principal_kind <> OLD.principal_kind AND (
    EXISTS (SELECT 1 FROM v2_staff_permission_set_assignments WHERE organization_id=OLD.organization_id AND permission_set_id=OLD.id)
    OR EXISTS (SELECT 1 FROM v2_portal_permission_set_assignments WHERE organization_id=OLD.organization_id AND permission_set_id=OLD.id)
  ) THEN RAISE EXCEPTION 'permission-set subject kind is immutable after assignment' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_permission_set_kind_immutable
BEFORE UPDATE OF principal_kind ON v2_permission_sets
FOR EACH ROW EXECUTE FUNCTION v2_reject_permission_set_kind_change();
