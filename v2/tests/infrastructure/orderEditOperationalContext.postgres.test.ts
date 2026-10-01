import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { readOrderEditBlockedLines } from "../../infrastructure/sales/postgresOrderEditOperationalContext.js";

// Real PostgreSQL query semantics against the exact columns this read projection
// consumes; full domain migration/constraint validation belongs to acceptance.
const db = new PGlite();
const statements: string[] = [];
const client = { query: async (text: string, values: unknown[]) => {
  statements.push(text);
  const result = await db.query(text, values);
  return { ...result, rowCount: result.rows.length };
} } as unknown as PoolClient;
try {
  await db.exec(`CREATE TABLE v2_sales_document_lines(id text PRIMARY KEY, organization_id text NOT NULL, document_id text NOT NULL);
    INSERT INTO v2_sales_document_lines VALUES ('line-a','org-a','order-a'),('line-b','org-a','order-a'),('foreign','org-b','order-b');`);
  for (const table of ["v2_production_works", "v2_prepress_units", "v2_proof_works", "v2_fulfillment_handoff_lines", "v2_order_replacement_obligations"]) {
    await db.exec(`CREATE TABLE ${table}(organization_id text NOT NULL, order_document_id text NOT NULL, order_line_id text NOT NULL)`);
  }
  assert.deepEqual(await readOrderEditBlockedLines(client, "org-a", "order-a", []), []);
  assert.equal(statements.length, 0, "empty scope must not produce empty IN or an unbounded query");
  assert.deepEqual(await readOrderEditBlockedLines(client, "org-a", "order-a", ["line-b", "line-a"]), []);
  await assert.rejects(readOrderEditBlockedLines(client, "org-a", "order-a", ["foreign"]), { code: "NOT_FOUND" });
  await assert.rejects(readOrderEditBlockedLines(client, "org-a", "order-other", ["line-a"]), { code: "NOT_FOUND" });
  await assert.rejects(readOrderEditBlockedLines(client, "org-b", "order-a", ["line-a"]), { code: "NOT_FOUND" });
  await assert.rejects(readOrderEditBlockedLines(client, "org-a", "order-a", ["line-a", "line-a"]), { code: "VALIDATION_ERROR" });
  const beforeOversized = statements.length;
  await assert.rejects(readOrderEditBlockedLines(client, "org-a", "order-a", Array.from({ length: 501 }, (_, index) => `line-${index}`)), { code: "VALIDATION_ERROR" });
  assert.equal(statements.length, beforeOversized, "oversized scope rejects before any SQL");
  await assert.rejects(readOrderEditBlockedLines(client, "org-a", "order-a", ["line-a", "missing"]), { code: "NOT_FOUND" });
  for (const table of ["v2_production_works", "v2_prepress_units", "v2_proof_works", "v2_fulfillment_handoff_lines", "v2_order_replacement_obligations"]) {
    await db.query(`INSERT INTO ${table} VALUES ($1,$2,$3)`, ["org-b", "order-a", "line-a"]);
    await db.query(`INSERT INTO ${table} VALUES ($1,$2,$3)`, ["org-a", "order-other", "line-a"]);
    assert.deepEqual(await readOrderEditBlockedLines(client, "org-a", "order-a", ["line-a", "line-b"]), [], `${table}: no unrelated scope may block this Order`);
    await db.query(`INSERT INTO ${table} VALUES ($1,$2,$3)`, ["org-a", "order-a", "line-a"]);
    assert.deepEqual(await readOrderEditBlockedLines(client, "org-a", "order-a", ["line-b", "line-a"]), ["line-a"], `${table}: this line's progressed evidence is blocked`);
    await db.exec(`DELETE FROM ${table}`);
  }
  await db.exec("BEGIN");
  await db.query("INSERT INTO v2_production_works VALUES ($1,$2,$3),($1,$2,$4)", ["org-a", "order-a", "line-b", "line-a"]);
  assert.deepEqual(await readOrderEditBlockedLines(client, "org-a", "order-a", ["line-b", "line-a"]), ["line-a", "line-b"], "caller-uncommitted evidence is read in stable source identity order");
  await db.exec("ROLLBACK");
  assert.deepEqual(await readOrderEditBlockedLines(client, "org-a", "order-a", ["line-a", "line-b"]), [], "the reader neither commits nor owns the caller's rollback");
  assert.ok(statements.every(text => /^SELECT\b/.test(text)), "the adapter never mutates owner state");
  assert.deepEqual((await db.query("SELECT * FROM v2_sales_document_lines ORDER BY id")).rows, [
    { id: "foreign", organization_id: "org-b", document_id: "order-b" },
    { id: "line-a", organization_id: "org-a", document_id: "order-a" },
    { id: "line-b", organization_id: "org-a", document_id: "order-a" },
  ]);
  console.log("Order edit operational read context: PostgreSQL scope, no-write and all five evidence sources PASS");
} finally { await db.close(); }
