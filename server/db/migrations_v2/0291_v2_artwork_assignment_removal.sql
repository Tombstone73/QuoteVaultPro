-- Removal is an append-only assignment fact, not file deletion or supersession.
CREATE TABLE v2_artwork_assignment_removals (
  organization_id varchar NOT NULL,
  artwork_assignment_id varchar NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now(),
  removed_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (organization_id, artwork_assignment_id),
  FOREIGN KEY (artwork_assignment_id, organization_id)
    REFERENCES v2_artwork_assignments(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_artwork_assignment_removals_actor_idx ON v2_artwork_assignment_removals(removed_by_user_id);

CREATE VIEW v2_current_artwork_assignments AS
SELECT a.* FROM v2_artwork_assignments a
WHERE NOT EXISTS (SELECT 1 FROM v2_artwork_assignment_removals r WHERE r.organization_id=a.organization_id AND r.artwork_assignment_id=a.id)
  AND NOT EXISTS (SELECT 1 FROM v2_artwork_assignments s WHERE s.organization_id=a.organization_id AND s.supersedes_artwork_assignment_id=a.id);

CREATE FUNCTION v2_artwork_removal_validate() RETURNS trigger AS $$
DECLARE target record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Artwork removal history is immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO target FROM v2_artwork_assignments WHERE organization_id=NEW.organization_id AND id=NEW.artwork_assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Artwork assignment was not found' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM v2_sales_order_details WHERE organization_id=NEW.organization_id AND document_id=target.order_document_id AND commercial_state='open' AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Artwork removal requires an open unarchived Order' USING ERRCODE='23514'; END IF;
  -- Reference writers below take the same row lock before binding an assignment.
  PERFORM 1 FROM v2_artwork_assignments WHERE organization_id=NEW.organization_id AND id=target.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM v2_artwork_assignments WHERE organization_id=NEW.organization_id AND supersedes_artwork_assignment_id=target.id)
  THEN RAISE EXCEPTION 'Only current Artwork assignments can be removed' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM v2_proof_version_artwork binding
    JOIN v2_proof_versions version ON version.organization_id=binding.organization_id AND version.id=binding.proof_version_id
    WHERE binding.organization_id=NEW.organization_id AND binding.artwork_assignment_id=target.id
      AND version.id=(SELECT latest.id FROM v2_proof_versions latest WHERE latest.organization_id=version.organization_id AND latest.proof_work_id=version.proof_work_id ORDER BY latest.sequence DESC LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM v2_proof_responses response WHERE response.organization_id=version.organization_id AND response.proof_version_id=version.id AND response.outcome='revision_requested')
  ) THEN RAISE EXCEPTION 'Artwork is in use by the current Proof; a revision request or a newer Proof without this Artwork is required' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM v2_prepress_units WHERE organization_id=NEW.organization_id AND artwork_assignment_id=target.id)
    OR EXISTS (SELECT 1 FROM v2_production_works WHERE organization_id=NEW.organization_id AND artwork_assignment_id=target.id)
  THEN RAISE EXCEPTION 'Artwork is in use by Prepress or Production and cannot be removed' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_artwork_removal_validate_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_artwork_assignment_removals
FOR EACH ROW EXECUTE FUNCTION v2_artwork_removal_validate();

-- Protect new references from a concurrent removal, without changing old evidence.
CREATE FUNCTION v2_artwork_removed_reference_validate() RETURNS trigger AS $$
DECLARE target_id varchar;
BEGIN
  IF TG_TABLE_NAME='v2_artwork_assignments' THEN target_id := NEW.supersedes_artwork_assignment_id;
  ELSE target_id := NEW.artwork_assignment_id; END IF;
  IF target_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM v2_artwork_assignments WHERE organization_id=NEW.organization_id AND id=target_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM v2_artwork_assignment_removals WHERE organization_id=NEW.organization_id AND artwork_assignment_id=target_id)
  THEN RAISE EXCEPTION 'Removed Artwork cannot be used for new workflow evidence or supersession' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_artwork_removed_reference_trigger BEFORE INSERT OR UPDATE OF artwork_assignment_id,organization_id ON v2_proof_version_artwork
FOR EACH ROW EXECUTE FUNCTION v2_artwork_removed_reference_validate();
CREATE TRIGGER v2_artwork_removed_reference_trigger BEFORE INSERT OR UPDATE OF artwork_assignment_id,organization_id ON v2_prepress_units
FOR EACH ROW EXECUTE FUNCTION v2_artwork_removed_reference_validate();
CREATE TRIGGER v2_artwork_removed_reference_trigger BEFORE INSERT OR UPDATE OF artwork_assignment_id,organization_id ON v2_production_works
FOR EACH ROW EXECUTE FUNCTION v2_artwork_removed_reference_validate();
CREATE TRIGGER v2_artwork_removed_reference_trigger BEFORE INSERT ON v2_artwork_assignments
FOR EACH ROW EXECUTE FUNCTION v2_artwork_removed_reference_validate();
