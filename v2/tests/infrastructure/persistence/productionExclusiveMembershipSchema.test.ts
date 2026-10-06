import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { TransactionalClient } from "../../../infrastructure/persistence/types.js";
import { assertProductionExclusiveMembershipSchema } from "../../../infrastructure/production/productionExclusiveMembershipPhysicalPostconditions.js";

const runDdl = readFileSync(new URL("../../../../server/db/migrations_v2/0279_v2_canonical_production_runs.sql", import.meta.url), "utf8");
const membershipDdl = readFileSync(new URL("../../../../server/db/migrations_v2/0303_v2_production_exclusive_membership.sql", import.meta.url), "utf8");
const approvedDdl = readFileSync(new URL("../productionExclusiveMembership.request.sql", import.meta.url), "utf8");
const fingerprint = `sha256:${"a".repeat(64)}`;
let checks = 0;

// Only dependencies referenced by actual 0279 DDL or read/locked by actual 0303.
// This is single-client SQL evidence, not native PostgreSQL concurrency evidence.
async function schema() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE v2_production_works(id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organization_id varchar NOT NULL, UNIQUE(id,organization_id));
    CREATE TABLE v2_production_attempts(id varchar PRIMARY KEY, organization_id varchar NOT NULL,
      UNIQUE(id,organization_id));
    CREATE TABLE v2_artwork_assignments(id varchar PRIMARY KEY, organization_id varchar NOT NULL,
      artwork_file_id varchar NOT NULL, UNIQUE(id,organization_id,artwork_file_id));
    CREATE TABLE v2_permission_capabilities(id varchar PRIMARY KEY,module text,label text);
    CREATE TABLE v2_permission_set_templates(id varchar PRIMARY KEY,template_key text);
    CREATE TABLE v2_permission_set_template_capabilities(template_id varchar,capability_id varchar,
      PRIMARY KEY(template_id,capability_id));
    CREATE TABLE schema_test_issued_evidence(id integer PRIMARY KEY, amount numeric(12,2), bytes bytea);
    INSERT INTO schema_test_issued_evidence VALUES(1,1234.56,decode('000aff805c27','hex'));
    INSERT INTO organizations VALUES('org-a'),('org-b');
    INSERT INTO v2_production_works(id,organization_id) VALUES
      ('work-a','org-a'),('work-b','org-a'),('work-c','org-a'),('work-d','org-b');
    INSERT INTO v2_production_attempts VALUES('attempt-a','org-a');
    INSERT INTO v2_artwork_assignments VALUES('art-a','org-a','file-a'),('art-b','org-b','file-b');
  `);
  await db.exec(runDdl);
  return db;
}

async function run(db: PGlite, id: string, state = "draft", organization = "org-a") {
  await db.query(`INSERT INTO v2_production_runs(id,organization_id,station_key,state,
    created_principal_kind,created_principal_subject,layout_metadata,completed_at,cancelled_at)
    VALUES($1,$2,'flatbed',$3::varchar,'staff','schema-test',
      '{"literal":"ACTIVE held \\u0027","quantity":17,"opaque":"00ff"}',
      CASE WHEN $3::varchar='completed' THEN '2026-01-02'::timestamptz END,
      CASE WHEN $3::varchar='cancelled' THEN '2026-01-03'::timestamptz END)`, [id, organization, state]);
}

async function nativeRawRunParameterTyping() {
  // Read only: importing the native module would execute its guarded native harness.
  const source = readFileSync(new URL("../productionRunExclusive.native.ts", import.meta.url), "utf8");
  const matches = [...source.matchAll(/^const rawRun=async\(id:string,state="draft"\)=>a\.query\("([^"\\\r\n]+)",\[id,state\]\);\r?$/gm)];
  assert.equal(matches.length, 1, "Expected exactly one literal rawRun query with the reviewed argument binding");
  assert.equal([...source.matchAll(/\bconst\s+rawRun\b/g)].length, 1, "Ambiguous rawRun declaration");
  const sql = matches[0][1];
  const baseline = "INSERT INTO v2_production_runs(id,organization_id,station_key,state,created_principal_kind,created_principal_subject,completed_at,cancelled_at) VALUES($1,'org-a','roll',$2,'staff','actor-a',CASE WHEN $2='completed' THEN now() END,CASE WHEN $2='cancelled' THEN now() END)";
  // Temporary reproduction contract: after native author confirmation, assert the
  // actual corrected helper succeeds and retain this uncast SQL as the red control.
  assert.equal(sql, baseline, "Native rawRun changed; review and update the regression contract");
  const castSql = sql.replace("'roll',$2,", "'roll',$2::varchar,");
  assert.notEqual(castSql, sql);
  checks += 4;

  const db = await schema();
  try {
    await db.exec(membershipDdl);
    await assert.rejects(db.query(sql, ["uncast", "draft"]), { code: "42P08" });
    assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM v2_production_runs")).rows[0].count, 0);
    checks += 2;
    const states = ["draft", "ready", "active", "held", "completed", "cancelled"];
    for (const state of states) {
      const id = `cast-${state}`;
      await db.query(castSql, [id, state]);
      const result = await db.query("SELECT id,state,completed_at IS NOT NULL AS completed,cancelled_at IS NOT NULL AS cancelled FROM v2_production_runs WHERE id=$1", [id]);
      assert.deepEqual(result.rows, [{ id, state, completed: state === "completed", cancelled: state === "cancelled" }]);
      checks++;
    }
    assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM v2_production_runs")).rows[0].count, states.length);
    checks++;
    console.log("Native rawRun typing: uncast 42P08; assignment-only varchar cast passes all six states. Supplemental in-memory SQL, not native concurrency proof.");
  } finally { await db.close(); }
}

async function allocation(db: PGlite, id: string, parent: string, work = "work-a",
  released = false, organization = "org-a", suppliedActive?: boolean) {
  const columns = suppliedActive === undefined ? "" : ",membership_active";
  const value = suppliedActive === undefined ? "" : ",$7";
  const params: unknown[] = [id, organization, parent, work, fingerprint, released];
  if (suppliedActive !== undefined) params.push(suppliedActive);
  await db.query(`INSERT INTO v2_production_run_allocations(id,organization_id,production_run_id,
    production_work_id,allocated_quantity,good_quantity,waste_quantity,artwork_assignment_id,
    artwork_file_id,artwork_identity_fingerprint,artwork_object_version,position,released_at${columns})
    VALUES($1,$2::varchar,$3,$4,17,3,2,CASE WHEN $2::varchar='org-a' THEN 'art-a' ELSE 'art-b' END,
      CASE WHEN $2::varchar='org-a' THEN 'file-a' ELSE 'file-b' END,$5,'opaque:00ff\\unchanged',0,
      CASE WHEN $6 THEN '2026-01-04'::timestamptz END${value})`, params);
}

async function facts(db: PGlite) {
  const tables = ["v2_production_runs", "v2_production_run_allocations", "v2_production_run_events",
    "v2_production_works", "v2_production_attempts", "v2_artwork_assignments", "schema_test_issued_evidence"];
  const snapshots: unknown[] = [];
  for (const table of tables) snapshots.push((await db.query(`SELECT
    (to_jsonb(t)-'membership_active')::text AS facts FROM ${table} t ORDER BY id`)).rows);
  return snapshots;
}

async function ready(db: PGlite) {
  // Adapter exposes only the query contract, never an ambient pool or URL.
  await assertProductionExclusiveMembershipSchema({ query: (sql: string, params?: unknown[]) =>
    db.query(sql, params) } as unknown as TransactionalClient);
}

async function active(db: PGlite, id: string, expected: boolean) {
  const result = await db.query<{ membership_active: boolean }>(
    "SELECT membership_active FROM v2_production_run_allocations WHERE id=$1", [id]);
  assert.equal(result.rows[0]?.membership_active, expected);
  checks++;
}

async function derivedBackfill() {
  const db = await schema();
  try {
    await assert.rejects(ready(db), /schema is unavailable/);
    const states = ["draft", "ready", "active", "held", "completed", "cancelled"];
    for (const state of states) {
      const organization = state === "held" ? "org-b" : "org-a";
      const work = state === "held" ? "work-d" : "work-a";
      await run(db, `legacy-${state}`, state, organization);
      await run(db, `legacy-released-${state}`, state, organization);
      // One historical work can legitimately appear in released or terminal Runs.
      await allocation(db, `released-${state}`, `legacy-released-${state}`, work, true, organization);
      await allocation(db, `member-${state}`, `legacy-${state}`,
        states.indexOf(state) < 4 ? ["work-a", "work-b", "work-c", "work-d"][states.indexOf(state)] : "work-a",
        false, organization);
    }
    await db.exec(`INSERT INTO v2_production_run_events(id,organization_id,production_run_id,sequence,
      event_kind,production_run_allocation_id,reason,note,created_principal_kind,created_principal_subject)
      VALUES('historical-event','org-a','legacy-active',1,'good_output','member-active',
        'historical reason','untouched byte-like 00ff','staff','original-actor');
      UPDATE v2_production_attempts SET terminal_disposition='successful' WHERE id='attempt-a';`);
    const before = await facts(db);
    await db.exec(`BEGIN; ${membershipDdl} COMMIT;`);
    assert.deepEqual(await facts(db), before);
    for (const state of states) {
      await active(db, `released-${state}`, false);
      await active(db, `member-${state}`, states.indexOf(state) < 4);
    }
    await ready(db);
    checks += 3;
  } finally { await db.close(); }
}

async function overlapRollback() {
  for (const state of ["draft", "ready", "active", "held"]) {
    const db = await schema();
    try {
      await run(db, "old-run", state);
      await run(db, "other-run", "draft");
      await allocation(db, "old-allocation", "old-run");
      await allocation(db, "other-allocation", "other-run");
      const before = await facts(db);
      await db.exec("BEGIN");
      await assert.rejects(db.exec(membershipDdl), /unique|duplicate/i);
      await db.exec("ROLLBACK");
      assert.deepEqual(await facts(db), before);
      assert.deepEqual((await db.query(`SELECT attname FROM pg_attribute
        WHERE attrelid='v2_production_run_allocations'::regclass AND attname='membership_active'`)).rows, []);
      assert.equal((await db.query<{ absent: boolean }>(`SELECT
        to_regclass('public.v2_production_run_allocations_exclusive_active_uidx') IS NULL
        AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname LIKE 'v2_production_run_membership_%')
        AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname LIKE 'v2_production_run_membership_%') AS absent`)).rows[0].absent, true);
      assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM v2_production_run_allocations")).rows[0].count, 2);
      await assert.rejects(ready(db), /schema is unavailable/);
      checks += 6;
    } finally { await db.close(); }
  }
}

async function mutationSemantics() {
  const db = await schema();
  try {
    await db.exec(membershipDdl);
    await run(db, "one"); await run(db, "two"); await run(db, "tenant", "draft", "org-b");
    await allocation(db, "a", "one", "work-a", false, "org-a", false);
    await active(db, "a", true);
    await assert.rejects(allocation(db, "overlap", "two", "work-a", false, "org-a", false), /unique|duplicate/i);
    await allocation(db, "tenant-a", "tenant", "work-d", false, "org-b", false);
    await active(db, "tenant-a", true);
    await db.exec("UPDATE v2_production_run_allocations SET membership_active=false WHERE id='a'");
    await active(db, "a", true);
    await db.exec("UPDATE v2_production_run_allocations SET released_at=now(),membership_active=true WHERE id='a'");
    await active(db, "a", false);
    await allocation(db, "b", "two", "work-a");
    await assert.rejects(db.exec("UPDATE v2_production_run_allocations SET released_at=NULL WHERE id='a'"), /unique|duplicate/i);
    await db.exec("UPDATE v2_production_runs SET state='held' WHERE id='two'");
    await active(db, "b", true);
    await assert.rejects(db.exec("UPDATE v2_production_run_allocations SET production_work_id='work-b' WHERE id='b'"), /Started Production/);
    await db.exec("UPDATE v2_production_runs SET state='cancelled',cancelled_at=now() WHERE id='two'");
    await active(db, "b", false);
    await db.exec("UPDATE v2_production_run_allocations SET released_at=NULL WHERE id='a'");
    await active(db, "a", true);
    await assert.rejects(db.exec("UPDATE v2_production_runs SET state='ready' WHERE id='two'"), /unique|duplicate/i);
    assert.equal((await db.query<{ state: string }>("SELECT state FROM v2_production_runs WHERE id='two'")).rows[0].state, "cancelled");
    for (const mutation of ["id='renamed'", "organization_id='org-b'", "production_run_id='two'"]) {
      await assert.rejects(db.exec(`UPDATE v2_production_run_allocations SET ${mutation} WHERE id='a'`), /identity is immutable/);
      checks++;
    }
    await db.exec("UPDATE v2_production_run_allocations SET production_work_id='work-b' WHERE id='a'");
    await db.exec("UPDATE v2_production_runs SET state='ready' WHERE id='one'");
    await db.exec("UPDATE v2_production_run_allocations SET production_work_id='work-c' WHERE id='a'");
    await db.exec("UPDATE v2_production_run_allocations SET production_attempt_id='attempt-a' WHERE id='a'");
    await assert.rejects(db.exec("UPDATE v2_production_run_allocations SET production_work_id='work-b' WHERE id='a'"), /Started Production/);
    await db.exec("UPDATE v2_production_runs SET state='active' WHERE id='one'");
    await active(db, "a", true);
    await db.exec("UPDATE v2_production_runs SET state='completed',completed_at=now() WHERE id='one'");
    await active(db, "a", false);
    await db.exec("UPDATE v2_production_run_allocations SET membership_active=true WHERE id='a'");
    await active(db, "a", false);
    await assert.rejects(allocation(db, "orphan", "missing", "work-b"), /parent was not found/);
    await ready(db);
    checks += 9;
  } finally { await db.close(); }
}

async function catalogFailures() {
  const db = await schema();
  const index = "v2_production_run_allocations_exclusive_active_uidx";
  const alloc = "v2_production_run_allocations";
  const runs = "v2_production_runs";
  const triggers = [
    [runs, "v2_production_run_membership_gate_runs", "BEFORE INSERT OR UPDATE OR DELETE", "STATEMENT", "gate"],
    [alloc, "v2_production_run_membership_gate_allocations", "BEFORE INSERT OR UPDATE OR DELETE", "STATEMENT", "gate"],
    [alloc, "v2_production_run_membership_bind_trigger", "BEFORE INSERT OR UPDATE", "ROW", "bind"],
    [runs, "v2_production_run_membership_state_trigger", "AFTER UPDATE OF state", "ROW", "state"],
  ];
  const cases: [string, string][] = [
    ["missing column", `ALTER TABLE ${alloc} DROP COLUMN membership_active CASCADE`],
    ["nullable flag", `ALTER TABLE ${alloc} ALTER COLUMN membership_active DROP NOT NULL`],
    ["flag default", `ALTER TABLE ${alloc} ALTER COLUMN membership_active SET DEFAULT false`],
    ["wrong flag type", `DROP INDEX ${index}; ALTER TABLE ${alloc} ALTER COLUMN membership_active TYPE text USING membership_active::text`],
    ["state default literal", `ALTER TABLE ${runs} ALTER COLUMN state SET DEFAULT 'ACTIVE'`],
    ["state nullable", `ALTER TABLE ${runs} ALTER COLUMN state DROP NOT NULL`],
    ["allocation run default", `ALTER TABLE ${alloc} ALTER COLUMN production_run_id SET DEFAULT 'made-up'`],
    ["allocation work nullable", `ALTER TABLE ${alloc} ALTER COLUMN production_work_id DROP NOT NULL`],
    ["released timestamp default", `ALTER TABLE ${alloc} ALTER COLUMN released_at SET DEFAULT now()`],
    ["attempt nullable contract", `ALTER TABLE ${alloc} ALTER COLUMN production_attempt_id SET NOT NULL`],
    ["state width", `DROP TRIGGER v2_production_run_membership_state_trigger ON ${runs}; ALTER TABLE ${runs} ALTER COLUMN state TYPE varchar(32); CREATE TRIGGER v2_production_run_membership_state_trigger AFTER UPDATE OF state ON ${runs} FOR EACH ROW EXECUTE FUNCTION v2_production_run_membership_state()`],
    ["missing index", `DROP INDEX ${index}`],
  ];
  for (const [label, definition] of [
    ["nonunique", `(organization_id,production_work_id) WHERE membership_active`],
    ["wrong key order", `(production_work_id,organization_id) WHERE membership_active`],
    ["wrong keys", `(organization_id,production_run_id) WHERE membership_active`],
    ["wrong predicate", `(organization_id,production_work_id) WHERE NOT membership_active`],
    ["extra predicate", `(organization_id,production_work_id) WHERE membership_active AND released_at IS NULL`],
    ["no predicate", `(organization_id,production_work_id)`],
    ["included column", `(organization_id,production_work_id) INCLUDE(id) WHERE membership_active`],
    ["descending", `(organization_id DESC,production_work_id) WHERE membership_active`],
    ["null order", `(organization_id NULLS FIRST,production_work_id) WHERE membership_active`],
    ["expression", `(organization_id,lower(production_work_id)) WHERE membership_active`],
    ["wrong opclass", `(organization_id varchar_pattern_ops,production_work_id) WHERE membership_active`],
    ["wrong collation", `(organization_id COLLATE "C",production_work_id) WHERE membership_active`],
    ["nulls not distinct", `(organization_id,production_work_id) NULLS NOT DISTINCT WHERE membership_active`],
  ]) cases.push([label, `DROP INDEX ${index}; CREATE ${label === "nonunique" ? "" : "UNIQUE "}INDEX ${index} ON ${alloc}${definition}`]);
  for (const [table, name, event, level, fn] of triggers) {
    cases.push([`missing ${name}`, `DROP TRIGGER ${name} ON ${table}`]);
    cases.push([`disabled ${name}`, `ALTER TABLE ${table} DISABLE TRIGGER ${name}`]);
    cases.push([`replica-only ${name}`, `ALTER TABLE ${table} ENABLE REPLICA TRIGGER ${name}`]);
    cases.push([`wrong function ${name}`, `DROP TRIGGER ${name} ON ${table}; CREATE TRIGGER ${name} ${event} ON ${table} FOR EACH ${level} EXECUTE FUNCTION v2_production_run_membership_${fn === "gate" ? "bind" : "gate"}()`]);
  }
  cases.push(
    ["gate event subset", `DROP TRIGGER ${triggers[0][1]} ON ${runs}; CREATE TRIGGER ${triggers[0][1]} BEFORE UPDATE ON ${runs} FOR EACH STATEMENT EXECUTE FUNCTION v2_production_run_membership_gate()`],
    ["gate wrong timing", `DROP TRIGGER ${triggers[1][1]} ON ${alloc}; CREATE TRIGGER ${triggers[1][1]} AFTER INSERT OR UPDATE OR DELETE ON ${alloc} FOR EACH STATEMENT EXECUTE FUNCTION v2_production_run_membership_gate()`],
    ["gate wrong level", `DROP TRIGGER ${triggers[0][1]} ON ${runs}; CREATE TRIGGER ${triggers[0][1]} BEFORE INSERT OR UPDATE OR DELETE ON ${runs} FOR EACH ROW EXECUTE FUNCTION v2_production_run_membership_gate()`],
    ["conditional bind", `DROP TRIGGER ${triggers[2][1]} ON ${alloc}; CREATE TRIGGER ${triggers[2][1]} BEFORE INSERT OR UPDATE ON ${alloc} FOR EACH ROW WHEN (NEW.membership_active) EXECUTE FUNCTION v2_production_run_membership_bind()`],
    ["bind update-column restriction", `DROP TRIGGER ${triggers[2][1]} ON ${alloc}; CREATE TRIGGER ${triggers[2][1]} BEFORE INSERT OR UPDATE OF membership_active ON ${alloc} FOR EACH ROW EXECUTE FUNCTION v2_production_run_membership_bind()`],
    ["bind event subset", `DROP TRIGGER ${triggers[2][1]} ON ${alloc}; CREATE TRIGGER ${triggers[2][1]} BEFORE INSERT ON ${alloc} FOR EACH ROW EXECUTE FUNCTION v2_production_run_membership_bind()`],
    ["state wrong update column", `DROP TRIGGER ${triggers[3][1]} ON ${runs}; CREATE TRIGGER ${triggers[3][1]} AFTER UPDATE OF revision ON ${runs} FOR EACH ROW EXECUTE FUNCTION v2_production_run_membership_state()`],
    ["state broader columns", `DROP TRIGGER ${triggers[3][1]} ON ${runs}; CREATE TRIGGER ${triggers[3][1]} AFTER UPDATE OF state,revision ON ${runs} FOR EACH ROW EXECUTE FUNCTION v2_production_run_membership_state()`],
    ["conditional state", `DROP TRIGGER ${triggers[3][1]} ON ${runs}; CREATE TRIGGER ${triggers[3][1]} AFTER UPDATE OF state ON ${runs} FOR EACH ROW WHEN (NEW.state='held') EXECUTE FUNCTION v2_production_run_membership_state()`],
    ["trigger args", `DROP TRIGGER ${triggers[2][1]} ON ${alloc}; CREATE TRIGGER ${triggers[2][1]} BEFORE INSERT OR UPDATE ON ${alloc} FOR EACH ROW EXECUTE FUNCTION v2_production_run_membership_bind('bypass')`],
  );
  for (const fn of ["gate", "bind", "state"]) {
    for (const metadata of ["SECURITY DEFINER", "IMMUTABLE", "STABLE", "STRICT", "PARALLEL SAFE", "SET search_path TO public", "COST 1"]) {
      cases.push([`${fn} ${metadata}`, `ALTER FUNCTION v2_production_run_membership_${fn}() ${metadata}`]);
    }
    cases.push([`missing ${fn} function`, `DROP FUNCTION v2_production_run_membership_${fn}() CASCADE`]);
    cases.push([`altered ${fn} body`, `CREATE OR REPLACE FUNCTION v2_production_run_membership_${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$`]);
  }
  const bodies = [...membershipDdl.matchAll(/CREATE FUNCTION (\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$;/g)];
  for (const [, fn, body] of bodies) {
    const changed = body.includes("'active'") ? body.replaceAll("'active'", "'ACTIVE'") : body.replace("1209", "1210");
    cases.push([`protected literals ${fn}`, `CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$${changed}$$;`]);
  }
  try {
    await db.exec(membershipDdl);
    await ready(db);
    await db.exec("BEGIN");
    for (const [table, name] of triggers) await db.exec(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${name}`);
    await ready(db);
    await db.exec("ROLLBACK");
    checks++;
    for (const [label, mutation] of cases) {
      await db.exec("BEGIN");
      try {
        await db.exec(mutation);
        await assert.rejects(ready(db), /schema is unavailable/, label);
        checks++;
      } finally { await db.exec("ROLLBACK"); }
      await ready(db);
    }
    // A catalog-invalid/unfinished index is not constructible via ordinary DDL.
    // Use transactional catalog mutation only in this disposable in-memory engine.
    const invalidCatalog = [
      ...["indisvalid", "indisready", "indislive", "indimmediate"].map(flag =>
        [`${flag}`, `UPDATE pg_index SET ${flag}=false WHERE indexrelid='${index}'::regclass`]),
      ["missing opclass", `UPDATE pg_index SET indclass='0 0'::oidvector WHERE indexrelid='${index}'::regclass`],
      ["hash text_ops corruption", `UPDATE pg_index SET indclass=(SELECT
        (op.oid::text || ' ' || op.oid::text)::oidvector FROM pg_opclass op
        JOIN pg_am am ON am.oid=op.opcmethod WHERE op.opcnamespace='pg_catalog'::regnamespace
          AND op.opcname='text_ops' AND am.amname='hash') WHERE indexrelid='${index}'::regclass`],
      ["short opclass", `UPDATE pg_index SET indclass=''::oidvector WHERE indexrelid='${index}'::regclass`],
      ["short collation", `UPDATE pg_index SET indcollation=''::oidvector WHERE indexrelid='${index}'::regclass`],
      ["short options", `UPDATE pg_index SET indoption=''::int2vector WHERE indexrelid='${index}'::regclass`],
    ];
    for (const [label, mutation] of invalidCatalog) {
      await db.exec("BEGIN");
      try {
        await db.exec(mutation);
        await assert.rejects(ready(db), /schema is unavailable/, label);
        checks++;
      } finally { await db.exec("ROLLBACK"); }
      await ready(db);
    }
    // A read-only transaction proves the assertion performs no repair/DDL.
    await db.exec("BEGIN READ ONLY");
    await ready(db);
    await db.exec("ROLLBACK");
    checks++;
    console.log(`Catalog fail-closed cases: ${cases.length + invalidCatalog.length}; restored ready rechecks: ${cases.length + invalidCatalog.length} (not included in counted checks).`);
  } finally { await db.close(); }
}

async function main() {
  assert.equal(membershipDdl, approvedDdl, "Canonical SQL must exactly preserve the accepted proposal");
  const deployment = readFileSync(new URL("../../../src/deployment/server.ts", import.meta.url), "utf8");
  assert.match(deployment, /await assertPreparedQuoteDeliverySchema\(pool\);\s*await assertShipmentSenderSchema\(pool\);\s*await assertQuickBooksRecoveryPhysicalPostconditions\(pool\);\s*await assertQuotePublicationSchema\(pool\);\s*await assertProductionExclusiveMembershipSchema\(pool\);\s*return \{ ready: true \};\s*\} catch \{\s*return \{ ready: false \};/);
  for (const rows of [[], [{ ready: false }], [{ ready: null }], [{ ready: "true" }]]) {
    await assert.rejects(assertProductionExclusiveMembershipSchema({ query: async () => ({ rows }) } as unknown as TransactionalClient), /schema is unavailable/);
    checks++;
  }
  await assert.rejects(assertProductionExclusiveMembershipSchema({ query: async () => { throw new Error("catalog unavailable"); } } as unknown as TransactionalClient), /catalog unavailable/);
  checks += 2;
  checks++;
  await nativeRawRunParameterTyping();
  await derivedBackfill();
  await overlapRollback();
  await mutationSemantics();
  await catalogFailures();
  console.log(`Production exclusive membership schema: ${checks} counted checks passed; in-memory single-client SQL only; native PG16 UNRUN.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
