-- Artwork-owned immutable source evidence. Empty source-line sets live in the
-- session token, never in counterfeit upload claims or storage ledgers.
CREATE TABLE v2_artwork_workspace_edit_sessions (
  organization_id varchar NOT NULL,
  workspace_id text NOT NULL,
  order_document_id varchar NOT NULL,
  source_line_map_json jsonb NOT NULL CHECK (jsonb_typeof(source_line_map_json)='array' AND octet_length(source_line_map_json::text)<=262144),
  baseline_fingerprint text NOT NULL CHECK (baseline_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,workspace_id),
  UNIQUE(organization_id,workspace_id,baseline_fingerprint),
  FOREIGN KEY(workspace_id,organization_id) REFERENCES v2_sales_workspaces(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(order_document_id,organization_id) REFERENCES v2_sales_order_details(document_id,organization_id) ON DELETE RESTRICT
);

CREATE TABLE v2_artwork_workspace_edit_refs (
  organization_id varchar NOT NULL,
  workspace_id text NOT NULL,
  workspace_line_id text NOT NULL,
  source_canonical_line_id varchar NOT NULL,
  source_assignment_id varchar NOT NULL,
  source_artwork_file_id varchar NOT NULL,
  source_status text NOT NULL CHECK (source_status IN ('current','removed','superseded','removed_and_superseded')),
  source_quote_accepted_artwork_snapshot_id varchar,
  source_evidence_json jsonb NOT NULL CHECK (jsonb_typeof(source_evidence_json)='object' AND octet_length(source_evidence_json::text)<=131072),
  baseline_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,workspace_id,source_assignment_id),
  FOREIGN KEY(organization_id,workspace_id,baseline_fingerprint) REFERENCES v2_artwork_workspace_edit_sessions(organization_id,workspace_id,baseline_fingerprint) ON DELETE RESTRICT,
  FOREIGN KEY(source_assignment_id,organization_id) REFERENCES v2_artwork_assignments(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_artwork_file_id,organization_id) REFERENCES v2_artwork_files(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_artwork_workspace_edit_refs_line_idx ON v2_artwork_workspace_edit_refs(organization_id,workspace_id,workspace_line_id);

CREATE TABLE v2_artwork_workspace_edit_intents (
  organization_id varchar NOT NULL,
  workspace_id text NOT NULL,
  source_assignment_id varchar NOT NULL,
  action text NOT NULL CHECK (action IN ('KEEP','REMOVE')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,workspace_id,source_assignment_id),
  FOREIGN KEY(organization_id,workspace_id,source_assignment_id) REFERENCES v2_artwork_workspace_edit_refs(organization_id,workspace_id,source_assignment_id) ON DELETE RESTRICT
);

CREATE TABLE v2_artwork_workspace_edit_applications (
  organization_id varchar NOT NULL,
  workspace_id text NOT NULL,
  mapping_fingerprint text NOT NULL CHECK (mapping_fingerprint ~ '^[0-9a-f]{64}$'),
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=16777216),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,workspace_id),
  FOREIGN KEY(organization_id,workspace_id) REFERENCES v2_artwork_workspace_edit_sessions(organization_id,workspace_id) ON DELETE RESTRICT
);

CREATE FUNCTION v2_artwork_workspace_edit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Order edit Artwork source and application evidence is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER v2_artwork_workspace_edit_session_immutable BEFORE UPDATE OR DELETE ON v2_artwork_workspace_edit_sessions FOR EACH ROW EXECUTE FUNCTION v2_artwork_workspace_edit_immutable();
CREATE TRIGGER v2_artwork_workspace_edit_ref_immutable BEFORE UPDATE OR DELETE ON v2_artwork_workspace_edit_refs FOR EACH ROW EXECUTE FUNCTION v2_artwork_workspace_edit_immutable();
CREATE TRIGGER v2_artwork_workspace_edit_application_immutable BEFORE UPDATE OR DELETE ON v2_artwork_workspace_edit_applications FOR EACH ROW EXECUTE FUNCTION v2_artwork_workspace_edit_immutable();

-- Membership is validated at capture without permanently pinning TEMP or
-- empty canonical lines. Existing canonical assignment FKs remain unchanged.
CREATE FUNCTION v2_artwork_workspace_edit_source_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='v2_artwork_workspace_edit_sessions' THEN
    PERFORM 1 FROM v2_sales_workspaces WHERE organization_id=NEW.organization_id AND id=NEW.workspace_id
      AND kind='order_edit' AND source_document_kind='order' AND source_document_id=NEW.order_document_id AND state='draft' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order edit Artwork requires its source workspace' USING ERRCODE='23514'; END IF;
    IF jsonb_array_length(NEW.source_line_map_json)<>(SELECT count(*) FROM v2_sales_document_lines WHERE organization_id=NEW.organization_id AND document_id=NEW.order_document_id)
      OR jsonb_array_length(NEW.source_line_map_json)<>(SELECT count(DISTINCT entry->>'canonicalLineId') FROM jsonb_array_elements(NEW.source_line_map_json) entry)
      OR jsonb_array_length(NEW.source_line_map_json)<>(SELECT count(DISTINCT entry->>'workspaceLineId') FROM jsonb_array_elements(NEW.source_line_map_json) entry)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.source_line_map_json) entry
        WHERE NOT EXISTS (SELECT 1 FROM v2_sales_workspace_lines temp JOIN v2_sales_document_lines line
          ON line.organization_id=temp.organization_id AND line.id=temp.source_line_id
          WHERE temp.organization_id=NEW.organization_id AND temp.workspace_id=NEW.workspace_id AND temp.id=entry->>'workspaceLineId'
            AND line.document_id=NEW.order_document_id AND line.id=entry->>'canonicalLineId')) THEN
      RAISE EXCEPTION 'Order edit Artwork source-line mapping is incomplete' USING ERRCODE='23514';
    END IF;
  ELSE
    PERFORM 1 FROM v2_artwork_workspace_edit_sessions session
      JOIN v2_artwork_assignments assignment ON assignment.organization_id=session.organization_id AND assignment.order_document_id=session.order_document_id
      WHERE session.organization_id=NEW.organization_id AND session.workspace_id=NEW.workspace_id
        AND assignment.id=NEW.source_assignment_id AND assignment.order_line_id=NEW.source_canonical_line_id
        AND assignment.artwork_file_id=NEW.source_artwork_file_id
        AND assignment.source_quote_accepted_artwork_snapshot_id IS NOT DISTINCT FROM NEW.source_quote_accepted_artwork_snapshot_id
        AND session.source_line_map_json @> jsonb_build_array(jsonb_build_object('workspaceLineId',NEW.workspace_line_id,'canonicalLineId',NEW.source_canonical_line_id));
    IF NOT FOUND THEN RAISE EXCEPTION 'Order edit Artwork reference is outside its captured source' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_artwork_workspace_edit_session_validate BEFORE INSERT ON v2_artwork_workspace_edit_sessions FOR EACH ROW EXECUTE FUNCTION v2_artwork_workspace_edit_source_validate();
CREATE TRIGGER v2_artwork_workspace_edit_ref_validate BEFORE INSERT ON v2_artwork_workspace_edit_refs FOR EACH ROW EXECUTE FUNCTION v2_artwork_workspace_edit_source_validate();

CREATE FUNCTION v2_artwork_workspace_edit_intent_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Order edit Artwork intent evidence must be retained' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.organization_id<>OLD.organization_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.source_assignment_id<>OLD.source_assignment_id) THEN
    RAISE EXCEPTION 'Order edit Artwork intent identity is immutable' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM v2_sales_workspaces WHERE organization_id=NEW.organization_id AND id=NEW.workspace_id AND kind='order_edit' AND state='draft' AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order edit Artwork intent requires an active draft' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM v2_artwork_workspace_edit_refs WHERE organization_id=NEW.organization_id AND workspace_id=NEW.workspace_id AND source_assignment_id=NEW.source_assignment_id AND source_status='current';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only current captured Artwork references can be changed' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_artwork_workspace_edit_intent_validate BEFORE INSERT OR UPDATE OR DELETE ON v2_artwork_workspace_edit_intents FOR EACH ROW EXECUTE FUNCTION v2_artwork_workspace_edit_intent_validate();

-- Canonical assignment writers, including conversion ports, share the same
-- Order-row-before-advisory protocol as capture and Save. No history rewrites.
CREATE FUNCTION v2_artwork_order_coordination_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id varchar; order_id varchar;
BEGIN
  IF TG_TABLE_NAME='v2_artwork_assignments' THEN
    org_id:=NEW.organization_id; order_id:=NEW.order_document_id;
  ELSE
    org_id:=NEW.organization_id;
    SELECT order_document_id INTO order_id FROM v2_artwork_assignments WHERE organization_id=org_id AND id=NEW.artwork_assignment_id;
  END IF;
  PERFORM 1 FROM v2_sales_documents WHERE organization_id=org_id AND id=order_id AND document_kind='order' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Artwork Order was not found' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM v2_sales_order_details WHERE organization_id=org_id AND document_id=order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Artwork Order was not found' USING ERRCODE='23503'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('order-artwork:'||org_id||':'||order_id,0));
  RETURN NEW;
END;
$$;
-- Alphabetically first, before replacement/removal guards acquire narrower locks.
CREATE TRIGGER aa_v2_artwork_order_coordination BEFORE INSERT ON v2_artwork_assignments FOR EACH ROW EXECUTE FUNCTION v2_artwork_order_coordination_lock();
CREATE TRIGGER aa_v2_artwork_order_coordination BEFORE INSERT ON v2_artwork_assignment_removals FOR EACH ROW EXECUTE FUNCTION v2_artwork_order_coordination_lock();
