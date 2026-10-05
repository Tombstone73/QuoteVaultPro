import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { brandedId,canonicalJson } from "../../src/modules/shared/commercialValues.js";
import { FulfillmentApplicationService } from "../../src/modules/fulfillment/fulfillmentApplication.js";
import { PostgresFulfillmentTransaction, PostgresFulfillmentTransactionRunner } from "../../infrastructure/fulfillment/postgresFulfillmentTransaction.js";
import { PostgresFulfillmentWorkspaceReads } from "../../infrastructure/fulfillment/postgresFulfillmentWorkspaceReads.js";
import { PostgresFulfillmentCompletionProjection } from "../../infrastructure/fulfillment/postgresFulfillmentCompletionProjection.js";
import { PostgresReplacementObligationService } from "../../infrastructure/fulfillment/postgresReplacementObligations.js";
import { PostgresShipmentContainerRunner, PostgresShipmentContainerTransaction } from "../../infrastructure/fulfillment/postgresShipmentContainerTransaction.js";
import { ShipmentContainerApplicationService } from "../../src/modules/fulfillment/shipmentContainerApplication.js";
import { V2ApplicationError, type ApplicationResult } from "../../src/errors/applicationError.js";
import { PostgresOrderAutomaticLifecycle } from "../../infrastructure/sales/postgresOrderAutomaticLifecycle.js";
import { PostgresProductionCompletionProjection } from "../../infrastructure/production/postgresProductionCompletionProjection.js";
import { createOrReadReplacementInvoice } from "../../infrastructure/billing/postgresReplacementInvoice.js";
import type { ReplacementFulfillmentProjection } from "../../src/modules/fulfillment/contracts.js";
import type { ShipmentPreparedAllocation } from "../../src/modules/fulfillment/shipmentContainer.js";
import { PostgresPhysicalOperationRecovery } from "../../infrastructure/fulfillment/postgresPhysicalOperationRecovery.js";
import { PostgresFulfillmentDocumentService } from "../../infrastructure/fulfillment/postgresFulfillmentDocuments.js";
import { createHash,webcrypto } from "node:crypto";
import React from "react";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { canonicalFulfillmentIntentBody,useFulfillmentIntent,validateFulfillmentIntentRecord,submittedPhysicalFingerprint } from "../../ui/src/ShipmentBuilder.js";
import { PhysicalRecoveryPanel } from "../../ui/src/PhysicalRecoveryPanel.js";
import { configureFulfillmentOwnerTransport } from "../../ui/src/fulfillmentOwnerApi.js";
import type { PhysicalOperation,PhysicalRecoveryResult } from "../../src/modules/fulfillment/physicalOperationRecovery.js";

// All identities and rows below are synthetic and exist only in this embedded database.
const org = brandedId<"OrganizationId">("m5-isolation-org"), foreignOrg = brandedId<"OrganizationId">("m5-foreign-org");
const db = new PGlite();
const sql = (name: string) => readFileSync(resolve(process.cwd(), "server/db/migrations_v2", name), "utf8");
const statements: string[] = [];
const query = async (text: string, params?: unknown[]) => {
  statements.push(text);
  const result = await db.query<Record<string, unknown>>(text, params);
  // node-postgres returns timestamps as Date; do not mock SQL or its aggregates.
  const dates = result.fields.filter(field => field.dataTypeID === 1184 || field.dataTypeID === 1114).map(field => field.name);
  return { rows: result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, dates.includes(key) && value !== null ? new Date(value as string) : value]))), rowCount: result.affectedRows ?? result.rows.length };
};
let available = Promise.resolve();
const pool = { query, async connect() {
  const prior = available;
  let release!: () => void;
  available = new Promise<void>(done => { release = done; });
  await prior;
  return { query, release };
} } as unknown as Pool;
const client = { query } as unknown as PoolClient;
const tx = new PostgresFulfillmentTransaction(client);
const workspace = new PostgresFulfillmentWorkspaceReads(pool);
const lifecycle = new PostgresOrderAutomaticLifecycle(pool);
const fulfillment = new FulfillmentApplicationService(new PostgresFulfillmentTransactionRunner(pool), undefined, lifecycle);
const replacements = new PostgresReplacementObligationService(pool, lifecycle);
const context = (id = "read", organizationId = org): OperationContext => ({ organizationId, operationId: id,
  businessRequest: { id, payloadFingerprint: id }, principal: { kind: "staff", organizationId, userId: "m5-user",
    authority: { membershipId: "m5-membership", capabilities: ["fulfillment.view", "fulfillment.pickup", "fulfillment.ship", "fulfillment.replace"] } } });

async function setup() {
  // Minimal foreign-owner table shapes, not their business rules. Fulfillment,
  // replacement and shipment constraints/functions below come from actual DDL.
  await db.exec(`
    CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar,display_name text,company_name text,UNIQUE(id,organization_id));
    CREATE TABLE customer_contacts(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE pbv2_tree_versions(id varchar,organization_id varchar,product_id varchar,tree_json jsonb);
    CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar,document_kind text,display_number text,
      customer_id varchar,contact_id varchar,requested_due_date date,purchase_order_number text,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_order_details(document_id varchar PRIMARY KEY,organization_id varchar,commercial_state text DEFAULT 'open',
      requested_fulfillment_method text DEFAULT 'pickup',requested_destination jsonb DEFAULT '{"addressLine1":"Fixture Way","city":"Fixture City"}',
      fulfillment_instructions text,archived_at timestamptz,completed_at timestamptz,updated_at timestamptz,
      completed_principal_kind text,completed_principal_subject text,completed_staff_actor_user_id varchar,
      archived_principal_kind text,archived_principal_subject text,archived_staff_actor_user_id varchar,UNIQUE(document_id,organization_id));
    CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar,document_id varchar,description text,quantity integer,
      position integer DEFAULT 0,product_id varchar DEFAULT 'm5-product',resolved_configuration jsonb,
      selling_unit_cents bigint DEFAULT 875,selling_line_cents bigint DEFAULT 1750,pricing_evidence_fingerprint text DEFAULT 'frozen-m5-price',
      taxability_snapshot jsonb DEFAULT '{"taxable":true}',UNIQUE(id,organization_id,document_id));
    CREATE TABLE v2_sales_line_production_requirements(organization_id varchar,order_line_id varchar,requirement_key varchar);
    CREATE TABLE v2_sales_line_workflow_exceptions(organization_id varchar,order_line_id varchar,production_requirement text);
    CREATE TABLE v2_route_instances(organization_id varchar,order_line_id varchar,route_state text);
    CREATE TABLE v2_production_works(id varchar PRIMARY KEY,organization_id varchar,order_document_id varchar,order_line_id varchar,
      requirement_key varchar,ordered_quantity integer,artwork_assignment_id varchar,artwork_file_id varchar,prepress_unit_id varchar,
      side text,source_page_index integer,layer_key text,layer_order integer,rework_cycle_id varchar,
      created_at timestamptz DEFAULT now(),created_principal_kind text,created_principal_subject text,created_staff_actor_user_id varchar,
      UNIQUE(id,organization_id));
    CREATE UNIQUE INDEX v2_production_works_normal_assignment_uidx ON v2_production_works(organization_id,artwork_assignment_id) WHERE rework_cycle_id IS NULL;
    CREATE UNIQUE INDEX v2_production_works_normal_requirement_uidx ON v2_production_works(organization_id,order_line_id,requirement_key,artwork_assignment_id) WHERE rework_cycle_id IS NULL;
    CREATE TABLE v2_production_attempts(id varchar PRIMARY KEY,organization_id varchar,production_work_id varchar,good_quantity integer,completed_at timestamptz);
    CREATE TABLE v2_production_output_dispositions(organization_id varchar,production_work_id varchar,rejected_quantity integer);
    CREATE TABLE v2_operation_requests(id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,organization_id varchar,operation text,
      business_request_id text,payload_fingerprint text,status text DEFAULT 'in_progress',result_resource_type text,result_resource_id text,
      result_json jsonb,initiated_principal_kind text,initiated_principal_subject text,staff_actor_user_id varchar,
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),completed_at timestamptz,UNIQUE(organization_id,operation,business_request_id));
    CREATE TABLE v2_principal_attributions(id varchar DEFAULT gen_random_uuid()::text,organization_id varchar,operation_request_id varchar,
      operation text,resource_type text,resource_id varchar,principal_kind text,principal_subject text,staff_actor_user_id varchar);
    CREATE TABLE v2_audit_events(id varchar DEFAULT gen_random_uuid()::text,organization_id varchar,operation_request_id varchar,
      operation text,event_type text,resource_type text,resource_id varchar,principal_kind text,principal_subject text,staff_actor_user_id varchar,changes jsonb);
    CREATE TABLE v2_billing_invoices(id varchar PRIMARY KEY,organization_id varchar,sales_order_document_id varchar,invoice_state text,
      invoice_display_number text,invoice_sequence integer,customer_id varchar,contact_id varchar,purchase_order_number text,currency text DEFAULT 'USD',
      terms_code text,source_sales_state_token text,synchronization_version bigint DEFAULT 1,subtotal_cents bigint,tax_total_cents bigint,total_cents bigint,tax_context_reference text,
      tax_calculator_version text,tax_evidence jsonb,sales_adjustment_cents bigint,sales_adjustment_reason text,sales_commercial_charge jsonb,
      sales_tax_composition jsonb,UNIQUE(id,organization_id),CONSTRAINT v2_billing_invoices_display_number_state_chk CHECK(true));
    CREATE UNIQUE INDEX v2_billing_invoices_one_draft_per_order_uidx ON v2_billing_invoices(organization_id,sales_order_document_id) WHERE invoice_state='draft';
    CREATE TABLE v2_billing_invoice_lines(id varchar PRIMARY KEY,organization_id varchar,invoice_id varchar,sales_order_document_id varchar,
      source_sales_line_id varchar,position integer,product_id varchar,description text,quantity integer,currency text,
      selling_unit_cents bigint,selling_line_cents bigint,sales_pricing_evidence_fingerprint text);
    CREATE TABLE v2_billing_payment_allocations(id varchar PRIMARY KEY,organization_id varchar,invoice_id varchar,amount_cents bigint);
    CREATE TABLE v2_billing_refund_allocation_evidence(id varchar,organization_id varchar,invoice_id varchar,amount_cents bigint);
    CREATE TABLE v2_billing_invoice_checkpoints(organization_id varchar,invoice_id varchar,checkpoint_json jsonb);
    CREATE TABLE v2_billing_invoice_additional_charges(organization_id varchar,invoice_id varchar);
    CREATE TABLE invoices(organization_id varchar,display_number text,qb_doc_number text,invoice_number integer);
  `);
  const outputFunction = sql("0282_v2_production_output_rejections.sql").match(/CREATE OR REPLACE FUNCTION v2_usable_production_good_quantity[\s\S]*?\$\$;/)?.[0];
  assert.ok(outputFunction, "fixture must execute the actual Production-owned usable-output function");
  await db.exec(outputFunction);
  await db.exec(sql("0205_v2_fulfillment_domain_foundation.sql").split("INSERT INTO v2_permission_capabilities")[0]);
  await db.exec(sql("0231_v2_fulfillment_handoff_document_snapshots.sql"));
  await db.exec(sql("0267_v2_fulfillment_shipment_containers.sql"));
  await db.exec(sql("0275_v2_fulfillment_shipment_recovery.sql"));
  await db.exec(sql("0283_v2_replacement_obligations_shipping_economics.sql").split("-- Shipping cost")[0]);
  await db.exec(sql("0284_v2_replacement_obligation_execution.sql"));
  await db.exec(sql("0285_v2_billable_replacement_invoices.sql"));
  await db.query("INSERT INTO organizations VALUES($1),($2)", [org, foreignOrg]);
  await db.query("INSERT INTO users VALUES('m5-user')");
  await db.query("INSERT INTO customers VALUES('m5-customer',$1,'Synthetic Customer',NULL)", [org]);
  await db.exec(`ALTER TABLE customers ADD COLUMN blind_shipping boolean DEFAULT false;
    ALTER TABLE organizations ADD COLUMN name text DEFAULT 'Organization';
    CREATE TABLE company_settings(organization_id text PRIMARY KEY,company_name text,company_display_name text,address text,physical_address jsonb,remittance_address jsonb,phone text,email text,website text,invoice_footer_note text,invoice_payment_instructions text,checks_payable_to text);
    ALTER TABLE customers ADD COLUMN billing_street1 text DEFAULT 'Return Way';
    ALTER TABLE customers ADD COLUMN billing_street2 text;
    ALTER TABLE customers ADD COLUMN billing_city text DEFAULT 'Return City';
    ALTER TABLE customers ADD COLUMN billing_state text DEFAULT 'FL';
    ALTER TABLE customers ADD COLUMN billing_postal_code text DEFAULT '12345';
    ALTER TABLE customers ADD COLUMN billing_country text DEFAULT 'US';
    ALTER TABLE customers ADD COLUMN phone text;
    ALTER TABLE customers ADD COLUMN email text;`);
  await db.exec(sql("0301_v2_shipment_sender_snapshot.sql"));
}

let sequence = 0;
async function fixture(quantity = 2, requirements = ["front"]) {
  const id = `m5-order-${++sequence}`, orderId = brandedId<"OrderId">(id), lineId = brandedId<"OrderLineId">(`${id}-line`);
  await db.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,display_number,customer_id) VALUES($1,$2,'order','ORD-1019','m5-customer')", [orderId, org]);
  await db.query("INSERT INTO v2_sales_order_details(document_id,organization_id) VALUES($1,$2)", [orderId, org]);
  await db.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id,description,quantity,resolved_configuration,selling_line_cents) VALUES($1,$2,$3,'Synthetic Banner',$4,$5::jsonb,$6)",
    [lineId, org, orderId, quantity, JSON.stringify({ productFacts: { workflowIntent: "standard_production", requiresProductionJob: true } }), quantity * 875]);
  await db.query("INSERT INTO v2_route_instances VALUES($1,$2,'completed')", [org, lineId]);
  for (const key of requirements) await db.query("INSERT INTO v2_sales_line_production_requirements VALUES($1,$2,$3)", [org, lineId, key]);
  const work = async (key: string, evidence: Readonly<{ orderedQuantity: number; producedQuantity: number }>, obligationId: string | null = null, reworkCycle: string | null = null) => {
    assert.ok(Number.isSafeInteger(evidence.orderedQuantity) && evidence.orderedQuantity > 0);
    assert.ok(Number.isSafeInteger(evidence.producedQuantity) && evidence.producedQuantity >= 0);
    const workId = `${id}-work-${++sequence}`;
    await db.query("INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,ordered_quantity,artwork_assignment_id,replacement_obligation_id,rework_cycle_id) VALUES($1,$2,$3,$4,$5,$6,$1,$7,$8)",
      [workId, org, orderId, lineId, key, evidence.orderedQuantity, obligationId, reworkCycle]);
    await db.query("INSERT INTO v2_production_attempts VALUES($1,$2,$3,$4,now())", [`${workId}-attempt`, org, workId, evidence.producedQuantity]);
    return workId;
  };
  const handoff = async (amount: number, obligationId: string | null = null, method = "pickup") => {
    const handoffId = `${id}-handoff-${++sequence}`;
    await tx.createHandoff({ id: brandedId<"FulfillmentHandoffId">(handoffId), organizationId: org, orderId, method: method as "pickup" | "shipment",
      customerId: "m5-customer", ...(obligationId ? { replacementObligationId: obligationId } : {}), principalKind: "staff", principalSubject: "m5-user" });
    await tx.createAllocations({ organizationId: org, handoffId: brandedId<"FulfillmentHandoffId">(handoffId), orderId,
      allocations: [{ id: brandedId<"FulfillmentHandoffLineId">(`${handoffId}-line`), orderLineId: lineId, quantity: amount }] });
    await tx.writeDocumentSnapshot({ organizationId: org, handoffId: brandedId<"FulfillmentHandoffId">(handoffId) });
    return handoffId;
  };
  const replacement = async (amount: number) => {
    const replacementId = brandedId<"ReplacementObligationId">(`${id}-replacement-${++sequence}`);
    await db.query("INSERT INTO v2_order_replacement_obligations(id,organization_id,order_document_id,order_line_id,replacement_quantity,reason,responsibility,billing_treatment,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,$4,$5,'print_defect','titan','no_charge','staff','m5-user')", [replacementId, org, orderId, lineId, amount]);
    return replacementId;
  };
  return { orderId, lineId, work, handoff, replacement };
}

async function settleOriginal(f: Awaited<ReturnType<typeof fixture>>) {
  const invoiceId = `${f.orderId}-invoice`;
  await db.query(`INSERT INTO v2_billing_invoices(id,organization_id,sales_order_document_id,invoice_state,invoice_display_number,
    invoice_sequence,subtotal_cents,tax_total_cents,total_cents,tax_calculator_version,tax_evidence)
    VALUES($1,$2,$3,'issued','ORD-1019',1,1750,0,1750,'v2-sales-receipt-jurisdiction-v1',$4::jsonb)`,
    [invoiceId, org, f.orderId, JSON.stringify({ status: "resolved", jurisdiction: { id: "fixture-zero-tax", name: "Synthetic zero tax",
      receiptLocation: { country: "US", region: "FL" }, rateBasisPoints: 0 }, exemption: { exempt: false } })]);
  await db.query(`INSERT INTO v2_billing_invoice_lines(id,organization_id,invoice_id,sales_order_document_id,source_sales_line_id,
    product_id,description,quantity,currency,selling_unit_cents,selling_line_cents,sales_pricing_evidence_fingerprint)
    VALUES($1,$2,$3,$4,$5,'m5-product','Synthetic Banner',2,'USD',875,1750,'frozen-m5-price')`,
    [`${invoiceId}-line`, org, invoiceId, f.orderId, f.lineId]);
  await db.query("INSERT INTO v2_billing_payment_allocations VALUES($1,$2,$3,1750)", [`${invoiceId}-payment`, org, invoiceId]);
}

async function projection(orderId: ReturnType<typeof brandedId<"OrderId">>, replacementId: string) {
  const result = await replacements.list(context(), orderId);
  assert.ok(result.ok, result.ok ? "" : result.error.publicMessage);
  const found = result.value.find(item => item.obligation.replacementObligationId === replacementId);
  assert.ok(found);
  return found as ReplacementFulfillmentProjection;
}
async function shipping<T>(action: (transaction: PostgresShipmentContainerTransaction) => Promise<T>) {
  const connection = await pool.connect();
  try { await connection.query("BEGIN"); const result = await action(new PostgresShipmentContainerTransaction(connection)); await connection.query("COMMIT"); return result; }
  catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}
const prepare = (allocations: readonly ShipmentPreparedAllocation[]) => shipping(transaction => transaction.createPrepared({
  id: `m5-shipment-${++sequence}`, organizationId: org, carrier: { status: "prepared", carrierName: "Synthetic carrier" },
  allocations, principalKind: "staff", principalSubject: "m5-user" }));
async function financialHistory(orderId: string) {
  const result = await db.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM v2_billing_invoices i WHERE i.organization_id=$1 AND i.sales_order_document_id=$2 AND i.replacement_obligation_id IS NULL) invoices,
    (SELECT jsonb_agg(to_jsonb(line) ORDER BY line.id) FROM v2_billing_invoice_lines line JOIN v2_billing_invoices i ON i.organization_id=line.organization_id AND i.id=line.invoice_id WHERE i.organization_id=$1 AND i.sales_order_document_id=$2 AND i.replacement_obligation_id IS NULL) lines,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM v2_billing_payment_allocations a JOIN v2_billing_invoices i ON i.organization_id=a.organization_id AND i.id=a.invoice_id WHERE i.organization_id=$1 AND i.sales_order_document_id=$2) payments,
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM v2_billing_refund_allocation_evidence e JOIN v2_billing_invoices i ON i.organization_id=e.organization_id AND i.id=e.invoice_id WHERE i.organization_id=$1 AND i.sales_order_document_id=$2) refunds`, [org, orderId]);
  return result.rows[0];
}

const cases: [string, () => Promise<void>][] = [];
cases.push(["Routing's Production-owned original completion excludes replacement output but retains original rework", async () => {
  const f = await fixture(2);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 1 });
  await f.handoff(1);
  const replacementId = await f.replacement(1);
  await f.work("front", { orderedQuantity: 1, producedQuantity: 1 }, replacementId);
  const completion = new PostgresProductionCompletionProjection(client);
  const before = await completion.readCompletion(org, f.lineId);
  assert.equal(before.state, "in_progress");
  assert.equal(before.completedUnitCount, 0, "replacement output cannot release the original Route");
  await f.work("front", { orderedQuantity: 1, producedQuantity: 1 }, null, "m5-original-rework");
  const after = await completion.readCompletion(org, f.lineId);
  assert.equal(after.state, "complete");
  assert.equal(after.completedUnitCount, 1, "original rework remains valid original supply");
  const foreign = await completion.readCompletion(foreignOrg, f.lineId);
  assert.equal(foreign.state, "blocked");
  assert.equal(foreign.requiredUnitCount, 0);
}]);
cases.push(["original 2/2 stays separate from produced replacement 1/1 before and after pickup", async () => {
  const f = await fixture();
  await settleOriginal(f);
  assert.deepEqual((await db.query("SELECT i.total_cents::text total,a.amount_cents::text paid FROM v2_billing_invoices i JOIN v2_billing_payment_allocations a ON a.organization_id=i.organization_id AND a.invoice_id=i.id WHERE i.organization_id=$1 AND i.sales_order_document_id=$2", [org, f.orderId])).rows,
    [{ total: "1750", paid: "1750" }]);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 2 });
  const originalHandoff = await f.handoff(2);
  const replacementId = await f.replacement(1);
  await f.work("front", { orderedQuantity: 1, producedQuantity: 1 }, replacementId);
  const before = await workspace.get(org, f.orderId);
  assert.equal(before?.lines[0].completedFulfillmentQuantity, 2);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, replacementId))?.availableFulfillmentQuantity, 1);
  await f.handoff(1, replacementId);
  const after = await workspace.get(org, f.orderId);
  assert.equal(after?.lines[0].completedPickupQuantity, 2, "replacement pickup must not become a third original pickup");
  assert.equal(after?.lines[0].physicalIntegrityAnomaly, undefined, "replacement history must not fabricate an original anomaly");
  assert.equal(after?.handoffs.find(item => item.handoff.handoffId !== originalHandoff)?.handoff.replacementObligationId, replacementId);
  assert.equal((await new PostgresFulfillmentCompletionProjection(client).readCompletion(org, f.lineId)).completedQuantity, 2);
}]);
cases.push(["replacement output never supplies an unproduced original, including a missing frozen requirement", async () => {
  const f = await fixture(2, ["front", "back"]);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 1 });
  const a = await f.replacement(2);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a); await f.work("back", { orderedQuantity: 2, producedQuantity: 2 }, a);
  for (const read of [(await tx.readAvailability(org, f.orderId))?.availability[0], (await workspace.get(org, f.orderId))?.lines[0]]) {
    assert.equal(read?.completedProductionQuantity, 0);
    assert.equal(read?.availableFulfillmentQuantity, 0);
    assert.equal(read?.remainingProductionQuantity, 2);
  }
  const pickup = await fulfillment.recordPickup(context("original-no-output"), { businessRequestId: "original-no-output", orderId: f.orderId, allocations: [{ orderLineId: f.lineId, quantity: 1 }] });
  assert.equal(pickup.ok, false);
  await assert.rejects(prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1 }]), /exceeds the currently available output/);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, a))?.availableFulfillmentQuantity, 2);
}]);
cases.push(["legitimate original rework remains in the existing per-requirement sum", async () => {
  const f = await fixture(4, ["front", "back"]);
  for (const requirement of ["front", "back"]) { await f.work(requirement, { orderedQuantity: 4, producedQuantity: 1 }); await f.work(requirement, { orderedQuantity: 3, producedQuantity: 3 }, null, `${f.orderId}-${requirement}-rework`); }
  const a = await f.replacement(7);
  await f.work("front", { orderedQuantity: 7, producedQuantity: 7 }, a); await f.work("back", { orderedQuantity: 7, producedQuantity: 7 }, a);
  assert.equal((await tx.readAvailability(org, f.orderId))?.availability[0].completedProductionQuantity, 4);
  assert.equal((await workspace.get(org, f.orderId))?.lines[0].availableFulfillmentQuantity, 4);
  await prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 4 }]);
}]);
cases.push(["A requested2 produced2 fulfilled1 and B requested3 produced3 fulfilled0 remain independent", async () => {
  const f = await fixture(); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }); await f.handoff(2);
  const a = await f.replacement(2), b = await f.replacement(3);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a); await f.work("front", { orderedQuantity: 3, producedQuantity: 3 }, b); await f.handoff(1, a);
  const pa = await projection(f.orderId, a), pb = await projection(f.orderId, b);
  assert.deepEqual([pa.remainingProductionQuantity, pa.remainingFulfillmentQuantity, pa.availableFulfillmentQuantity], [0, 1, 1]);
  assert.deepEqual([pb.remainingProductionQuantity, pb.remainingFulfillmentQuantity, pb.availableFulfillmentQuantity], [0, 3, 3]);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, a))?.availableFulfillmentQuantity, 1);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, b))?.availableFulfillmentQuantity, 3);
  assert.equal((await workspace.get(org, f.orderId))?.lines[0].completedFulfillmentQuantity, 2);
}]);
cases.push(["single-work replacement requirements use their minimum and missing A work stays zero despite B supply", async () => {
  const f = await fixture(2, ["front", "back"]), a = await f.replacement(2), b = await f.replacement(5);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a); await f.work("front", { orderedQuantity: 5, producedQuantity: 5 }, b); await f.work("back", { orderedQuantity: 5, producedQuantity: 5 }, b);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, a))?.availableFulfillmentQuantity, 0);
  assert.equal((await projection(f.orderId, a)).remainingProductionQuantity, 2);
  await assert.rejects(prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1, replacementObligationId: a }]), /accepted-good authority/);
  await f.work("back", { orderedQuantity: 2, producedQuantity: 1 }, a);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, a))?.availableFulfillmentQuantity, 1);
  assert.equal((await projection(f.orderId, a)).remainingProductionQuantity, 1);
  assert.equal((await projection(f.orderId, a)).obligation.status, "open", "the actual status function still requires each work's own ordered quantity");
  await assert.rejects(prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 2, replacementObligationId: a }]), /accepted-good authority/);
  await prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1, replacementObligationId: a }]);
}]);
cases.push(["two unlinked same-requirement works ordered2 produced1 each cannot invent completed replacement2", async () => {
  const f = await fixture(); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }); await f.handoff(2); await settleOriginal(f);
  const a = await f.replacement(2), b = await f.replacement(3);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 1 }, a);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 1 }, a);
  await f.work("front", { orderedQuantity: 3, producedQuantity: 3 }, b);
  const finance = await financialHistory(f.orderId);
  const history = (await db.query("SELECT to_jsonb(r) obligation FROM v2_order_replacement_obligations r WHERE r.organization_id=$1 AND r.id=$2", [org, a])).rows;
  assert.equal((history[0].obligation as { status: string }).status, "open", "actual migration0284 does not combine independent work quantities");
  assert.deepEqual((await db.query("SELECT w.ordered_quantity,v2_usable_production_good_quantity(w.organization_id,w.id)::integer usable FROM v2_production_works w WHERE w.organization_id=$1 AND w.replacement_obligation_id=$2 ORDER BY w.id", [org, a])).rows,
    [{ ordered_quantity: 2, usable: 1 }, { ordered_quantity: 2, usable: 1 }]);
  const locked = await tx.lockReplacementAvailability(org, f.orderId, a);
  assert.equal(locked?.availableFulfillmentQuantity, 0, "ambiguous same-key work cannot be summed into handoff authority");
  const projected = await projection(f.orderId, a);
  assert.equal(projected.availableFulfillmentQuantity, 0);
  assert.equal(projected.remainingProductionQuantity, 1, "retain the existing per-work minimum witness, not fabricated zero production");
  assert.equal(projected.obligation.status, "open");
  assert.deepEqual(projected.productionAuthorityIssue, { kind: "AMBIGUOUS_REPLACEMENT_PRODUCTION", requirementKeys: ["front"] });
  assert.deepEqual(locked?.productionAuthorityIssue, projected.productionAuthorityIssue);
  assert.equal((await projection(f.orderId, b)).availableFulfillmentQuantity, 3, "A ambiguity cannot block B");
  for (const quantity of [1, 2]) {
    const request = `ambiguous-a-pickup-${quantity}`;
    const pickup = await fulfillment.recordPickup(context(request), { businessRequestId: request, orderId: f.orderId, replacementObligationId: a,
      allocations: [{ orderLineId: f.lineId, quantity }] });
    assert.equal(pickup.ok, false, "API pickup cannot decide deferred replacement lineage");
    if (!pickup.ok) assert.equal(pickup.error.code, "CONFLICT");
    const shipmentRequest = `ambiguous-a-shipment-${quantity}`;
    const shipment = await fulfillment.recordShipment(context(shipmentRequest), { businessRequestId: shipmentRequest, orderId: f.orderId,
      replacementObligationId: a, allocations: [{ orderLineId: f.lineId, quantity }] });
    assert.equal(shipment.ok, false, "API shipment cannot decide deferred replacement lineage");
    if (!shipment.ok) assert.equal(shipment.error.code, "CONFLICT");
    await assert.rejects(prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity, replacementObligationId: a }]), /ambiguous/i);
  }
  assert.deepEqual((await db.query("SELECT to_jsonb(r) obligation FROM v2_order_replacement_obligations r WHERE r.organization_id=$1 AND r.id=$2", [org, a])).rows, history, "read projections and rejected handoffs never rewrite canonical status/history");
  assert.deepEqual(await financialHistory(f.orderId), finance);
  assert.equal((await db.query("SELECT count(*)::integer n FROM v2_fulfillment_handoffs WHERE organization_id=$1 AND replacement_obligation_id=$2", [org, a])).rows[0].n, 0);
}]);
cases.push(["completed duplicate required works still need lineage review without changing canonical production_complete status", async () => {
  const f = await fixture(), a = await f.replacement(2);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a, `${f.orderId}-ambiguous-successor`);
  const history = (await db.query("SELECT to_jsonb(r) obligation FROM v2_order_replacement_obligations r WHERE r.organization_id=$1 AND r.id=$2", [org, a])).rows;
  assert.equal((history[0].obligation as { status: string }).status, "production_complete");
  const projected = await projection(f.orderId, a);
  assert.equal(projected.remainingProductionQuantity, 0, "preserve the existing minimum witness of two, not fabricated zero usable output");
  assert.equal(projected.availableFulfillmentQuantity, 0);
  assert.deepEqual(projected.productionAuthorityIssue?.requirementKeys, ["front"]);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, a))?.availableFulfillmentQuantity, 0);
  await assert.rejects(prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 2, replacementObligationId: a }]), /ambiguous/i);
  assert.deepEqual((await db.query("SELECT to_jsonb(r) obligation FROM v2_order_replacement_obligations r WHERE r.organization_id=$1 AND r.id=$2", [org, a])).rows, history);
}]);
cases.push(["later ambiguous required work blocks prepared finalization without rewriting the existing revision", async () => {
  const f = await fixture(), a = await f.replacement(2);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a);
  const prepared = await prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 2, replacementObligationId: a }]);
  const before = (await db.query("SELECT to_jsonb(s) shipment FROM v2_fulfillment_shipments s WHERE s.organization_id=$1 AND s.id=$2", [org, prepared.shipmentId])).rows;
  await f.work("front", { orderedQuantity: 2, producedQuantity: 1 }, a);
  await assert.rejects(shipping(transaction => transaction.finalizePrepared({ organizationId: org, shipmentId: prepared.shipmentId,
    expectedPreparedRevisionId: prepared.currentPreparedRevision!.revisionId, principalKind: "staff", principalSubject: "m5-user" })), /ambiguous/i);
  assert.deepEqual((await db.query("SELECT to_jsonb(s) shipment FROM v2_fulfillment_shipments s WHERE s.organization_id=$1 AND s.id=$2", [org, prepared.shipmentId])).rows, before);
  assert.equal((await projection(f.orderId, a)).obligation.status, "open");
  assert.equal((await projection(f.orderId, a)).reservedShipmentQuantity, 2);
  assert.equal((await db.query("SELECT count(*)::integer n FROM v2_fulfillment_handoffs WHERE organization_id=$1 AND replacement_obligation_id=$2", [org, a])).rows[0].n, 0);
}]);
cases.push(["replacement minimum still includes every exact-obligation work without borrowing foreign Order work", async () => {
  const f = await fixture(), other = await fixture(), a = await f.replacement(2);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a);
  await f.work("additional-work", { orderedQuantity: 2, producedQuantity: 1 }, a);
  await other.work("front", { orderedQuantity: 9, producedQuantity: 9 }, a);
  assert.equal((await projection(f.orderId, a)).remainingProductionQuantity, 1, "the pre-existing per-work minimum does not omit an exact scoped work");
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, a))?.availableFulfillmentQuantity, 1);
  await assert.rejects(prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 2, replacementObligationId: a }]), /accepted-good authority/);
  await prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1, replacementObligationId: a }]);
}]);
cases.push(["usable output comes from the actual Production function, not raw or incomplete accepted history", async () => {
  const f = await fixture(); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 });
  const a = await f.replacement(2), workId = await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a);
  await db.query("INSERT INTO v2_production_attempts VALUES($1,$2,$3,99,NULL)", [`${workId}-incomplete`, org, workId]);
  await db.query("INSERT INTO v2_production_output_dispositions VALUES($1,$2,1)", [org, workId]);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, a))?.availableFulfillmentQuantity, 1);
  assert.equal((await projection(f.orderId, a)).remainingProductionQuantity, 1);
  assert.equal((await workspace.get(org, f.orderId))?.lines[0].completedProductionQuantity, 2);
  assert.deepEqual((await db.query("SELECT good_quantity FROM v2_production_attempts WHERE id=$1", [`${workId}-attempt`])).rows, [{ good_quantity: 2 }]);
}]);
cases.push(["zero frozen requirements fails closed rather than borrowing work from any obligation", async () => {
  const f = await fixture(2, []), a = await f.replacement(2); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, a))?.availableFulfillmentQuantity, 0);
  assert.equal((await projection(f.orderId, a)).availableFulfillmentQuantity, 0);
  await assert.rejects(prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1, replacementObligationId: a }]), /accepted-good authority/);
}]);
cases.push(["stock-origin and frozen production-not-required lines keep their existing supply without fabricated Production", async () => {
  for (const workflowIntent of ["fulfillment_only", "standard_production"]) {
    const f = await fixture(2, []);
    await db.query("UPDATE v2_sales_document_lines SET resolved_configuration=$2::jsonb WHERE id=$1", [f.lineId,
      JSON.stringify({ productFacts: { workflowIntent, requiresProductionJob: false } })]);
    assert.equal((await tx.readAvailability(org, f.orderId))?.availability[0].availableFulfillmentQuantity, 2);
    assert.equal((await workspace.get(org, f.orderId))?.lines[0].completedProductionQuantity, 0);
    await prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1 }]);
    assert.equal((await workspace.get(org, f.orderId))?.lines[0].availableFulfillmentQuantity, 1);
    assert.equal((await workspace.get(org, f.orderId))?.lines[0].physicalIntegrityAnomaly, undefined);
    const pickup = await fulfillment.recordPickup(context(`stock-${workflowIntent}`), { businessRequestId: `stock-${workflowIntent}`, orderId: f.orderId,
      allocations: [{ orderLineId: f.lineId, quantity: 1 }] });
    assert.ok(pickup.ok);
    assert.equal(pickup.value.availability[0].completedProductionQuantity, 0);
    assert.equal(pickup.value.availability[0].physicalIntegrityAnomaly, undefined);
  }
}]);
cases.push(["replacement history neither hides nor inflates a conservative original physical anomaly", async () => {
  const f = await fixture(); await f.handoff(1);
  const a = await f.replacement(2); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a); await f.handoff(2, a);
  const line = (await workspace.get(org, f.orderId))!.lines[0];
  assert.equal(line.completedPickupQuantity, 1);
  assert.equal(line.completedProductionQuantity, 0);
  assert.equal(line.physicalIntegrityAnomaly?.excessFulfillmentQuantity, 1);
  assert.equal((await tx.readAvailability(org, f.orderId))?.availability[0].physicalIntegrityAnomaly?.excessFulfillmentQuantity, 1);
  assert.equal((await new PostgresFulfillmentCompletionProjection(client).readCompletion(org, f.lineId)).completedQuantity, 1);
}]);
cases.push(["prepared replacement reservations subtract from bounded obligation supply even when usable evidence is larger", async () => {
  const f = await fixture(), a = await f.replacement(1); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a);
  await prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1, replacementObligationId: a }]);
  assert.equal((await projection(f.orderId, a)).availableFulfillmentQuantity, 0);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, a))?.availableFulfillmentQuantity, 0);
  await assert.rejects(prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1, replacementObligationId: a }]), /accepted-good authority/);
}]);
cases.push(["prepared original/null, A and B reservations and finalization consume only their exact authority", async () => {
  const f = await fixture(4); await f.work("front", { orderedQuantity: 4, producedQuantity: 4 }); await f.handoff(1);
  const a = await f.replacement(2), b = await f.replacement(3);
  await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a); await f.work("front", { orderedQuantity: 3, producedQuantity: 3 }, b); await f.handoff(1, a);
  const shipment = await prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1 },
    { orderId: f.orderId, orderLineId: f.lineId, quantity: 1, replacementObligationId: a },
    { orderId: f.orderId, orderLineId: f.lineId, quantity: 2, replacementObligationId: b }]);
  assert.deepEqual([(await tx.readAvailability(org, f.orderId))?.availability[0].reservedShipmentQuantity, (await workspace.get(org, f.orderId))?.lines[0].availableFulfillmentQuantity], [1, 2]);
  assert.deepEqual([(await projection(f.orderId, a)).reservedShipmentQuantity, (await projection(f.orderId, a)).availableFulfillmentQuantity], [1, 0]);
  assert.deepEqual([(await projection(f.orderId, b)).reservedShipmentQuantity, (await projection(f.orderId, b)).availableFulfillmentQuantity], [2, 1]);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, a))?.availableFulfillmentQuantity, 0);
  assert.equal((await tx.lockReplacementAvailability(org, f.orderId, b))?.availableFulfillmentQuantity, 1);
  const unavailable = await fulfillment.recordPickup(context("reserved-a"), { businessRequestId: "reserved-a", orderId: f.orderId, replacementObligationId: a, allocations: [{ orderLineId: f.lineId, quantity: 1 }] });
  assert.equal(unavailable.ok, false, "direct replacement pickup cannot consume prepared A supply");
  await assert.rejects(prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 3 }]), /currently available output/);
  await assert.rejects(prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 2, replacementObligationId: b }]), /accepted-good authority/);
  const finalized = await shipping(transaction => transaction.finalizePrepared({ organizationId: org, shipmentId: shipment.shipmentId,
    expectedPreparedRevisionId: shipment.currentPreparedRevision!.revisionId, principalKind: "staff", principalSubject: "m5-user" }));
  assert.equal(finalized?.status, "shipped");
  const original = (await workspace.get(org, f.orderId))!;
  assert.deepEqual([original.lines[0].completedPickupQuantity, original.lines[0].completedShipmentQuantity, original.lines[0].completedFulfillmentQuantity], [1, 1, 2]);
  assert.equal(original.handoffs.filter(item => item.shipment?.shipmentId === shipment.shipmentId).length, 3);
  assert.deepEqual(original.handoffs.filter(item => item.shipment?.shipmentId === shipment.shipmentId).map(item => item.handoff.replacementObligationId ?? "original").sort(), [a, b, "original"].sort());
  assert.equal((await projection(f.orderId, a)).remainingFulfillmentQuantity, 0);
  assert.equal((await projection(f.orderId, b)).remainingFulfillmentQuantity, 1);
  assert.equal((await new PostgresFulfillmentCompletionProjection(client).readCompletion(org, f.lineId)).completedQuantity, 2);
}]);
cases.push(["correction and void release only current reservations without rewriting earlier revisions", async () => {
  const f = await fixture(4); await f.work("front", { orderedQuantity: 4, producedQuantity: 4 });
  const a = await f.replacement(2), b = await f.replacement(3); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a); await f.work("front", { orderedQuantity: 3, producedQuantity: 3 }, b);
  const sa = await prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1, replacementObligationId: a }]);
  await prepare([{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1, replacementObligationId: b }]);
  const corrected = await shipping(transaction => transaction.correctPrepared({ organizationId: org, shipmentId: sa.shipmentId,
    carrier: { status: "prepared" }, allocations: [{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1 }], correctionReason: "Synthetic authority correction",
    principalKind: "staff", principalSubject: "m5-user" }));
  assert.equal((await projection(f.orderId, a)).availableFulfillmentQuantity, 2);
  assert.equal((await projection(f.orderId, b)).availableFulfillmentQuantity, 2);
  assert.equal((await tx.readAvailability(org, f.orderId))?.availability[0].availableFulfillmentQuantity, 3);
  await shipping(transaction => transaction.voidPrepared({ organizationId: org, shipmentId: sa.shipmentId, reason: "Synthetic void", principalKind: "staff", principalSubject: "m5-user" }));
  assert.equal((await workspace.get(org, f.orderId))?.lines[0].availableFulfillmentQuantity, 4);
  assert.equal((await projection(f.orderId, b)).availableFulfillmentQuantity, 2);
  assert.deepEqual((await db.query("SELECT replacement_obligation_id,quantity FROM v2_fulfillment_shipment_prepared_revision_lines WHERE organization_id=$1 AND shipment_id=$2 ORDER BY replacement_obligation_id NULLS FIRST", [org, sa.shipmentId])).rows,
    [{ replacement_obligation_id: null, quantity: 1 }, { replacement_obligation_id: a, quantity: 1 }]);
  assert.equal(await shipping(transaction => transaction.finalizePrepared({ organizationId: org, shipmentId: sa.shipmentId,
    expectedPreparedRevisionId: corrected!.currentPreparedRevision!.revisionId, principalKind: "staff", principalSubject: "m5-user" })), null);
}]);
cases.push(["tenant, Order and OrderLine scope failures never consume another obligation", async () => {
  const f = await fixture(), other = await fixture(); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }); await other.work("front", { orderedQuantity: 2, producedQuantity: 2 });
  const a = await f.replacement(2); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a);
  assert.equal(await tx.lockReplacementAvailability(foreignOrg, f.orderId, a), null);
  assert.equal(await tx.lockReplacementAvailability(org, other.orderId, a), null);
  assert.equal(await workspace.get(foreignOrg, f.orderId), null);
  const wrongTenant = await fulfillment.recordPickup(context("foreign-pickup", foreignOrg), { businessRequestId: "foreign-pickup", orderId: f.orderId, replacementObligationId: a, allocations: [{ orderLineId: f.lineId, quantity: 1 }] });
  assert.equal(wrongTenant.ok, false);
  const wrongLine = await fulfillment.recordPickup(context("wrong-line"), { businessRequestId: "wrong-line", orderId: other.orderId, replacementObligationId: a, allocations: [{ orderLineId: other.lineId, quantity: 1 }] });
  assert.equal(wrongLine.ok, false);
  await assert.rejects(prepare([{ orderId: other.orderId, orderLineId: other.lineId, quantity: 1, replacementObligationId: a }]), /authority is unavailable/);
  await assert.rejects(shipping(transaction => transaction.createPrepared({ id: `m5-foreign-shipment-${++sequence}`, organizationId: foreignOrg,
    carrier: { status: "prepared" }, allocations: [{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1, replacementObligationId: a }], principalKind: "staff", principalSubject: "m5-user" })), /active Order/);
  assert.equal((await projection(f.orderId, a)).availableFulfillmentQuantity, 2);
  assert.equal((await db.query("SELECT count(*)::integer n FROM v2_fulfillment_handoffs WHERE order_document_id=ANY($1::text[])", [[f.orderId, other.orderId]])).rows[0].n, 0);
}]);
cases.push(["no-charge source/replay/pickup preserves all original financial and physical history and Sales closes", async () => {
  const f = await fixture(); const originalWork = await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }), source = await f.handoff(2); await settleOriginal(f);
  const finance = await financialHistory(f.orderId);
  const history = (await db.query("SELECT to_jsonb(w) work,(SELECT jsonb_agg(to_jsonb(a)) FROM v2_production_attempts a WHERE a.production_work_id=w.id) attempts FROM v2_production_works w WHERE w.id=$1", [originalWork])).rows;
  await lifecycle.reconcileOrder(org, f.orderId);
  assert.equal((await workspace.get(org, f.orderId))?.commercialState, "completed");
  const input = { businessRequestId: "no-charge-create", orderId: f.orderId, orderLineId: f.lineId, sourceFulfillmentHandoffId: brandedId<"FulfillmentHandoffId">(source),
    replacementQuantity: 1, reason: "print_defect" as const, responsibility: "titan" as const, billingTreatment: "no_charge" as const };
  const created = await replacements.create(context(input.businessRequestId), input);
  assert.ok(created.ok, created.ok ? "" : created.error.publicMessage);
  const replay = await replacements.create(context(input.businessRequestId), input);
  assert.deepEqual(replay, created);
  assert.equal((await workspace.get(org, f.orderId))?.commercialState, "open");
  assert.equal(created.value.obligation.successorProductionWorkIds.length, 1);
  assert.equal(created.value.billingInvoice, undefined);
  const replacementId = created.value.obligation.replacementObligationId, successor = created.value.obligation.successorProductionWorkIds[0];
  await db.query("INSERT INTO v2_production_attempts VALUES($1,$2,$3,1,now())", [`${successor}-attempt`, org, successor]);
  const pickupInput = { businessRequestId: "no-charge-pickup", orderId: f.orderId, replacementObligationId: replacementId, allocations: [{ orderLineId: f.lineId, quantity: 1 }] };
  const first = await fulfillment.recordPickup(context(pickupInput.businessRequestId), pickupInput);
  assert.ok(first.ok, first.ok ? "" : first.error.publicMessage);
  const repeated = await fulfillment.recordPickup(context(pickupInput.businessRequestId), pickupInput);
  assert.deepEqual(repeated, first, "repeat pickup request replays without creating another immutable handoff");
  assert.equal(first.value.handoff.replacementObligationId, replacementId);
  assert.equal(first.value.availability[0].completedPickupQuantity, 2);
  assert.equal((await projection(f.orderId, replacementId)).obligation.status, "fulfilled");
  assert.equal((await workspace.get(org, f.orderId))?.commercialState, "completed", "existing Sales reconciliation closes paid original plus completed no-charge replacement");
  assert.equal((await db.query("SELECT count(*)::integer n FROM v2_fulfillment_handoffs WHERE organization_id=$1 AND replacement_obligation_id=$2", [org, replacementId])).rows[0].n, 1);
  assert.deepEqual(await financialHistory(f.orderId), finance);
  assert.deepEqual((await db.query("SELECT to_jsonb(w) work,(SELECT jsonb_agg(to_jsonb(a)) FROM v2_production_attempts a WHERE a.production_work_id=w.id) attempts FROM v2_production_works w WHERE w.id=$1", [originalWork])).rows, history);
  await assert.rejects(db.query("UPDATE v2_fulfillment_handoffs SET handoff_method='shipment' WHERE id=$1", [source]), error => (error as { code: string }).code === "23514");
}]);
cases.push(["P2 actual application locks and gates mixed/removal scope, replays exact bounded history without effects", async () => {
  const f = await fixture(4); await f.work("front", { orderedQuantity: 4, producedQuantity: 4 });
  const a = await f.replacement(2); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }, a);
  const reconciled: string[] = [];
  const service = new ShipmentContainerApplicationService(new PostgresShipmentContainerRunner(pool), undefined,
    { reconcileOrder: async (_org, orderId) => { reconciled.push(orderId); }, reconcileInvoice: async () => undefined });
  const caller = (id: string, replace = false, organizationId = org): OperationContext => ({ ...context(id, organizationId),
    principal: { kind: "staff", organizationId, userId: "m5-user", authority: { membershipId: "m5-membership", capabilities: replace ? ["fulfillment.ship", "fulfillment.replace"] : ["fulfillment.ship"] } } });
  const accepted = <T>(result: ApplicationResult<T>) => { assert.ok(result.ok, result.ok ? "" : result.error.publicMessage); return result.value; };
  const denied = (result: ApplicationResult<unknown>, code = "FORBIDDEN") => { assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, code); };
  const noDomainWork = (start: number, replay = false) => {
    const calls = statements.slice(start);
    assert.ok(!calls.some(text => /^(INSERT INTO|UPDATE|DELETE FROM)\s+v2_(?!operation_requests)/i.test(text.trim())), "no shipment, revision, event or handoff writes");
    assert.ok(!calls.some(text => /WITH production_output|v2_usable_production_good_quantity|FROM v2_order_replacement_obligations|SELECT line\.(order_line_id|replacement_obligation_id)/.test(text)), "no availability or reservation checks");
    if (replay) assert.ok(!calls.some(text => /^(INSERT INTO|UPDATE|DELETE FROM)\s/i.test(text.trim())), "replay performs no writes, including the request ledger");
  };
  const original = { orderId: f.orderId, orderLineId: f.lineId, quantity: 1 }, replacement = { ...original, replacementObligationId: a };
  const prepareInput = { allocations: [original, replacement] };
  let start = statements.length;
  denied(await service.createPrepared(caller("p2-prepare"), prepareInput)); noDomainWork(start);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal((await db.query("SELECT count(*)::integer n FROM v2_operation_requests WHERE business_request_id='p2-prepare'")).rows[0].n, 0, "denied creation leaves no request or domain write committed");
  const prepared = accepted(await service.createPrepared(caller("p2-prepare", true), prepareInput));
  const correction = { shipmentId: prepared.shipmentId, allocations: [original], reason: "Remove replacement allocation" };
  for (const run of [
    () => service.correctPrepared(caller("p2-remove-denied"), correction),
    () => service.finalize(caller("p2-final-denied"), { shipmentId: prepared.shipmentId, expectedPreparedRevisionId: prepared.preparedRevisionId! }),
    () => service.voidPrepared(caller("p2-void-denied"), { shipmentId: prepared.shipmentId, reason: "Cancel" }),
  ]) {
    start = statements.length; denied(await run()); noDomainWork(start);
    const calls = statements.slice(start), lockAt = calls.findIndex(text => text.startsWith("SELECT * FROM v2_fulfillment_shipments") && text.endsWith("FOR UPDATE"));
    const scopeAt = calls.findIndex(text => text.includes("FROM v2_fulfillment_shipment_prepared_revisions"));
    assert.ok(lockAt >= 0 && scopeAt > lockAt, "actual SQL locks the container before reading allocation authority");
    assert.equal(calls.at(-1), "ROLLBACK", "the same runner client retains its lock through the denied decision");
  }
  denied(await service.correctPrepared(caller("p2-wrong-tenant", true, foreignOrg), correction), "CONFLICT");
  const removed = accepted(await service.correctPrepared(caller("p2-remove", true), correction));
  start = statements.length; denied(await service.correctPrepared(caller("p2-remove"), correction)); noDomainWork(start, true);
  start = statements.length; assert.deepEqual(accepted(await service.correctPrepared(caller("p2-remove", true), correction)), removed); noDomainWork(start, true);
  const laterInput = { ...correction, reason: "New original-only correction" };
  const later = accepted(await service.correctPrepared(caller("p2-later"), laterInput));
  accepted(await service.correctPrepared(caller("p2-add-again", true), { ...correction, allocations: [replacement], reason: "Later replacement" }));
  start = statements.length; assert.deepEqual(accepted(await service.correctPrepared(caller("p2-later"), laterInput)), later); noDomainWork(start, true);
  start = statements.length; denied(await service.correctPrepared(caller("p2-remove"), correction)); noDomainWork(start, true);
  start = statements.length; assert.deepEqual(accepted(await service.correctPrepared(caller("p2-remove", true), correction)), removed); noDomainWork(start, true);
  denied(await service.correctPrepared(caller("p2-remove", true), { ...correction, reason: "Different payload" }), "IDEMPOTENCY_CONFLICT");
  denied(await service.createPrepared(caller("p2-prepare", true), { allocations: [original] }), "IDEMPOTENCY_CONFLICT");
  const finalRevision = accepted(await service.correctPrepared(caller("p2-remove-again", true), { ...correction, reason: "Remove later replacement" }));
  const finalizeInput = { shipmentId: prepared.shipmentId, expectedPreparedRevisionId: finalRevision.preparedRevisionId! };
  const finalized = accepted(await service.finalize(caller("p2-final"), finalizeInput));
  assert.equal(finalized.status, "shipped"); assert.deepEqual(reconciled, [f.orderId]);
  start = statements.length; assert.deepEqual(accepted(await service.finalize(caller("p2-final"), finalizeInput)), finalized); noDomainWork(start, true);
   assert.deepEqual(reconciled, [f.orderId,f.orderId], "exact replay repairs postcommit lifecycle interruption without new handoffs");
  start = statements.length; denied(await service.createPrepared(caller("p2-prepare"), prepareInput)); noDomainWork(start, true);
  start = statements.length; assert.deepEqual(accepted(await service.createPrepared(caller("p2-prepare", true), prepareInput)), prepared); noDomainWork(start, true);
  assert.deepEqual(await shipping(transaction => transaction.getPreparedRevision(org, prepared.shipmentId, prepared.preparedRevisionId!)), prepared.currentPreparedRevision);
  for (const [scopeOrg, scopeShipment, scopeRevision] of [[foreignOrg, prepared.shipmentId, prepared.preparedRevisionId!], [org, "foreign-shipment", prepared.preparedRevisionId!], [org, prepared.shipmentId, "missing-revision"]] as const) {
    assert.equal(await shipping(transaction => transaction.getPreparedRevision(scopeOrg, scopeShipment, scopeRevision)), null, "historical owner read scopes tenant, shipment and revision");
  }
  // Simulate unavailable evidence at the client seam, never delete immutable DB history.
  const missingEvidencePool = { connect: async () => {
    const connection = await pool.connect();
    return { release: () => connection.release(), query: async (text: string, params?: unknown[]) =>
      text.includes("FROM v2_fulfillment_shipment_prepared_revisions") && params?.[2] === prepared.preparedRevisionId ? { rows: [] } : connection.query(text, params) };
  } } as unknown as Pool;
  const missingEvidence = new ShipmentContainerApplicationService(new PostgresShipmentContainerRunner(missingEvidencePool));
  start = statements.length; denied(await missingEvidence.correctPrepared(caller("p2-remove", true), correction), "CONFLICT"); noDomainWork(start, true);
}]);
cases.push(["P2 replacement terminal replays reauthorize while original-only and resumed prepare remain supported", async () => {
  for (const terminal of ["finalize", "void"] as const) for (const replace of [false, true]) {
    const f = await fixture(2); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 });
    const a = await f.replacement(1); await f.work("front", { orderedQuantity: 1, producedQuantity: 1 }, a);
    const service = new ShipmentContainerApplicationService(new PostgresShipmentContainerRunner(pool));
    const id = `p2-${terminal}-${replace}`, full = context(id), shipOnly = { ...full, principal: { kind: "staff" as const, organizationId: org, userId: "m5-user", authority: { membershipId: "membership", capabilities: ["fulfillment.ship" as const] } } };
    const prepareInput = { allocations: [{ orderId: f.orderId, orderLineId: f.lineId, quantity: 1, ...(replace ? { replacementObligationId: a } : {}) }] };
    // A failed request from an earlier caller resumes under the current caller's grants.
    await shipping(async transaction => {
      const { createHash } = await import("node:crypto");
      const { canonicalJson } = await import("../../src/modules/shared/commercialValues.js");
      const reserved = await transaction.reserve({ organizationId: org, operation: "fulfillment.shipment-container.prepare.v1", businessRequestId: id,
        payloadFingerprint: `sha256:${createHash("sha256").update(canonicalJson(prepareInput)).digest("hex")}`, principalKind: "staff", principalSubject: "m5-user" });
      await query("UPDATE v2_operation_requests SET status='retryable_failure' WHERE id=$1", [reserved.request.id]);
    });
    if (replace) {
      const denied = await service.createPrepared(shipOnly, prepareInput); assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, "FORBIDDEN");
    }
    const prepared = await service.createPrepared(replace ? full : shipOnly, prepareInput); assert.ok(prepared.ok);
    const run = (caller: OperationContext) => terminal === "finalize"
      ? service.finalize(caller, { shipmentId: prepared.value.shipmentId, expectedPreparedRevisionId: prepared.value.preparedRevisionId! })
      : service.voidPrepared(caller, { shipmentId: prepared.value.shipmentId, reason: "Cancel" });
    const first = await run(replace ? full : shipOnly); assert.ok(first.ok, first.ok ? "" : first.error.publicMessage);
    if (replace) { const denied = await run(shipOnly); assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, "FORBIDDEN"); }
    const start = statements.length; assert.deepEqual(await run(replace ? full : shipOnly), first);
    assert.ok(statements.slice(start).every(text => !/^(INSERT INTO|UPDATE|DELETE FROM)\s/i.test(text.trim())), "actual terminal replay performs no writes");
    assert.ok(statements.slice(start).every(text => !/v2_usable_production_good_quantity|FROM v2_order_replacement_obligations/.test(text)), "terminal replay does not recheck availability");
  }
}]);
cases.push(["billable quantity1 uses frozen875 cents through existing Billing owner and creates ORD-1019-B", async () => {
  const f = await fixture(); await f.work("front", { orderedQuantity: 2, producedQuantity: 2 }); await f.handoff(2); await settleOriginal(f);
  const before = await financialHistory(f.orderId), start = statements.length;
  const input = { businessRequestId: "billable-create", orderId: f.orderId, orderLineId: f.lineId, replacementQuantity: 1,
    reason: "customer_change" as const, responsibility: "customer" as const, billingTreatment: "billable" as const };
  const created = await replacements.create(context(input.businessRequestId), input);
  assert.ok(created.ok, created.ok ? "" : created.error.publicMessage);
  assert.equal(created.value.billingInvoice?.invoiceNumber, "ORD-1019-B");
  assert.equal(created.value.billingInvoice?.totalCents, 875);
  assert.equal(created.value.billingInvoice?.lifecycle, "draft");
  const repeated = await createOrReadReplacementInvoice(client, { organizationId: org, orderId: f.orderId, orderLineId: f.lineId,
    replacementObligationId: created.value.obligation.replacementObligationId, replacementQuantity: 1 });
  assert.equal(repeated.invoiceId, created.value.billingInvoice?.invoiceId);
  const billingSource = statements.slice(start).filter(text => /FROM v2_billing_invoices i\s+JOIN v2_billing_invoice_lines line/.test(text));
  assert.equal(billingSource.length, 1, "existing Billing owner reads the single canonical issued base Invoice");
  assert.doesNotMatch(billingSource[0], /\b(?:FROM|JOIN)\s+(?:products|v2_products|v2_product_\w*|pbv2_tree_versions|v2_pricing_\w*)\b/i, "Billing prices from frozen Sales evidence, not Product/Pricing configuration");
  assert.ok(statements.slice(start).every(text => !/\b(?:FROM|JOIN)\s+(?:products|v2_products|v2_product_\w*|v2_pricing_\w*)\b/i.test(text)), "coordination adds no Product/Pricing runtime calls; Sales may still read its existing frozen workflow fallback");
  assert.deepEqual(await financialHistory(f.orderId), before);
  assert.deepEqual((await db.query("SELECT quantity,selling_unit_cents::text unit,selling_line_cents::text total,sales_pricing_evidence_fingerprint FROM v2_billing_invoice_lines WHERE invoice_id=$1", [repeated.invoiceId])).rows,
    [{ quantity: 1, unit: "875", total: "875", sales_pricing_evidence_fingerprint: "frozen-m5-price" }]);
}]);

cases.push(["FUL26 durable admission, timeout after commit, tab/session loss and fresh scoped receipt recovery",async()=>{
  const f=await fixture(4);await f.work("front",{orderedQuantity:4,producedQuantity:4});
  const recovery=new PostgresPhysicalOperationRecovery(pool),id="l0-pickup-unknown",input={businessRequestId:id,orderId:f.orderId,allocations:[{orderLineId:f.lineId,quantity:1}]};
  const admitted=await recovery.admit(context(id),{businessRequestId:id,operation:"fulfillment.pickup.complete.v1",input});assert.ok(admitted.ok);assert.equal(admitted.value.status,"pending");
  const different={...context("fresh-read"),principal:{...context().principal,userId:"another-user"}} as OperationContext;
  const before=await recovery.discover(different);assert.ok(before.ok);const hidden=before.value.find(item=>item.businessRequestId===id)!;assert.equal(hidden.status,"pending");assert.equal(hidden.input,undefined,"another actor never receives admitted payload");
  const secondInput={...input,businessRequestId:"l0-blind-second"};const second=await fulfillment.recordPickup(context(secondInput.businessRequestId),secondInput);assert.equal(second.ok,false,"fresh ID cannot bypass unresolved physical authority");
  const lost=new FulfillmentApplicationService(new PostgresFulfillmentTransactionRunner(pool),undefined,{reconcileOrder:async()=>{throw Error("timeout after committed owner result");},reconcileInvoice:async()=>undefined});
  const unknown=await lost.recordPickup(context(id),input);assert.equal(unknown.ok,false);
  const receipt=await recovery.discover(context("new-session-read"));assert.ok(receipt.ok);const exact=receipt.value.find(item=>item.businessRequestId===id)!;assert.equal(exact.status,"succeeded");assert.equal(exact.input,undefined);assert.equal((exact.result as any).allocations[0].quantity,1);
  const other=await recovery.discover(different);assert.ok(other.ok);assert.deepEqual(other.value.find(item=>item.businessRequestId===id)?.result,exact.result,"fresh authorized read can recover historical domain result without original actor's submitted payload");
  const denied={...context("revoked"),principal:{...context().principal,authority:{membershipId:"m",capabilities:[]}}} as OperationContext;assert.equal((await recovery.discover(denied)).ok,false);
  const foreign=await recovery.discover(context("foreign",foreignOrg));assert.ok(foreign.ok);assert.equal(foreign.value.length,0);
  const retry=await fulfillment.recordPickup(context(id),input);assert.ok(retry.ok);assert.deepEqual(retry.value,exact.result);assert.equal((await db.query("SELECT COUNT(*)::integer n FROM v2_fulfillment_handoffs WHERE organization_id=$1 AND order_document_id=$2",[org,f.orderId])).rows[0].n,1);
  assert.equal((await fulfillment.recordPickup(context(id),{...input,allocations:[{orderLineId:f.lineId,quantity:2}]})).ok,false,"same identity cannot change quantity");
}]);
cases.push(["FUL26 explicit withdrawal proof prevents late execution; replacement and original admissions remain authority-isolated",async()=>{
  const f=await fixture(3);await f.work("front",{orderedQuantity:3,producedQuantity:3});const a=await f.replacement(1),b=await f.replacement(1);await f.work("front",{orderedQuantity:1,producedQuantity:1},a);await f.work("front",{orderedQuantity:1,producedQuantity:1},b);
  const recovery=new PostgresPhysicalOperationRecovery(pool),id="l0-replacement-pending",input={businessRequestId:id,orderId:f.orderId,replacementObligationId:a,allocations:[{orderLineId:f.lineId,quantity:1}]};
  assert.ok((await recovery.admit(context(id),{businessRequestId:id,operation:"fulfillment.pickup.complete.v1",input})).ok);
  const originalId="l0-original-independent",original={businessRequestId:originalId,orderId:f.orderId,allocations:[{orderLineId:f.lineId,quantity:1}]};assert.ok((await fulfillment.recordPickup(context(originalId),original)).ok,"replacement admission cannot consume original authority");
  const siblingId="l0-sibling-independent",sibling={...input,businessRequestId:siblingId,replacementObligationId:b};assert.ok((await fulfillment.recordPickup(context(siblingId),sibling)).ok);
  const noReplace={...context("no-replace"),principal:{...context().principal,authority:{membershipId:"m",capabilities:["fulfillment.view","fulfillment.pickup"]}}} as OperationContext;
  const hidden=await recovery.discover(noReplace);assert.ok(hidden.ok);assert.ok(!hidden.value.some(item=>item.businessRequestId===id));
  const otherOperator={...context(id),principal:{...context().principal,userId:"replacement-withdrawing-operator"}} as OperationContext;
  const resolved=await recovery.withdraw(otherOperator,"fulfillment.pickup.complete.v1",id);assert.ok(resolved.ok);assert.equal(resolved.value.status,"withdrawn");assert.equal(resolved.value.input,undefined);
  const proof=(await db.query<{initiated_principal_subject:string;result_json:any}>("SELECT initiated_principal_subject,result_json FROM v2_operation_requests WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3",[org,"fulfillment.physical-intent.withdraw.v1:fulfillment.pickup.complete.v1",id])).rows[0];assert.equal(proof.initiated_principal_subject,"replacement-withdrawing-operator","positive withdrawal receipt attributes the actual fresh operator, not the admitting actor");assert.deepEqual(proof.result_json,{organizationId:org,operation:"fulfillment.pickup.complete.v1",businessRequestId:id,status:"withdrawn",submittedPayloadFingerprint:`sha256:${createHash("sha256").update(canonicalJson(input)).digest("hex")}`});assert.equal(resolved.value.submittedPayloadFingerprint,proof.result_json.submittedPayloadFingerprint);
  const late=await fulfillment.recordPickup(context(id),input);assert.equal(late.ok,false,"explicit durable withdrawal fences a late same-key request without declaring an unknown mutation failed");
  assert.equal((await db.query("SELECT COUNT(*)::integer n FROM v2_fulfillment_handoffs WHERE organization_id=$1 AND replacement_obligation_id=$2",[org,a])).rows[0].n,0);
  const nextId="l0-replacement-next",next={...input,businessRequestId:nextId};assert.ok((await fulfillment.recordPickup(context(nextId),next)).ok,"explicit resolved/new intent can use remaining replacement output");
}]);
cases.push(["FUL26 Shipment prepare/correction/finalize exact receipts survive unknown response and preserve historical replacement authority",async()=>{
  const f=await fixture(4);await f.work("front",{orderedQuantity:4,producedQuantity:4});const a=await f.replacement(1);await f.work("front",{orderedQuantity:1,producedQuantity:1},a);
  const recovery=new PostgresPhysicalOperationRecovery(pool),runner=new PostgresShipmentContainerRunner(pool),service=new ShipmentContainerApplicationService(runner);
  const prepareId="l0-admitted-prepare",input={allocations:[{orderId:f.orderId,orderLineId:f.lineId,quantity:1},{orderId:f.orderId,orderLineId:f.lineId,quantity:1,replacementObligationId:a}]};
  assert.ok((await recovery.admit(context(prepareId),{businessRequestId:prepareId,operation:"fulfillment.shipment-container.prepare.v1",input})).ok);
  const prepared=await service.createPrepared(context(prepareId),input);assert.ok(prepared.ok);
  const correctionId="l0-admitted-correction",correction={shipmentId:prepared.value.shipmentId,allocations:[input.allocations[0]],reason:"Remove replacement from this exact shipment"};
  assert.ok((await recovery.admit(context(correctionId),{businessRequestId:correctionId,operation:"fulfillment.shipment-container.correct.v1",input:correction})).ok);
  const lost=new ShipmentContainerApplicationService({transaction:async work=>{await runner.transaction(work);throw new V2ApplicationError("INTERNAL_ERROR","Response lost after commit");}});
  assert.equal((await lost.correctPrepared(context(correctionId),correction)).ok,false);
  const discovered=await recovery.discover(context("l0-correction-read"));assert.ok(discovered.ok,discovered.ok?"":discovered.error.publicMessage);const exact=discovered.value.find(item=>item.businessRequestId===correctionId)!;assert.equal(exact.status,"succeeded");assert.equal((exact.result as any).currentPreparedRevision.allocations.length,1);
  const shipOnly={...context("l0-historical-revoked"),principal:{...context().principal,authority:{membershipId:"m",capabilities:["fulfillment.ship","fulfillment.view"]}}} as OperationContext;
  const redacted=await recovery.discover(shipOnly);assert.ok(redacted.ok);assert.ok(!redacted.value.some(item=>item.businessRequestId===correctionId),"removed replacement still requires fresh replacement history authority");
  const deniedReceipt=await recovery.receipt(shipOnly,"fulfillment.shipment-container.correct.v1",correctionId);assert.equal(deniedReceipt.ok,false,"exact receipt lookup retains replacement-removal authorization after the original-only result");
  const anotherReader={...context("fresh-authorized-correction-reader"),principal:{...context().principal,userId:"correction-history-reader"}} as OperationContext;
  const approvedReceipt=await recovery.receipt(anotherReader,"fulfillment.shipment-container.correct.v1",correctionId);assert.ok(approvedReceipt.ok);assert.deepEqual(approvedReceipt.value.result,exact.result,"fresh authorized different actor reads the same canonical result");
  assert.equal((await service.correctPrepared({...shipOnly,businessRequest:context(correctionId).businessRequest},correction)).ok,false,"saved correction replay retains Wave1 prior scope gate");
  const finalId="l0-admitted-finalize",finalInput={shipmentId:prepared.value.shipmentId,expectedPreparedRevisionId:(exact.result as any).preparedRevisionId};
  assert.ok((await recovery.admit(context(finalId),{businessRequestId:finalId,operation:"fulfillment.shipment-container.finalize.v1",input:finalInput})).ok);
  assert.equal((await lost.finalize(context(finalId),finalInput)).ok,false);
  const terminal=await recovery.discover(context("l0-final-read"));assert.ok(terminal.ok);const shipment=terminal.value.find(item=>item.businessRequestId===finalId)!;assert.equal((shipment.result as any).status,"shipped");
  const replay=await service.finalize(context(finalId),finalInput);assert.ok(replay.ok);assert.deepEqual(replay.value,shipment.result);
  assert.equal((await db.query("SELECT COUNT(*)::integer n FROM v2_fulfillment_shipment_handoffs WHERE organization_id=$1 AND shipment_id=$2",[org,prepared.value.shipmentId])).rows[0].n,1,"recovery/replay materializes no second handoff");
  assert.equal((await projection(f.orderId,a)).remainingFulfillmentQuantity,1,"removed replacement output remains separately usable");
}]);
cases.push(["FUL26 receipt identity is tenant/operation/request, not actor; distinct operations may share a business request",async()=>{
  const f=await fixture(4);await f.work("front",{orderedQuantity:4,producedQuantity:4});
  const recovery=new PostgresPhysicalOperationRecovery(pool),id="l0-shared-business-identity",input={businessRequestId:id,orderId:f.orderId,allocations:[{orderLineId:f.lineId,quantity:1}]};
  const first=await recovery.admit(context(id),{businessRequestId:id,operation:"fulfillment.pickup.complete.v1",input});assert.ok(first.ok);
  await db.query("INSERT INTO users VALUES('fresh-second-operator')");
  const another={...context(id),principal:{...context().principal,userId:"fresh-second-operator"}} as OperationContext;
  const pending=await recovery.receipt(another,"fulfillment.pickup.complete.v1",id);assert.ok(pending.ok);assert.equal(pending.value.organizationId,org);assert.equal(pending.value.input,undefined,"another actor's pending body stays private without changing receipt identity");
  const adopted=await recovery.admit(another,{businessRequestId:id,operation:"fulfillment.pickup.complete.v1",input});assert.ok(adopted.ok);assert.equal(adopted.value.status,"pending");assert.equal(adopted.value.input,undefined);
  const picked=await fulfillment.recordPickup(another,input);assert.ok(picked.ok,picked.ok?"":`freshly authorized actor can execute the independently known exact admitted command: ${picked.error.publicMessage}`);assert.equal(picked.value.handoff.completedPrincipalSubject,"fresh-second-operator");
  const shipAdmit=await recovery.admit(context(id),{businessRequestId:id,operation:"fulfillment.shipment.complete.v1",input});assert.ok(shipAdmit.ok,"admission identity includes operation, so the same business ID is not conflated");
  const shipped=await fulfillment.recordShipment(context(id),input);assert.ok(shipped.ok);
  const pickupReceipt=await recovery.receipt(context("read-pickup"),"fulfillment.pickup.complete.v1",id),shipmentReceipt=await recovery.receipt(another,"fulfillment.shipment.complete.v1",id);assert.ok(pickupReceipt.ok);assert.ok(shipmentReceipt.ok);assert.deepEqual(pickupReceipt.value.result,picked.value);assert.deepEqual(shipmentReceipt.value.result,shipped.value);assert.notEqual(picked.value.handoff.handoffId,shipped.value.handoff.handoffId);
  assert.equal((await recovery.receipt(another,"fulfillment.shipment-container.void.v1",id)).ok,false,"another operation's receipt is not a match");
  assert.equal((await recovery.receipt(context("wrong-tenant",foreignOrg),"fulfillment.pickup.complete.v1",id)).ok,false);
  assert.equal((await recovery.withdraw(context(id),"fulfillment.shipment-container.void.v1",id)).ok,false,"missing admission must not be converted into a failed mutation receipt");
  const success=await recovery.withdraw(another,"fulfillment.pickup.complete.v1",id);assert.ok(success.ok);assert.equal(success.value.status,"succeeded","withdrawal cannot rewrite a committed result");assert.deepEqual(success.value.result,picked.value);
  assert.ok((await fulfillment.recordPickup(context(id),input)).ok);assert.ok((await fulfillment.recordShipment(another,input)).ok);
  assert.equal((await db.query("SELECT COUNT(*)::integer n FROM v2_fulfillment_handoffs WHERE organization_id=$1 AND order_document_id=$2",[org,f.orderId])).rows[0].n,2,"cross-actor exact replay materializes no additional physical result");
  const revoked={...another,principal:{...another.principal,authority:{membershipId:"m",capabilities:[]}}} as OperationContext;assert.equal((await recovery.receipt(revoked,"fulfillment.pickup.complete.v1",id)).ok,false);assert.equal((await fulfillment.recordShipment(revoked,input)).ok,false);
}]);
cases.push(["FUL11 actual Customer/custom source, immutable prepare/correction/handoff sender and blind historical document",async()=>{
  const f=await fixture(3);await f.work("front",{orderedQuantity:3,producedQuantity:3});
  await db.query("UPDATE customers SET company_name='Ordering Customer',blind_shipping=true,billing_street1='Original Return Address' WHERE organization_id=$1 AND id='m5-customer'",[org]);
  const service=new ShipmentContainerApplicationService(new PostgresShipmentContainerRunner(pool)),input={allocations:[{orderId:f.orderId,orderLineId:f.lineId,quantity:1}]};
  const prepared=await service.createPrepared(context("l0-sender-default"),input);assert.ok(prepared.ok,prepared.ok?"":prepared.error.publicMessage);const frozen=prepared.value.currentPreparedRevision!.senderSnapshot!;assert.equal(frozen.blindShipping,true);assert.equal(frozen.source,"customer");assert.equal(frozen.sender?.addressLine1,"Original Return Address");
  await db.query("UPDATE customers SET company_name='Changed Customer',billing_street1='Changed Return Address' WHERE organization_id=$1 AND id='m5-customer'",[org]);
  const corrected=await service.correctPrepared(context("l0-sender-carrier-correction"),{shipmentId:prepared.value.shipmentId,allocations:input.allocations,carrier:{carrierName:"Manual"},reason:"Carrier correction only"});assert.ok(corrected.ok);assert.deepEqual(corrected.value.currentPreparedRevision?.senderSnapshot,frozen,"carrier-only correction preserves frozen sender instead of rebinding mutable CRM");
  const finalized=await service.finalize(context("l0-sender-final"),{shipmentId:prepared.value.shipmentId,expectedPreparedRevisionId:corrected.value.preparedRevisionId!});assert.ok(finalized.ok);
  await assert.rejects(db.query("UPDATE v2_fulfillment_shipment_prepared_revisions SET sender_snapshot='{}'::jsonb WHERE organization_id=$1 AND id=$2",[org,corrected.value.preparedRevisionId]),error=>(error as {code:string}).code==="23514","sender identity cannot be rewritten after preparation");
  const snapshot=(await db.query<{handoff_id:string;snapshot:any}>("SELECT s.handoff_id,s.snapshot FROM v2_fulfillment_handoff_document_snapshots s JOIN v2_fulfillment_shipment_handoffs h ON h.organization_id=s.organization_id AND h.handoff_id=s.handoff_id WHERE h.organization_id=$1 AND h.shipment_id=$2",[org,prepared.value.shipmentId])).rows[0];assert.deepEqual(snapshot.snapshot.senderSnapshot,frozen);assert.notEqual(snapshot.snapshot.destination.addressLine1,frozen.sender?.addressLine1);
  const document=await new PostgresFulfillmentDocumentService(pool).document(org,brandedId<"FulfillmentHandoffId">(snapshot.handoff_id));assert.equal(document.organization.name,"Ordering Customer");assert.match(document.organization.address!,/Original Return Address/);assert.equal(document.organization.website,undefined);assert.equal(document.organization.footerNote,undefined);
  const explicitFalse=await service.createPrepared(context("l0-sender-false"),{...input,senderIntents:[{orderId:f.orderId,blindShipping:false}]});assert.ok(explicitFalse.ok);assert.equal(explicitFalse.value.currentPreparedRevision?.senderSnapshot?.source,"organization");
  const incomplete=await service.createPrepared(context("l0-sender-incomplete"),{...input,senderIntents:[{orderId:f.orderId,blindShipping:true,source:"custom",customSender:{company:"Custom",addressLine1:"Missing locality"} as any}]});assert.equal(incomplete.ok,false,"incomplete Custom never falls back to complete Customer billing data");
  await db.query("INSERT INTO company_settings(organization_id,website,address) VALUES($1,'organization.example.invalid','New company address')",[org]);
  await db.query("UPDATE organizations SET name='Changed Organization' WHERE id=$1",[org]);
  const branded=await service.finalize(context("l0-company-sender-final"),{shipmentId:explicitFalse.value.shipmentId,expectedPreparedRevisionId:explicitFalse.value.preparedRevisionId!});assert.ok(branded.ok);
  const companyHandoff=(await db.query<{handoff_id:string}>("SELECT handoff_id FROM v2_fulfillment_shipment_handoffs WHERE organization_id=$1 AND shipment_id=$2",[org,explicitFalse.value.shipmentId])).rows[0].handoff_id;
  const normalDocument=await new PostgresFulfillmentDocumentService(pool).document(org,brandedId<"FulfillmentHandoffId">(companyHandoff));assert.equal(normalDocument.organization.name,"Changed Organization","non-blind company sender remains the established branding contract");assert.equal(normalDocument.organization.address,"New company address","non-blind sender never substitutes Customer billing");assert.equal(normalDocument.organization.website,"organization.example.invalid","non-blind organization branding remains the established presentation");
  await db.query("UPDATE customers SET blind_shipping=false WHERE organization_id=$1 AND id='m5-customer'",[org]);
}]);
cases.push(["FUL11 preserves existing direct non-blind Shipment without a Customer; no new Customer requirement or Ship To fallback",async()=>{
  const f=await fixture(2);await f.work("front",{orderedQuantity:2,producedQuantity:2});await db.query("UPDATE v2_sales_documents SET customer_id=NULL WHERE organization_id=$1 AND id=$2",[org,f.orderId]);
  const id="l0-nonblind-no-customer",result=await fulfillment.recordShipment(context(id),{businessRequestId:id,orderId:f.orderId,allocations:[{orderLineId:f.lineId,quantity:1}]});assert.ok(result.ok,result.ok?"":result.error.publicMessage);
  const snapshot=(await db.query<{snapshot:any}>("SELECT snapshot FROM v2_fulfillment_handoff_document_snapshots WHERE organization_id=$1 AND handoff_id=$2",[org,result.value.handoff.handoffId])).rows[0].snapshot;assert.equal(snapshot.senderSnapshot.blindShipping,false);assert.equal(snapshot.senderSnapshot.source,"organization");assert.equal(snapshot.senderSnapshot.sender,undefined);assert.equal(snapshot.senderSnapshot.organizationSender,undefined);
}]);

cases.push(["FUL26 actual Shipping/M0 receipt B cannot acknowledge canonical browser marker A with the same receipt key",async()=>{
  const f=await fixture(4);await f.work("front",{orderedQuantity:4,producedQuantity:4});
  const shipping=new ShipmentContainerApplicationService(new PostgresShipmentContainerRunner(pool)),recovery=new PostgresPhysicalOperationRecovery(pool);
  const allocation={orderId:f.orderId,orderLineId:f.lineId,quantity:1};
  const a=await shipping.createPrepared(context("proof-prepare-a"),{allocations:[allocation]}),b=await shipping.createPrepared(context("proof-prepare-b"),{allocations:[allocation]});assert.ok(a.ok);assert.ok(b.ok);
  const businessRequestId="44444444-4444-4444-8444-444444444444",operation="fulfillment.shipment-container.finalize.v1" as const;
  const inputB={shipmentId:b.value.shipmentId,expectedPreparedRevisionId:b.value.preparedRevisionId!};
  const completed=await shipping.finalize(context(businessRequestId),inputB);assert.ok(completed.ok);
  const canonicalRow=(await db.query<{payload_fingerprint:string}>("SELECT payload_fingerprint FROM v2_operation_requests WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3",[org,operation,businessRequestId])).rows[0];
  const expected=`sha256:${createHash("sha256").update(canonicalJson(inputB)).digest("hex")}`;assert.equal(canonicalRow.payload_fingerprint,expected);assert.equal(Buffer.from(expected.slice(7),"hex").length,32);
  let reader={...context("proof-read"),principal:{...context().principal,userId:"different-authorized-proof-reader"}} as OperationContext;
  const verified=await recovery.receipt(reader,operation,businessRequestId);assert.ok(verified.ok);assert.equal(verified.value.submittedPayloadFingerprint,expected);assert.equal(verified.value.input,undefined,"legacy canonical proof does not expose another actor's submitted body");
  const count=async()=>Number((await db.query<{n:number}>("SELECT COUNT(*)::integer n FROM v2_fulfillment_handoffs WHERE organization_id=$1 AND order_document_id=$2",[org,f.orderId])).rows[0].n),before=await count();
  const dom=new JSDOM("<!doctype html><div id='proof-root'></div>",{url:"http://localhost"});
  for(const [name,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,MouseEvent:dom.window.MouseEvent,crypto:webcrypto}))Object.defineProperty(globalThis,name,{configurable:true,value});
  const storageKey=`ph.v2.fulfillment.intent.v1:${encodeURIComponent(org)}`,container=dom.window.document.getElementById("proof-root")!,root=createRoot(container);
  let physicalCalls=0,wire:"normal"|"missing"|"malformed"|"wrong-size"="normal";
  const alter=(proof:PhysicalRecoveryResult):PhysicalRecoveryResult=>wire==="normal"?proof:{...proof,submittedPayloadFingerprint:wire==="missing"?undefined:wire==="malformed"?"sha256:not-a-digest":`sha256:${"a".repeat(62)}`};
  configureFulfillmentOwnerTransport(async <T,>(requestedOrg:string,suffix:string,init?:RequestInit):Promise<T>=>{
    assert.equal(requestedOrg,org);
    if(init?.method&&init.method!=="GET"){physicalCalls++;throw Error("No mutation is permitted during this mounted proof regression.");}
    if(suffix==="/physical-operations"){const result=await recovery.discover(reader);if(!result.ok)throw result.error;return result.value.map(alter) as T;}
    const parts=suffix.split("/"),result=await recovery.receipt(reader,decodeURIComponent(parts[2]) as PhysicalOperation,decodeURIComponent(parts[3]));
    if(!result.ok)throw result.error;return alter(result.value) as T;
  });
  const Harness=({scope}:{scope:string})=>{
    const intent=useFulfillmentIntent(org,scope);
    return React.createElement(React.Fragment,null,React.createElement("button",{disabled:intent.state.kind!=="ready",onClick:()=>{physicalCalls++;}},"Submit physical intent"),React.createElement(PhysicalRecoveryPanel,{organizationId:org,sessionScope:scope,csrfReady:true}));
  };
  const marker=(scope:string,payload:typeof inputB)=>({version:1 as const,organizationId:org,sessionScope:scope,businessRequestId,operation:"shipment-finalize" as const,payload,bodyCanonical:canonicalFulfillmentIntentBody(org,scope,"shipment-finalize",businessRequestId,payload)!,recovery:"retry" as const});
  const button=(label:string)=>Array.from(container.querySelectorAll("button")).find(item=>item.textContent===label)!;
  const wait=async(predicate:()=>boolean)=>{for(let attempt=0;attempt<100&&!predicate();attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate(),container.textContent??"mounted proof did not settle");};
  const probe=async(scope:string,value:ReturnType<typeof marker>,clears:boolean)=>{
    const raw=JSON.stringify(value);dom.window.sessionStorage.setItem(storageKey,raw);flushSync(()=>root.render(React.createElement(Harness,{key:scope,scope})));
    await wait(()=>Boolean(button("Acknowledge these owner results before new physical intent")));
    flushSync(()=>button("Acknowledge these owner results before new physical intent").click());
    await wait(()=>clears?dom.window.sessionStorage.getItem(storageKey)===null:/remains blocked|could not be read|cannot be cleared/.test(container.textContent??""));
    assert.equal(dom.window.sessionStorage.getItem(storageKey),clears?null:raw);assert.equal(button("Submit physical intent").disabled,!clears);assert.equal(physicalCalls,0);
  };
  try{
    const markerA=marker("same-key-wrong-shipment",{shipmentId:a.value.shipmentId,expectedPreparedRevisionId:a.value.preparedRevisionId!});assert.ok(validateFulfillmentIntentRecord(markerA,org,markerA.sessionScope));await probe(markerA.sessionScope,markerA,false);
    await probe("same-key-wrong-revision",marker("same-key-wrong-revision",{...inputB,expectedPreparedRevisionId:a.value.preparedRevisionId!}),false);
    await probe("malformed-body",{...marker("malformed-body",inputB),bodyCanonical:"not-the-canonical-submitted-body"},false);
    wire="missing";await probe("missing-owner-proof",marker("missing-owner-proof",inputB),false);
    wire="malformed";await probe("malformed-owner-proof",marker("malformed-owner-proof",inputB),false);
    wire="wrong-size";await probe("wrong-size-owner-proof",marker("wrong-size-owner-proof",inputB),false);
    wire="normal";const matching=marker("canonical-b-different-actor",inputB);assert.equal(await submittedPhysicalFingerprint(matching),expected);await probe(matching.sessionScope,matching,true);
    reader={...reader,principal:{...reader.principal,authority:{membershipId:"m",capabilities:[]}}} as OperationContext;
    const denied=await recovery.receipt(reader,operation,businessRequestId);assert.equal(denied.ok,false);assert.equal("value" in denied,false,"revoked grants receive no fingerprint");
    assert.equal(await count(),before,"acknowledgement never calls a physical API or inflates canonical handoffs");assert.equal(physicalCalls,0);
  }finally{flushSync(()=>root.unmount());dom.window.close();}
}]);

try {
  await setup();
  const failures: string[] = [];
  for (const [name, action] of cases) {
    try { await action(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
  }
  assert.deepEqual(failures, [], `${failures.length}/${cases.length} embedded PostgreSQL scenarios failed`);
  console.log(`replacementFulfillmentIsolation.postgres.test: ${cases.length} scenarios PASS, zero skipped`);
} finally { await db.close(); }
