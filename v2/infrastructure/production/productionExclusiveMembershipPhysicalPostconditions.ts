import type { TransactionalClient } from "../persistence/types.js";

// Exact prosrc comparison deliberately preserves SQL literals and lock ordering.
const gateBody = `
BEGIN
  PERFORM pg_advisory_xact_lock(1886547812,1209);
  RETURN NULL;
END;
`;
const bindBody = `
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
`;
const stateBody = `
BEGIN
  PERFORM w.id FROM v2_production_works w JOIN v2_production_run_allocations a ON a.organization_id=w.organization_id AND a.production_work_id=w.id WHERE a.organization_id=NEW.organization_id AND a.production_run_id=NEW.id ORDER BY w.id FOR UPDATE OF w;
  UPDATE v2_production_run_allocations SET membership_active=(released_at IS NULL AND NEW.state IN ('draft','ready','active','held')) WHERE organization_id=NEW.organization_id AND production_run_id=NEW.id;
  RETURN NEW;
END;
`;

/** Read-only readiness gate. An absent or altered invariant requires a migration, not startup DDL. */
export async function assertProductionExclusiveMembershipSchema(client: TransactionalClient): Promise<void> {
  const result = await client.query<{ ready: boolean }>(`WITH
    expected_columns(table_name, column_name, column_type, not_null, default_expr) AS (VALUES
      ('v2_production_runs','id','character varying',true,'(gen_random_uuid())::text'),
      ('v2_production_runs','organization_id','character varying',true,NULL),
      ('v2_production_runs','state','character varying(16)',true,'''draft''::character varying'),
      ('v2_production_works','id','character varying',true,'(gen_random_uuid())::text'),
      ('v2_production_works','organization_id','character varying',true,NULL),
      ('v2_production_run_allocations','id','character varying',true,'(gen_random_uuid())::text'),
      ('v2_production_run_allocations','organization_id','character varying',true,NULL),
      ('v2_production_run_allocations','production_run_id','character varying',true,NULL),
      ('v2_production_run_allocations','production_work_id','character varying',true,NULL),
      ('v2_production_run_allocations','production_attempt_id','character varying',false,NULL),
      ('v2_production_run_allocations','released_at','timestamp with time zone',false,NULL),
      ('v2_production_run_allocations','membership_active','boolean',true,NULL)
    ), expected_functions(function_name, body) AS (VALUES
      ('v2_production_run_membership_gate',$1::text),
      ('v2_production_run_membership_bind',$2::text),
      ('v2_production_run_membership_state',$3::text)
    ), expected_triggers(table_name, trigger_name, function_name, trigger_type, update_column) AS (VALUES
      ('v2_production_runs','v2_production_run_membership_gate_runs','v2_production_run_membership_gate',30,NULL),
      ('v2_production_run_allocations','v2_production_run_membership_gate_allocations','v2_production_run_membership_gate',30,NULL),
      ('v2_production_run_allocations','v2_production_run_membership_bind_trigger','v2_production_run_membership_bind',23,NULL),
      ('v2_production_runs','v2_production_run_membership_state_trigger','v2_production_run_membership_state',17,'state')
    ) SELECT
      NOT EXISTS (SELECT 1 FROM expected_columns e WHERE NOT EXISTS (
        SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE c.oid=to_regclass('public.' || e.table_name) AND c.relkind='r'
          AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped
          AND format_type(a.atttypid,a.atttypmod)=e.column_type AND a.attnotnull=e.not_null
          AND a.attgenerated='' AND a.attidentity=''
          AND pg_get_expr(d.adbin,d.adrelid) IS NOT DISTINCT FROM e.default_expr
      ))
      AND EXISTS (SELECT 1 FROM pg_index i
        JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_namespace ns ON ns.oid=ix.relnamespace
        JOIN pg_am am ON am.oid=ix.relam
        WHERE i.indrelid=to_regclass('public.v2_production_run_allocations')
          AND ns.nspname='public' AND ix.relname='v2_production_run_allocations_exclusive_active_uidx'
          AND ix.relkind='i' AND NOT ix.relispartition AND am.amname='btree'
          AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
          AND NOT i.indnullsnotdistinct AND i.indnkeyatts=2 AND i.indnatts=2 AND i.indexprs IS NULL
          AND cardinality(i.indoption::smallint[])=2 AND cardinality(i.indclass::oid[])=2
          AND cardinality(i.indcollation::oid[])=2
          AND NOT EXISTS (SELECT 1 FROM unnest(i.indoption) option WHERE option<>0)
          AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY key(attnum,position)
            JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=key.attnum ORDER BY key.position)
            = ARRAY['organization_id','production_work_id']::text[]
          AND NOT EXISTS (SELECT 1 FROM unnest(i.indclass,i.indcollation,i.indkey) key(opclass,index_collation,attnum)
            LEFT JOIN pg_opclass op ON op.oid=key.opclass
            JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=key.attnum
            WHERE op.oid IS NULL OR op.opcnamespace<>'pg_catalog'::regnamespace OR op.opcname<>'text_ops'
              OR op.opcmethod<>ix.relam
              OR key.index_collation<>a.attcollation)
          AND pg_get_expr(i.indpred,i.indrelid)='membership_active'
      )
      AND NOT EXISTS (SELECT 1 FROM expected_functions e WHERE NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        JOIN pg_language l ON l.oid=p.prolang
        WHERE ns.nspname='public' AND p.proname=e.function_name AND p.pronargs=0
          AND p.prorettype='trigger'::regtype AND p.prokind='f' AND l.lanname='plpgsql'
          AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef AND NOT p.proisstrict
          AND NOT p.proleakproof AND NOT p.proretset AND p.proconfig IS NULL
          AND p.provariadic=0 AND p.pronargdefaults=0 AND p.proallargtypes IS NULL
          AND p.proargmodes IS NULL AND p.proargnames IS NULL AND p.prosupport=0
          AND p.proargtypes::text='' AND p.prosqlbody IS NULL
          AND p.procost=100 AND p.prorows=0 AND p.prosrc=e.body
      ))
      AND NOT EXISTS (SELECT 1 FROM expected_triggers e WHERE NOT EXISTS (
        SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
        JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE t.tgrelid=to_regclass('public.' || e.table_name) AND t.tgname=e.trigger_name
          AND t.tgtype=e.trigger_type AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
          AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0
          AND t.tgconstraint=0 AND t.tgparentid=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
          AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
          AND ns.nspname='public' AND p.proname=e.function_name AND p.pronargs=0
          AND t.tgattr::text=COALESCE((SELECT a.attnum::text FROM pg_attribute a
            WHERE a.attrelid=t.tgrelid AND a.attname=e.update_column AND NOT a.attisdropped),'')
      )) AS ready`, [gateBody, bindBody, stateBody]);
  if (result.rows[0]?.ready !== true) throw new Error("Production exclusive membership schema is unavailable.");
}
