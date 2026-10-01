import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { assessOrderEditBillingInTransaction } from "../../infrastructure/billing/postgresOrderEditSafety.js";
import type { TransactionalClient } from "../../infrastructure/persistence/types.js";
import type { OrderEditBillingSafetyRequest } from "../../src/modules/billing/orderEditSafety.js";

const org = "30000000-0000-4000-8000-000000000001";
const foreignOrg = "30000000-0000-4000-8000-000000000002";
const database = new PGlite();
const statements: { sql: string; params: unknown[]; ids: unknown[] }[] = [];
const client = { async query(sql: string, params: unknown[] = []) {
  const result = await database.query<Record<string, unknown>>(sql, params);
  statements.push({ sql, params: [...params], ids: result.rows.map(row => row.id).filter(id => id !== undefined) });
  return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
} } as unknown as TransactionalClient;
const migration = (name: string) => readFileSync(resolve(process.cwd(), "server/db/migrations_v2", name), "utf8");

async function setup() {
  // Only foreign-owner FK targets are minimal shapes. Every Billing table,
  // constraint, index and history trigger below comes from existing real DDL.
  await database.exec(`
    CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE customer_contacts(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_kind varchar NOT NULL,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_order_details(document_id varchar PRIMARY KEY,organization_id varchar NOT NULL,UNIQUE(document_id,organization_id));
    CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar,document_id varchar,UNIQUE(id,organization_id,document_id));
    CREATE TABLE v2_order_replacement_obligations(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_order_replacement_obligation_events(event_kind varchar,
      CONSTRAINT v2_replacement_obligation_events_kind_chk CHECK(event_kind IN ('created')));
    CREATE TABLE v2_fulfillment_shipments(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_fulfillment_shipment_shipping_allocations(id varchar PRIMARY KEY,organization_id varchar);
  `);
  const foundation = migration("0195_v2_order_draft_invoice_vertical_slice.sql");
  const start = foundation.indexOf("CREATE TABLE v2_billing_invoices (");
  const end = foundation.indexOf("-- Override authority");
  assert.ok(start >= 0 && end > start, "execute the original Billing foundation, not copied fixture DDL");
  await database.exec(foundation.slice(start, end));
  for (const name of ["0206_v2_invoice_lifecycle_foundation.sql", "0247_v2_job_derived_invoice_numbering.sql",
    "0260_v2_live_order_invoice_revisions.sql", "0285_v2_billable_replacement_invoices.sql",
    "0287_v2_shipment_shipping_invoice_projection.sql", "0289_v2_billing_invoice_revision_history_immutability.sql"]) {
    await database.exec(migration(name));
  }
  await database.query("INSERT INTO organizations(id) VALUES($1),($2)", [org, foreignOrg]);
}

async function seedOrder(organizationId = org, documentKind = "order") {
  const orderId = randomUUID();
  await database.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind) VALUES($1,$2,$3)", [orderId, organizationId, documentKind]);
  if (documentKind === "order") await database.query("INSERT INTO v2_sales_order_details(document_id,organization_id) VALUES($1,$2)", [orderId, organizationId]);
  return orderId;
}

async function seedInvoice(orderId: string, options: Readonly<{
  organizationId?: string; id?: string; state?: "draft" | "issued" | "void"; replacement?: boolean; sequence?: number;
}> = {}) {
  const organizationId = options.organizationId ?? org, invoiceId = options.id ?? randomUUID(), state = options.state ?? "draft";
  const replacementId = options.replacement ? randomUUID() : null;
  if (replacementId) await database.query("INSERT INTO v2_order_replacement_obligations(id,organization_id) VALUES($1,$2)", [replacementId, organizationId]);
  const sequence = options.sequence ?? (state === "draft" && !replacementId ? null : replacementId ? 2 : 1);
  await database.query(`INSERT INTO v2_billing_invoices(id,organization_id,sales_order_document_id,invoice_state,currency,
    source_sales_state_token,synchronization_version,subtotal_cents,total_cents,tax_calculator_version,
    replacement_obligation_id,invoice_sequence,invoice_display_number,issued_at,voided_at,issued_principal_kind,issued_principal_subject)
    VALUES($1,$2,$3,$4::varchar,'USD','1',7,10000,10000,'synthetic-frozen-evidence',$5,$6,$7,
      CASE WHEN $4::varchar='issued' THEN now() ELSE NULL END,CASE WHEN $4::varchar='void' THEN now() ELSE NULL END,
      CASE WHEN $4::varchar='issued' THEN 'staff' ELSE NULL END,CASE WHEN $4::varchar='issued' THEN 'synthetic-owner' ELSE NULL END)`,
  [invoiceId, organizationId, orderId, state, replacementId, sequence, sequence === null ? null : `INV-${invoiceId}`]);
  if (state === "issued") await database.query(`INSERT INTO v2_billing_invoice_checkpoints(id,organization_id,invoice_id,schema_version,evidence_fingerprint,checkpoint_json)
    VALUES($1,$2,$3,1,'synthetic-issued-evidence',$4::jsonb)`,
  [randomUUID(), organizationId, invoiceId, JSON.stringify({ invoiceId, totalCents: 10000 })]);
  return invoiceId;
}

async function seedCharge(orderId: string, invoiceId: string, cents = 101, tax = 5, organizationId = org) {
  const shipmentId = randomUUID(), allocationId = randomUUID(), chargeId = randomUUID();
  await database.query("INSERT INTO v2_fulfillment_shipments(id,organization_id) VALUES($1,$2)", [shipmentId, organizationId]);
  await database.query("INSERT INTO v2_fulfillment_shipment_shipping_allocations(id,organization_id) VALUES($1,$2)", [allocationId, organizationId]);
  await database.query(`INSERT INTO v2_billing_invoice_additional_charges(id,organization_id,invoice_id,sales_order_document_id,
    charge_kind,source_shipment_id,shipment_shipping_allocation_id,customer_charge_cents,tax_cents,tax_evidence,created_principal_kind,created_principal_subject)
    VALUES($1,$2,$3,$4,'shipping',$5,$6,$7,$8,'{}','staff','synthetic-owner')`,
  [chargeId, organizationId, invoiceId, orderId, shipmentId, allocationId, cents, tax]);
  await database.query(`INSERT INTO v2_billing_invoice_revisions(id,organization_id,invoice_id,revision_number,revision_kind,detail,created_principal_kind,created_principal_subject)
    VALUES($1,$2,$3,1,'additional_charge',$4::jsonb,'staff','synthetic-owner')`,
  [randomUUID(), organizationId, invoiceId, JSON.stringify({ chargeId })]);
}

async function history(orderId: string, organizationId = org) {
  return (await database.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM v2_billing_invoices i WHERE i.organization_id=$1 AND i.sales_order_document_id=$2) invoices,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM v2_billing_invoice_additional_charges c WHERE c.organization_id=$1 AND c.sales_order_document_id=$2) charges,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM v2_billing_invoice_checkpoints c JOIN v2_billing_invoices i ON i.id=c.invoice_id AND i.organization_id=c.organization_id WHERE i.organization_id=$1 AND i.sales_order_document_id=$2) checkpoints,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM v2_billing_invoice_revisions r JOIN v2_billing_invoices i ON i.id=r.invoice_id AND i.organization_id=r.organization_id WHERE i.organization_id=$1 AND i.sales_order_document_id=$2) revisions`,
  [organizationId, orderId])).rows[0];
}

const assess = (orderId: string, organizationId = org) => assessOrderEditBillingInTransaction(client, { organizationId, orderId });
const cases: [string, () => Promise<void>][] = [];
for (const state of ["draft", "issued"] as const) {
  cases.push([`${state} base is editable without retained charges; no payment policy or history mutation`, async () => {
    const orderId = await seedOrder(), invoiceId = await seedInvoice(orderId, { state });
    const before = await history(orderId);
    assert.deepEqual(await assess(orderId), { baseInvoiceId: invoiceId, synchronizationVersion: "7", hasRetainedShippingCharges: false, editability: "editable" });
    assert.deepEqual(await history(orderId), before);
    assert.ok(statements.every(call => !/payment|refund|provider|outbox|credit/i.test(call.sql)));
  }]);
  cases.push([`${state} base with retained Shipping charge is blocked without erasing financial evidence`, async () => {
    const orderId = await seedOrder(), invoiceId = await seedInvoice(orderId, { state });
    await seedCharge(orderId, invoiceId);
    const before = await history(orderId);
    assert.deepEqual(await assess(orderId), { baseInvoiceId: invoiceId, synchronizationVersion: "7", hasRetainedShippingCharges: true,
      editability: "blocked", reason: "retained_shipping_charges" });
    assert.deepEqual(await history(orderId), before);
  }]);
}
cases.push(["zero-valued Shipping rows are conservatively retained, not claimed to lose an amount", async () => {
  const orderId = await seedOrder(), invoiceId = await seedInvoice(orderId);
  await seedCharge(orderId, invoiceId, 0, 0);
  assert.deepEqual(await assess(orderId), { baseInvoiceId: invoiceId, synchronizationVersion: "7", hasRetainedShippingCharges: true,
    editability: "blocked", reason: "retained_shipping_charges" });
}]);
cases.push(["tax-only Shipping evidence is also retained", async () => {
  const orderId = await seedOrder(), invoiceId = await seedInvoice(orderId, { state: "issued" });
  await seedCharge(orderId, invoiceId, 0, 5);
  assert.equal((await assess(orderId)).reason, "retained_shipping_charges");
}]);
cases.push(["void base is an explicit synchronization blocker, not an unpaid interpretation", async () => {
  const orderId = await seedOrder(), invoiceId = await seedInvoice(orderId, { state: "void" });
  assert.deepEqual(await assess(orderId), { baseInvoiceId: invoiceId, synchronizationVersion: "7", hasRetainedShippingCharges: false,
    editability: "blocked", reason: "base_invoice_void" });
}]);
cases.push(["no Invoice or only a replacement Invoice cannot impersonate the base", async () => {
  const orderId = await seedOrder();
  const expected = { hasRetainedShippingCharges: false, editability: "blocked", reason: "base_invoice_missing" };
  assert.deepEqual(await assess(orderId), expected);
  const replacement = await seedInvoice(orderId, { replacement: true });
  statements.length = 0;
  assert.deepEqual(await assess(orderId), expected);
  assert.deepEqual(statements.find(call => /FOR UPDATE/.test(call.sql))?.ids, [replacement]);
}]);
cases.push(["multiple active primary Invoices are explicitly ambiguous, never LIMIT 1 chosen", async () => {
  const orderId = await seedOrder();
  await seedInvoice(orderId, { state: "issued" });
  await seedInvoice(orderId);
  assert.deepEqual(await assess(orderId), { hasRetainedShippingCharges: false, editability: "blocked", reason: "multiple_active_base_invoices" });
  assert.ok(statements.every(call => !/LIMIT\s+1/i.test(call.sql)));
}]);
cases.push(["a numbered non-base primary Invoice is blocked rather than guessed as base", async () => {
  const orderId = await seedOrder(), invoiceId = await seedInvoice(orderId, { state: "issued", sequence: 2 });
  assert.deepEqual(await assess(orderId), { baseInvoiceId: invoiceId, synchronizationVersion: "7", hasRetainedShippingCharges: false,
    editability: "blocked", reason: "invalid_base_invoice_relation" });
}]);
cases.push(["all existing Invoice identities, including replacement and void, lock stably before caller Order mutation lock", async () => {
  const orderId = await seedOrder();
  const ids = ["40000000-0000-4000-8000-000000000003", "40000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000002"];
  const base = await seedInvoice(orderId, { state: "issued", id: ids[0] });
  await seedInvoice(orderId, { replacement: true, id: ids[1] });
  await seedInvoice(orderId, { replacement: true, state: "void", sequence: 3, id: ids[2] });
  const otherOrder = await seedOrder(), otherInvoice = await seedInvoice(otherOrder);
  const result = await assess(orderId);
  await client.query("SELECT document_id FROM v2_sales_order_details WHERE organization_id=$1 AND document_id=$2 FOR UPDATE", [org, orderId]);
  const locks = statements.filter(call => /FOR UPDATE/.test(call.sql));
  assert.match(locks[0].sql, /ORDER BY id FOR UPDATE/);
  assert.deepEqual(locks[0].ids, [...ids].sort());
  assert.ok(!locks[0].ids.includes(otherInvoice));
  assert.match(locks[1].sql, /FROM v2_sales_order_details/);
  assert.deepEqual(result, { baseInvoiceId: base, synchronizationVersion: "7", hasRetainedShippingCharges: false, editability: "editable" });
  assert.ok(!Object.keys(result).some(key => /lock|replacement|client|query/i.test(key)));
}]);
cases.push(["void history and replacement Shipping charges do not replace or block the active base projection", async () => {
  const orderId = await seedOrder();
  await seedInvoice(orderId, { state: "void" });
  const base = await seedInvoice(orderId, { state: "issued" });
  const replacement = await seedInvoice(orderId, { replacement: true });
  await seedCharge(orderId, replacement);
  assert.deepEqual(await assess(orderId), { baseInvoiceId: base, synchronizationVersion: "7", hasRetainedShippingCharges: false, editability: "editable" });
}]);
cases.push(["missing, quote and foreign-tenant Order identities disclose no Invoice identity or charge presence", async () => {
  const foreignOrder = await seedOrder(foreignOrg), invoice = await seedInvoice(foreignOrder, { organizationId: foreignOrg, state: "issued" });
  await seedCharge(foreignOrder, invoice, 101, 5, foreignOrg);
  for (const id of [randomUUID(), await seedOrder(org, "quote"), foreignOrder]) {
    statements.length = 0;
    assert.deepEqual(await assess(id), { hasRetainedShippingCharges: false, editability: "blocked", reason: "order_missing" });
    assert.equal(statements.length, 1);
    assert.deepEqual(statements[0].params, [org, id]);
  }
}]);
cases.push(["organization, Order and base Invoice predicates isolate charge presence", async () => {
  const orderId = await seedOrder(), base = await seedInvoice(orderId);
  for (const organizationId of [org, foreignOrg]) {
    const otherOrder = await seedOrder(organizationId), otherInvoice = await seedInvoice(otherOrder, { organizationId });
    await seedCharge(otherOrder, otherInvoice, 101, 5, organizationId);
  }
  statements.length = 0;
  assert.equal((await assess(orderId)).hasRetainedShippingCharges, false);
  const invoiceRead = statements.find(call => /FROM v2_billing_invoices/.test(call.sql));
  assert.match(invoiceRead!.sql, /WHERE organization_id=\$1 AND sales_order_document_id=\$2/);
  assert.deepEqual(invoiceRead!.params, [org, orderId]);
  const chargeRead = statements.find(call => /FROM v2_billing_invoice_additional_charges/.test(call.sql));
  assert.match(chargeRead!.sql, /organization_id=\$1 AND sales_order_document_id=\$2 AND invoice_id=\$3/);
  assert.deepEqual(chargeRead!.params, [org, orderId, base]);
}]);
cases.push(["real tenant foreign keys reject foreign Invoice and charge lineage", async () => {
  const orderId = await seedOrder(), invoice = await seedInvoice(orderId);
  await database.exec("SAVEPOINT foreign_invoice");
  await assert.rejects(seedInvoice(orderId, { organizationId: foreignOrg }), { code: "23503" });
  await database.exec("ROLLBACK TO SAVEPOINT foreign_invoice");
  await database.exec("SAVEPOINT foreign_charge");
  await assert.rejects(seedCharge(orderId, invoice, 101, 5, foreignOrg), { code: "23503" });
  await database.exec("ROLLBACK TO SAVEPOINT foreign_charge");
  assert.equal((await assess(orderId)).editability, "editable");
}]);
cases.push(["UUID and payload invariants fail before any SQL", async () => {
  const orderId = randomUUID();
  for (const request of [null, {}, { organizationId: "", orderId }, { organizationId: org, orderId: "not-a-uuid" },
    { organizationId: org, orderId: -1 }, { organizationId: `${org} `, orderId }, { organizationId: org, orderId, amountCents: 1 }]) {
    await assert.rejects(assessOrderEditBillingInTransaction(client, request as unknown as OrderEditBillingSafetyRequest), { code: "VALIDATION_ERROR" });
  }
  assert.equal(statements.length, 0);
}]);
cases.push(["uses caller's uncommitted rows and leaves transaction ownership and rollback to the caller", async () => {
  await database.exec("SAVEPOINT caller_effects");
  const orderId = await seedOrder(), invoice = await seedInvoice(orderId, { state: "issued" });
  await seedCharge(orderId, invoice);
  const before = await history(orderId);
  const transactionId = (await database.query("SELECT txid_current()::text AS id")).rows[0];
  assert.equal((await assess(orderId)).reason, "retained_shipping_charges");
  assert.deepEqual((await database.query("SELECT txid_current()::text AS id")).rows[0], transactionId);
  assert.deepEqual(await history(orderId), before);
  assert.ok(statements.every(call => /^\s*SELECT\b/i.test(call.sql)), "owner operation issues SELECT/locks only, not writes or transaction commands");
  await database.exec("ROLLBACK TO SAVEPOINT caller_effects");
  assert.deepEqual((await database.query("SELECT id FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$2", [org, orderId])).rows, []);
  assert.equal((await assess(orderId)).reason, "order_missing");
}]);

try {
  await setup();
  for (const [name, run] of cases) {
    await database.exec("BEGIN");
    statements.length = 0;
    try {
      await run();
      assert.ok(statements.every(call => /^\s*SELECT\b/i.test(call.sql)), "Billing safety never writes or controls the transaction");
      console.log(`PASS ${name}`);
    } finally { await database.exec("ROLLBACK"); }
  }
  console.log(`Order edit Billing safety: ${cases.length} cases passed using real Billing DDL in memory.`);
} finally { await database.close(); }
