-- M2.1 hardening: application validation already requires proof evidence
-- before issuance. PostgreSQL needs a trigger because a CHECK cannot count
-- child Artwork rows across v2_proof_version_artwork.
CREATE OR REPLACE FUNCTION v2_proof_version_issuance_evidence_validate() RETURNS trigger AS $$
BEGIN
  IF NEW.issued_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2_proof_version_artwork
    WHERE organization_id=NEW.organization_id AND proof_version_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'Proof Version needs Artwork evidence before issuance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER v2_proof_version_issuance_evidence_validate_trigger
  BEFORE INSERT OR UPDATE OF issued_at ON v2_proof_versions
  FOR EACH ROW EXECUTE FUNCTION v2_proof_version_issuance_evidence_validate();
