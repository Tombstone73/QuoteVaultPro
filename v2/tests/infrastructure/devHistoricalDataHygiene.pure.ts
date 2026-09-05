import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { historicalDataDisposition, historicalDataScope, readOnlyDevSnapshot } from "../../scripts/devHistoricalDataHygienePolicy.js";

const dev = { NODE_ENV: "production", RAILWAY_PROJECT_NAME: "PrintersHero-DEV", RAILWAY_ENVIRONMENT_NAME: "Development", DATABASE_URL: "postgres://unused:unused@127.0.0.1/never-opened" };
let poolOpened = false;
const forbiddenPool = () => { poolOpened = true; throw new Error("Pool must not open"); };
for (const environment of [
  { ...dev, RAILWAY_PROJECT_NAME: "PrintersHero-MAIN" },
  { ...dev, RAILWAY_PROJECT_NAME: "PrintersHero-DEV " , RAILWAY_ENVIRONMENT_NAME: "production" },
  { ...dev, NODE_ENV: "development" },
  { ...dev, DATABASE_URL: undefined },
  { ...dev, DATABASE_URL: "https://invalid.example" },
]) {
  await assert.rejects(readOnlyDevSnapshot(environment, async () => undefined, forbiddenPool));
  assert.equal(poolOpened, false, "Wrong target must fail before pool creation");
}
for (const args of [[], ["--all-organizations", "--organization-id", "org"], ["--organization-id"], ["--organization-id", "a' OR true--"], ["--delete"], ["--all-organizations", "--force"]]) assert.throws(() => historicalDataScope(args));
assert.equal(historicalDataScope(["--organization-id", "organization-a"]), "organization-a");
assert.equal(historicalDataScope(["--all-organizations"]), null);

function mockPool(readOnly = "on") {
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: sql.startsWith("SELECT current_setting") ? [{ read_only: readOnly, isolation: "repeatable read", snapshot_at: new Date(0) }] : [] };
    },
    release: () => statements.push("release"),
  } as unknown as PoolClient;
  const pool = { connect: async () => client, end: async () => { statements.push("end"); } } as unknown as Pick<Pool, "connect" | "end">;
  return { statements, pool };
}
const success = mockPool();
const result = await readOnlyDevSnapshot(dev, async client => { await client.query("SELECT 1"); return "evidence"; }, () => success.pool);
assert.equal(result.data, "evidence");
assert.equal(success.statements[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
assert.deepEqual(success.statements.slice(-3), ["ROLLBACK", "release", "end"]);
assert(!success.statements.includes("COMMIT"));
assert(success.statements.some(sql => sql.startsWith("SET LOCAL statement_timeout")));
const failed = mockPool();
await assert.rejects(readOnlyDevSnapshot(dev, async () => { throw new Error("Read failed"); }, () => failed.pool), /Read failed/);
assert.deepEqual(failed.statements.slice(-3), ["ROLLBACK", "release", "end"]);
const unsafe = mockPool("off");
let readInvoked = false;
await assert.rejects(readOnlyDevSnapshot(dev, async () => { readInvoked = true; }, () => unsafe.pool), /Read-only snapshot/);
assert.equal(readInvoked, false);
assert.deepEqual(unsafe.statements.slice(-3), ["ROLLBACK", "release", "end"]);

const labelledSynthetic = { customer_has_qa_marker: true, product_has_qa_marker: true, older_than_30_days: true, provenance: "known_rehearsal_organization_id" };
assert.equal(historicalDataDisposition("product_version", { ...labelledSynthetic, status: "DRAFT" }), "REVIEW");
assert.equal(historicalDataDisposition("product_version", { ...labelledSynthetic, status: "DEPRECATED" }), "KEEP AS HISTORY");
assert.equal(historicalDataDisposition("sales_document", labelledSynthetic), "KEEP AS HISTORY");
assert.equal(historicalDataDisposition("artifact", labelledSynthetic), "REVIEW");
assert.equal(historicalDataDisposition("payment", labelledSynthetic), "KEEP AS HISTORY");
for (const state of ["ambiguous", "uncertain", "pending", "failed", "processing", "unknown"]) assert.equal(historicalDataDisposition("queue", { ...labelledSynthetic, state, has_provider_attempt_evidence: true }), "REVIEW");
assert.equal(historicalDataDisposition("queue", { state: "sent" }), "KEEP AS HISTORY");
assert.equal(historicalDataDisposition("prepress", { production_requirement_state: "unconfigured", artwork_assignment_count: 1 }), "ARCHIVE / HIDE FROM ACTIVE WORK");
assert.equal(historicalDataDisposition("prepress", { production_requirement_state: "configured" }), "KEEP AS HISTORY");
console.log("[dev-historical-data-hygiene] DEV guard, explicit scope, read-only rollback, conservative classification and provider uncertainty passed.");
