-- Sales TEMP persistence only. IDs are allocated by the application; no extension required.
CREATE TABLE v2_sales_workspaces (
  id text PRIMARY KEY CHECK (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  creator_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('new_sales','quote_edit','order_edit')),
  state text NOT NULL CHECK (state IN ('draft','promoting','promoted','discarded','expired')),
  source_document_kind text CHECK (source_document_kind IN ('quote','order')),
  source_document_id text,
  base_revision text,
  revision integer NOT NULL CHECK (revision > 0),
  header_json jsonb NOT NULL CHECK (jsonb_typeof(header_json) = 'object' AND octet_length(header_json::text) <= 32768),
  creation_request_id text NOT NULL CHECK (length(creation_request_id) BETWEEN 1 AND 128),
  creation_fingerprint text NOT NULL CHECK (creation_fingerprint ~ '^[0-9a-f]{64}$'),
  promotion_request_id text CHECK (length(promotion_request_id) BETWEEN 1 AND 128),
  promotion_target text CHECK (promotion_target IN ('quote','order')),
  promotion_fingerprint text CHECK (promotion_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  CONSTRAINT v2_sales_workspaces_id_org_unique UNIQUE(id,organization_id),
  CONSTRAINT v2_sales_workspaces_creation_unique UNIQUE(organization_id,creation_request_id),
  CONSTRAINT v2_sales_workspaces_promotion_request_unique UNIQUE(organization_id,promotion_request_id),
  CONSTRAINT v2_sales_workspaces_promotion_identity_check CHECK (
    (state IN ('promoting','promoted') AND promotion_request_id IS NOT NULL AND promotion_target IS NOT NULL AND promotion_fingerprint IS NOT NULL)
    OR (state IN ('draft','discarded','expired') AND promotion_request_id IS NULL AND promotion_target IS NULL AND promotion_fingerprint IS NULL)),
  CONSTRAINT v2_sales_workspaces_source_check CHECK (
    (kind = 'new_sales' AND source_document_kind IS NULL AND source_document_id IS NULL AND base_revision IS NULL)
    OR (kind = 'quote_edit' AND source_document_kind IS NOT NULL AND source_document_kind = 'quote' AND source_document_id IS NOT NULL AND base_revision IS NOT NULL)
    OR (kind = 'order_edit' AND source_document_kind IS NOT NULL AND source_document_kind = 'order' AND source_document_id IS NOT NULL AND base_revision IS NOT NULL))
);
CREATE INDEX v2_sales_workspaces_resume_idx ON v2_sales_workspaces(organization_id,creator_user_id,updated_at DESC,id) WHERE state = 'draft';
CREATE INDEX v2_sales_workspaces_expiry_idx ON v2_sales_workspaces(expires_at,id) WHERE state = 'draft';

CREATE TABLE v2_sales_workspace_lines (
  id text PRIMARY KEY CHECK (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  organization_id varchar NOT NULL,
  workspace_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  source_line_id varchar,
  input_json jsonb NOT NULL CHECK (jsonb_typeof(input_json) = 'object' AND octet_length(input_json::text) <= 65536),
  preview_json jsonb CHECK (jsonb_typeof(preview_json) = 'object' AND octet_length(preview_json::text) <= 262144),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_sales_workspace_lines_workspace_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES v2_sales_workspaces(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_workspace_lines_source_fk FOREIGN KEY(source_line_id,organization_id) REFERENCES v2_sales_document_lines(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_workspace_lines_id_org_workspace_unique UNIQUE(id,organization_id,workspace_id),
  CONSTRAINT v2_sales_workspace_lines_position_unique UNIQUE(organization_id,workspace_id,position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE v2_sales_workspace_requests (
  organization_id varchar NOT NULL,
  workspace_id text NOT NULL,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 80),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json) = 'object' AND octet_length(result_json::text) <= 16777216),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,workspace_id,request_id),
  CONSTRAINT v2_sales_workspace_requests_workspace_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES v2_sales_workspaces(id,organization_id) ON DELETE RESTRICT
);

CREATE TABLE v2_sales_workspace_promotions (
  organization_id varchar NOT NULL,
  workspace_id text NOT NULL,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  input_revision integer NOT NULL CHECK (input_revision > 0),
  target text NOT NULL CHECK (target IN ('quote','order')),
  document_id varchar NOT NULL,
  document_revision text NOT NULL CHECK (length(document_revision) BETWEEN 1 AND 128),
  display_number text CHECK (length(display_number) <= 200),
  header_json jsonb NOT NULL CHECK (jsonb_typeof(header_json) = 'object' AND octet_length(header_json::text) <= 32768),
  promoted_at timestamptz NOT NULL,
  result_json jsonb CHECK (jsonb_typeof(result_json) = 'object' AND octet_length(result_json::text) <= 16777216),
  artwork_promoted boolean,
  PRIMARY KEY(organization_id,workspace_id),
  CONSTRAINT v2_sales_workspace_promotions_request_unique UNIQUE(organization_id,request_id),
  CONSTRAINT v2_sales_workspace_promotions_document_unique UNIQUE(organization_id,workspace_id,document_id),
  CONSTRAINT v2_sales_workspace_promotions_workspace_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES v2_sales_workspaces(id,organization_id) ON DELETE RESTRICT
);

CREATE TABLE v2_sales_workspace_promotion_lines (
  organization_id varchar NOT NULL,
  workspace_id text NOT NULL,
  workspace_line_id text NOT NULL,
  document_id varchar NOT NULL,
  canonical_line_id varchar NOT NULL,
  target text NOT NULL CHECK (target IN ('quote','order')),
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY(organization_id,workspace_id,workspace_line_id),
  CONSTRAINT v2_sales_workspace_promotion_lines_position_unique UNIQUE(organization_id,workspace_id,position),
  CONSTRAINT v2_sales_workspace_promotion_lines_canonical_unique UNIQUE(organization_id,workspace_id,canonical_line_id),
  CONSTRAINT v2_sales_workspace_promotion_lines_receipt_fk FOREIGN KEY(organization_id,workspace_id,document_id) REFERENCES v2_sales_workspace_promotions(organization_id,workspace_id,document_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT v2_sales_workspace_promotion_lines_temp_fk FOREIGN KEY(workspace_line_id,organization_id,workspace_id) REFERENCES v2_sales_workspace_lines(id,organization_id,workspace_id) ON DELETE RESTRICT
);

-- Validate membership when publishing history, without pinning mutable canonical
-- rows forever. Key-share locks protect the tuple until this transaction ends.
CREATE FUNCTION v2_sales_workspace_assert_canonical_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM v2_sales_document_lines
    WHERE id=NEW.canonical_line_id AND organization_id=NEW.organization_id AND document_id=NEW.document_id
    FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace promotion canonical line is outside its document or organization'
      USING ERRCODE='23503', CONSTRAINT='v2_sales_workspace_promotion_lines_canonical_fk';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_sales_workspace_map_canonical_insert BEFORE INSERT ON v2_sales_workspace_promotion_lines
  FOR EACH ROW EXECUTE FUNCTION v2_sales_workspace_assert_canonical_line();

-- A promoting marker may exist within a transaction, never in committed state.
-- The final receipt and its complete positional line map are one atomic fact.
CREATE FUNCTION v2_sales_workspace_assert_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  workspace_key text;
  org_key varchar;
  current_state text;
  line_count integer;
  map_count integer;
  canonical_count integer;
  receipt_count integer;
BEGIN
  IF TG_TABLE_NAME = 'v2_sales_workspaces' THEN
    workspace_key := NEW.id; org_key := NEW.organization_id;
  ELSE
    workspace_key := NEW.workspace_id; org_key := NEW.organization_id;
  END IF;
  SELECT state INTO current_state FROM v2_sales_workspaces WHERE id = workspace_key AND organization_id = org_key;
  IF current_state = 'promoting' THEN RAISE EXCEPTION 'Workspace cannot commit in promoting state' USING ERRCODE = '23514'; END IF;
  SELECT count(*) INTO receipt_count FROM v2_sales_workspace_promotions WHERE workspace_id = workspace_key AND organization_id = org_key;
  IF (current_state = 'promoted') <> (receipt_count = 1) THEN
    RAISE EXCEPTION 'Workspace promotion requires its terminal receipt' USING ERRCODE = '23514';
  END IF;
  IF current_state = 'promoted' THEN
    SELECT count(*) INTO line_count FROM v2_sales_workspace_lines WHERE workspace_id = workspace_key AND organization_id = org_key;
    SELECT count(*) INTO map_count FROM v2_sales_workspace_promotion_lines WHERE workspace_id = workspace_key AND organization_id = org_key;
    IF line_count = 0 OR line_count <> map_count OR EXISTS (
      SELECT 1 FROM v2_sales_workspace_promotion_lines m
      JOIN v2_sales_workspace_lines l ON l.id = m.workspace_line_id AND l.organization_id = m.organization_id AND l.workspace_id = m.workspace_id
      WHERE m.workspace_id = workspace_key AND m.organization_id = org_key AND m.position <> l.position
    ) OR EXISTS (
      SELECT 1 FROM v2_sales_workspace_promotions p JOIN v2_sales_workspaces w ON w.id=p.workspace_id AND w.organization_id=p.organization_id
      WHERE p.workspace_id=workspace_key AND p.organization_id=org_key AND (p.input_revision+1<>w.revision OR p.header_json<>w.header_json
        OR p.request_id<>w.promotion_request_id OR p.target<>w.promotion_target OR p.fingerprint<>w.promotion_fingerprint)
    ) OR EXISTS (
      SELECT 1 FROM v2_sales_workspace_promotion_lines m JOIN v2_sales_workspace_promotions p USING(organization_id,workspace_id)
      WHERE m.workspace_id=workspace_key AND m.organization_id=org_key AND m.target<>p.target
    ) THEN RAISE EXCEPTION 'Workspace promotion line map is incomplete' USING ERRCODE = '23514'; END IF;
    -- Recheck after all owner writes: the same transaction may have deleted or
    -- replaced a canonical row after inserting its map. Later transactions may
    -- edit canonical lines without rewriting this immutable promotion history.
    PERFORM l.id FROM v2_sales_document_lines l
      JOIN v2_sales_workspace_promotion_lines m ON l.id=m.canonical_line_id
        AND l.organization_id=m.organization_id AND l.document_id=m.document_id
      WHERE m.workspace_id=workspace_key AND m.organization_id=org_key FOR KEY SHARE OF l;
    GET DIAGNOSTICS canonical_count = ROW_COUNT;
    IF canonical_count <> map_count THEN
      RAISE EXCEPTION 'Workspace promotion canonical line disappeared before commit'
        USING ERRCODE='23503', CONSTRAINT='v2_sales_workspace_promotion_lines_canonical_fk';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER v2_sales_workspace_terminal_check AFTER INSERT OR UPDATE ON v2_sales_workspaces DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_sales_workspace_assert_terminal();
CREATE CONSTRAINT TRIGGER v2_sales_workspace_receipt_check AFTER INSERT OR UPDATE ON v2_sales_workspace_promotions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_sales_workspace_assert_terminal();

CREATE FUNCTION v2_sales_workspace_guard_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state text;
BEGIN
  IF TG_TABLE_NAME = 'v2_sales_workspaces' THEN
    IF TG_OP = 'DELETE' OR OLD.state IN ('promoted','discarded','expired') THEN
      RAISE EXCEPTION 'Terminal workspace is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.state='promoting' THEN
      IF OLD.state='draft' AND
        (to_jsonb(NEW)-ARRAY['state','promotion_request_id','promotion_target','promotion_fingerprint'])=
        (to_jsonb(OLD)-ARRAY['state','promotion_request_id','promotion_target','promotion_fingerprint']) THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'Promotion reservation cannot change workspace input or revision' USING ERRCODE = '23514';
    END IF;
    IF (OLD.state='promoting' AND (NEW.state<>'promoted' OR NEW.header_json<>OLD.header_json))
      OR NEW.promotion_request_id IS DISTINCT FROM OLD.promotion_request_id
      OR NEW.promotion_target IS DISTINCT FROM OLD.promotion_target
      OR NEW.promotion_fingerprint IS DISTINCT FROM OLD.promotion_fingerprint THEN
      RAISE EXCEPTION 'Workspace promotion reservation is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.creator_user_id <> OLD.creator_user_id
      OR NEW.kind <> OLD.kind OR NEW.creation_request_id <> OLD.creation_request_id OR NEW.creation_fingerprint <> OLD.creation_fingerprint
      OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at OR NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'Invalid workspace identity or revision change' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'v2_sales_workspace_lines' THEN
    SELECT state INTO current_state FROM v2_sales_workspaces
      WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END
        AND organization_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END FOR UPDATE;
    IF current_state <> 'draft' THEN RAISE EXCEPTION 'Workspace lines require an active draft' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.organization_id <> OLD.organization_id) THEN
      RAISE EXCEPTION 'Workspace line identity is immutable' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Workspace receipt is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_sales_workspace_mutation_guard BEFORE UPDATE OR DELETE ON v2_sales_workspaces FOR EACH ROW EXECUTE FUNCTION v2_sales_workspace_guard_mutation();
CREATE TRIGGER v2_sales_workspace_line_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON v2_sales_workspace_lines FOR EACH ROW EXECUTE FUNCTION v2_sales_workspace_guard_mutation();
CREATE TRIGGER v2_sales_workspace_request_immutable BEFORE UPDATE OR DELETE ON v2_sales_workspace_requests FOR EACH ROW EXECUTE FUNCTION v2_sales_workspace_guard_mutation();
CREATE TRIGGER v2_sales_workspace_receipt_immutable BEFORE UPDATE OR DELETE ON v2_sales_workspace_promotions FOR EACH ROW EXECUTE FUNCTION v2_sales_workspace_guard_mutation();
CREATE TRIGGER v2_sales_workspace_map_immutable BEFORE UPDATE OR DELETE ON v2_sales_workspace_promotion_lines FOR EACH ROW EXECUTE FUNCTION v2_sales_workspace_guard_mutation();
