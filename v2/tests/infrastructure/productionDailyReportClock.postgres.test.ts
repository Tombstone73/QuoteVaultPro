import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { composeAuthenticatedProductionRuntime } from "../../infrastructure/production/authenticatedProductionRuntime.js";
import { productionDailyReportCandidatesSql } from "../../infrastructure/production/postgresProductionDailyReport.js";
import { PassportSessionIdentitySource } from "../../infrastructure/authentication/trustedHostPrincipalProvider.js";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
assert.deepEqual(Object.keys(process.env).filter(key => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);
const org = randomUUID(), otherOrg = randomUUID(), user = randomUUID(), otherUser = randomUUID();
const db = new PGlite(); await db.exec("CREATE TABLE organizations(id varchar PRIMARY KEY,settings jsonb NOT NULL)");
await db.query("INSERT INTO organizations VALUES($1,$3::jsonb),($2,$4::jsonb)", [org, otherOrg, JSON.stringify({ timezone: "America/New_York" }), JSON.stringify({ timezone: "Pacific/Kiritimati" })]);
const RealDate = Date, originalTZ = process.env.TZ;
let pinned = "2026-10-02T02:00:00.000Z", connections = 0, releases = 0, candidateReads = 0, leased = false, failWindow = false;
const sqlLog: { sql: string; values: readonly unknown[] }[] = [];
const windows: { client: PoolClient; timeZone: string; asOf: string; start: string; end: string; today: string; tomorrow: string }[] = [];
class ServerDate extends RealDate {
  constructor(value?: string | number | Date) { super(value === undefined ? pinned : value instanceof RealDate ? value.getTime() : value); }
  static now() { return new RealDate(pinned).getTime(); }
}
const client = {
  async query(sql: string, values: readonly unknown[] = []) {
    assert.ok(leased); sqlLog.push({ sql, values });
    assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE)\b/i);
    if (sql === productionDailyReportCandidatesSql) { assert.equal(values[1], 1001); candidateReads++; return { rows: [], rowCount: 0 }; }
    if (!/^(?:BEGIN|COMMIT|ROLLBACK|SELECT settings->>'timezone'|SELECT EXISTS\(SELECT 1 FROM pg_timezone_names|WITH local_clock)/.test(sql.trimStart())) throw Error(`Unexpected composed report SQL: ${sql}`);
    if (sql.includes("settings->>'timezone'")) {
      assert.equal((await db.query<{ transaction_isolation: string }>("SHOW transaction_isolation")).rows[0].transaction_isolation, "repeatable read");
      assert.equal((await db.query<{ transaction_read_only: string }>("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
    }
    if (failWindow && sql.includes("WITH local_clock")) throw Error("fixture-only calendar read fault");
    const result = await db.query(sql, [...values]);
    if (sql.includes("WITH local_clock")) {
      const row = result.rows[0] as { start_inclusive: Date | string; end_exclusive: Date | string; today_date: string; tomorrow_date: string };
      windows.push({ client, timeZone: String(values[0]), asOf: String(values[1]), start: row.start_inclusive instanceof RealDate ? row.start_inclusive.toISOString() : new RealDate(row.start_inclusive).toISOString(), end: row.end_exclusive instanceof RealDate ? row.end_exclusive.toISOString() : new RealDate(row.end_exclusive).toISOString(), today: row.today_date, tomorrow: row.tomorrow_date });
    }
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  },
  release() { assert.equal(leased, true); leased = false; releases++; },
} as unknown as PoolClient;

// Bounded authority SQL rows are fixture data, not an issued Principal override.
// Actual PostgresPermissionAuthorityReader + issuer + Passport identity adapter
// run through the composed runtime; Settings and calendar SQL use PGlite.
const pool = {
  async query(sql: string, values: readonly unknown[] = []) {
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b/i);
    if (sql.includes("FROM v2_permission_organization_state s")) return { rows: values[0] === org || values[0] === otherOrg ? [{ status: "active", delete_state: "active", is_archived: false, authority_revision: 7 }] : [] };
    const actor = values[1] === org ? user : values[1] === otherOrg ? otherUser : undefined;
    if (sql.includes("FROM user_organizations m")) return { rows: values[0] === actor ? [{ user_id: actor, role: "member", is_active: true, is_platform_developer: false }] : [] };
    if (sql.includes("FROM v2_staff_permission_set_assignments")) return { rows: values[0] === actor ? [{ id: "clock-production-reader", name: "Production only", active: true, revision: 1, capability_id: "production.view" }] : [] };
    if (sql.includes("FROM customer_portal_access")) return { rows: [] };
    throw Error(`Unexpected authority SQL: ${sql}`);
  },
  async connect() { assert.equal(leased, false); leased = true; connections++; return client; },
} as unknown as Pool;
const runtime = composeAuthenticatedProductionRuntime({ pool, trustedHostIdentity: new PassportSessionIdentitySource(), trustedHostMiddleware: (_request, _response, next) => next() });
assert.equal(runtime.dailyReportDependencies.principals, runtime.dependencies.principals);
const context = async (organizationId = org, actor = user): Promise<OperationContext> => ({ organizationId, operationId: "production-clock-integration", principal: await runtime.dependencies.principals.principal({ user: { id: actor }, isAuthenticated: () => true } as unknown as Request, organizationId) });
const read = async (organizationId = org, actor = user) => runtime.dailyReportDependencies.service.dailyReport(await context(organizationId, actor), { mode: "page" });
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
try {
  globalThis.Date = ServerDate as DateConstructor; process.env.TZ = "Pacific/Kiritimati";
  await check("composed server clock crosses UTC midnight using Settings, not process/browser date", async () => {
    const start = sqlLog.length, result = await read(); if (!result.ok) throw result.error; assert.equal(result.ok, true);
    assert.deepEqual(result.value.calendar, { asOf: pinned, timeZone: "America/New_York", todayDate: "2026-10-01", tomorrowDate: "2026-10-02" });
    const window = windows.at(-1)!; assert.equal(window.client, client); assert.equal(window.asOf, pinned);
    assert.equal(window.start, "2026-10-01T04:00:00.000Z"); assert.equal(window.end, "2026-10-02T04:00:00.000Z");
    assert.equal(sqlLog[start].sql, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); assert.equal(sqlLog.at(-1)!.sql, "COMMIT");
    assert.deepEqual(sqlLog.slice(start).find(entry => entry.sql.includes("settings->>'timezone'"))!.values, [org]);
    assert.equal(connections, releases);
  });
  for (const [name, asOf, start, end, hours] of [
    ["spring DST 23-hour local day", "2026-03-08T12:00:00.000Z", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z", 23],
    ["fall DST 25-hour local day", "2026-11-01T12:00:00.000Z", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z", 25],
  ] as const) await check(`composed reporting window honors ${name}`, async () => {
    pinned = asOf; const result = await read(); if (!result.ok) throw result.error; assert.equal(result.ok, true);
    const window = windows.at(-1)!; assert.equal(window.client, client); assert.equal(window.start, start); assert.equal(window.end, end);
    assert.equal((new RealDate(window.end).getTime() - new RealDate(window.start).getTime()) / 3_600_000, hours);
    assert.equal(result.value.calendar.todayDate, asOf.slice(0, 10)); assert.equal(result.value.calendar.timeZone, "America/New_York"); assert.equal(connections, releases);
  });
  await check("missing Settings timezone falls back to UTC on the same report client", async () => {
    pinned = "2026-10-02T02:00:00.000Z"; await db.query("UPDATE organizations SET settings='{}' WHERE id=$1", [org]);
    const result = await read(); if (!result.ok) throw result.error; assert.equal(result.ok, true);
    assert.deepEqual(result.value.calendar, { asOf: pinned, timeZone: "UTC", todayDate: "2026-10-02", tomorrowDate: "2026-10-03" });
    assert.equal(windows.at(-1)!.start, "2026-10-02T00:00:00.000Z"); assert.equal(windows.at(-1)!.client, client); assert.equal(connections, releases);
  });
  await check("second tenant's actual issued principal reads only its own Settings timezone", async () => {
    const start = sqlLog.length, result = await read(otherOrg, otherUser); if (!result.ok) throw result.error; assert.equal(result.ok, true);
    assert.equal(result.value.calendar.timeZone, "Pacific/Kiritimati"); assert.equal(result.value.calendar.todayDate, "2026-10-02");
    assert.deepEqual(sqlLog.slice(start).find(entry => entry.sql.includes("settings->>'timezone'"))!.values, [otherOrg]);
    const before = connections, issued = await context();
    const wrong = await runtime.dailyReportDependencies.service.dailyReport({ ...issued, organizationId: otherOrg }, {});
    assert.equal(wrong.ok, false); if (wrong.ok) throw Error("Expected scope denial"); assert.equal(wrong.error.code, "WRONG_TENANT"); assert.equal(connections, before);
  });
  for (const zone of ["Not/A_Zone", ""]) await check(`invalid stored timezone ${JSON.stringify(zone)} fails closed, rolls back and releases`, async () => {
    await db.query("UPDATE organizations SET settings=$2::jsonb WHERE id=$1", [org, JSON.stringify({ timezone: zone })]);
    const candidates = candidateReads, beforeRelease = releases, result = await read();
    assert.equal(result.ok, false); if (result.ok) throw Error("Invalid timezone must fail"); assert.equal(result.error.code, "CONFLICT");
    assert.equal(candidateReads, candidates); assert.equal(sqlLog.at(-1)!.sql, "ROLLBACK"); assert.equal(releases, beforeRelease + 1); assert.equal(leased, false);
  });
  await check("calendar read failure sanitizes the error and rolls back/releases before candidate reads", async () => {
    await db.query("UPDATE organizations SET settings=$2::jsonb WHERE id=$1", [org, JSON.stringify({ timezone: "UTC" })]); failWindow = true;
    const candidates = candidateReads, result = await read(); assert.equal(result.ok, false); if (result.ok) throw Error("Expected clock failure");
    assert.equal(result.error.code, "INTERNAL_ERROR"); assert.doesNotMatch(result.error.publicMessage, /fixture-only/); assert.equal(candidateReads, candidates);
    assert.equal(sqlLog.at(-1)!.sql, "ROLLBACK"); assert.equal(connections, releases); failWindow = false;
  });
  await check("organization disappearance after issuance cannot substitute another tenant's clock", async () => {
    const issued = await context(), candidates = candidateReads; await db.query("DELETE FROM organizations WHERE id=$1", [org]);
    const result = await runtime.dailyReportDependencies.service.dailyReport(issued, {}); assert.equal(result.ok, false); if (result.ok) throw Error("Expected missing organization");
    assert.equal(result.error.code, "NOT_FOUND"); assert.equal(candidateReads, candidates); assert.equal(sqlLog.at(-1)!.sql, "ROLLBACK"); assert.equal(connections, releases);
  });
  console.log(`Production daily report composed Settings/clock integration: ${cases} cases passed. Actual PGlite calendar/isolation SQL; bounded authority rows and empty operational candidates are fixture ports. No native multi-client snapshot proof.`);
} finally { globalThis.Date = RealDate; if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; assert.equal(leased, false); await db.close(); }
