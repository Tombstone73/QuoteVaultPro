import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import type { Request, RequestHandler } from "express";
import { composeAuthenticatedProductionRuntime } from "../../infrastructure/production/authenticatedProductionRuntime.js";
import { productionDailyReportCandidatesSql } from "../../infrastructure/production/postgresProductionDailyReport.js";
import { PassportSessionIdentitySource } from "../../infrastructure/authentication/trustedHostPrincipalProvider.js";
import { createV2HttpApp } from "../../src/interfaces/http/app.js";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
assert.deepEqual(Object.keys(process.env).filter(key => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);
const org = randomUUID(), foreignOrg = randomUUID(), user = randomUUID(), csrf = "a-production-session-bound-csrf-token";
const db = new PGlite(), queries: { sql: string; values: readonly unknown[]; kind: "authority" | "report" | "production" }[] = [];
let authenticated = true, session = { v2CsrfToken: csrf, v2SessionScope: undefined as string | undefined };
let connections = 0, releases = 0, leased = false, reportReads = 0;
const json = (value: unknown) => JSON.stringify(value);

await db.exec(`
  CREATE TABLE organizations(id varchar PRIMARY KEY,status varchar NOT NULL,delete_state varchar NOT NULL,is_archived boolean NOT NULL,settings jsonb NOT NULL);
  CREATE TABLE users(id varchar PRIMARY KEY,is_platform_developer boolean NOT NULL);
  CREATE TABLE user_organizations(user_id varchar,organization_id varchar,is_active boolean,role varchar);
  CREATE TABLE v2_permission_organization_state(organization_id varchar PRIMARY KEY,authority_revision integer NOT NULL);
  CREATE TABLE v2_permission_sets(id varchar PRIMARY KEY,organization_id varchar,name varchar,active boolean,revision integer,principal_kind varchar);
  CREATE TABLE v2_permission_set_capabilities(permission_set_id varchar,organization_id varchar,capability_id varchar);
  CREATE TABLE v2_permission_capabilities(id varchar PRIMARY KEY,active boolean);
  CREATE TABLE v2_staff_permission_set_assignments(user_id varchar,organization_id varchar,permission_set_id varchar,active boolean);
  CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar);
  CREATE TABLE customer_portal_access(id varchar PRIMARY KEY,organization_id varchar,customer_id varchar,user_id varchar,status varchar);
`);
await db.query("INSERT INTO organizations VALUES($1,'active','active',false,$3::jsonb),($2,'active','active',false,'{}')", [org, foreignOrg, json({ timezone: "America/New_York" })]);
await db.query("INSERT INTO users VALUES($1,false)", [user]);
await db.query("INSERT INTO user_organizations VALUES($1,$2,true,'member')", [user, org]);
await db.query("INSERT INTO v2_permission_organization_state VALUES($1,1),($2,1)", [org, foreignOrg]);
await db.query("INSERT INTO v2_permission_sets VALUES('production-only',$1,'Production report reader',true,1,'staff')", [org]);
await db.query("INSERT INTO v2_permission_capabilities VALUES('production.view',true),('prepress.view',true)");
await db.query("INSERT INTO v2_permission_set_capabilities VALUES('production-only',$1,'production.view')", [org]);
await db.query("INSERT INTO v2_staff_permission_set_assignments VALUES($1,$2,'production-only',true)", [user, org]);

// Permission resolution and Settings clock SQL are actual PGlite reads. Only
// operational population/queue SQL is an explicit empty fixture port. Any other
// SQL fails closed, especially writes or an unexpected owner dependency.
const client = {
  async query(sql: string, values: readonly unknown[] = []) {
    assert.ok(leased); assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE)\b/i);
    const kind = sql === productionDailyReportCandidatesSql || sql.includes("WITH local_clock") || sql.includes("settings->>'timezone'") || sql.includes("pg_timezone_names") || sql.includes("READ ONLY") ? "report" : "production";
    queries.push({ sql, values, kind });
    if (sql === productionDailyReportCandidatesSql) {
      assert.deepEqual(values, [org, 1001]); reportReads++;
      const isolation = (await db.query<{ transaction_isolation: string }>("SHOW transaction_isolation")).rows[0].transaction_isolation;
      const readOnly = (await db.query<{ transaction_read_only: string }>("SHOW transaction_read_only")).rows[0].transaction_read_only;
      assert.equal(isolation, "repeatable read"); assert.equal(readOnly, "on");
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("SELECT count(*) count ") && sql.includes("FROM v2_production_works w JOIN v2_sales_order_details")) {
      assert.deepEqual(values.slice(0, 3), [org, "roll", ""]); return { rows: [{ count: "0" }], rowCount: 1 };
    }
    if (sql.startsWith("SELECT w.id ") && sql.includes("FROM v2_production_works w JOIN v2_sales_order_details")) {
      assert.deepEqual(values.slice(0, 3), [org, "roll", ""]); return { rows: [], rowCount: 0 };
    }
    if (!/^(?:BEGIN|COMMIT|ROLLBACK|SELECT settings->>'timezone'|SELECT EXISTS\(SELECT 1 FROM pg_timezone_names|WITH local_clock)/.test(sql.trimStart())) throw Error(`Unexpected report/Production SQL: ${sql}`);
    const result = await db.query(sql, [...values]); return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  },
  release() { assert.equal(leased, true); leased = false; releases++; },
} as unknown as PoolClient;
const pool = {
  async query(sql: string, values: readonly unknown[] = []) {
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b/i); queries.push({ sql, values, kind: "authority" });
    assert.match(sql, /FROM (?:v2_permission_organization_state|user_organizations|v2_staff_permission_set_assignments|customer_portal_access)/);
    return db.query(sql, [...values]);
  },
  async connect() { assert.equal(leased, false); leased = true; connections++; return client; },
} as unknown as Pool;

// The transport fixture represents an already-authenticated host identity only.
// It never authors Staff authority. Passport's real adapter, the actual SQL
// authority reader and PermissionSetPrincipalIssuer decide all grants afresh.
const trustedHostMiddleware: RequestHandler = (incoming, _response, next) => {
  Object.assign(incoming, { session, sessionID: "production-report-host-session", isAuthenticated: () => authenticated, user: authenticated ? { id: user } : undefined }); next();
};
const runtime = composeAuthenticatedProductionRuntime({ pool, trustedHostIdentity: new PassportSessionIdentitySource(), trustedHostMiddleware });
assert.equal(runtime.dailyReportDependencies.principals, runtime.dependencies.principals, "report and Production share the exact issued provider");
const args: Parameters<typeof createV2HttpApp> = [{ environment: "test", serviceName: "production-report-mount", port: 8080 }, { log: () => {} }];
args[9] = runtime;
const app = createV2HttpApp(...args), base = `/v2/organizations/${org}/production`, reportUrl = `${base}/daily-report`;
const image = async () => ({ organizations: (await db.query("SELECT * FROM organizations ORDER BY id")).rows, assignments: (await db.query("SELECT * FROM v2_staff_permission_set_assignments ORDER BY user_id")).rows, grants: (await db.query("SELECT * FROM v2_permission_set_capabilities ORDER BY capability_id")).rows });
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
try {
  await check("real composition/mount serves production.view-only without any Prepress grant", async () => {
    const before = await image(); const response = await request(app).get(reportUrl).query({ page: "3", pageSize: "17" });
    assert.equal(response.status, 200, json(response.body)); assert.equal(response.body.ok, true);
    assert.equal(response.headers["cache-control"], "private, no-store"); assert.ok(response.headers["x-v2-session-scope"]);
    assert.equal(response.headers["x-v2-session-scope"], session.v2SessionScope);
    assert.equal(response.body.data.mode, "page"); assert.equal(response.body.data.pagination.page, 3); assert.equal(response.body.data.pagination.pageSize, 17);
    assert.equal(response.body.data.summary.totalActive, 0); assert.equal(reportReads, 1);
    const carrier = { user: { id: user }, isAuthenticated: () => true } as unknown as Request;
    const issued = await runtime.dependencies.principals.principal(carrier, org);
    assert.equal(issued.kind, "staff"); if (issued.kind !== "staff") throw Error("Expected issued Staff");
    assert.equal(issued.authority?.source, "permission_set"); assert.deepEqual(issued.authority?.capabilities, ["production.view"]);
    assert.deepEqual(await image(), before); assert.equal(connections, releases);
    assert.ok(queries.findIndex(entry => entry.kind === "authority") < queries.findIndex(entry => entry.sql === productionDailyReportCandidatesSql));
  });
  await check("client date/zone hints are not report authority and print uses the bounded server mode", async () => {
    const response = await request(app).get(reportUrl).query({ mode: "print", page: "99", pageSize: "7", asOf: "1900-01-01T00:00:00Z", timeZone: "Pacific/Kiritimati", todayDate: "1900-01-01" });
    assert.equal(response.status, 200); assert.equal(response.body.data.mode, "print");
    assert.equal(response.body.data.pagination.page, 1); assert.equal(response.body.data.pagination.pageSize, 1000);
    assert.equal(response.body.data.calendar.timeZone, "America/New_York"); assert.notEqual(response.body.data.calendar.asOf, "1900-01-01T00:00:00.000Z");
    assert.notEqual(response.body.data.calendar.todayDate, "1900-01-01");
  });
  await check("unauthenticated and wrong-tenant callers are denied before report connection/reads", async () => {
    const before = { connections, reportReads };
    authenticated = false; const noSession = await request(app).get(reportUrl); assert.equal(noSession.status, 403); assert.equal(noSession.body.error.code, "FORBIDDEN");
    authenticated = true; const foreign = await request(app).get(`/v2/organizations/${foreignOrg}/production/daily-report`); assert.equal(foreign.status, 404); assert.equal(foreign.body.error.code, "NOT_FOUND");
    assert.deepEqual({ connections, reportReads }, before);
  });
  await check("same-session revocation reloads actual permission rows before report reads", async () => {
    await db.query("UPDATE v2_permission_sets SET revision=2 WHERE id='production-only'");
    await db.query("UPDATE v2_permission_organization_state SET authority_revision=2 WHERE organization_id=$1", [org]);
    await db.query("UPDATE v2_permission_set_capabilities SET capability_id='prepress.view' WHERE permission_set_id='production-only'");
    const before = { connections, reportReads }; const response = await request(app).get(reportUrl);
    assert.equal(response.status, 403); assert.equal(response.body.error.code, "FORBIDDEN"); assert.deepEqual({ connections, reportReads }, before);
    await db.query("UPDATE v2_permission_set_capabilities SET capability_id='production.view' WHERE permission_set_id='production-only'");
  });
  await check("report stays GET-only in the existing Production CSRF chain", async () => {
    const before = { connections, reportReads }; const tokenDenied = await request(app).post(reportUrl).send({});
    assert.equal(tokenDenied.status, 403); assert.match(tokenDenied.body.error.message, /CSRF/);
    for (const method of ["post", "put", "patch", "delete"] as const) assert.equal((await request(app)[method](reportUrl).set("x-v2-csrf-token", csrf).send({})).status, 404);
    assert.deepEqual({ connections, reportReads }, before);
  });
  await check("existing Production station route and actual service remain mounted unchanged", async () => {
    const before = reportReads; const response = await request(app).get(`${base}/stations/roll/queue`).query({ page: "2", pageSize: "25" });
    assert.equal(response.status, 200, json(response.body)); assert.deepEqual(response.body.data.items, []); assert.equal(response.body.data.pagination.page, 2); assert.equal(response.body.data.pagination.totalCount, 0);
    assert.equal(response.headers["x-v2-session-scope"], session.v2SessionScope); assert.equal(reportReads, before); assert.equal(connections, releases);
  });
  await check("replacement host session uses the same mounted session-header helper without cross-owner writes", async () => {
    const old = session.v2SessionScope; session = { v2CsrfToken: csrf, v2SessionScope: undefined };
    const before = await image(); const response = await request(app).get(reportUrl);
    assert.equal(response.status, 200); assert.notEqual(response.headers["x-v2-session-scope"], old); assert.equal(response.headers["x-v2-session-scope"], session.v2SessionScope);
    assert.deepEqual(await image(), before); assert.ok(queries.every(entry => !/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(entry.sql)));
    assert.equal(leased, false); assert.equal(connections, releases);
  });
  console.log(`Production daily report actual mount/auth integration: ${cases} cases passed. Identity transport and empty operational SQL populations are fixtures; authority, issuance, report service, clock and app mount are actual. No login/provider/native-concurrency proof.`);
} finally { assert.equal(leased, false); await db.close(); }
