import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { assertQuickBooksRecoveryPhysicalPostconditions } from "../../infrastructure/accounting/quickBooksRecoveryPhysicalPostconditions.js";

const db = new PGlite();
let assertions = 0;
const client = { query: async (sql: string, values?: readonly unknown[]) => db.query(sql, values ? [...values] : undefined) };
const migration = (name: string) => readFileSync(path.resolve("server/db/migrations_v2", name), "utf8");
const context = {
  schemaVersion: 1, organizationId: "org-a", jobId: "job-new", paymentId: "payment-new",
  realmId: "1234", environment: "sandbox", reference: "PMT-2", customerId: "100",
  amountCents: 300, currency: "USD", allocations: [{ invoiceId: "10", amountCents: 100 }, { invoiceId: "20", amountCents: 200 }],
};
const check = (value: unknown, reason: string) => { assert.ok(value, reason); assertions += 1; };
const rejected = async (value: unknown, reason: string) => {
  await assert.rejects(() => db.query(`INSERT INTO v2_quickbooks_payment_references
    (organization_id,payment_id,sequence_number,payment_ref_num,recovery_context)
    VALUES('org-a','payment-new',2,'PMT-2',$1::jsonb)`, [value === null ? null : JSON.stringify(value)]),
  (error: unknown) => (error as { code?: string }).code === "23514", reason);
  assertions += 1;
};
try {
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE v2_billing_payments(id varchar,organization_id varchar,PRIMARY KEY(id,organization_id));
    INSERT INTO organizations VALUES('org-a'),('org-b');
    INSERT INTO v2_billing_payments VALUES('historical','org-a'),('payment-new','org-a'),('rollback','org-a');`);
  await db.exec(migration("0248_v2_quickbooks_billing_queue.sql"));
  await db.exec(migration("0263_v2_quickbooks_payment_reference_sequence.sql"));
  await db.exec(`INSERT INTO v2_quickbooks_payment_references VALUES('org-a','historical',1,'PMT-1',now());
    INSERT INTO v2_quickbooks_sync_jobs(id,organization_id,subject_kind,subject_id,state)
    VALUES('job-new','org-a','payment','payment-new','processing'),('job-wrong','org-b','payment','payment-new','processing'),('job-rollback','org-a','payment','rollback','processing');`);
  const before = await db.query("SELECT organization_id,payment_id,sequence_number,payment_ref_num,created_at FROM v2_quickbooks_payment_references");
  await assert.rejects(() => assertQuickBooksRecoveryPhysicalPostconditions(client), /schema is unavailable/); assertions += 1;
  await db.exec(migration("0300_v2_quickbooks_payment_recovery_context.sql"));
  const definition = (await db.query<{ definition: string }>("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conname='v2_quickbooks_provider_requests_shape_chk'")).rows[0]!.definition;
  await db.exec("BEGIN");
  try {
    await db.exec(`ALTER TABLE v2_quickbooks_provider_requests DROP CONSTRAINT v2_quickbooks_provider_requests_shape_chk;
      ALTER TABLE v2_quickbooks_provider_requests ADD CONSTRAINT v2_quickbooks_provider_requests_shape_chk ${definition.replace("'customer'", "'customer '")}`);
    await assert.rejects(() => assertQuickBooksRecoveryPhysicalPostconditions(client), /schema is unavailable/); assertions += 1;
  } finally { await db.exec("ROLLBACK"); }
  await assertQuickBooksRecoveryPhysicalPostconditions(client); assertions += 1;
  assert.deepEqual((await db.query("SELECT organization_id,payment_id,sequence_number,payment_ref_num,created_at FROM v2_quickbooks_payment_references")).rows, before.rows); assertions += 1;
  check((await db.query<{ recovery_context: unknown }>("SELECT recovery_context FROM v2_quickbooks_payment_references WHERE payment_id='historical'")).rows[0]?.recovery_context === null, "historical evidence remains absent, not invented");
  await assertQuickBooksRecoveryPhysicalPostconditions(client); assertions += 1;
  for (const [reason, value] of Object.entries({
    null: null, empty: {}, primitive: "bad", version: { ...context, schemaVersion: 2 },
    tenant: { ...context, organizationId: "org-b" }, payment: { ...context, paymentId: "foreign" },
    reference: { ...context, reference: "PMT-9" }, missingJob: { ...context, jobId: "absent" },
    foreignJob: { ...context, jobId: "job-wrong" }, missingRealm: { ...context, realmId: undefined },
    nullRealm: { ...context, realmId: null }, environment: { ...context, environment: "unknown" },
    currency: { ...context, currency: "usd" }, missingCustomer: { ...context, customerId: "" },
    amountType: { ...context, amountCents: "300" }, negative: { ...context, amountCents: -300 },
    fractional: { ...context, amountCents: 300.5 }, unsafe: { ...context, amountCents: 9007199254740992 },
    unknownField: { ...context, token: "not-allowed" }, emptyAllocations: { ...context, allocations: [] },
    allocationType: { ...context, allocations: {} }, incomplete: { ...context, allocations: [{ invoiceId: "10" }] },
    zero: { ...context, allocations: [{ invoiceId: "10", amountCents: 0 }] },
    wrongSum: { ...context, allocations: [{ invoiceId: "10", amountCents: 100 }] },
    duplicate: { ...context, allocations: [{ invoiceId: "10", amountCents: 100 }, { invoiceId: "10", amountCents: 200 }] },
  })) await rejected(value, reason);
  await db.query(`INSERT INTO v2_quickbooks_payment_references
    (organization_id,payment_id,sequence_number,payment_ref_num,recovery_context)
    VALUES('org-a','payment-new',2,'PMT-2',$1::jsonb)`, [JSON.stringify(context)]);
  assert.deepEqual((await db.query<{ recovery_context: unknown }>("SELECT recovery_context FROM v2_quickbooks_payment_references WHERE payment_id='payment-new'")).rows[0]?.recovery_context, context); assertions += 1;
  check((await db.query<{ provider_attempt_started_at: unknown }>("SELECT provider_attempt_started_at FROM v2_quickbooks_payment_references WHERE payment_id='payment-new'")).rows[0]?.provider_attempt_started_at === null, "new references start without a provider-attempt marker");
  await db.exec("UPDATE v2_quickbooks_payment_references SET provider_attempt_started_at=now() WHERE payment_id='payment-new'");
  check((await db.query<{ provider_attempt_started_at: unknown }>("SELECT provider_attempt_started_at FROM v2_quickbooks_payment_references WHERE payment_id='payment-new'")).rows[0]?.provider_attempt_started_at !== null, "valid original context permits recording that invocation may have begun");
  await assert.rejects(() => db.exec("UPDATE v2_quickbooks_payment_references SET provider_attempt_started_at=now() WHERE payment_id='historical'"), (error: unknown) => (error as { code?: string }).code === "23514"); assertions += 1;
  for (const statement of ["SET provider_attempt_started_at=NULL", "SET provider_attempt_started_at=provider_attempt_started_at+interval '1 second'"]) {
    await assert.rejects(() => db.exec(`UPDATE v2_quickbooks_payment_references ${statement} WHERE payment_id='payment-new'`), (error: unknown) => (error as { code?: string }).code === "23514"); assertions += 1;
  }
  for (const sql of [
    "UPDATE v2_quickbooks_payment_references SET recovery_context=NULL WHERE payment_id='payment-new'",
    "UPDATE v2_quickbooks_payment_references SET recovery_context='{}'::jsonb WHERE payment_id='payment-new'",
    "DELETE FROM v2_quickbooks_payment_references WHERE payment_id='payment-new'",
    "DELETE FROM v2_quickbooks_payment_references WHERE payment_id='historical'",
  ]) { await assert.rejects(() => db.exec(sql), (error: unknown) => (error as { code?: string }).code === "23514"); assertions += 1; }
  await assert.rejects(() => db.query("UPDATE v2_quickbooks_payment_references SET recovery_context=$1::jsonb WHERE payment_id='historical'", [JSON.stringify(context)]), (error: unknown) => (error as { code?: string }).code === "23514"); assertions += 1;
  await db.exec("BEGIN");
  await db.query(`INSERT INTO v2_quickbooks_payment_references
    (organization_id,payment_id,sequence_number,payment_ref_num,recovery_context) VALUES('org-a','rollback',3,'PMT-3',$1::jsonb)`,
  [JSON.stringify({ ...context, jobId: "job-rollback", paymentId: "rollback", reference: "PMT-3" })]);
  await db.exec("ROLLBACK");
  check(!(await db.query("SELECT 1 FROM v2_quickbooks_payment_references WHERE payment_id='rollback'")).rows.length, "rollback leaves no prepared request context");
  const intent = { connection: { organizationId: "org-a", realmId: "1234", environment: "sandbox" },
    entityKind: "customer", entityId: "customer-a", requestId: "publication-a", payload: { DisplayName: "Fixture", Notes: "original correlation" } };
  const insertRequest = (value: unknown = intent, extra = "", values: readonly unknown[] = []) => db.query(`INSERT INTO v2_quickbooks_provider_requests
    (request_id,organization_id,entity_kind,entity_id,realm_id,environment,intent_json${extra ? "," + extra.split("=")[0] : ""})
    VALUES('publication-a','org-a','customer','customer-a','1234','sandbox',$1::jsonb${extra ? "," + extra.slice(extra.indexOf("=") + 1) : ""})`,
  [JSON.stringify(value), ...values]);
  for (const value of [null, {}, [], "invalid", { ...intent, requestId: "other" }, { ...intent, entityKind: "invoice" },
    { ...intent, entityId: "other" }, { ...intent, payload: null }, { ...intent, payload: [] },
    { ...intent, connection: { ...intent.connection, organizationId: "org-b" } },
    { ...intent, connection: { ...intent.connection, realmId: "9999" } },
    { ...intent, connection: { ...intent.connection, environment: "production" } },
    { ...intent, connection: { ...intent.connection, accessToken: "not-allowed" } }, { ...intent, unknown: true }]) {
    await assert.rejects(() => insertRequest(value), (error: unknown) => (error as { code?: string }).code === "23514"); assertions += 1;
  }
  for (const extra of ["provider_attempt_started_at=now()", "confirmed_provider_id='100'", "confirmed_at=now()", "created_at='infinity'"]) {
    await assert.rejects(() => insertRequest(intent, extra), (error: unknown) => (error as { code?: string }).code === "23514"); assertions += 1;
  }
  await insertRequest();
  const originalRequest = (await db.query("SELECT * FROM v2_quickbooks_provider_requests WHERE request_id='publication-a'")).rows[0];
  check(originalRequest?.provider_attempt_started_at === null && originalRequest?.confirmed_provider_id === null && originalRequest?.confirmed_at === null, "new requests have no fabricated provider evidence");
  const rejectRequestUpdate = async (assignment: string) => {
    await assert.rejects(() => db.exec(`UPDATE v2_quickbooks_provider_requests SET ${assignment} WHERE request_id='publication-a'`),
      (error: unknown) => (error as { code?: string }).code === "23514"); assertions += 1;
  };
  for (const assignment of ["request_id='other'", "organization_id='org-b'", "entity_kind='invoice'", "entity_id='other'",
    "realm_id='9999'", "environment='production'", "intent_json='{}'::jsonb", "created_at=created_at+interval '1 second'",
    "confirmed_provider_id='100',confirmed_at=now()", "provider_attempt_started_at=now(),confirmed_provider_id='100',confirmed_at=now()",
    "provider_attempt_started_at='infinity'"]) await rejectRequestUpdate(assignment);
  assert.deepEqual((await db.query("SELECT * FROM v2_quickbooks_provider_requests WHERE request_id='publication-a'")).rows[0], originalRequest); assertions += 1;
  await db.exec("BEGIN; UPDATE v2_quickbooks_provider_requests SET provider_attempt_started_at=now() WHERE request_id='publication-a'; ROLLBACK");
  check((await db.query("SELECT provider_attempt_started_at FROM v2_quickbooks_provider_requests WHERE request_id='publication-a'")).rows[0]?.provider_attempt_started_at === null, "rolled-back attempts grant no provider invocation evidence");
  await db.exec("UPDATE v2_quickbooks_provider_requests SET provider_attempt_started_at=now() WHERE request_id='publication-a'");
  for (const assignment of ["provider_attempt_started_at=NULL", "provider_attempt_started_at=provider_attempt_started_at+interval '1 second'",
    "confirmed_provider_id='invalid',confirmed_at=now()", "confirmed_provider_id='100'", "confirmed_at=now()",
    "confirmed_provider_id='100',confirmed_at='infinity'", "confirmed_provider_id='100',confirmed_at=provider_attempt_started_at-interval '1 second'"]) await rejectRequestUpdate(assignment);
  await db.exec("BEGIN; UPDATE v2_quickbooks_provider_requests SET confirmed_provider_id='100',confirmed_at=now() WHERE request_id='publication-a'; ROLLBACK");
  check((await db.query("SELECT confirmed_provider_id FROM v2_quickbooks_provider_requests WHERE request_id='publication-a'")).rows[0]?.confirmed_provider_id === null, "confirmation rolls back independently without erasing the attempt");
  await db.exec("UPDATE v2_quickbooks_provider_requests SET confirmed_provider_id='100',confirmed_at=now() WHERE request_id='publication-a'");
  const confirmedRequest = (await db.query("SELECT * FROM v2_quickbooks_provider_requests WHERE request_id='publication-a'")).rows[0];
  for (const assignment of ["confirmed_provider_id=NULL,confirmed_at=NULL", "confirmed_provider_id='101'", "confirmed_at=confirmed_at+interval '1 second'"]) await rejectRequestUpdate(assignment);
  await db.exec("UPDATE v2_quickbooks_provider_requests SET confirmed_provider_id='100',confirmed_at=confirmed_at WHERE request_id='publication-a'");
  assert.deepEqual((await db.query("SELECT * FROM v2_quickbooks_provider_requests WHERE request_id='publication-a'")).rows[0], confirmedRequest); assertions += 1;
  await assert.rejects(() => db.exec("DELETE FROM v2_quickbooks_provider_requests WHERE request_id='publication-a'"), (error: unknown) => (error as { code?: string }).code === "23514"); assertions += 1;
  await assert.rejects(() => insertRequest(), (error: unknown) => (error as { code?: string }).code === "23505"); assertions += 1;
  const foreignIntent = { ...intent, requestId: "foreign-request", connection: { ...intent.connection, organizationId: "absent" } };
  await assert.rejects(() => db.query(`INSERT INTO v2_quickbooks_provider_requests
    (request_id,organization_id,entity_kind,entity_id,realm_id,environment,intent_json)
    VALUES('foreign-request','absent','customer','customer-a','1234','sandbox',$1::jsonb)`, [JSON.stringify(foreignIntent)]),
  (error: unknown) => (error as { code?: string }).code === "23503"); assertions += 1;
  await assertQuickBooksRecoveryPhysicalPostconditions(client); assertions += 1;
  for (const corruptSchema of [
    "DROP TRIGGER v2_quickbooks_provider_requests_immutable ON v2_quickbooks_provider_requests; CREATE TRIGGER v2_quickbooks_provider_requests_immutable BEFORE UPDATE ON v2_quickbooks_provider_requests FOR EACH ROW EXECUTE FUNCTION v2_quickbooks_provider_request_guard()",
    "ALTER TABLE v2_quickbooks_provider_requests DROP CONSTRAINT v2_quickbooks_provider_requests_shape_chk; ALTER TABLE v2_quickbooks_provider_requests ADD CONSTRAINT v2_quickbooks_provider_requests_shape_chk CHECK (true)",
    "ALTER TABLE v2_quickbooks_provider_requests ALTER COLUMN request_id TYPE varchar(100)",
    "ALTER TABLE v2_quickbooks_provider_requests ALTER COLUMN created_at DROP DEFAULT",
    "DROP INDEX v2_quickbooks_provider_requests_entity_idx",
    "DROP INDEX v2_quickbooks_provider_requests_entity_idx; CREATE INDEX v2_quickbooks_provider_requests_entity_idx ON v2_quickbooks_provider_requests (entity_id,organization_id)",
    "DROP INDEX v2_quickbooks_provider_requests_entity_idx; CREATE INDEX v2_quickbooks_provider_requests_entity_idx ON v2_quickbooks_provider_requests (organization_id,entity_kind,entity_id,realm_id,environment) INCLUDE (created_at)",
  ]) {
    await db.exec("BEGIN");
    try {
      await db.exec(corruptSchema);
      await assert.rejects(() => assertQuickBooksRecoveryPhysicalPostconditions(client), /schema is unavailable/); assertions += 1;
    } finally { await db.exec("ROLLBACK"); }
    await assertQuickBooksRecoveryPhysicalPostconditions(client); assertions += 1;
  }
  await db.exec("ALTER TABLE v2_quickbooks_provider_requests DISABLE TRIGGER v2_quickbooks_provider_requests_immutable");
  await assert.rejects(() => assertQuickBooksRecoveryPhysicalPostconditions(client), /schema is unavailable/); assertions += 1;
  await db.exec("ALTER TABLE v2_quickbooks_provider_requests ENABLE TRIGGER v2_quickbooks_provider_requests_immutable");
  await db.exec("ALTER TABLE v2_quickbooks_payment_references DISABLE TRIGGER v2_quickbooks_payment_recovery_context_immutable");
  await assert.rejects(() => assertQuickBooksRecoveryPhysicalPostconditions(client), /schema is unavailable/); assertions += 1;
  console.log(`QuickBooks recovery context: ${assertions} assertions passed; actual 0248/0263/0300 SQL in isolated PGlite.`);
} finally { await db.close(); }
