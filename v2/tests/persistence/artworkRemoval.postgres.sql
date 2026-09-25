-- Disposable database only. All production DDL and test evidence are rolled back.
BEGIN;
CREATE SCHEMA artwork_removal_regression;
SET LOCAL search_path TO artwork_removal_regression, public;
CREATE TABLE organizations(id varchar PRIMARY KEY);
CREATE TABLE users(id varchar PRIMARY KEY);
CREATE TABLE v2_sales_order_details(document_id varchar,organization_id varchar,commercial_state text,archived_at timestamptz,PRIMARY KEY(document_id,organization_id));
CREATE TABLE v2_sales_document_lines(id varchar,organization_id varchar,document_id varchar,PRIMARY KEY(id,organization_id,document_id));
CREATE TABLE v2_permission_capabilities(id text PRIMARY KEY,module text,label text);
CREATE TABLE v2_permission_set_templates(id text PRIMARY KEY,template_key text);
CREATE TABLE v2_permission_set_template_capabilities(template_id text,capability_id text,PRIMARY KEY(template_id,capability_id));
CREATE TABLE v2_proof_works(id varchar,organization_id varchar,order_document_id varchar,order_line_id varchar);
CREATE TABLE v2_proof_versions(id varchar,organization_id varchar,proof_work_id varchar,sequence integer);
CREATE TABLE v2_proof_version_artwork(organization_id varchar,proof_version_id varchar,artwork_assignment_id varchar);
CREATE TABLE v2_proof_responses(organization_id varchar,proof_version_id varchar,outcome text);
CREATE TABLE v2_prepress_units(organization_id varchar,artwork_assignment_id varchar);
CREATE TABLE v2_production_works(organization_id varchar,artwork_assignment_id varchar);
\ir ../../../server/db/migrations_v2/0197_v2_artwork_domain_foundation.sql
ALTER TABLE v2_artwork_assignments ADD COLUMN source_quote_accepted_artwork_snapshot_id varchar;
\ir ../../../server/db/migrations_v2/0244_v2_order_artwork_replacement_lineage.sql
\ir ../../../server/db/migrations_v2/0290_v2_artwork_additive_line_assignments.sql
\ir ../../../server/db/migrations_v2/0291_v2_artwork_assignment_removal.sql
INSERT INTO organizations VALUES('org-a'),('org-b');
INSERT INTO users VALUES('staff');
INSERT INTO v2_sales_order_details VALUES('order-a','org-a','open',NULL),('order-b','org-b','open',NULL),('closed','org-a','closed',NULL);
INSERT INTO v2_sales_document_lines VALUES('line-a','org-a','order-a'),('line-2','org-a','order-a'),('line-b','org-b','order-b'),('closed-line','org-a','closed');
INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,source_kind)
SELECT 'file-'||n,'org-a','test','object-'||n,'test.pdf','test.pdf','application/pdf',331,'customer_upload' FROM generate_series(1,10) n;
CREATE FUNCTION add_art(id text,f text,previous text DEFAULT NULL,line text DEFAULT 'line-a',ord text DEFAULT 'order-a') RETURNS void AS $$
INSERT INTO v2_artwork_assignments(id,organization_id,artwork_file_id,order_document_id,order_line_id,purpose,side,identity_fingerprint,supersedes_artwork_assignment_id)
VALUES(id,'org-a',f,ord,line,'customer_supplied','front','sha256:'||md5(f)||md5(f),previous);
$$ LANGUAGE sql;
SELECT add_art('A','file-1'); SELECT add_art('B','file-2'); SELECT add_art('C','file-3');
SELECT add_art('B-other','file-2',NULL,'line-2');
INSERT INTO v2_proof_works VALUES('proof','org-a','order-a','line-a');
INSERT INTO v2_proof_versions VALUES('v1','org-a','proof',1);
INSERT INTO v2_proof_version_artwork VALUES('org-a','v1','B');
DO $$ BEGIN
  BEGIN
    INSERT INTO v2_artwork_assignment_removals VALUES('org-a','B',now(),'staff');
    RAISE EXCEPTION 'Pending Proof allowed removal';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT (SELECT count(*) FROM v2_current_artwork_assignments WHERE order_line_id='line-a')=3;
END $$;
INSERT INTO v2_proof_responses VALUES('org-a','v1','revision_requested');
INSERT INTO v2_artwork_assignment_removals VALUES('org-a','B',now(),'staff');
INSERT INTO v2_artwork_assignment_removals VALUES('org-a','B',now(),'staff') ON CONFLICT DO NOTHING;
DO $$ BEGIN
  ASSERT (SELECT array_agg(id ORDER BY id) FROM v2_current_artwork_assignments WHERE order_line_id='line-a')=ARRAY['A','C']::varchar[];
  ASSERT EXISTS(SELECT 1 FROM v2_current_artwork_assignments WHERE id='B-other'), 'Same file on another line must remain';
  ASSERT (SELECT count(*) FROM v2_artwork_assignment_removals)=1;
  ASSERT (SELECT artwork_assignment_id FROM v2_proof_version_artwork WHERE proof_version_id='v1')='B';
  ASSERT (SELECT artwork_file_id FROM v2_artwork_assignments WHERE id='B')='file-2';
  ASSERT EXISTS(SELECT 1 FROM v2_artwork_files WHERE id='file-2');
  BEGIN UPDATE v2_artwork_assignment_removals SET removed_by_user_id='staff'; RAISE EXCEPTION 'Removal history was mutable'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN DELETE FROM v2_artwork_assignment_removals; RAISE EXCEPTION 'Removal history was deleted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO v2_artwork_assignment_removals VALUES('org-b','A',now(),'staff'); RAISE EXCEPTION 'Tenant guard failed'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN INSERT INTO v2_proof_version_artwork VALUES('org-a','v2','B'); RAISE EXCEPTION 'New Proof bound removed Artwork'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO v2_prepress_units VALUES('org-a','B'); RAISE EXCEPTION 'Prepress bound removed Artwork'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO v2_production_works VALUES('org-a','B'); RAISE EXCEPTION 'Production bound removed Artwork'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM add_art('bad-successor','file-4','B'); RAISE EXCEPTION 'Removed Artwork was superseded'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT add_art('D','file-4');
DO $$ BEGIN
  ASSERT (SELECT array_agg(id ORDER BY id) FROM v2_current_artwork_assignments WHERE order_line_id='line-a')=ARRAY['A','C','D']::varchar[], 'Additive upload after removal';
END $$;
-- Existing explicit supersession remains independent of removal.
SELECT add_art('E','file-5','A');
INSERT INTO v2_artwork_assignment_removals VALUES('org-a','E',now(),'staff');
INSERT INTO v2_prepress_units VALUES('org-a','C');
INSERT INTO v2_production_works VALUES('org-a','D');
SELECT add_art('closed-art','file-6',NULL,'closed-line','closed');
DO $$ BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM v2_current_artwork_assignments WHERE id IN('A','B','E')), 'Removal must not revive a superseded predecessor';
  ASSERT (SELECT supersedes_artwork_assignment_id FROM v2_artwork_assignments WHERE id='E')='A';
  BEGIN INSERT INTO v2_artwork_assignment_removals VALUES('org-a','C',now(),'staff'); RAISE EXCEPTION 'Prepress use allowed removal'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO v2_artwork_assignment_removals VALUES('org-a','D',now(),'staff'); RAISE EXCEPTION 'Production use allowed removal'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO v2_artwork_assignment_removals VALUES('org-a','closed-art',now(),'staff'); RAISE EXCEPTION 'Closed Order allowed removal'; EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT (SELECT count(*) FROM v2_artwork_files)=10, 'No storage/file deletion';
END $$;
-- Approved current Proofs stay protected; a newer revision without the file
-- permits unassignment without rewriting the older immutable binding.
SELECT add_art('historical','file-7');
SELECT add_art('approved','file-8');
INSERT INTO v2_proof_works VALUES('history','org-a','order-a','line-a'),('approval','org-a','order-a','line-a');
INSERT INTO v2_proof_versions VALUES('history-v1','org-a','history',1),('approval-v1','org-a','approval',1);
INSERT INTO v2_proof_version_artwork VALUES('org-a','history-v1','historical'),('org-a','approval-v1','approved');
INSERT INTO v2_proof_responses VALUES('org-a','history-v1','revision_requested'),('org-a','approval-v1','approved');
INSERT INTO v2_proof_versions VALUES('history-v2','org-a','history',2);
INSERT INTO v2_proof_version_artwork VALUES('org-a','history-v2','D');
INSERT INTO v2_artwork_assignment_removals VALUES('org-a','historical',now(),'staff');
DO $$ BEGIN
  ASSERT (SELECT artwork_assignment_id FROM v2_proof_version_artwork WHERE proof_version_id='history-v1')='historical';
  ASSERT NOT EXISTS(SELECT 1 FROM v2_current_artwork_assignments WHERE id='historical');
  BEGIN INSERT INTO v2_artwork_assignment_removals VALUES('org-a','approved',now(),'staff'); RAISE EXCEPTION 'Approved Proof allowed removal'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;
