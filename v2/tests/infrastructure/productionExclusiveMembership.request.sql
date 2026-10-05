-- Parent-owned forward migration request/acceptance fixture; not a migration.
-- Existing overlapping active memberships must fail the unique-index build;
-- this request deliberately does not invent a de-duplication/cancellation policy.
ALTER TABLE v2_production_run_allocations ADD COLUMN membership_active boolean;
UPDATE v2_production_run_allocations a SET membership_active=(a.released_at IS NULL AND r.state IN ('draft','ready','active','held')) FROM v2_production_runs r WHERE r.organization_id=a.organization_id AND r.id=a.production_run_id;
ALTER TABLE v2_production_run_allocations ALTER COLUMN membership_active SET NOT NULL;
CREATE UNIQUE INDEX v2_production_run_allocations_exclusive_active_uidx ON v2_production_run_allocations(organization_id,production_work_id) WHERE membership_active;
-- Acquire the owner gate before statement tuple locks, including raw DML.
-- Owner APIs acquire the same gate before existing Run/Work tuple locks.
CREATE FUNCTION v2_production_run_membership_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(1886547812,1209);
  RETURN NULL;
END;
$$;
CREATE TRIGGER v2_production_run_membership_gate_runs BEFORE INSERT OR UPDATE OR DELETE ON v2_production_runs FOR EACH STATEMENT EXECUTE FUNCTION v2_production_run_membership_gate();
CREATE TRIGGER v2_production_run_membership_gate_allocations BEFORE INSERT OR UPDATE OR DELETE ON v2_production_run_allocations FOR EACH STATEMENT EXECUTE FUNCTION v2_production_run_membership_gate();
CREATE FUNCTION v2_production_run_membership_bind() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state varchar; old_work varchar;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.production_run_id IS DISTINCT FROM OLD.production_run_id THEN RAISE EXCEPTION 'Production allocation identity is immutable'; END IF;
    old_work:=OLD.production_work_id;
  END IF;
  SELECT state INTO parent_state FROM v2_production_runs WHERE organization_id=NEW.organization_id AND id=NEW.production_run_id FOR UPDATE;
  IF parent_state IS NULL THEN RAISE EXCEPTION 'Production allocation parent was not found'; END IF;
  IF TG_OP='UPDATE' AND NEW.production_work_id IS DISTINCT FROM OLD.production_work_id AND (parent_state NOT IN ('draft','ready') OR OLD.production_attempt_id IS NOT NULL) THEN RAISE EXCEPTION 'Started Production allocation work identity is immutable'; END IF;
  PERFORM id FROM v2_production_works WHERE organization_id=NEW.organization_id AND id IN (NEW.production_work_id,old_work) ORDER BY id FOR UPDATE;
  NEW.membership_active:=NEW.released_at IS NULL AND parent_state IN ('draft','ready','active','held');
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_production_run_membership_bind_trigger BEFORE INSERT OR UPDATE ON v2_production_run_allocations FOR EACH ROW EXECUTE FUNCTION v2_production_run_membership_bind();
CREATE FUNCTION v2_production_run_membership_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM w.id FROM v2_production_works w JOIN v2_production_run_allocations a ON a.organization_id=w.organization_id AND a.production_work_id=w.id WHERE a.organization_id=NEW.organization_id AND a.production_run_id=NEW.id ORDER BY w.id FOR UPDATE OF w;
  UPDATE v2_production_run_allocations SET membership_active=(released_at IS NULL AND NEW.state IN ('draft','ready','active','held')) WHERE organization_id=NEW.organization_id AND production_run_id=NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_production_run_membership_state_trigger AFTER UPDATE OF state ON v2_production_runs FOR EACH ROW EXECUTE FUNCTION v2_production_run_membership_state();
