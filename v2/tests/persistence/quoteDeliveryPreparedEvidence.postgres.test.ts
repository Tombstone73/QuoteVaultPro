import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { assertPreparedQuoteDeliverySchema, checkV2CommercialPhysicalPostconditions } from "../../infrastructure/sales/commercialPhysicalPostconditions.js";

const db = new PGlite();
let assertions = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); assertions += 1; };
const sql = (file: string) => readFileSync(path.resolve("server/db/migrations_v2", file), "utf8");
const digest = `sha256:${"a".repeat(64)}`;
const evidence = {
  schemaVersion: 1, organizationId: "org-a", quoteId: "quote-a", expectedRevision: "2",
  customerContact: { organizationId: "org-a", contactId: "contact-a" },
  commercial: { currency: "USD", terms: {}, lines: [] },
  customerPresentation: { customerDisplayName: "Prepared Customer" },
  organizationPresentation: { name: "Prepared Shop" }, recipientEmail: "prepared@example.invalid",
  documentSha256: digest, documentNumber: "QT-1", documentDate: "2026-10-02",
};
const insert = async (id: string, value: unknown) => {
  await db.query("INSERT INTO v2_operation_requests(id,organization_id) VALUES($1,'org-a')", [id]);
  return db.query(`INSERT INTO v2_sales_quote_delivery_attempts
    (id,organization_id,quote_document_id,operation_request_id,recipient_email,document_sha256,initiated_principal_kind,initiated_principal_subject,prepared_evidence_json)
    VALUES($1,'org-a','quote-a',$1,'prepared@example.invalid',$2,'staff','staff-a',$3::jsonb)`, [id, digest, value === null ? null : JSON.stringify(value)]);
};
const rejectsConstraint = async (action: () => Promise<unknown>, message: string) => {
  await assert.rejects(action, (error: unknown) => (error as { code?: string }).code === "23514", message);
  assertions += 1;
};
try {
  // Apply both real migration files over a minimal referenced-key fixture.
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE v2_sales_quote_details(document_id varchar,organization_id varchar,PRIMARY KEY(document_id,organization_id));
    CREATE TABLE v2_sales_quote_checkpoints(id varchar,organization_id varchar,quote_document_id varchar,PRIMARY KEY(id,organization_id,quote_document_id));
    CREATE TABLE v2_operation_requests(id varchar,organization_id varchar,PRIMARY KEY(id,organization_id));
    INSERT INTO organizations VALUES('org-a');
    INSERT INTO v2_sales_quote_details VALUES('quote-a','org-a');
    INSERT INTO v2_operation_requests VALUES('historical','org-a');`);
  await db.exec(sql("0229_v2_sales_customer_delivery_evidence.sql"));
  await db.query(`INSERT INTO v2_sales_quote_delivery_attempts
    (id,organization_id,quote_document_id,operation_request_id,recipient_email,document_sha256,initiated_principal_kind,initiated_principal_subject)
    VALUES('historical','org-a','quote-a','historical','prepared@example.invalid',$1,'staff','staff-a')`, [digest]);
  const before = await db.query("SELECT id,recipient_email,document_sha256,attempted_at FROM v2_sales_quote_delivery_attempts WHERE id='historical'");
  const client = { query: async (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) };
  await assert.rejects(() => assertPreparedQuoteDeliverySchema(client), /schema is unavailable/); assertions += 1;
  await db.exec(sql("0299_v2_sales_quote_delivery_prepared_evidence.sql"));
  const after = await db.query("SELECT id,recipient_email,document_sha256,attempted_at FROM v2_sales_quote_delivery_attempts WHERE id='historical'");
  assert.deepEqual(after.rows, before.rows); assertions += 1;
  check((await db.query<{ prepared_evidence_json: unknown }>("SELECT prepared_evidence_json FROM v2_sales_quote_delivery_attempts WHERE id='historical'")).rows[0]?.prepared_evidence_json === null, "historical evidence is not invented");
  await rejectsConstraint(() => insert("null-evidence", null), "new attempts require prepared evidence");
  for (const [name, value] of Object.entries({
    empty: {}, primitive: "bad", version: { ...evidence, schemaVersion: 2 },
    organization: { ...evidence, organizationId: "org-b" }, quote: { ...evidence, quoteId: "quote-b" },
    recipient: { ...evidence, recipientEmail: "other@example.invalid" }, hash: { ...evidence, documentSha256: `sha256:${"b".repeat(64)}` },
    contactScope: { ...evidence, customerContact: { organizationId: "org-b", contactId: "contact-a" } },
    missingContact: { ...evidence, customerContact: { organizationId: "org-a" } },
    blankContact: { ...evidence, customerContact: { organizationId: "org-a", contactId: " " } },
    missingHash: { ...evidence, documentSha256: undefined }, number: { ...evidence, documentNumber: " " },
    date: { ...evidence, documentDate: "invalid" }, lines: { ...evidence, commercial: { currency: "USD", terms: {}, lines: {} } },
  })) await rejectsConstraint(() => insert(`bad-${name}`, value), `reject malformed or mismatched ${name}`);
  await insert("valid", evidence);
  const stored = await db.query<{ prepared_evidence_json: unknown }>("SELECT prepared_evidence_json FROM v2_sales_quote_delivery_attempts WHERE id='valid'");
  assert.deepEqual(stored.rows[0]?.prepared_evidence_json, evidence); assertions += 1;
  await db.exec("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='uncertain',completed_at=now(),failure_message='provider response unknown',provider_message_id='provider-1' WHERE id='valid'");
  assert.deepEqual((await db.query<{ prepared_evidence_json: unknown }>("SELECT prepared_evidence_json FROM v2_sales_quote_delivery_attempts WHERE id='valid'")).rows[0]?.prepared_evidence_json, evidence); assertions += 1;
  await rejectsConstraint(() => db.query("UPDATE v2_sales_quote_delivery_attempts SET prepared_evidence_json=$1::jsonb WHERE id='valid'", [JSON.stringify({ ...evidence, documentNumber: "QT-changed" })]), "prepared snapshots cannot change");
  await rejectsConstraint(() => db.exec("UPDATE v2_sales_quote_delivery_attempts SET prepared_evidence_json=NULL WHERE id='valid'"), "prepared snapshots cannot be removed");
  await rejectsConstraint(() => db.query("UPDATE v2_sales_quote_delivery_attempts SET prepared_evidence_json=$1::jsonb WHERE id='historical'", [JSON.stringify(evidence)]), "historical evidence cannot be backfilled");
  await rejectsConstraint(() => db.exec("UPDATE v2_sales_quote_delivery_attempts SET recipient_email='changed@example.invalid' WHERE id='valid'"), "attempt columns must retain snapshot correspondence");
  await db.exec("BEGIN"); await insert("rolled-back", evidence); await db.exec("ROLLBACK");
  check(!(await db.query("SELECT 1 FROM v2_sales_quote_delivery_attempts WHERE id='rolled-back'")).rows.length, "rollback leaves no attempt");
  await assertPreparedQuoteDeliverySchema(client); assertions += 1;
  const findings = await checkV2CommercialPhysicalPostconditions(client);
  const ids = ["column:v2_sales_quote_delivery_attempts.prepared_evidence_json", "validated:quote-delivery-prepared-evidence", "trigger:v2_sales_quote_delivery_prepared_evidence_immutable"];
  check(ids.every(id => findings.some(finding => finding.id === id && finding.passed)), "new physical postconditions pass against real catalogs");
  await db.exec("ALTER TABLE v2_sales_quote_delivery_attempts DISABLE TRIGGER v2_sales_quote_delivery_prepared_evidence_immutable");
  check((await checkV2CommercialPhysicalPostconditions(client)).some(finding => finding.id === ids[2] && !finding.passed), "disabled evidence trigger fails physical readiness");
  await assert.rejects(() => assertPreparedQuoteDeliverySchema(client), /schema is unavailable/); assertions += 1;
  console.log(`Prepared Quote evidence migration: ${assertions} assertions passed; actual 0229/0299 SQL, in-memory PostgreSQL only.`);
} finally { await db.close(); }
