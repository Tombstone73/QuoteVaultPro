-- Auth-owned transaction enrollment. Historical capability-floor migrations stay immutable.
SELECT pg_advisory_xact_lock(73050305);
-- Existing pre-enrollment writers cannot race the preflight/trigger installation.
LOCK TABLE auth_identities,customer_portal_access,customer_portal_invite_tokens,org_invites,organizations,user_organizations,users,
  v2_permission_capabilities,v2_permission_organization_state,v2_permission_set_capabilities,v2_permission_sets,
  v2_staff_permission_set_assignments IN SHARE ROW EXCLUSIVE MODE;

-- Exact ECMAScript trim characters and UTF-16 length, matching the Staff login
-- boundary without changing its case-insensitive, untrimmed stored-email lookup.
CREATE FUNCTION v2_staff_login_email_ready(email text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(email<>'' AND email=btrim(email,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
    AND char_length(email)+(SELECT count(*) FROM regexp_split_to_table(email,'') c WHERE ascii(c)>65535)<=320,false)
$$;

CREATE FUNCTION v2_staff_login_ready(target_user varchar) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM users u JOIN auth_identities i ON i.user_id=u.id AND i.provider='password'
    WHERE u.id=target_user AND u.account_type='INTERNAL_USER' AND v2_staff_login_email_ready(u.email)
      AND NOT COALESCE(u.must_set_password,false)
      AND length(i.password_hash)=60
      AND i.password_hash ~ '^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{21}[.Oeu][./A-Za-z0-9]{30}[.CGKOSWaeimquy26]$')
$$;

CREATE FUNCTION v2_usable_structural_administrators(target_org varchar) RETURNS TABLE(user_id varchar) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT m.user_id FROM user_organizations m
  JOIN v2_staff_permission_set_assignments a ON a.organization_id=m.organization_id AND a.user_id=m.user_id AND a.active
  JOIN v2_permission_sets s ON s.organization_id=a.organization_id AND s.id=a.permission_set_id AND s.active AND s.principal_kind='staff'
  JOIN v2_permission_set_capabilities c ON c.organization_id=s.organization_id AND c.permission_set_id=s.id
  JOIN v2_permission_capabilities p ON p.id=c.capability_id AND p.active
  WHERE m.organization_id=target_org AND m.is_active AND m.role IN ('owner','admin') AND v2_staff_login_ready(m.user_id)
$$;

CREATE FUNCTION v2_assert_structural_authority(target_org varchar) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o organizations%ROWTYPE;
BEGIN
  SELECT * INTO o FROM organizations WHERE id=target_org;
  IF NOT FOUND THEN RETURN; END IF;
  IF o.delete_state NOT IN ('active','pending_delete','soft_deleted') THEN
    RAISE EXCEPTION 'Invalid organization deletion lifecycle' USING ERRCODE='23514';
  END IF;
  IF o.delete_state='active' AND NOT o.is_archived AND o.status IN ('active','trial') THEN
    IF NOT EXISTS(SELECT 1 FROM v2_permission_organization_state WHERE organization_id=target_org AND admin_floor_enforced)
       OR NOT EXISTS(SELECT 1 FROM v2_organization_authority_enrollments WHERE organization_id=target_org)
       OR NOT EXISTS(SELECT 1 FROM v2_usable_structural_administrators(target_org)) THEN
      RAISE EXCEPTION 'Active organization requires a usable structural Owner or Administrator: %',target_org USING ERRCODE='23514';
    END IF;
  END IF;
END $$;

-- Preflight never repairs identity, promotes members, or exempts active tenants.
DO $$ DECLARE target varchar; BEGIN
  IF EXISTS(SELECT 1 FROM organizations WHERE delete_state NOT IN ('active','pending_delete','soft_deleted')) THEN
    RAISE EXCEPTION 'ACCESS05 preflight: invalid organization deletion lifecycle' USING ERRCODE='23514';
  END IF;
  FOR target IN SELECT id FROM organizations WHERE delete_state='active' AND NOT is_archived AND status IN ('active','trial') LOOP
    IF NOT EXISTS(SELECT 1 FROM v2_permission_organization_state WHERE organization_id=target)
       OR NOT EXISTS(SELECT 1 FROM v2_usable_structural_administrators(target)) THEN
      RAISE EXCEPTION 'ACCESS05 preflight: active tenant lacks usable structural authority: %',target USING ERRCODE='23514';
    END IF;
  END LOOP;
END $$;
UPDATE v2_permission_organization_state SET admin_floor_enforced=true;
ALTER TABLE v2_permission_organization_state ALTER COLUMN admin_floor_enforced SET DEFAULT true;

CREATE FUNCTION v2_authority_entry(target_orgs varchar[], exclusive_mode boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target varchar; scope varchar[]; prior jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Authority writes require READ COMMITTED' USING ERRCODE='25000'; END IF;
  prior:=NULLIF(current_setting('v2.authority_entry',true),'')::jsonb;
  IF prior IS NOT NULL AND prior->>'xid'=txid_current()::text THEN
    RAISE EXCEPTION 'Authority entry must precede dependent work; no re-entry or lock upgrade' USING ERRCODE='25000';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE l.pid=pg_backend_pid() AND l.granted AND l.locktype='relation' AND n.nspname='public' AND l.mode<>'AccessShareLock')
     OR EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND granted AND locktype='advisory' AND classid=0 AND objid=73050305 AND objsubid=1) THEN
    RAISE EXCEPTION 'Authority entry must be the first locking operation' USING ERRCODE='25000';
  END IF;
  IF exclusive_mode THEN PERFORM pg_advisory_xact_lock(73050305); ELSE PERFORM pg_advisory_xact_lock_shared(73050305); END IF;
  SELECT array_agg(id ORDER BY id) INTO scope FROM (
    SELECT DISTINCT unnest(COALESCE(target_orgs,'{}'::varchar[])) id
    UNION SELECT id FROM organizations WHERE exclusive_mode
  ) ids WHERE id IS NOT NULL;
  scope:=COALESCE(scope,'{}'::varchar[]);
  IF NOT exclusive_mode AND cardinality(scope)=0 THEN RAISE EXCEPTION 'Tenant scope is required' USING ERRCODE='25000'; END IF;
  FOREACH target IN ARRAY scope LOOP PERFORM pg_advisory_xact_lock(73050305,hashtext(target)); END LOOP;
  PERFORM id FROM organizations WHERE id=ANY(scope) ORDER BY id FOR UPDATE;
  IF NOT exclusive_mode AND (SELECT count(*) FROM organizations WHERE id=ANY(scope))<>cardinality(scope) THEN
    RAISE EXCEPTION 'Authority organization is missing' USING ERRCODE='23503';
  END IF;
  PERFORM organization_id FROM v2_permission_organization_state WHERE organization_id=ANY(scope) ORDER BY organization_id FOR UPDATE;
  PERFORM set_config('v2.authority_entry',jsonb_build_object('xid',txid_current()::text,'exclusive',exclusive_mode,'organizations',to_jsonb(scope))::text,true);
  PERFORM set_config('v2.authority_changed','[]',true);
END $$;

CREATE FUNCTION v2_assert_authority_entry(target_org varchar DEFAULT NULL, require_exclusive boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE entry jsonb; exclusive_mode boolean;
BEGIN
  entry:=NULLIF(current_setting('v2.authority_entry',true),'')::jsonb;
  exclusive_mode:=COALESCE((entry->>'exclusive')::boolean,false);
  IF current_setting('transaction_isolation')<>'read committed' OR entry IS NULL OR entry->>'xid' IS DISTINCT FROM txid_current()::text
     OR (require_exclusive AND NOT exclusive_mode)
     OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=0 AND objid=73050305 AND objsubid=1 AND granted AND mode=CASE WHEN exclusive_mode THEN 'ExclusiveLock' ELSE 'ShareLock' END) THEN
    RAISE EXCEPTION 'Auth transaction entry is required before protected writes' USING ERRCODE='25000';
  END IF;
  IF target_org IS NOT NULL AND (NOT (entry->'organizations' ? target_org)
    OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=73050305 AND objid::bigint=(hashtext(target_org)::bigint & 4294967295) AND objsubid=2 AND granted AND mode='ExclusiveLock')) THEN
    RAISE EXCEPTION 'Auth write is outside the entered tenant scope' USING ERRCODE='25000';
  END IF;
END $$;

CREATE FUNCTION v2_authority_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; target varchar;
BEGIN
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'Protected authority tables cannot be truncated' USING ERRCODE='25000'; END IF;
  PERFORM v2_assert_authority_entry(NULL,TG_TABLE_NAME IN ('users','auth_identities','v2_permission_capabilities') OR (TG_TABLE_NAME='organizations' AND TG_OP='DELETE'));
  IF TG_LEVEL='STATEMENT' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME IN ('v2_permission_organization_state','v2_organization_authority_enrollments') AND TG_OP<>'INSERT' THEN
    IF (TG_OP='DELETE' AND EXISTS(SELECT 1 FROM organizations WHERE id=OLD.organization_id))
       OR (TG_OP='UPDATE' AND (TG_TABLE_NAME='v2_organization_authority_enrollments' OR OLD.organization_id IS DISTINCT FROM NEW.organization_id)) THEN
      RAISE EXCEPTION 'Existing organization authority initialization cannot be reset' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME='v2_staff_authority_enrollments' AND TG_OP<>'INSERT' THEN
    IF TG_OP='UPDATE' OR (EXISTS(SELECT 1 FROM organizations WHERE id=OLD.organization_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)) THEN
      RAISE EXCEPTION 'Authority enrollment history is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP<>'INSERT' THEN
    item:=to_jsonb(OLD); target:=CASE WHEN TG_TABLE_NAME='organizations' THEN item->>'id' ELSE COALESCE(item->>'organization_id',item->>'org_id') END;
    IF target IS NOT NULL THEN PERFORM v2_assert_authority_entry(target); END IF;
  END IF;
  IF TG_OP<>'DELETE' THEN
    item:=to_jsonb(NEW); target:=CASE WHEN TG_TABLE_NAME='organizations' THEN item->>'id' ELSE COALESCE(item->>'organization_id',item->>'org_id') END;
    IF target IS NOT NULL THEN PERFORM v2_assert_authority_entry(target); END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE FUNCTION v2_authority_changed(target_org varchar) RETURNS void LANGUAGE plpgsql AS $$
DECLARE changed jsonb;
BEGIN
  PERFORM v2_assert_authority_entry(target_org);
  changed:=COALESCE(NULLIF(current_setting('v2.authority_changed',true),'')::jsonb,'[]'::jsonb);
  IF NOT (changed ? target_org) THEN
    PERFORM set_config('v2.authority_changed',(changed || to_jsonb(target_org))::text,true);
    UPDATE v2_permission_organization_state SET authority_revision=authority_revision+1,updated_at=now() WHERE organization_id=target_org;
  END IF;
END $$;

CREATE FUNCTION v2_authority_fact_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target varchar; item jsonb; before_data jsonb; after_data jsonb; user_ids varchar[];
BEGIN
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NULL; END IF;
  before_data:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  after_data:=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME IN ('users','auth_identities') THEN
    IF TG_TABLE_NAME='users' THEN
      IF TG_OP='UPDATE' AND ARRAY[before_data->'id',before_data->'email',before_data->'account_type',before_data->'must_set_password',before_data->'is_platform_developer']
        IS NOT DISTINCT FROM ARRAY[after_data->'id',after_data->'email',after_data->'account_type',after_data->'must_set_password',after_data->'is_platform_developer'] THEN RETURN NULL; END IF;
      user_ids:=ARRAY[before_data->>'id',after_data->>'id'];
    ELSE
      IF COALESCE(before_data->>'provider','')<>'password' AND COALESCE(after_data->>'provider','')<>'password' THEN RETURN NULL; END IF;
      user_ids:=ARRAY[before_data->>'user_id',after_data->>'user_id'];
    END IF;
    -- Exclusive lock scope is deliberately wider than the affected identity scope.
    -- Cascaded membership/access changes also mark their own old/new organization.
    FOR target IN SELECT organization_id FROM user_organizations WHERE user_id=ANY(user_ids)
      UNION SELECT organization_id FROM customer_portal_access WHERE user_id=ANY(user_ids) LOOP
      PERFORM v2_authority_changed(target);
    END LOOP;
  ELSIF TG_TABLE_NAME='v2_permission_capabilities' THEN
    FOR target IN SELECT organization_id FROM v2_permission_set_capabilities WHERE capability_id IN (before_data->>'id',after_data->>'id')
      UNION SELECT organization_id FROM v2_organization_portal_capability_defaults WHERE capability_id IN (before_data->>'id',after_data->>'id')
      UNION SELECT organization_id FROM v2_customer_portal_ceiling_capabilities WHERE capability_id IN (before_data->>'id',after_data->>'id') LOOP
      PERFORM v2_authority_changed(target);
    END LOOP;
  ELSE
    IF TG_OP<>'INSERT' THEN item:=to_jsonb(OLD); target:=CASE WHEN TG_TABLE_NAME='organizations' THEN item->>'id' ELSE item->>'organization_id' END; IF target IS NOT NULL THEN PERFORM v2_authority_changed(target); END IF; END IF;
    IF TG_OP<>'DELETE' THEN item:=to_jsonb(NEW); target:=CASE WHEN TG_TABLE_NAME='organizations' THEN item->>'id' ELSE item->>'organization_id' END; IF target IS NOT NULL THEN PERFORM v2_authority_changed(target); END IF; END IF;
  END IF;
  RETURN NULL;
END $$;

-- Deferred checks only read. No late acquisition of organization/state locks.
CREATE OR REPLACE FUNCTION v2_assert_permission_admin_floor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target varchar;
BEGIN
  IF TG_TABLE_NAME='organizations' AND TG_OP='UPDATE' THEN
    IF (to_jsonb(OLD)->'id')=(to_jsonb(NEW)->'id') AND (to_jsonb(OLD)->'status')=(to_jsonb(NEW)->'status')
      AND (to_jsonb(OLD)->'is_archived')=(to_jsonb(NEW)->'is_archived') AND (to_jsonb(OLD)->'delete_state')=(to_jsonb(NEW)->'delete_state') THEN RETURN NULL; END IF;
  END IF;
  PERFORM v2_assert_authority_entry();
  FOR target IN SELECT jsonb_array_elements_text(NULLIF(current_setting('v2.authority_entry',true),'')::jsonb->'organizations') LOOP
    PERFORM v2_assert_structural_authority(target);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS v2_permission_admin_floor_assignment ON v2_staff_permission_set_assignments;
DROP TRIGGER IF EXISTS v2_permission_admin_floor_set ON v2_permission_sets;
DROP TRIGGER IF EXISTS v2_permission_admin_floor_capability ON v2_permission_set_capabilities;
DROP TRIGGER IF EXISTS v2_permission_admin_floor_membership ON user_organizations;
DROP TRIGGER IF EXISTS v2_permission_membership_authority_revision ON user_organizations;

-- This marker survives assignment deletion and membership disable/re-enable.
CREATE TABLE v2_staff_authority_enrollments (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(organization_id,user_id)
);
INSERT INTO v2_staff_authority_enrollments SELECT organization_id,user_id FROM user_organizations ON CONFLICT DO NOTHING;

-- Initialization history is not derived from a deletable permission-state row.
-- Existing organizations, including inactive ones, must never be re-bootstrapped.
CREATE TABLE v2_organization_authority_enrollments (
  organization_id varchar PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE
);
INSERT INTO v2_organization_authority_enrollments SELECT id FROM organizations;

CREATE OR REPLACE FUNCTION v2_bootstrap_permission_organization(target_org_id varchar) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM v2_assert_authority_entry(target_org_id);
  INSERT INTO v2_organization_authority_enrollments VALUES(target_org_id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM v2_permission_organization_state WHERE organization_id=target_org_id) THEN
      RAISE EXCEPTION 'Existing organization authority state is missing; bootstrap cannot restore grants' USING ERRCODE='23514';
    END IF;
    RETURN;
  END IF;
  INSERT INTO v2_permission_organization_state(organization_id,admin_floor_enforced) VALUES(target_org_id,true);
  INSERT INTO v2_permission_sets(organization_id,name,normalized_name,source_template_key,principal_kind)
    SELECT target_org_id,t.name,lower(t.name),t.template_key,t.principal_kind FROM v2_permission_set_templates t ON CONFLICT DO NOTHING;
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
    SELECT s.organization_id,s.id,c.capability_id FROM v2_permission_sets s JOIN v2_permission_set_templates t ON t.template_key=s.source_template_key
    JOIN v2_permission_set_template_capabilities c ON c.template_id=t.id WHERE s.organization_id=target_org_id ON CONFLICT DO NOTHING;
  INSERT INTO v2_organization_portal_capability_defaults(organization_id,capability_id)
    SELECT target_org_id,c FROM unnest(ARRAY['quote.view','order.view','invoice.view','proof.respond','payment.view','payment.record']) c ON CONFLICT DO NOTHING;
END $$;
CREATE OR REPLACE FUNCTION v2_bootstrap_permission_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE template_key varchar;
BEGIN
  PERFORM v2_assert_authority_entry(NEW.organization_id);
  IF NOT NEW.is_active THEN RETURN NEW; END IF;
  INSERT INTO v2_staff_authority_enrollments VALUES(NEW.organization_id,NEW.user_id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NEW; END IF;
  template_key:=CASE NEW.role::text WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'administrator' WHEN 'manager' THEN 'manager' ELSE 'staff_basic' END;
  INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id,active,assignment_source,bootstrap_legacy_role)
    SELECT NEW.organization_id,NEW.user_id,s.id,true,'legacy_role_bootstrap',NEW.role::text FROM v2_permission_sets s
    WHERE s.organization_id=NEW.organization_id AND s.source_template_key=template_key ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['users','auth_identities','user_organizations','v2_permission_organization_state','v2_permission_sets',
    'v2_permission_set_capabilities','v2_staff_permission_set_assignments','v2_permission_capabilities','v2_staff_authority_enrollments','v2_organization_authority_enrollments',
    'customer_portal_access','customer_portal_invite_tokens','v2_portal_password_reset_tokens','v2_portal_permission_set_assignments',
    'v2_customer_portal_ceiling_policies','v2_customer_portal_ceiling_capabilities','v2_organization_portal_capability_defaults','org_invites'] LOOP
    EXECUTE format('CREATE TRIGGER v2_authority_entry_statement BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION v2_authority_write_guard()',tab);
    EXECUTE format('CREATE TRIGGER v2_authority_scope_row BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION v2_authority_write_guard()',tab);
    EXECUTE format('CREATE CONSTRAINT TRIGGER v2_structural_floor AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_assert_permission_admin_floor()',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['users','auth_identities','user_organizations','v2_permission_sets','v2_permission_set_capabilities',
    'v2_staff_permission_set_assignments','v2_permission_capabilities','v2_portal_permission_set_assignments',
    'v2_customer_portal_ceiling_policies','v2_customer_portal_ceiling_capabilities','v2_organization_portal_capability_defaults'] LOOP
    EXECUTE format('CREATE TRIGGER v2_authority_fact_revision AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION v2_authority_fact_changed()',tab);
  END LOOP;
END $$;
CREATE TRIGGER v2_authority_access_revision AFTER INSERT OR DELETE OR UPDATE OF organization_id,user_id,status ON customer_portal_access FOR EACH ROW EXECUTE FUNCTION v2_authority_fact_changed();
-- Settings/QBO writes to settings and presentation columns do not change authority.
CREATE TRIGGER v2_authority_org_entry BEFORE INSERT OR DELETE OR UPDATE OF id,status,is_archived,delete_state ON organizations FOR EACH STATEMENT EXECUTE FUNCTION v2_authority_write_guard();
CREATE TRIGGER v2_authority_org_scope BEFORE INSERT OR DELETE OR UPDATE OF id,status,is_archived,delete_state ON organizations FOR EACH ROW EXECUTE FUNCTION v2_authority_write_guard();
CREATE TRIGGER v2_authority_org_truncate BEFORE TRUNCATE ON organizations FOR EACH STATEMENT EXECUTE FUNCTION v2_authority_write_guard();
CREATE TRIGGER v2_authority_org_revision AFTER UPDATE OF status,is_archived,delete_state ON organizations FOR EACH ROW EXECUTE FUNCTION v2_authority_fact_changed();
CREATE CONSTRAINT TRIGGER v2_structural_floor AFTER INSERT OR UPDATE OR DELETE ON organizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_assert_permission_admin_floor();
