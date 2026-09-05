import assert from "node:assert/strict";
import type { Pool } from "pg";

// The retained provider module constructs a pool at import time. This fixture
// uses a closed local endpoint and supplies every query through its fake pool.
process.env.DATABASE_URL = "postgresql://hygiene:hygiene@127.0.0.1:1/hygiene";
const { PostgresQuickBooksSyncNow } = await import("../../infrastructure/accounting/quickBooksBillingQueue.js");

type Call = Readonly<{ sql: string; values: readonly unknown[] }>;
const fixture = (rows: (call: Call) => readonly unknown[]) => {
  const calls: Call[] = [];
  let released = false;
  const client = {
    query: async (sql: string, values: readonly unknown[] = []) => {
      const call = { sql, values };
      calls.push(call);
      return { rows: rows(call) };
    },
    release: () => { released = true; },
  };
  return { service: new PostgresQuickBooksSyncNow({ connect: async () => client } as unknown as Pool), calls, released: () => released };
};

// Accounting's one generic retry path preserves tenant, subject, and attempt
// identity for every supported financial subject, including Payments.
for (const kind of ["invoice", "payment", "refund"] as const) {
  const f = fixture(({ sql }) => sql.startsWith("SELECT i.id") || sql.startsWith("SELECT p.id") || sql.startsWith("SELECT r.id")
    ? [{ id: "subject-a" }]
    : sql.startsWith("UPDATE v2_quickbooks_sync_jobs") ? [{ attempt_count: 3 }] : []);
  assert.deepEqual(await f.service.retry("tenant-a", kind, "subject-a"), { state: "queued", attemptCount: 3 });
  const update = f.calls.find(({ sql }) => sql.startsWith("UPDATE v2_quickbooks_sync_jobs"))!;
  assert.deepEqual(update.values, ["tenant-a", kind, "subject-a"]);
  assert.match(update.sql, /state IN \('blocked','retry'\)/u);
  assert.match(f.calls[1]!.sql, /organization_id=\$1/u);
  if (kind === "invoice") assert.match(f.calls[1]!.sql, /v2_quickbooks_invoice_approvals/u);
  assert.equal(f.calls.at(-1)?.sql, "COMMIT");
  assert.equal(f.released(), true);
}

// Provider uncertainty and completed/in-flight jobs cannot acquire an
// automatic retry; each rejected attempt releases its transaction.
for (const [state, message] of [["uncertain", /provider reconciliation/u], ["succeeded", /already synchronized/u], ["processing", /currently being processed/u], ["queued", /not eligible/u]] as const) {
  const f = fixture(({ sql }) => sql.startsWith("SELECT p.id") ? [{ id: "payment-a" }]
    : sql.startsWith("SELECT state") ? [{ state }] : []);
  await assert.rejects(f.service.retry("tenant-a", "payment", "payment-a"), message);
  assert.equal(f.calls.at(-1)?.sql, "ROLLBACK");
  assert.equal(f.released(), true);
  assert.equal(f.calls.some(({ sql }) => sql.startsWith("INSERT")), false);
}
const missing = fixture(() => []);
await assert.rejects(missing.service.retry("tenant-a", "payment", "other-tenant-payment"), /unavailable/u);
assert.equal(missing.calls.some(({ sql }) => sql.startsWith("UPDATE")), false);

// Bulk admission is the same path for one Invoice and many; IDs are bounded,
// deduplicated, and approval-gated before the existing queue identity is used.
for (const supplied of [[" invoice-a ", "invoice-a"], ["invoice-a", "invoice-b"]]) {
  const expected = [...new Set(supplied.map((id) => id.trim()))];
  const f = fixture(({ sql }) => sql.startsWith("SELECT i.id") ? expected.map((id) => ({ id })) : []);
  assert.deepEqual(await f.service.enqueueInvoices("tenant-a", supplied), expected);
  const eligibility = f.calls.find(({ sql }) => sql.startsWith("SELECT i.id"))!;
  assert.match(eligibility.sql, /v2_quickbooks_invoice_approvals/u);
  assert.deepEqual(eligibility.values, ["tenant-a", expected]);
  const admissions = f.calls.filter(({ sql }) => sql.includes("INSERT INTO v2_quickbooks_sync_jobs"));
  assert.equal(admissions.length, expected.length);
  assert.equal(f.calls.at(-1)?.sql, "COMMIT");
  assert.equal(f.released(), true);
}
const unapproved = fixture(() => []);
await assert.rejects(unapproved.service.enqueueInvoices("tenant-a", ["invoice-a"]), /Approve the current V2 Invoice version/u);
assert.equal(unapproved.calls.some(({ sql }) => sql.includes("INSERT INTO v2_quickbooks_sync_jobs")), false);
assert.equal(unapproved.calls.at(-1)?.sql, "ROLLBACK");
for (const ids of [[], Array.from({ length: 101 }, (_, i) => String(i))]) {
  const f = fixture(() => []);
  await assert.rejects(f.service.enqueueInvoices("tenant-a", ids), /between 1 and 100/u);
  assert.equal(f.calls.length, 0);
}
console.log("QuickBooks canonical queue admission and recovery tests passed (no provider or database calls).");
