-- Run only against a disposable test database using psql -v ON_ERROR_STOP=1 -f.
-- Real Artwork DDL/triggers are applied inside a rolled-back isolated schema.
BEGIN;
CREATE SCHEMA artwork_additive_regression;
SET LOCAL search_path TO artwork_additive_regression, public;
CREATE TABLE organizations (id varchar PRIMARY KEY);
CREATE TABLE v2_sales_order_details (document_id varchar, organization_id varchar, commercial_state text, PRIMARY KEY(document_id, organization_id));
CREATE TABLE v2_sales_document_lines (id varchar, organization_id varchar, document_id varchar, PRIMARY KEY(id, organization_id, document_id));
CREATE TABLE v2_permission_capabilities (id text PRIMARY KEY, module text, label text);
CREATE TABLE v2_permission_set_templates (id text PRIMARY KEY, template_key text);
CREATE TABLE v2_permission_set_template_capabilities (template_id text, capability_id text, PRIMARY KEY(template_id, capability_id));
CREATE TABLE v2_proof_works (id varchar, organization_id varchar, order_document_id varchar, order_line_id varchar);
CREATE TABLE v2_proof_versions (id varchar, organization_id varchar, proof_work_id varchar, sequence integer);
CREATE TABLE v2_proof_version_artwork (organization_id varchar, proof_version_id varchar, artwork_assignment_id varchar);
CREATE TABLE v2_proof_responses (organization_id varchar, proof_version_id varchar, outcome text);
CREATE TABLE v2_prepress_units (organization_id varchar, artwork_assignment_id varchar);
CREATE TABLE v2_production_works (organization_id varchar, artwork_assignment_id varchar);
\ir ../../../server/db/migrations_v2/0197_v2_artwork_domain_foundation.sql
ALTER TABLE v2_artwork_assignments ADD COLUMN source_quote_accepted_artwork_snapshot_id varchar;
\ir ../../../server/db/migrations_v2/0244_v2_order_artwork_replacement_lineage.sql
\ir ../../../server/db/migrations_v2/0245_v2_order_artwork_current_slot_guard.sql

INSERT INTO organizations VALUES ('org-a'), ('org-b');
INSERT INTO v2_sales_order_details VALUES ('order-a','org-a','open'), ('order-b','org-b','open'), ('closed','org-a','closed');
INSERT INTO v2_sales_document_lines VALUES ('line-a','org-a','order-a'), ('line-2','org-a','order-a'), ('line-b','org-b','order-b'), ('closed-line','org-a','closed');
INSERT INTO v2_artwork_files (id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,source_kind)
SELECT 'file-'||n, 'org-a', 'test', 'object-'||n, 'test.pdf', 'test.pdf', 'application/pdf', 331, 'customer_upload' FROM generate_series(1,20) n;
INSERT INTO v2_artwork_files (id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,source_kind)
VALUES ('foreign','org-b','test','foreign','test.pdf','test.pdf','application/pdf',331,'customer_upload');

CREATE FUNCTION add_assignment(assignment_id text, file_id text, predecessor text DEFAULT NULL, line_id text DEFAULT 'line-a', order_id text DEFAULT 'order-a', org_id text DEFAULT 'org-a') RETURNS void AS $$
  INSERT INTO v2_artwork_assignments (id,organization_id,artwork_file_id,order_document_id,order_line_id,purpose,side,identity_fingerprint,supersedes_artwork_assignment_id)
  VALUES (assignment_id,org_id,file_id,order_id,line_id,'customer_supplied','front','sha256:'||md5(file_id)||md5(file_id),predecessor);
$$ LANGUAGE sql;
SELECT add_assignment('A','file-1');
DO $$ BEGIN
  BEGIN
    PERFORM add_assignment('B','file-2');
    RAISE EXCEPTION 'Old single-slot guard unexpectedly allowed B';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%explicitly supersede%' THEN RAISE; END IF;
  END;
END $$;

\ir ../../../server/db/migrations_v2/0290_v2_artwork_additive_line_assignments.sql

CREATE VIEW current_artwork AS SELECT a.* FROM v2_artwork_assignments a
WHERE NOT EXISTS (SELECT 1 FROM v2_artwork_assignments successor WHERE successor.organization_id=a.organization_id AND successor.supersedes_artwork_assignment_id=a.id);
SELECT add_assignment('B','file-2');
SELECT add_assignment('C','file-3');
DO $$ BEGIN
  ASSERT (SELECT array_agg(id ORDER BY id) FROM current_artwork WHERE order_line_id='line-a' AND organization_id='org-a') = ARRAY['A','B','C']::varchar[], 'A/B/C must all remain current on line';
  ASSERT (SELECT count(*) FROM current_artwork WHERE order_document_id='order-a' AND organization_id='org-a') = 3, 'Order read must retain A/B/C';
  ASSERT NOT EXISTS (SELECT 1 FROM v2_artwork_assignments WHERE supersedes_artwork_assignment_id IS NOT NULL), 'Ordinary uploads must have no lineage';
END $$;

-- The repository's semantic identity conflict target remains idempotent.
INSERT INTO v2_artwork_assignments (id,organization_id,artwork_file_id,order_document_id,order_line_id,purpose,side,identity_fingerprint)
SELECT 'retry-B',organization_id,artwork_file_id,order_document_id,order_line_id,purpose,side,identity_fingerprint FROM v2_artwork_assignments WHERE id='B'
ON CONFLICT(organization_id,order_line_id,identity_fingerprint) DO NOTHING;
SELECT add_assignment('D','file-4','A');
DO $$ BEGIN
  ASSERT (SELECT array_agg(id ORDER BY id) FROM current_artwork WHERE order_line_id='line-a') = ARRAY['B','C','D']::varchar[], 'Explicit D replaces only A';
  ASSERT (SELECT count(*) FROM v2_artwork_assignments) = 4, 'A remains historical and retry adds nothing';
  ASSERT (SELECT supersedes_artwork_assignment_id FROM v2_artwork_assignments WHERE id='D')='A';
  BEGIN
    PERFORM add_assignment('E','file-5','A');
    RAISE EXCEPTION 'Two explicit successors were accepted';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE '%v2_artwork_assignments_one_successor_uidx%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM add_assignment('foreign-file','foreign');
    RAISE EXCEPTION 'Foreign tenant file was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    PERFORM add_assignment('foreign-line','file-6',NULL,'line-b');
    RAISE EXCEPTION 'Foreign tenant line was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    PERFORM add_assignment('cross-line','file-6','B','line-2');
    RAISE EXCEPTION 'Cross-line supersession was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM add_assignment('self','file-6','self');
    RAISE EXCEPTION 'Self supersession was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE v2_artwork_assignments SET supersedes_artwork_assignment_id='B' WHERE id='D';
    RAISE EXCEPTION 'Existing replacement lineage was rewritten';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT (SELECT array_agg(id ORDER BY id) FROM current_artwork WHERE order_line_id='line-a') = ARRAY['B','C','D']::varchar[], 'Failed writes must preserve current set';
END $$;

SELECT add_assignment('other-line','file-7',NULL,'line-2');
SELECT add_assignment('other-tenant','foreign',NULL,'line-b','order-b','org-b');
INSERT INTO v2_proof_works VALUES ('proof','org-a','order-a','line-a');
-- Same multi-assignment selection used by canonical Proofing createVersion.
DO $$ BEGIN
  ASSERT (SELECT array_agg(a.id ORDER BY a.id) FROM current_artwork a JOIN v2_proof_works w ON w.organization_id=a.organization_id AND w.order_document_id=a.order_document_id AND w.order_line_id=a.order_line_id WHERE w.organization_id='org-a' AND w.id='proof' AND a.id=ANY(ARRAY['B','C','D'])) = ARRAY['B','C','D']::varchar[], 'Proofing must resolve every current source in its line';
END $$;
INSERT INTO v2_proof_versions VALUES ('proof-v1','org-a','proof',1);
INSERT INTO v2_proof_version_artwork VALUES ('org-a','proof-v1','B');
DO $$ BEGIN
  BEGIN
    PERFORM add_assignment('proof-blocked','file-8','B');
    RAISE EXCEPTION 'Proof-bound source replaced before request for changes';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
INSERT INTO v2_proof_responses VALUES ('org-a','proof-v1','revision_requested');
SELECT add_assignment('proof-revised','file-8','B');
INSERT INTO v2_prepress_units VALUES ('org-a','C');
INSERT INTO v2_production_works VALUES ('org-a','D');
SELECT add_assignment('closed-source','file-10',NULL,'closed-line','closed');
DO $$ BEGIN
  BEGIN
    PERFORM add_assignment('prepress-blocked','file-9','C');
    RAISE EXCEPTION 'Prepress source was replaced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM add_assignment('production-blocked','file-9','D');
    RAISE EXCEPTION 'Production source was replaced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM add_assignment('closed-blocked','file-11','closed-source','closed-line','closed');
    RAISE EXCEPTION 'Closed Order source was replaced';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT (SELECT artwork_assignment_id FROM v2_proof_version_artwork WHERE proof_version_id='proof-v1')='B', 'Historical proof remains bound to B';
  ASSERT (SELECT count(*) FROM current_artwork WHERE order_line_id='line-a')=3;
  ASSERT (SELECT count(*) FROM current_artwork WHERE order_line_id='line-2')=1;
  ASSERT (SELECT count(*) FROM current_artwork WHERE organization_id='org-b')=1;
END $$;
ROLLBACK;
