import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import session from "express-session";
import { PGlite } from "@electric-sql/pglite";
import { assertPreparedQuoteDeliverySchema } from "../../infrastructure/sales/commercialPhysicalPostconditions.js";
import { assertQuotePublicationSchema } from "../../infrastructure/sales/quotePublicationPhysicalPostconditions.js";
import { createStandaloneStaffAuthentication, loadV2StandaloneAuthConfig } from "../../infrastructure/authentication/standaloneStaffAuth.js";
import { loadV2RuntimeConfig } from "../../src/config/runtimeConfig.js";

const db = new PGlite();
const sql = (file: string) => readFileSync(path.resolve("server/db/migrations_v2", file), "utf8");
const priorSql = sql("0229_v2_sales_customer_delivery_evidence.sql");
const preparedSql = sql("0299_v2_sales_quote_delivery_prepared_evidence.sql");
const migrationSql = sql("0302_v2_quote_delivery_checkpoint_success.sql");
const oldIndex = "v2_sales_quote_delivery_attempts_one_success_uidx";
const newIndex = "v2_sales_quote_delivery_attempts_checkpoint_success_uidx";
const oldStatement = priorSql.match(/CREATE UNIQUE INDEX v2_sales_quote_delivery_attempts_one_success_uidx[\s\S]*?;/)?.[0];
assert.ok(oldStatement, "old index statement must come from immutable canonical 0229, not a fabricated fixture");
const digest = `sha256:${"a".repeat(64)}`;
let cases = 0;
let readinessCases = 0;
const runCase = async (name: string, action: () => Promise<void>) => {
  await action();
  cases += 1;
  console.log(`PASS ${name}`);
};
const queryLog: string[] = [];
const client = {
  query: async (text: string, values?: readonly unknown[]) => {
    queryLog.push(text);
    assert.match(text.trimStart(), /^SELECT\b/, "readiness may inspect catalogs but must never execute DDL");
    return db.query(text, values ? [...values] : undefined);
  },
};
const ownerChecks = ["prepared_evidence_json", "sender_snapshot", "v2_quickbooks_provider_requests",
  newIndex, "v2_production_run_allocations_exclusive_active_uidx"];
const nonSalesChecks = [ownerChecks[1], ownerChecks[2], ownerChecks[4]];
// This fixture proves the real Sales catalogs; other owner catalogs are mocked only for composition.
const readinessClient = {
  query: async (text: string, values?: readonly unknown[]) => {
    if (nonSalesChecks.some(marker => text.includes(marker))) {
      queryLog.push(text);
      return { rows: [{ ready: true }], rowCount: 1 };
    }
    return client.query(text, values);
  },
};
const evidence = (organizationId: string) => ({
  schemaVersion: 1, organizationId, quoteId: "quote", expectedRevision: "2",
  customerContact: { organizationId, contactId: "contact" },
  commercial: { currency: "USD", terms: {}, lines: [] },
  customerPresentation: { customerDisplayName: "Frozen Customer" },
  organizationPresentation: { name: "Frozen Shop" }, recipientEmail: "prepared@example.invalid",
  documentSha256: digest, documentNumber: "QT-1", documentDate: "2026-10-02",
});
const insert = async (
  id: string, organizationId: string, checkpointId: string | null,
  state = "pending", requestId = id, prepared = true,
) => {
  await db.query("INSERT INTO v2_operation_requests VALUES($1,$2) ON CONFLICT DO NOTHING", [requestId, organizationId]);
  return db.query(`INSERT INTO v2_sales_quote_delivery_attempts
    (id,organization_id,quote_document_id,quote_checkpoint_id,operation_request_id,
     recipient_email,document_sha256,initiated_principal_kind,initiated_principal_subject,
     delivery_state,completed_at,provider_message_id,failure_message${prepared ? ",prepared_evidence_json" : ""})
    VALUES($1::varchar,$2,'quote',$3,$4,'prepared@example.invalid',$5,'staff','staff',
     $6::varchar,CASE WHEN $6='pending' THEN NULL ELSE '2026-10-02T00:00:00Z'::timestamptz END,
     CASE WHEN $6='succeeded' THEN $1::varchar ELSE NULL END,
     CASE WHEN $6 IN ('failed','uncertain') THEN 'provider failure' ELSE NULL END${prepared ? ",$7::jsonb" : ""})`,
  [id, organizationId, checkpointId, requestId, digest, state, ...(prepared ? [JSON.stringify(evidence(organizationId))] : [])]);
};
const rejectCode = async (action: () => Promise<unknown>, code: string) => {
  await assert.rejects(action, (error: unknown) => (error as { code?: string }).code === code);
};
const historicRows = () => db.query(`SELECT id,row_to_json(a)::text AS bytes,xmin::text,ctid::text
  FROM v2_sales_quote_delivery_attempts a WHERE id LIKE 'historic-%' ORDER BY id`);
const ownerCatalog = async () => ({
  constraints: (await db.query(`SELECT conname,contype,convalidated,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid='v2_sales_quote_delivery_attempts'::regclass ORDER BY conname`)).rows,
  columns: (await db.query(`SELECT a.attname,a.attnotnull,format_type(a.atttypid,a.atttypmod) AS type,
    pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='v2_sales_quote_delivery_attempts'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows,
  indexes: (await db.query(`SELECT indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename='v2_sales_quote_delivery_attempts'
      AND indexname NOT IN ('${oldIndex}','${newIndex}') ORDER BY indexname`)).rows,
  triggers: (await db.query(`SELECT tgname,tgenabled,pg_get_triggerdef(t.oid) AS definition,
    pg_get_functiondef(t.tgfoid) AS function_definition FROM pg_trigger t
    WHERE tgrelid='v2_sales_quote_delivery_attempts'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows,
});

try {
  // Only referenced-key prerequisites are declared here. The entire delivery table,
  // original indexes, defaults, tenant FKs and completion checks come from real 0229.
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE v2_sales_quote_details(document_id varchar,organization_id varchar,PRIMARY KEY(document_id,organization_id));
    CREATE TABLE v2_sales_quote_checkpoints(id varchar,organization_id varchar,quote_document_id varchar,PRIMARY KEY(id,organization_id,quote_document_id));
    CREATE TABLE v2_operation_requests(id varchar,organization_id varchar,PRIMARY KEY(id,organization_id));
    INSERT INTO organizations VALUES('org-a'),('org-b');
    INSERT INTO v2_sales_quote_details VALUES('quote','org-a'),('quote','org-b');
    INSERT INTO v2_sales_quote_checkpoints VALUES('cp-1','org-a','quote'),('cp-2','org-a','quote'),
      ('cp-1','org-b','quote'),('cp-other-tenant','org-b','quote');`);
  await db.exec(priorSql);
  await insert("historic-success", "org-a", "cp-1", "succeeded", undefined, false);
  await insert("historic-pending", "org-a", null, "pending", undefined, false);
  await runCase("canonical old index blocks a different checkpoint before replacement (23505)", async () => {
    await rejectCode(() => insert("old-second", "org-a", "cp-2", "succeeded", undefined, false), "23505");
  });
  await db.exec(preparedSql);
  const beforeRows = await historicRows();
  const beforeOwner = await ownerCatalog();
  await runCase("new gate fails closed before 0302", async () => {
    await assert.rejects(() => assertQuotePublicationSchema(client), /schema is unavailable/);
  });
  await runCase("failed replacement DDL rolls back the DROP and preserves rows", async () => {
    // A conflicting relation makes the actual CREATE fail, after the actual DROP.
    await db.exec(`CREATE INDEX ${newIndex} ON v2_sales_quote_delivery_attempts(id)`);
    await db.exec("BEGIN");
    await rejectCode(() => db.exec(migrationSql), "42P07");
    await db.exec("ROLLBACK");
    assert.ok((await db.query("SELECT to_regclass($1) AS index", [oldIndex])).rows[0]?.index);
    assert.deepEqual((await historicRows()).rows, beforeRows.rows);
    assert.deepEqual(await ownerCatalog(), beforeOwner);
    await db.exec(`DROP INDEX ${newIndex}`);
  });
  await db.exec("BEGIN");
  await db.exec(migrationSql);
  await db.exec("COMMIT");
  await runCase("0302 changes only the target index, not historic bytes/xmin/ctid or owner constraints", async () => {
    assert.deepEqual((await historicRows()).rows, beforeRows.rows);
    assert.deepEqual(await ownerCatalog(), beforeOwner);
    await assertPreparedQuoteDeliverySchema(client);
    await assertQuotePublicationSchema(client);
    assert.equal((await db.query("SELECT to_regclass($1) AS index", [oldIndex])).rows[0]?.index, null);
  });
  // Keep the real deployment composition and readiness route. Only unused V1
  // DB/provider bridges are fail-fast doubles, so importing the app cannot load
  // dotenv, acquire native connections or initialize hosted provider clients.
  const require = createRequire(import.meta.url);
  const { require: loadTs } = require("tsx/cjs/api");
  const moduleLoader = Module as unknown as { _load: (specifier: string, parent: { filename?: string }, ...args: unknown[]) => unknown };
  const originalLoad = moduleLoader._load;
  const forbidden = () => { throw new Error("Unused native/provider bridge must not run during schema readiness"); };
  const bridgeDoubles = new Map<string, unknown>([
    [path.resolve("server/db.ts"), { db: forbidden, pool: forbidden }],
    [path.resolve("server/quickbooksService.ts"), {}],
    [path.resolve("server/services/storage/StorageApplicationService.ts"), { storageApplicationService: forbidden }],
    [path.resolve("server/lib/stripe.ts"), { assertStripeServerConfig: forbidden, getStripeClient: forbidden, stripeRuntimeReadiness: forbidden, getStripeWebhookSecret: forbidden }],
  ]);
  let createV2DeploymentApp: typeof import("../../src/deployment/server.js").createV2DeploymentApp;
  try {
    moduleLoader._load = function (specifier, parent, ...args) {
      const requested = specifier.split("?")[0];
      const file = (parent?.filename && requested.startsWith(".")
        ? path.resolve(path.dirname(parent.filename), requested) : requested).replace(/\.js$/, ".ts");
      if (bridgeDoubles.has(file)) return bridgeDoubles.get(file);
      if (bridgeDoubles.has(`${file}.ts`)) return bridgeDoubles.get(`${file}.ts`);
      if (specifier === "dotenv" || specifier.startsWith("dotenv/")) throw new Error(`Unexpected dotenv dependency in schema fixture: ${parent?.filename}`);
      return originalLoad.call(this, specifier, parent, ...args);
    };
    ({ createV2DeploymentApp } = loadTs(path.resolve("v2/src/deployment/server.ts"), import.meta.url));
  } finally { moduleLoader._load = originalLoad; }

  const authentication = createStandaloneStaffAuthentication({
    verifier: { authenticate: async () => null, currentStaff: async () => null, eligibleOrganizations: async () => [] },
    config: loadV2StandaloneAuthConfig({ SESSION_SECRET: "x".repeat(32), NODE_ENV: "test" }),
    sessionMiddleware: session({ name: "v2.sid", secret: "x".repeat(32), resave: false, saveUninitialized: false }),
  });
  const replaceIndex = (definition: string) => `DROP INDEX ${newIndex}; CREATE ${definition};`;
  const standardIndex = `UNIQUE INDEX ${newIndex} ON v2_sales_quote_delivery_attempts`;
  const normalKeys = "(organization_id,quote_document_id,quote_checkpoint_id)";
  const succeeded = "WHERE delivery_state='succeeded'";
  const probes = [
    { name: "exact valid index", ddl: "", ready: true },
    { name: "old canonical unique index lingers", ddl: oldStatement, ready: false },
    { name: "new index missing", ddl: `DROP INDEX ${newIndex}`, ready: false },
    { name: "nonunique index", ddl: replaceIndex(`INDEX ${newIndex} ON v2_sales_quote_delivery_attempts ${normalKeys} ${succeeded}`), ready: false },
    { name: "weak tenant scope", ddl: replaceIndex(`${standardIndex} (id,quote_document_id,quote_checkpoint_id) ${succeeded}`), ready: false },
    { name: "wrong key order", ddl: replaceIndex(`${standardIndex} (quote_document_id,organization_id,quote_checkpoint_id) ${succeeded}`), ready: false },
    { name: "extra INCLUDE column", ddl: replaceIndex(`${standardIndex} ${normalKeys} INCLUDE (id) ${succeeded}`), ready: false },
    { name: "wrong predicate", ddl: replaceIndex(`${standardIndex} ${normalKeys} WHERE delivery_state='failed' AND id='absent'`), ready: false },
    { name: "widened predicate", ddl: replaceIndex(`${standardIndex} ${normalKeys} WHERE delivery_state IN ('succeeded','failed') AND id='absent'`), ready: false },
    { name: "literal whitespace is not normalized", ddl: replaceIndex(`${standardIndex} ${normalKeys} WHERE delivery_state='succeeded '`), ready: false },
    { name: "invalid index", ddl: `UPDATE pg_index SET indisvalid=false WHERE indexrelid='${newIndex}'::regclass`, ready: false },
    { name: "unready index", ddl: `UPDATE pg_index SET indisready=false WHERE indexrelid='${newIndex}'::regclass`, ready: false },
    { name: "descending key", ddl: replaceIndex(`${standardIndex} (organization_id,quote_document_id,quote_checkpoint_id DESC) ${succeeded}`), ready: false },
    { name: "index on the wrong table", ddl: `DROP INDEX ${newIndex}; CREATE TABLE wrong_attempts (organization_id varchar,quote_document_id varchar,quote_checkpoint_id varchar,delivery_state varchar); CREATE UNIQUE INDEX ${newIndex} ON wrong_attempts ${normalKeys} ${succeeded}`, ready: false },
    { name: "existing prepared helper fails first", ddl: "UPDATE pg_constraint SET convalidated=false WHERE conname='v2_sales_quote_delivery_prepared_evidence_chk'", ready: false, preparedMissing: true },
  ];
  for (const probe of probes) await runCase(`helper + actual deployment /ready: ${probe.name}`, async () => {
    await db.exec("BEGIN");
    try {
      if (probe.ddl) await db.exec(probe.ddl);
      if (!probe.preparedMissing) {
        if (probe.ready) await assertQuotePublicationSchema(client);
        else await assert.rejects(() => assertQuotePublicationSchema(client), /schema is unavailable/);
      }
      queryLog.length = 0;
      const app = createV2DeploymentApp(loadV2RuntimeConfig({ V2_SERVICE_NAME: "checkpoint-readiness" }), readinessClient as never, { log: () => undefined }, authentication);
      // Invoke the actual composed Express route without listen/Supertest/network.
      const router = (app as unknown as { _router: { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> } })._router;
      const handler = router.stack.find(layer => layer.route?.path === "/ready")?.route?.stack[0]?.handle;
      assert.ok(handler, "actual deployment app must compose /ready");
      let statusCode: number | undefined;
      let body: unknown;
      const response = { status: (code: number) => { statusCode = code; return response; }, json: (value: unknown) => { body = value; return response; } };
      await handler({}, response);
      assert.equal(statusCode, probe.ready ? 200 : 503);
      assert.deepEqual(body, { status: probe.ready ? "ready" : "not_ready", checks: { application: probe.ready ? "ok" : "unavailable" } });
      const expectedChecks = ownerChecks.slice(0, probe.preparedMissing ? 1 : probe.ready ? ownerChecks.length : 4);
      assert.equal(queryLog.length, expectedChecks.length, "each owner failure must short-circuit the protected readiness union");
      for (const [index, text] of queryLog.entries()) assert.ok(text.includes(expectedChecks[index]), `owner catalog order ${index}`);
      if (!probe.preparedMissing) assert.match(queryLog[3], /pg_index/);
      readinessCases += 1;
    } finally { await db.exec("ROLLBACK"); }
  });
  await runCase("additional key and non-btree catalog index fail the narrow helper", async () => {
    for (const ddl of [
      replaceIndex(`${standardIndex} (organization_id,quote_document_id,quote_checkpoint_id,id) ${succeeded}`),
      replaceIndex(`INDEX ${newIndex} ON v2_sales_quote_delivery_attempts USING hash (quote_checkpoint_id) ${succeeded}`),
    ]) {
      await db.exec("BEGIN");
      try { await db.exec(ddl); await assert.rejects(() => assertQuotePublicationSchema(client), /schema is unavailable/); }
      finally { await db.exec("ROLLBACK"); }
    }
  });
  await runCase("missing catalog response and query failures fail closed", async () => {
    await assert.rejects(() => assertQuotePublicationSchema({ query: async () => ({ rows: [] }) } as never), /schema is unavailable/);
    await assert.rejects(() => assertQuotePublicationSchema({ query: async () => { throw new Error("catalog unavailable"); } } as never), /catalog unavailable/);
  });
  await runCase("two different checkpoints of one Quote can succeed; duplicate same checkpoint is 23505", async () => {
    await insert("second-checkpoint", "org-a", "cp-2", "succeeded");
    await rejectCode(() => insert("duplicate-checkpoint", "org-a", "cp-2", "succeeded"), "23505");
    assert.equal((await db.query("SELECT count(*)::int AS count FROM v2_sales_quote_delivery_attempts WHERE organization_id='org-a' AND delivery_state='succeeded'")).rows[0]?.count, 2);
  });
  await runCase("failed/pending/uncertain attempts remain non-success and retain request uniqueness", async () => {
    for (const state of ["failed", "pending", "uncertain"]) {
      await insert(`${state}-1`, "org-a", "cp-2", state);
      await insert(`${state}-2`, "org-a", "cp-2", state);
      await rejectCode(() => insert(`${state}-duplicate-request`, "org-a", "cp-2", state, `${state}-1`), "23505");
    }
    await rejectCode(() => db.exec("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='succeeded',provider_message_id='receipt',failure_message=NULL WHERE id='failed-1'"), "23505");
  });
  await runCase("organization is part of success and request uniqueness; tenant FKs remain enforced", async () => {
    await insert("tenant-b-success", "org-b", "cp-1", "succeeded", "historic-success");
    await rejectCode(() => insert("tenant-b-duplicate", "org-b", "cp-1", "succeeded"), "23505");
    await rejectCode(() => insert("foreign-checkpoint", "org-a", "cp-other-tenant"), "23503");
    await db.exec("INSERT INTO v2_operation_requests VALUES('only-org-b','org-b'); INSERT INTO v2_sales_quote_details VALUES('foreign-quote','org-b')");
    await rejectCode(() => db.exec("UPDATE v2_sales_quote_delivery_attempts SET operation_request_id='only-org-b' WHERE id='historic-success'"), "23503");
    await rejectCode(() => db.exec("UPDATE v2_sales_quote_delivery_attempts SET quote_document_id='foreign-quote' WHERE id='historic-pending'"), "23503");
    await rejectCode(() => db.exec("UPDATE v2_sales_quote_delivery_attempts SET organization_id='absent' WHERE id='historic-success'"), "23503");
    await rejectCode(() => db.exec("UPDATE v2_sales_quote_delivery_attempts SET initiated_staff_actor_user_id='absent' WHERE id='historic-success'"), "23503");
  });
  await runCase("completion/state/recipient/digest checks and default pending state remain enforced", async () => {
    for (const assignment of ["completed_at=now()", "provider_message_id='invalid'", "failure_message='invalid'",
      "delivery_state='invented'", "recipient_email='x'", "document_sha256='bad'"]) {
      await rejectCode(() => db.exec(`UPDATE v2_sales_quote_delivery_attempts SET ${assignment} WHERE id='historic-pending'`), "23514");
    }
    await db.exec("INSERT INTO v2_operation_requests VALUES('default-pending','org-a')");
    await db.query(`INSERT INTO v2_sales_quote_delivery_attempts
      (id,organization_id,quote_document_id,operation_request_id,recipient_email,document_sha256,
       initiated_principal_kind,initiated_principal_subject,prepared_evidence_json)
      VALUES('default-pending','org-a','quote','default-pending','prepared@example.invalid',$1,'staff','staff',$2::jsonb)`,
    [digest, JSON.stringify(evidence("org-a"))]);
    const row = (await db.query("SELECT delivery_state,transport,completed_at,provider_message_id,failure_message,attempted_at IS NOT NULL AS attempted FROM v2_sales_quote_delivery_attempts WHERE id='default-pending'")).rows[0];
    assert.deepEqual(row, { delivery_state: "pending", transport: "gmail", completed_at: null, provider_message_id: null, failure_message: null, attempted: true });
  });
  await runCase("0299 prepared evidence remains required, validated and immutable including historic NULL", async () => {
    await db.exec("INSERT INTO v2_operation_requests VALUES('missing-evidence','org-a')");
    await rejectCode(() => insert("missing-evidence", "org-a", "cp-1", "pending", undefined, false), "23514");
    await rejectCode(() => db.exec("UPDATE v2_sales_quote_delivery_attempts SET prepared_evidence_json=NULL WHERE id='second-checkpoint'"), "23514");
    await rejectCode(() => db.query("UPDATE v2_sales_quote_delivery_attempts SET prepared_evidence_json=$1::jsonb WHERE id='historic-pending'", [JSON.stringify(evidence("org-a"))]), "23514");
    await rejectCode(() => db.exec("UPDATE v2_sales_quote_delivery_attempts SET recipient_email='changed@example.invalid' WHERE id='second-checkpoint'"), "23514");
    assert.deepEqual((await historicRows()).rows, beforeRows.rows);
  });
  assert.equal(readinessCases, 15);
  console.log(`Quote checkpoint success schema: ${cases} cases passed, including ${readinessCases} actual-app readiness cases; real 0229/0299/0302 SQL in PGlite only. Native PG16+ UNRUN; no publication acceptance or parity closure.`);
} finally { await db.close(); }
