-- Forward-only Sales TEMP edit evidence. Historical 0294/0295 remain unchanged.
ALTER TABLE v2_sales_documents ADD COLUMN job_label varchar(300);
ALTER TABLE v2_sales_documents ADD CONSTRAINT v2_sales_documents_job_label_check
  CHECK (job_label IS NULL OR char_length(job_label) <= 300);

-- Only one tenant/document-bound creation receipt is unambiguous. JSON numbers,
-- arrays and objects are not labels, and an existing canonical label wins.
-- Match normalizeSalesJobLabel: UTF-16 length and its exact forbidden ranges.
-- NUL cannot occur in PostgreSQL jsonb; valid historical whitespace is retained.
WITH candidates AS (
  SELECT p.organization_id,p.document_id,
    min(CASE WHEN jsonb_typeof(p.header_json->'jobLabel')='string'
      AND char_length(p.header_json->>'jobLabel')
        + char_length(regexp_replace(p.header_json->>'jobLabel',U&'[\0001-\ffff]','','g'))<=300
      AND p.header_json->>'jobLabel' !~ U&'[\0001-\001f\007f-\009f\202a-\202e\2066-\2069]'
      THEN p.header_json->>'jobLabel' END) AS label
  FROM v2_sales_workspace_promotions p
  JOIN v2_sales_workspaces w ON w.organization_id=p.organization_id AND w.id=p.workspace_id
    AND w.kind='new_sales' AND w.state='promoted'
  JOIN v2_sales_documents d ON d.organization_id=p.organization_id AND d.id=p.document_id AND d.document_kind=p.target
  GROUP BY p.organization_id,p.document_id HAVING count(*)=1
)
UPDATE v2_sales_documents d SET job_label=c.label FROM candidates c
  WHERE d.organization_id=c.organization_id AND d.id=c.document_id AND d.job_label IS NULL AND c.label IS NOT NULL;

ALTER TABLE v2_sales_workspaces ADD COLUMN source_header_json jsonb;
ALTER TABLE v2_sales_workspaces ADD COLUMN source_artifact_fingerprint text;
ALTER TABLE v2_sales_workspaces ADD CONSTRAINT v2_sales_workspaces_edit_evidence_check CHECK (
  (kind='order_edit' AND source_header_json IS NOT NULL AND jsonb_typeof(source_header_json)='object'
    AND octet_length(source_header_json::text)<=262144
    AND (source_header_json->>'orderId') IS NOT DISTINCT FROM source_document_id
    AND (source_header_json->>'organizationId') IS NOT DISTINCT FROM organization_id
    AND (NOT(source_header_json ? 'orderNumber') OR (jsonb_typeof(source_header_json->'orderNumber')='string'
      AND char_length(source_header_json->>'orderNumber') BETWEEN 1 AND 300) IS TRUE)
    AND source_artifact_fingerprint IS NOT NULL AND source_artifact_fingerprint ~ '^(sha256:)?[a-f0-9]{64}$'
    AND length(base_revision) BETWEEN 1 AND 128)
  OR (kind<>'order_edit' AND source_header_json IS NULL AND source_artifact_fingerprint IS NULL));
CREATE UNIQUE INDEX v2_sales_workspaces_active_order_edit_unique
  ON v2_sales_workspaces(organization_id,creator_user_id,source_document_id)
  WHERE kind='order_edit' AND state IN ('draft','promoting');

ALTER TABLE v2_sales_workspace_lines DROP CONSTRAINT v2_sales_workspace_lines_source_fk;
ALTER TABLE v2_sales_workspace_lines ADD COLUMN source_snapshot jsonb;
ALTER TABLE v2_sales_workspace_lines ADD COLUMN source_position integer;
ALTER TABLE v2_sales_workspace_lines ADD COLUMN operational_note varchar(4000);
ALTER TABLE v2_sales_workspace_lines ADD COLUMN removed boolean NOT NULL DEFAULT false;
ALTER TABLE v2_sales_workspace_lines ADD CONSTRAINT v2_sales_workspace_lines_source_evidence_check CHECK (
  (source_line_id IS NULL AND source_snapshot IS NULL AND source_position IS NULL AND removed=false)
  OR (source_line_id IS NOT NULL AND source_snapshot IS NOT NULL AND jsonb_typeof(source_snapshot)='object'
    AND octet_length(source_snapshot::text)<=262144 AND (source_snapshot->>'lineId') IS NOT DISTINCT FROM source_line_id
    AND source_position IS NOT NULL AND source_position>=0));
CREATE UNIQUE INDEX v2_sales_workspace_lines_source_unique
  ON v2_sales_workspace_lines(organization_id,workspace_id,source_line_id) WHERE source_line_id IS NOT NULL;
CREATE UNIQUE INDEX v2_sales_workspace_lines_source_position_unique
  ON v2_sales_workspace_lines(organization_id,workspace_id,source_position) WHERE source_line_id IS NOT NULL;

CREATE TABLE v2_sales_order_edit_starts (
  organization_id varchar NOT NULL,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  workspace_id text NOT NULL,
  creator_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=16777216),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,request_id),
  CONSTRAINT v2_sales_order_edit_starts_workspace_fk FOREIGN KEY(workspace_id,organization_id)
    REFERENCES v2_sales_workspaces(id,organization_id) ON DELETE RESTRICT
);
CREATE TRIGGER v2_sales_order_edit_start_immutable BEFORE UPDATE OR DELETE ON v2_sales_order_edit_starts
  FOR EACH ROW EXECUTE FUNCTION v2_sales_workspace_guard_mutation();

CREATE FUNCTION v2_sales_order_edit_guard_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_document text; workspace_kind text;
BEGIN
  IF TG_TABLE_NAME='v2_sales_workspaces' THEN
    IF TG_OP='UPDATE' AND (NEW.source_document_kind IS DISTINCT FROM OLD.source_document_kind
      OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id OR NEW.base_revision IS DISTINCT FROM OLD.base_revision
      OR NEW.source_header_json IS DISTINCT FROM OLD.source_header_json
      OR NEW.source_artifact_fingerprint IS DISTINCT FROM OLD.source_artifact_fingerprint) THEN
      RAISE EXCEPTION 'Workspace source identity and evidence are immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' AND NEW.kind='order_edit' THEN
      PERFORM 1 FROM v2_sales_documents WHERE organization_id=NEW.organization_id AND id=NEW.source_document_id
        AND document_kind='order' AND revision::text=NEW.base_revision FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Workspace source Order or revision is outside its organization' USING ERRCODE='23503'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.source_line_id IS NOT NULL THEN RAISE EXCEPTION 'Source TEMP line evidence requires a removal tombstone' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.source_line_id IS DISTINCT FROM OLD.source_line_id OR NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot
      OR NEW.source_position IS DISTINCT FROM OLD.source_position OR (OLD.removed AND NOT NEW.removed) THEN
      RAISE EXCEPTION 'Source line identity and evidence are immutable' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.source_line_id IS NOT NULL THEN
    SELECT source_document_id,kind INTO source_document,workspace_kind FROM v2_sales_workspaces
      WHERE organization_id=NEW.organization_id AND id=NEW.workspace_id;
    IF workspace_kind<>'order_edit' THEN RAISE EXCEPTION 'Source lines require an Order edit workspace' USING ERRCODE='23514'; END IF;
    PERFORM 1 FROM v2_sales_document_lines WHERE organization_id=NEW.organization_id AND id=NEW.source_line_id
      AND document_id=source_document FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Workspace source line is outside its Order or organization' USING ERRCODE='23503'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_sales_order_edit_workspace_source_guard BEFORE INSERT OR UPDATE ON v2_sales_workspaces
  FOR EACH ROW EXECUTE FUNCTION v2_sales_order_edit_guard_source();
CREATE TRIGGER v2_sales_order_edit_line_source_guard BEFORE INSERT OR UPDATE OR DELETE ON v2_sales_workspace_lines
  FOR EACH ROW EXECUTE FUNCTION v2_sales_order_edit_guard_source();

-- The existing deferred terminal invariant now counts live lines only. Source
-- tombstones do not map to canonical rows and never pin later canonical deletion.
CREATE OR REPLACE FUNCTION v2_sales_workspace_assert_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace_key text; org_key varchar; current_state text; line_count integer;
  map_count integer; canonical_count integer; receipt_count integer;
BEGIN
  IF TG_TABLE_NAME='v2_sales_workspaces' THEN workspace_key:=NEW.id; org_key:=NEW.organization_id;
  ELSE workspace_key:=NEW.workspace_id; org_key:=NEW.organization_id; END IF;
  SELECT state INTO current_state FROM v2_sales_workspaces WHERE id=workspace_key AND organization_id=org_key;
  IF current_state='promoting' THEN RAISE EXCEPTION 'Workspace cannot commit in promoting state' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO receipt_count FROM v2_sales_workspace_promotions WHERE workspace_id=workspace_key AND organization_id=org_key;
  IF (current_state='promoted')<>(receipt_count=1) THEN RAISE EXCEPTION 'Workspace promotion requires its terminal receipt' USING ERRCODE='23514'; END IF;
  IF current_state='promoted' THEN
    SELECT count(*) INTO line_count FROM v2_sales_workspace_lines WHERE workspace_id=workspace_key AND organization_id=org_key AND removed=false;
    SELECT count(*) INTO map_count FROM v2_sales_workspace_promotion_lines WHERE workspace_id=workspace_key AND organization_id=org_key;
    IF line_count=0 OR line_count<>map_count OR EXISTS (
      SELECT 1 FROM v2_sales_workspace_promotion_lines m JOIN v2_sales_workspace_lines l
        ON l.id=m.workspace_line_id AND l.organization_id=m.organization_id AND l.workspace_id=m.workspace_id
      WHERE m.workspace_id=workspace_key AND m.organization_id=org_key AND (l.removed OR m.position<>l.position)
    ) OR EXISTS (
      SELECT 1 FROM v2_sales_workspace_promotions p JOIN v2_sales_workspaces w ON w.id=p.workspace_id AND w.organization_id=p.organization_id
      WHERE p.workspace_id=workspace_key AND p.organization_id=org_key AND (p.input_revision+1<>w.revision OR p.header_json<>w.header_json
        OR p.request_id<>w.promotion_request_id OR p.target<>w.promotion_target OR p.fingerprint<>w.promotion_fingerprint
        OR (w.kind='order_edit' AND (p.target<>'order' OR p.document_id<>w.source_document_id)))
    ) OR EXISTS (
      SELECT 1 FROM v2_sales_workspace_promotion_lines m JOIN v2_sales_workspace_promotions p USING(organization_id,workspace_id)
      WHERE m.workspace_id=workspace_key AND m.organization_id=org_key AND (m.target<>p.target OR m.document_id<>p.document_id)
    ) THEN RAISE EXCEPTION 'Workspace promotion line map is incomplete or targets another source' USING ERRCODE='23514'; END IF;
    PERFORM l.id FROM v2_sales_document_lines l JOIN v2_sales_workspace_promotion_lines m
      ON l.id=m.canonical_line_id AND l.organization_id=m.organization_id AND l.document_id=m.document_id
      WHERE m.workspace_id=workspace_key AND m.organization_id=org_key FOR KEY SHARE OF l;
    GET DIAGNOSTICS canonical_count=ROW_COUNT;
    IF canonical_count<>map_count THEN RAISE EXCEPTION 'Workspace promotion canonical line disappeared before commit'
      USING ERRCODE='23503',CONSTRAINT='v2_sales_workspace_promotion_lines_canonical_fk'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
