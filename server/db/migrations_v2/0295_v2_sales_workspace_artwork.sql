-- Artwork owns TEMP binary claims. Sales alone owns workspace/line lifecycle.
ALTER TABLE v2_artwork_storage_upload_intents ADD CONSTRAINT v2_artwork_upload_intents_id_org_unique UNIQUE(id,organization_id);

CREATE TABLE v2_artwork_workspace_claims (
  id text PRIMARY KEY CHECK (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  organization_id varchar NOT NULL,
  workspace_id text NOT NULL,
  workspace_line_id text,
  upload_intent_id varchar NOT NULL,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  request_revision integer NOT NULL CHECK (request_revision > 0),
  accepted_revision integer NOT NULL CHECK (accepted_revision = request_revision + 1),
  filename varchar(120) NOT NULL CHECK (length(btrim(filename)) > 0),
  content_type text NOT NULL CHECK (content_type = 'application/pdf'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  storage_provider text NOT NULL CHECK (storage_provider = 'supabase'),
  object_key text NOT NULL CHECK (object_key = 'v2-artwork/' || organization_id || '/workspaces/' || workspace_id || '/' || id || '.pdf'),
  state text NOT NULL CHECK (state IN ('pending','uploaded','promoted','cleanup_pending','deleted','retained')),
  created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  artwork_file_id varchar,
  canonical_document_kind text CHECK (canonical_document_kind IN ('quote','order')),
  canonical_document_id varchar,
  canonical_line_id varchar,
  assignment_id varchar,
  upload_generation integer NOT NULL DEFAULT 1 CHECK (upload_generation > 0),
  settled_upload_generation integer NOT NULL DEFAULT 0 CHECK (settled_upload_generation BETWEEN 0 AND upload_generation),
  -- A failed provider request may still finish remotely. Absence is not proof
  -- that it cannot arrive later; keep released evidence eligible for rechecks.
  cleanup_recheck_required boolean NOT NULL DEFAULT false,
  cleanup_attempts integer NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  last_error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_artwork_workspace_claims_workspace_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES v2_sales_workspaces(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_artwork_workspace_claims_line_fk FOREIGN KEY(workspace_line_id,organization_id,workspace_id) REFERENCES v2_sales_workspace_lines(id,organization_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT v2_artwork_workspace_claims_intent_fk FOREIGN KEY(upload_intent_id,organization_id) REFERENCES v2_artwork_storage_upload_intents(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_artwork_workspace_claims_file_fk FOREIGN KEY(artwork_file_id,organization_id) REFERENCES v2_artwork_files(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_artwork_workspace_claims_canonical_line_fk FOREIGN KEY(canonical_line_id,organization_id,canonical_document_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_artwork_workspace_claims_request_unique UNIQUE(organization_id,workspace_id,request_id),
  CONSTRAINT v2_artwork_workspace_claims_intent_unique UNIQUE(upload_intent_id),
  CONSTRAINT v2_artwork_workspace_claims_object_unique UNIQUE(organization_id,storage_provider,object_key),
  CONSTRAINT v2_artwork_workspace_claims_settlement_check CHECK (
    state NOT IN ('uploaded','promoted','deleted') OR settled_upload_generation=upload_generation),
  CONSTRAINT v2_artwork_workspace_claims_deleted_check CHECK (state<>'deleted' OR NOT cleanup_recheck_required),
  CONSTRAINT v2_artwork_workspace_claims_promoted_check CHECK (
    (state = 'promoted' AND artwork_file_id IS NOT NULL AND canonical_document_kind IS NOT NULL AND canonical_document_id IS NOT NULL AND canonical_line_id IS NOT NULL AND assignment_id IS NOT NULL)
    OR (state <> 'promoted' AND canonical_document_kind IS NULL AND canonical_document_id IS NULL AND canonical_line_id IS NULL AND assignment_id IS NULL))
);
-- This first staging surface has one unlayered customer-source slot per line.
CREATE UNIQUE INDEX v2_artwork_workspace_claims_live_line_unique ON v2_artwork_workspace_claims(organization_id,workspace_id,workspace_line_id) WHERE state IN ('pending','uploaded');
CREATE INDEX v2_artwork_workspace_claims_cleanup_idx ON v2_artwork_workspace_claims(organization_id,state,updated_at,id);

-- Fence every canonical writer, including an old caller that does not know
-- workspace locks. Cleanup commits its tombstone before any external delete.
CREATE FUNCTION v2_artwork_workspace_adoption_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim v2_artwork_workspace_claims%ROWTYPE; workspace_state text;
BEGIN
  IF NEW.object_key NOT LIKE 'v2-artwork/%/workspaces/%' THEN RETURN NEW; END IF;
  SELECT * INTO claim FROM v2_artwork_workspace_claims
    WHERE organization_id=NEW.organization_id AND storage_provider=NEW.storage_provider AND object_key=NEW.object_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace Artwork claim is required' USING ERRCODE='23514'; END IF;
  SELECT state INTO workspace_state FROM v2_sales_workspaces WHERE organization_id=claim.organization_id AND id=claim.workspace_id;
  IF claim.state NOT IN ('uploaded','promoted') OR workspace_state NOT IN ('promoting','promoted')
    OR NEW.content_type <> claim.content_type OR NEW.byte_size <> claim.byte_size
    OR NEW.checksum_algorithm IS DISTINCT FROM 'sha256' OR NEW.checksum_value IS DISTINCT FROM claim.checksum_sha256 THEN
    RAISE EXCEPTION 'Workspace Artwork is not available for canonical adoption' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_artwork_workspace_adoption_guard BEFORE INSERT OR UPDATE OF object_key,storage_provider,organization_id ON v2_artwork_files FOR EACH ROW EXECUTE FUNCTION v2_artwork_workspace_adoption_guard();

CREATE FUNCTION v2_artwork_workspace_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Artwork cleanup evidence must be retained' USING ERRCODE='23514'; END IF;
  IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.workspace_id<>OLD.workspace_id
    OR NEW.upload_intent_id<>OLD.upload_intent_id OR NEW.request_id<>OLD.request_id OR NEW.request_fingerprint<>OLD.request_fingerprint
    OR NEW.object_key<>OLD.object_key OR NEW.storage_provider<>OLD.storage_provider OR NEW.checksum_sha256<>OLD.checksum_sha256
    OR NEW.byte_size<>OLD.byte_size OR NEW.filename<>OLD.filename OR NEW.content_type<>OLD.content_type
    OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.request_revision<>OLD.request_revision OR NEW.accepted_revision<>OLD.accepted_revision THEN
    RAISE EXCEPTION 'Artwork claim identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state IN ('promoted','deleted','retained') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal Artwork claim is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.upload_generation NOT IN (OLD.upload_generation,OLD.upload_generation+1)
    OR NEW.settled_upload_generation<OLD.settled_upload_generation
    OR (OLD.cleanup_recheck_required AND NOT NEW.cleanup_recheck_required) THEN
    RAISE EXCEPTION 'Artwork upload settlement evidence cannot be reset' USING ERRCODE='23514';
  END IF;
  IF NEW.upload_generation<>OLD.upload_generation AND
    (OLD.state<>'pending' OR NEW.state<>'pending' OR OLD.upload_generation<>OLD.settled_upload_generation
      OR NEW.settled_upload_generation<>OLD.settled_upload_generation) THEN
    RAISE EXCEPTION 'Only a settled pending upload can start another attempt' USING ERRCODE='23514';
  END IF;
  IF OLD.state='cleanup_pending' AND NEW.state NOT IN ('cleanup_pending','deleted','retained') THEN
    RAISE EXCEPTION 'Released Artwork cannot become live again' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_artwork_workspace_claim_guard BEFORE UPDATE OR DELETE ON v2_artwork_workspace_claims FOR EACH ROW EXECUTE FUNCTION v2_artwork_workspace_claim_guard();
