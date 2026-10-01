import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule, type Module } from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import type * as DraftExports from "../../infrastructure/billing/postgresBillingDraftInvoiceTransaction.js";
import type * as IssueExports from "../../infrastructure/billing/postgresBillingInvoiceTransaction.js";
import * as errors from "../../src/errors/applicationError.js";
import * as values from "../../src/modules/shared/commercialValues.js";
import * as customers from "../../infrastructure/compatibility/postgresCustomersRead.js";
import * as requests from "../../infrastructure/persistence/postgresOperationRequests.js";
import * as outbox from "../../infrastructure/persistence/postgresOutbox.js";
import * as branding from "../../infrastructure/documents/postgresTenantBranding.js";
import * as reusable from "../../infrastructure/billing/postgresReusableInvoiceTaxEvidence.js";
import { BillingApplicationService } from "../../src/modules/billing/billingApplication.js";
import { composeSalesTax } from "../../src/modules/sales/taxComposition.js";
import { PostgresReplacementObligationService } from "../../infrastructure/fulfillment/postgresReplacementObligations.js";
import { applyShippingChargeInTransaction } from "../../infrastructure/billing/postgresShippingCharge.js";
import { reconcileOrderInTransaction } from "../../infrastructure/sales/postgresOrderAutomaticLifecycle.js";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
assert.deepEqual(Object.keys(process.env).filter(key => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);

// Standalone TSX: exact production bytes and dependencies share the Node realm.
// Only the unrelated provider import is replaced. Its transaction-local
// auto-sync-disabled read still executes SQL.
const qb = { async enqueueV2QuickBooksAutoSync(client: PoolClient, organizationId: string) {
  const result = await client.query("SELECT settings FROM organizations WHERE id=$1", [organizationId]);
  assert.equal(result.rows[0].settings.preferences.quickBooks.autoSync, false);
} };
const common = new Map<string, object>([["node:crypto", crypto], ["../../src/errors/applicationError.js", errors],
  ["../../src/modules/shared/commercialValues.js", values], ["../accounting/quickBooksBillingQueue.js", qb]]);
const sources = new Map([
  ["postgresBillingDraftInvoiceTransaction.ts", new Map([...common, ["./postgresReusableInvoiceTaxEvidence.js", reusable]])],
  ["postgresBillingInvoiceTransaction.ts", new Map([...common, ["../compatibility/postgresCustomersRead.js", customers],
    ["../persistence/postgresOperationRequests.js", requests], ["../persistence/postgresOutbox.js", outbox], ["../documents/postgresTenantBranding.js", branding]])],
]);
const denyDynamic = (): never => { throw Error("Dynamic adapter imports are forbidden."); };
function link(specifier: string, parent: Module, source: string) {
  const expected = new URL(`../../infrastructure/billing/${source}`, import.meta.url).href;
  assert.equal(parent.identifier, expected);
  const exports = sources.get(source)?.get(specifier);
  if (!exports) throw Error(`Unreviewed adapter dependency: ${specifier}`);
  return new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { identifier: `${expected}#${specifier}` });
}
async function adapter(source: string) {
  if (!sources.has(source)) throw Error("Unreviewed adapter source.");
  const url = new URL(`../../infrastructure/billing/${source}`, import.meta.url);
  const { outputText } = ts.transpileModule(await readFile(url, "utf8"), { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const module = new SourceTextModule(outputText, { identifier: url.href, importModuleDynamically: denyDynamic });
  await module.link((specifier, parent) => link(specifier, parent, source)); await module.evaluate(); return module.namespace;
}
const draftExports = await adapter("postgresBillingDraftInvoiceTransaction.ts") as unknown as typeof DraftExports;
const issueExports = await adapter("postgresBillingInvoiceTransaction.ts") as unknown as typeof IssueExports;
const db = new PGlite();
const org = values.brandedId<"OrganizationId">("p1-org"), foreign = values.brandedId<"OrganizationId">("p1-foreign");
const usd = values.currencyCode("USD"), user = "p1-user";
const calls: { sql: string; params: unknown[] }[] = [];
let leased = false, failpoint: "replacement_line" | "revision" | undefined;
let failureWitness: unknown;
const client = { async query(sql: string, params: unknown[] = []) {
  calls.push({ sql, params });
  const result = await db.query<Record<string, unknown>>(sql, params);
  if ((failpoint === "replacement_line" && sql.includes("INSERT INTO v2_billing_invoice_lines")) ||
      (failpoint === "revision" && sql.includes("INSERT INTO v2_billing_invoice_revisions"))) {
    failureWitness = failpoint === "replacement_line" ? (await db.query(`SELECT
      (SELECT commercial_state FROM v2_sales_order_details WHERE document_id=$1) state,
      (SELECT count(*)::integer FROM v2_order_replacement_obligations WHERE order_document_id=$1) obligations,
      (SELECT count(*)::integer FROM v2_production_works WHERE order_document_id=$1 AND replacement_obligation_id IS NOT NULL) works,
      (SELECT count(*)::integer FROM v2_billing_invoices WHERE sales_order_document_id=$1 AND replacement_obligation_id IS NOT NULL) invoices,
      (SELECT count(*)::integer FROM v2_billing_invoice_lines WHERE invoice_id=$2) lines`, [params[3], params[2]])).rows[0] : "revision inserted";
    throw Error("Injected downstream failure after real SQL.");
  }
  const dates = result.fields.filter(field => field.dataTypeID === 1184 || field.dataTypeID === 1114).map(field => field.name);
  const bigints = result.fields.filter(field => field.dataTypeID === 20).map(field => field.name);
  return { rows: result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null ? null : dates.includes(key) ? new Date(value as string) : bigints.includes(key) ? String(value) : value]))), rowCount: result.affectedRows ?? result.rows.length };
}, release() { assert.ok(leased); leased = false; } } as unknown as PoolClient;
const pool = { async connect() { assert.equal(leased, false, "all owner operations share the sole client"); leased = true; return client; } } as Pool;
const drafts = new draftExports.PostgresBillingDraftInvoiceTransaction(client);
const billing = new BillingApplicationService({ read: async action => action(drafts) }, undefined, new issueExports.PostgresBillingInvoiceTransactionRunner(pool));
const replacements = new PostgresReplacementObligationService(pool);
const context = (id: string, organizationId = org, allowed = true): OperationContext => ({ organizationId, operationId: "p1-test", businessRequest: { id, payloadFingerprint: id },
  principal: { kind: "staff", organizationId, userId: user, authority: { membershipId: "member", capabilities: allowed ? ["invoice.issue", "invoice.view", "fulfillment.replace"] : [] } } });
const sql = (name: string) => readFile(new URL(`../../../server/db/migrations_v2/${name}`, import.meta.url), "utf8");
const beforeMarker = (source: string, marker: string) => { assert.ok(source.includes(marker)); return source.slice(0, source.indexOf(marker)); };
const fromMarker = (source: string, marker: string) => { assert.ok(source.includes(marker)); return source.slice(source.indexOf(marker)); };

async function initialize() {
  // Foreign-owner FK targets only. All Billing, Production and replacement
  // tables/functions/triggers below are taken from the real migration source.
  await db.exec(`
    CREATE TABLE organizations(id varchar PRIMARY KEY,name text,settings jsonb DEFAULT '{"preferences":{"quickBooks":{"autoSync":false}}}');
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE company_settings(organization_id varchar,company_display_name text,company_name text,address text,physical_address jsonb,remittance_address jsonb,phone text,email text,website text,invoice_footer_note text,invoice_payment_instructions text,checks_payable_to text);
    CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar,display_name text,company_name text,email text,phone text,is_active boolean DEFAULT true,status text DEFAULT 'active',merged_into_customer_id varchar,
      billing_street1 text,billing_street2 text,billing_city text,billing_state text,billing_postal_code text,billing_country text,shipping_street1 text,shipping_street2 text,shipping_city text,shipping_state text,shipping_postal_code text,shipping_country text,UNIQUE(id,organization_id));
    CREATE TABLE customer_contacts(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE products(id varchar PRIMARY KEY,unit_cents bigint);
    CREATE TABLE pbv2_tree_versions(id varchar,organization_id varchar,product_id varchar,tree_json jsonb);
    CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar,document_kind text,display_number text,customer_id varchar,contact_id varchar,currency varchar DEFAULT 'USD',terms_json jsonb DEFAULT '{}',revision bigint DEFAULT 1,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_order_details(document_id varchar PRIMARY KEY,organization_id varchar,commercial_state text DEFAULT 'open',archived_at timestamptz,completed_at timestamptz,updated_at timestamptz,
      completed_principal_kind text,completed_principal_subject text,completed_staff_actor_user_id varchar,archived_principal_kind text,archived_principal_subject text,archived_staff_actor_user_id varchar,UNIQUE(document_id,organization_id));
    CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar,document_id varchar,description text,quantity integer,position integer,product_id varchar,resolved_configuration jsonb,
      selling_unit_cents bigint,selling_line_cents bigint,pricing_evidence_fingerprint text,taxability_snapshot jsonb,UNIQUE(id,organization_id,document_id));
    CREATE TABLE v2_sales_line_production_requirements(organization_id varchar,order_line_id varchar,requirement_key varchar,side text,source_page_index integer,layer_key text,layer_order integer,UNIQUE(organization_id,order_line_id,requirement_key));
    CREATE TABLE v2_sales_line_workflow_exceptions(organization_id varchar,order_line_id varchar,production_requirement text);
    CREATE TABLE v2_route_instances(organization_id varchar,order_line_id varchar,route_state text);
    CREATE TABLE v2_artwork_assignments(id varchar PRIMARY KEY,organization_id varchar,artwork_file_id varchar,order_document_id varchar,order_line_id varchar,purpose text,side text,source_page_index integer,layer_key text,layer_order integer,UNIQUE(id,organization_id,artwork_file_id),UNIQUE(id,organization_id));
    CREATE TABLE v2_prepress_units(id varchar PRIMARY KEY,organization_id varchar,artwork_assignment_id varchar,completed_at timestamptz,UNIQUE(id,organization_id),CONSTRAINT v2_prepress_units_assignment_uidx UNIQUE(organization_id,artwork_assignment_id));
    CREATE TABLE v2_operation_requests(id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,organization_id varchar,operation text,business_request_id text,payload_fingerprint text,status text DEFAULT 'in_progress',result_resource_type text,result_resource_id text,result_json jsonb,
      initiated_principal_kind text,initiated_principal_subject text,staff_actor_user_id varchar,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),completed_at timestamptz,UNIQUE(organization_id,operation,business_request_id),UNIQUE(id,organization_id));
    CREATE TABLE v2_principal_attributions(id varchar DEFAULT gen_random_uuid()::text,organization_id varchar,operation_request_id varchar,operation text,resource_type text,resource_id varchar,principal_kind text,principal_subject text,staff_actor_user_id varchar);
    CREATE TABLE v2_audit_events(id varchar DEFAULT gen_random_uuid()::text,organization_id varchar,operation_request_id varchar,operation text,event_type text,resource_type text,resource_id varchar,principal_kind text,principal_subject text,staff_actor_user_id varchar,changes jsonb);
    CREATE TABLE v2_outbox_messages(id varchar DEFAULT gen_random_uuid()::text,organization_id varchar,event_type text,aggregate_type text,aggregate_id varchar,idempotency_key text,payload jsonb,status text DEFAULT 'pending',attempt_count integer DEFAULT 0,available_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),claimed_by text,lease_expires_at timestamptz,last_error text,completed_at timestamptz,UNIQUE(organization_id,event_type,aggregate_type,aggregate_id,idempotency_key));
    CREATE TABLE invoices(organization_id varchar,display_number text,qb_doc_number text,invoice_number integer);
  `);
  await db.exec(beforeMarker(fromMarker(await sql("0195_v2_order_draft_invoice_vertical_slice.sql"), "CREATE TABLE v2_billing_invoices ("), "-- Override authority"));
  for (const name of ["0206_v2_invoice_lifecycle_foundation.sql", "0207_v2_payments_refunds_foundation.sql", "0227_v2_order_commercial_context.sql", "0247_v2_job_derived_invoice_numbering.sql", "0260_v2_live_order_invoice_revisions.sql", "0270_v2_payment_allocation_aggregate.sql", "0271_v2_refund_allocation_aggregate.sql"]) await db.exec(await sql(name));
  await db.exec(fromMarker(await sql("0228_v2_sales_tax_and_quote_commercial_continuity.sql"), "ALTER TABLE v2_sales_order_details"));
  await db.exec(beforeMarker(await sql("0204_v2_production_domain_foundation.sql"), "INSERT INTO v2_permission_capabilities"));
  await db.exec(await sql("0261_v2_production_work_current_target.sql"));
  await db.exec(beforeMarker(await sql("0205_v2_fulfillment_domain_foundation.sql"), "INSERT INTO v2_permission_capabilities"));
  await db.exec(await sql("0231_v2_fulfillment_handoff_document_snapshots.sql"));
  await db.exec(await sql("0267_v2_fulfillment_shipment_containers.sql"));
  await db.exec(await sql("0275_v2_fulfillment_shipment_recovery.sql"));
  await db.exec(await sql("0280_v2_production_rework_successor_cycles.sql"));
  await db.exec(beforeMarker(await sql("0282_v2_production_output_rejections.sql"), "ALTER TABLE v2_production_work_events"));
  await db.exec(beforeMarker(await sql("0283_v2_replacement_obligations_shipping_economics.sql"), "INSERT INTO v2_permission_capabilities"));
  for (const name of ["0284_v2_replacement_obligation_execution.sql", "0285_v2_billable_replacement_invoices.sql", "0287_v2_shipment_shipping_invoice_projection.sql", "0289_v2_billing_invoice_revision_history_immutability.sql"]) await db.exec(await sql(name));
  await db.query("INSERT INTO organizations(id,name) VALUES($1,'Synthetic Billing'),($2,'Other tenant')", [org, foreign]);
  await db.query("INSERT INTO users VALUES($1)", [user]);
  await db.query("INSERT INTO customers(id,organization_id,display_name,company_name) VALUES('customer',$1,'Synthetic Customer','Synthetic Customer')", [org]);
  await db.query("INSERT INTO products VALUES('product',100)");
}

const unresolved = { status: "unresolved", calculatorVersion: "v2-sales-receipt-jurisdiction-v1", reason: "tax_jurisdiction_not_configured", finalTotalCents: 8750 };
const resolution = { status: "resolved" as const, receiptLocation: { country: "US", region: "IN" }, jurisdiction: { jurisdictionId: "frozen", name: "Frozen jurisdiction", receiptLocation: { country: "US", region: "IN" }, rateBasisPoints: 700, active: true, homeBusiness: true } };
type FixtureOptions = { composition?: unknown; raw?: unknown; scalarVersion?: string; financialVersion?: string; checkpoint?: (checkpoint: Record<string, any>) => unknown; omitCheckpoint?: boolean; draft?: boolean; context?: string; charge?: unknown; adjustment?: number; lines?: { amount: number; taxable: boolean }[] };
async function fixture(options: FixtureOptions = {}) {
  const orderId = values.brandedId<"OrderId">(crypto.randomUUID()), display = `ORD-${orderId}`, firstLineId = values.brandedId<"OrderLineId">(crypto.randomUUID());
  const composition = "composition" in options ? options.composition : unresolved;
  await db.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,display_number,customer_id) VALUES($1,$2,'order',$3,'customer')", [orderId, org, display]);
  await db.query("INSERT INTO v2_sales_order_details(document_id,organization_id,tax_composition,commercial_charge) VALUES($1,$2,$3::jsonb,$4::jsonb)", [orderId, org, composition == null ? null : JSON.stringify(composition), options.charge == null ? null : JSON.stringify(options.charge)]);
  const lineAmounts = options.lines ?? [{ amount: 8750, taxable: true }];
  const lines = [];
  for (const [index, line] of lineAmounts.entries()) {
    const lineId = index === 0 ? firstLineId : values.brandedId<"OrderLineId">(crypto.randomUUID());
    await db.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id,description,quantity,position,product_id,resolved_configuration,selling_unit_cents,selling_line_cents,pricing_evidence_fingerprint,taxability_snapshot) VALUES($1,$2,$3,'Frozen custom description',2,$4,'product',$5::jsonb,$6,$7,'frozen-8750-price',$8::jsonb)",
      [lineId, org, orderId, index, JSON.stringify({ productFacts: { workflowIntent: "standard_production", requiresProductionJob: true } }), Math.round(line.amount / 2), line.amount, JSON.stringify({ taxable: line.taxable })]);
    await db.query("INSERT INTO v2_sales_line_production_requirements(organization_id,order_line_id,requirement_key) VALUES($1,$2,'front')", [org, lineId]);
    await db.query("INSERT INTO v2_route_instances VALUES($1,$2,'completed')", [org, lineId]);
    const assignment = crypto.randomUUID(), work = crypto.randomUUID();
    await db.query("INSERT INTO v2_artwork_assignments(id,organization_id,artwork_file_id,order_document_id,order_line_id,purpose) VALUES($1,$2,'file',$3,$4,'production')", [assignment, org, orderId, lineId]);
    await db.query("INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,ordered_quantity,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,$4,'front',$5,'file',2,'staff',$6)", [work, org, orderId, lineId, assignment, user]);
    await db.query("INSERT INTO v2_production_attempts(organization_id,production_work_id,sequence,attempt_kind,station_key,good_quantity,started_principal_kind,started_principal_subject,completed_at,completed_principal_kind,completed_principal_subject) VALUES($1,$2,1,'initial','flatbed',2,'staff',$3,now(),'staff',$3)", [org, work, user]);
    lines.push({ lineId: values.brandedId<"SalesLineId">(lineId), productId: values.brandedId<"ProductId">("product"), description: "Frozen custom description", quantity: 2, sellingUnitAmount: values.money(usd, Math.round(line.amount / 2)), sellingLineAmount: values.money(usd, line.amount), salesPricingEvidenceFingerprint: "frozen-8750-price" });
  }
  const handoff = crypto.randomUUID();
  await db.query("INSERT INTO v2_fulfillment_handoffs(id,organization_id,order_document_id,handoff_method,completed_principal_kind,completed_principal_subject) VALUES($1,$2,$3,'pickup','staff',$4)", [handoff, org, orderId, user]);
  for (const line of lines) await db.query("INSERT INTO v2_fulfillment_handoff_lines(organization_id,handoff_id,order_document_id,order_line_id,quantity) VALUES($1,$2,$3,$4,2)", [org, handoff, orderId, line.lineId]);
  const draftInput = { organizationId: org, orderId, businessRequestId: values.brandedId<"BusinessRequestId">(crypto.randomUUID()), customerContact: { organizationId: org, customerId: values.brandedId<"CustomerId">("customer") }, currency: usd, sourceSalesStateToken: "1", taxInput: options.context ? { taxContextReference: options.context } : {}, salesLines: lines,
    ...(options.adjustment ? { salesAdjustment: { cents: options.adjustment, reason: "frozen adjustment" } } : {}) };
  const created = await drafts.createDraftInvoice(draftInput); assert.equal(created.status, "created");
  assert.ok("invoiceId" in created); const invoiceId = created.invoiceId;
  // Malformed historical fixtures are established before issuance, never repaired
  // after a rejected read or used as the recovery mechanism for a retry.
  if (options.raw !== undefined) await db.query("UPDATE v2_billing_invoices SET tax_evidence=$2::jsonb WHERE id=$1", [invoiceId, JSON.stringify(options.raw)]);
  if (options.scalarVersion !== undefined) await db.query("UPDATE v2_billing_invoices SET tax_calculator_version=$2 WHERE id=$1", [invoiceId, options.scalarVersion]);
  if (options.financialVersion !== undefined) await db.query("UPDATE v2_billing_invoices SET synchronization_version=$2 WHERE id=$1", [invoiceId, options.financialVersion]);
  if (!options.draft) {
    if (options.checkpoint || options.omitCheckpoint || (options.raw as { status?: string })?.status === "unresolved") {
      await db.exec("BEGIN");
      try {
        const tx = new issueExports.PostgresBillingInvoiceTransaction(client), issued = await tx.issue({ organizationId: org, invoiceId, principalKind: "staff", principalSubject: user }); assert.ok(issued);
        const locked = await tx.lockInvoice(org, invoiceId); assert.ok(locked);
        const checkpoint = tx.buildCheckpoint({ organizationId: org, invoice: issued, lines: locked.lines, checkpointId: values.brandedId<"InvoiceCheckpointId">(crypto.randomUUID()), customerPresentation: {}, organizationPresentation: { name: "Synthetic Billing" }, principalKind: "staff", principalSubject: user });
        if (!options.omitCheckpoint) await tx.writeCheckpoint({ organizationId: org, invoiceId, checkpoint: (options.checkpoint ? options.checkpoint(checkpoint) : checkpoint) as typeof checkpoint });
        await db.exec("COMMIT");
      } catch (error) { await db.exec("ROLLBACK"); throw error; }
    } else {
      const request = crypto.randomUUID();
      const issued = await billing.issueInvoice(context(request), { organizationId: org, invoiceId, businessRequestId: values.brandedId<"BusinessRequestId">(request) });
      assert.ok(issued.ok, issued.ok ? "" : `${issued.error.code}: ${issued.error.publicMessage}`);
    }
    const request = (await db.query<{ id: string }>("INSERT INTO v2_operation_requests(organization_id,operation,business_request_id,payload_fingerprint,initiated_principal_kind,initiated_principal_subject) VALUES($1,'seed-payment',$2,'fixture','staff',$3) RETURNING id", [org, crypto.randomUUID(), user])).rows[0].id;
    const total = (await db.query<{ total_cents: string }>("SELECT total_cents::text FROM v2_billing_invoices WHERE id=$1", [invoiceId])).rows[0].total_cents;
    const payment = crypto.randomUUID();
    await db.query("INSERT INTO v2_billing_payments(id,organization_id,invoice_id,currency,amount_cents,method,source,occurred_at,operation_request_id,principal_kind,principal_subject) VALUES($1,$2,$3,'USD',$4,'cash','manual',now(),$5,'staff',$6)", [payment, org, invoiceId, total, request, user]);
    await db.query("INSERT INTO v2_billing_payment_allocations(id,organization_id,payment_id,invoice_id,amount_cents) VALUES($1,$2,$3,$4,$5)", [crypto.randomUUID(), org, payment, invoiceId, total]);
    await reconcileOrderInTransaction(client, org, orderId);
  }
  const input = { businessRequestId: crypto.randomUUID(), orderId, orderLineId: firstLineId, replacementQuantity: 1, reason: "customer_change" as const, responsibility: "customer" as const, billingTreatment: "billable" as const };
  return { orderId, invoiceId, lineId: firstLineId, display, input, draftInput };
}

async function images(f: Awaited<ReturnType<typeof fixture>>) {
  const queries = [
    "SELECT to_jsonb(i)::text image FROM v2_billing_invoices i WHERE id=$1",
    "SELECT to_jsonb(l)::text image FROM v2_billing_invoice_lines l WHERE invoice_id=$1 ORDER BY id",
    "SELECT to_jsonb(c)::text image FROM v2_billing_invoice_checkpoints c WHERE invoice_id=$1 ORDER BY id",
    "SELECT to_jsonb(p)::text image FROM v2_billing_payments p WHERE invoice_id=$1 ORDER BY id",
    "SELECT to_jsonb(a)::text image FROM v2_billing_payment_allocations a WHERE invoice_id=$1 ORDER BY id",
    "SELECT to_jsonb(r)::text image FROM v2_billing_invoice_revisions r WHERE invoice_id=$1 ORDER BY id",
    "SELECT to_jsonb(c)::text image FROM v2_billing_invoice_additional_charges c WHERE invoice_id=$1 ORDER BY id",
    "SELECT to_jsonb(a)::text image FROM v2_production_attempts a JOIN v2_production_works w ON w.id=a.production_work_id JOIN v2_billing_invoices i ON i.sales_order_document_id=w.order_document_id WHERE i.id=$1 AND w.replacement_obligation_id IS NULL ORDER BY a.id",
    "SELECT to_jsonb(h)::text image FROM v2_fulfillment_handoffs h JOIN v2_billing_invoices i ON i.sales_order_document_id=h.order_document_id WHERE i.id=$1 AND h.replacement_obligation_id IS NULL ORDER BY h.id",
  ];
  return JSON.stringify(await Promise.all(queries.map(query => db.query(query, [f.invoiceId]).then(result => result.rows))));
}
async function transactionImages(f: Awaited<ReturnType<typeof fixture>>) {
  return JSON.stringify((await db.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(o)) FROM v2_sales_order_details o WHERE document_id=$1) sales,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM v2_order_replacement_obligations r WHERE order_document_id=$1) obligations,
    (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM v2_production_works w WHERE order_document_id=$1) works,
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM v2_order_replacement_obligation_events e) events,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM v2_operation_requests r) requests,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM v2_audit_events a) audit,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM v2_principal_attributions a) attribution,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM v2_billing_invoices i WHERE sales_order_document_id=$1) invoices`, [f.orderId])).rows);
}
const readEvidence = (f: Awaited<ReturnType<typeof fixture>>) => reusable.readReusableInvoiceTaxEvidenceInTransaction(client, { organizationId: org, invoiceId: f.invoiceId, orderId: f.orderId });
async function originalProjectionHash(f: Awaited<ReturnType<typeof fixture>>) {
  const invoice = await drafts.readInvoice(org, f.invoiceId); assert.ok(invoice);
  const { reusableTaxEvidence: _newProjection, ...preExistingFields } = invoice;
  return crypto.createHash("sha256").update(JSON.stringify(preExistingFields)).digest("hex");
}
const create = (f: Awaited<ReturnType<typeof fixture>>) => replacements.create(context(f.input.businessRequestId), f.input);
async function shipping(f: Awaited<ReturnType<typeof fixture>>, amount = 101) {
  const shipmentId = crypto.randomUUID(), allocation = crypto.randomUUID();
  await db.query("INSERT INTO v2_fulfillment_shipments(id,organization_id,created_principal_kind,created_principal_subject) VALUES($1,$2,'staff',$3)", [shipmentId, org, user]);
  await db.query("INSERT INTO v2_fulfillment_shipment_shipping_allocations(id,organization_id,shipment_id,order_document_id,customer_shipping_price_cents) VALUES($1,$2,$3,$4,$5)", [allocation, org, shipmentId, f.orderId, amount]);
  const request = { organizationId: org, invoiceId: f.invoiceId, orderId: f.orderId, shipmentId, shipmentAllocationId: allocation, customerChargeCents: amount, orderNumbers: [f.display], actor: { principalKind: "staff" as const, principalSubject: user } };
  return { request, async apply() { await db.exec("BEGIN"); try { await applyShippingChargeInTransaction(client, request); await db.exec("COMMIT"); } catch (error) { await db.exec("ROLLBACK"); throw error; } } };
}

const cases: Array<readonly [string, () => Promise<void>]> = [];
const check = (name: string, run: () => Promise<void>) => { cases.push([name, run]); };

check("closed VM source/dependency allowlists and host error identity", async () => {
  await assert.rejects(adapter("../../../server/db.ts"), /Unreviewed/);
  const source = "postgresBillingDraftInvoiceTransaction.ts", parent = new SourceTextModule("", { identifier: new URL(`../../infrastructure/billing/${source}`, import.meta.url).href });
  for (const specifier of ["pg", "dotenv/config", "../../../server/db.js", "../../../server/quickbooksService.js", "node:net", "./unknown.js"]) assert.throws(() => link(specifier, parent, source), /Unreviewed/);
  const probe = new SourceTextModule("await import('node:net')", { importModuleDynamically: denyDynamic }); await probe.link(() => { throw Error("Unexpected static import"); }); await assert.rejects(probe.evaluate(), /Dynamic adapter imports/);
  await assert.rejects(drafts.createDraftInvoice({ sourceSalesStateToken: "", salesLines: [] } as never), error => error instanceof errors.V2ApplicationError);
});

check("actual producer and full issuer preserve zero compatibility; current projection adds no persisted facts", async () => {
  const f = await fixture(), before = await images(f), evidence = await readEvidence(f), projection = await drafts.readInvoice(org, f.invoiceId);
  assert.equal(evidence.status, "unresolved"); assert.equal("source" in evidence && evidence.source, "zero_tax_compatibility");
  assert.deepEqual(projection?.reusableTaxEvidence, evidence); assert.equal(projection?.issuedCheckpoint?.taxEvidence.calculatorVersion, "v2-billing-zero-tax-compatibility-v1");
  assert.equal((await db.query<any>("SELECT tax_evidence FROM v2_billing_invoices WHERE id=$1", [f.invoiceId])).rows[0].tax_evidence.kind, "zero_tax_compatibility");
  assert.equal(await images(f), before);
});

check("previously rejected same-byte compatibility creates 4375 replacement from original8750 quantity2, not catalog100", async () => {
  const f = await fixture(), before = await images(f), publicHash = await originalProjectionHash(f), at = calls.length;
  const result = await create(f); assert.ok(result.ok, result.ok ? "" : result.error.publicMessage);
  assert.equal(result.value.billingInvoice?.invoiceNumber, `${f.display}-B`); assert.equal(result.value.billingInvoice?.totalCents, 4375);
  const row = (await db.query<any>("SELECT i.tax_evidence,l.selling_line_cents::text,l.selling_unit_cents::text,l.quantity,l.sales_pricing_evidence_fingerprint FROM v2_billing_invoices i JOIN v2_billing_invoice_lines l ON l.invoice_id=i.id WHERE i.id=$1", [result.value.billingInvoice!.invoiceId])).rows[0];
  assert.deepEqual(row.tax_evidence, { ...unresolved, finalTotalCents: 4375 }); assert.equal(row.selling_line_cents, "4375"); assert.equal(row.quantity, 1); assert.equal(row.sales_pricing_evidence_fingerprint, "frozen-8750-price");
  assert.ok(calls.slice(at).every(call => !/\b(?:FROM|JOIN)\s+products\b/i.test(call.sql))); assert.equal((await db.query<any>("SELECT unit_cents::text FROM products")).rows[0].unit_cents, "100");
  assert.equal(await images(f), before);
  assert.equal(await originalProjectionHash(f), publicHash, "all pre-existing public Invoice fields remain byte-identical; only additive current evidence is excluded");
});

check("true coordinator rollback after validation/Invoice allocation; unchanged valid history retries with same request and suffix", async () => {
  const f = await fixture(), base = await images(f), before = await transactionImages(f); failpoint = "replacement_line";
  const failed = await create(f); assert.equal(failed.ok, false); assert.deepEqual(failureWitness, { state: "open", obligations: 1, works: 1, invoices: 1, lines: 1 }); assert.equal(calls.at(-1)?.sql, "ROLLBACK");
  assert.equal(await transactionImages(f), before); assert.equal(await images(f), base);
  failpoint = undefined; const retried = await create(f); assert.ok(retried.ok, retried.ok ? "" : retried.error.publicMessage);
  assert.equal(retried.value.billingInvoice?.invoiceNumber, `${f.display}-B`); assert.equal(retried.value.obligation.successorProductionWorkIds.length, 1);
  const after = await transactionImages(f); assert.deepEqual(await create(f), retried); assert.equal(await transactionImages(f), after);
  const changed = await replacements.create(context(f.input.businessRequestId), { ...f.input, replacementQuantity: 2 }); assert.equal(changed.ok, false); if (!changed.ok) assert.equal(changed.error.code, "IDEMPOTENCY_CONFLICT");
  const at = calls.length, denied = await replacements.create(context(f.input.businessRequestId, org, false), f.input); assert.equal(denied.ok, false); assert.equal(calls.length, at);
  assert.equal(await transactionImages(f), after); assert.equal(await images(f), base);
});

check("rejected invalid historical fixture rolls back all coordinator owners without changing its bad evidence", async () => {
  const f = await fixture({ composition: null }), before = await transactionImages(f), base = await images(f), at = calls.length;
  const result = await create(f); assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.error.code, "CONFLICT"); assert.match(result.error.publicMessage, /original Invoice.*reusable/); }
  assert.ok(calls.slice(at).some(call => call.sql.includes("INSERT INTO v2_production_works"))); assert.ok(calls.slice(at).some(call => call.sql.includes("commercial_state='open'")));
  assert.ok(calls.slice(at).every(call => !call.sql.startsWith("SELECT invoice_sequence"))); assert.equal(await images(f), base); assert.equal(await transactionImages(f), before);
});

check("no-charge path leaves source Invoice/checkpoint/payment/history bytes unchanged even if tax is unavailable", async () => {
  const f = await fixture({ composition: null }), before = await images(f);
  const result = await replacements.create(context(f.input.businessRequestId), { ...f.input, billingTreatment: "no_charge" }); assert.ok(result.ok); assert.equal(result.value.billingInvoice, undefined); assert.equal(await images(f), before);
});

check("foreign tenant and revoked-authority replay cannot disclose or mutate source", async () => {
  const f = await fixture(), before = await transactionImages(f);
  const result = await replacements.create(context(f.input.businessRequestId, foreign), f.input); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "NOT_FOUND");
  assert.equal(await transactionImages(f), before);
  assert.equal((await reusable.readReusableInvoiceTaxEvidenceInTransaction(client, { organizationId: foreign, invoiceId: f.invoiceId, orderId: f.orderId })).status, "not_reusable");
});

for (const [name, options] of [
  ["unknown companion reason", { composition: { ...unresolved, reason: "unknown" } }],
  ["unknown companion version", { composition: { ...unresolved, calculatorVersion: "unknown" } }],
  ["missing companion", { composition: null }],
  ["unknown scalar version", { scalarVersion: "unknown" }],
  ["zero tax alone", { raw: {} }],
  ["malformed canonical must not fallback", { raw: { status: "resolved" } }],
  ["missing checkpoint", { omitCheckpoint: true }],
  ["changed financial version", { financialVersion: "2", checkpoint: (c: any) => ({ ...c, taxEvidence: { ...c.taxEvidence, calculationId: `${c.invoiceId}:1` } }) }],
  ["wrong checkpoint Invoice", { checkpoint: (c: any) => ({ ...c, invoiceId: "other" }) }],
  ["wrong checkpoint organization", { checkpoint: (c: any) => ({ ...c, organizationId: foreign }) }],
  ["wrong checkpoint currency", { checkpoint: (c: any) => ({ ...c, commercial: { ...c.commercial, total: { currency: "CAD", cents: 8750 } } }) }],
  ["wrong checkpoint amount", { checkpoint: (c: any) => ({ ...c, commercial: { ...c.commercial, total: values.money(usd, 8749) } }) }],
  ["wrong checkpoint context", { context: "opaque", checkpoint: (c: any) => ({ ...c, taxEvidence: { ...c.taxEvidence, contextReference: "different" } }) }],
  ["commercial charge ambiguity", { charge: { kind: "shipping", cents: 0 } }],
  ["charge total divergence", { composition: { ...unresolved, finalTotalCents: 8851 }, charge: { kind: "shipping", cents: 101 } }],
] satisfies [string, FixtureOptions][]) check(`actual SQL compatibility rejects ${name} without source writes`, async () => {
  const f = await fixture(options), before = await images(f); assert.equal((await readEvidence(f)).status, "not_reusable");
  const result = await create(f); assert.equal(result.ok, false); assert.equal(await images(f), before);
});

check("canonical unresolved remains consumer-supported and issuer-rejected", async () => {
  const draft = await fixture({ draft: true, raw: unresolved }), request = crypto.randomUUID();
  const denied = await billing.issueInvoice(context(request), { organizationId: org, invoiceId: draft.invoiceId, businessRequestId: values.brandedId<"BusinessRequestId">(request) }); assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, "VALIDATION_ERROR");
  const historic = await fixture({ raw: { status: "unresolved", reason: "tax_jurisdiction_conflict" } }), result = await create(historic); assert.ok(result.ok); assert.equal(result.value.billingInvoice?.totalCents, 4375);
});

for (const rateBasisPoints of [0, 700]) check(`native resolved rate ${rateBasisPoints} reuses canonical basis and original pricing`, async () => {
  const composition = composeSalesTax({ lines: [{ lineId: "ignored", amountCents: 8750, taxable: true }], exemption: { exempt: false }, resolution: { ...resolution, jurisdiction: { ...resolution.jurisdiction, rateBasisPoints } } });
  const f = await fixture({ composition }), result = await create(f); assert.ok(result.ok); assert.equal(result.value.billingInvoice?.totalCents, rateBasisPoints ? 4681 : 4375);
});

check("minimal historical resolved basis and frozen exemption preserve consumer rules", async () => {
  const raw = { status: "resolved", jurisdiction: { id: "historical", name: "Historical", receiptLocation: { country: "US", region: "IN" }, rateBasisPoints: 700 }, exemption: { exempt: true, reason: "certificate", certificateReference: "cert" } };
  const f = await fixture({ raw }), result = await create(f); assert.ok(result.ok); assert.equal(result.value.billingInvoice?.totalCents, 4375);
  assert.equal((await readEvidence(f)).status, "resolved");
});

check("Shipping uses same compatibility reader, then current native evidence wins over stale companion/checkpoint", async () => {
  const f = await fixture(), checkpoint = (await db.query("SELECT to_jsonb(c)::text image FROM v2_billing_invoice_checkpoints c WHERE invoice_id=$1", [f.invoiceId])).rows;
  const first = await shipping(f); await first.apply(); const second = await shipping(f, 99); await second.apply();
  const row = (await db.query<any>("SELECT total_cents::text,synchronization_version::text,tax_evidence FROM v2_billing_invoices WHERE id=$1", [f.invoiceId])).rows[0];
  assert.equal(row.total_cents, "8950"); assert.equal(row.synchronization_version, "3"); assert.equal(row.tax_evidence.status, "unresolved");
  assert.equal((await readEvidence(f)).status, "unresolved"); assert.equal((await readEvidence(f) as any).source, "canonical");
  assert.deepEqual((await db.query("SELECT to_jsonb(c)::text image FROM v2_billing_invoice_checkpoints c WHERE invoice_id=$1", [f.invoiceId])).rows, checkpoint);
  const before = await images(f); await first.apply(); assert.equal(await images(f), before);
});

check("Shipping mixed taxability, prior tax, cumulative rounding and revisions execute actual SQL", async () => {
  const composition = composeSalesTax({ lines: [{ lineId: "a", amountCents: 1000, taxable: true }, { lineId: "b", amountCents: 1000, taxable: false }], adjustmentCents: -200, charges: [{ kind: "handling", cents: 100 }], exemption: { exempt: false }, resolution: { ...resolution, jurisdiction: { ...resolution.jurisdiction, rateBasisPoints: 1000 } } });
  const f = await fixture({ composition, adjustment: -200, charge: { kind: "handling", cents: 100 }, lines: [{ amount: 1000, taxable: true }, { amount: 1000, taxable: false }] });
  const checkpoint = (await db.query("SELECT to_jsonb(c)::text FROM v2_billing_invoice_checkpoints c WHERE invoice_id=$1", [f.invoiceId])).rows;
  await (await shipping(f, 101)).apply(); await (await shipping(f, 99)).apply();
  assert.deepEqual((await db.query("SELECT subtotal_cents::text,tax_total_cents::text,total_cents::text,synchronization_version::text FROM v2_billing_invoices WHERE id=$1", [f.invoiceId])).rows[0], { subtotal_cents: "2100", tax_total_cents: "105", total_cents: "2205", synchronization_version: "3" });
  assert.deepEqual((await db.query("SELECT tax_cents::text FROM v2_billing_invoice_additional_charges WHERE invoice_id=$1 ORDER BY created_at,id", [f.invoiceId])).rows, [{ tax_cents: "5" }, { tax_cents: "5" }]);
  assert.equal((await db.query<any>("SELECT count(*)::integer n FROM v2_billing_invoice_revisions WHERE invoice_id=$1", [f.invoiceId])).rows[0].n, 2);
  assert.deepEqual((await db.query("SELECT to_jsonb(c)::text FROM v2_billing_invoice_checkpoints c WHERE invoice_id=$1", [f.invoiceId])).rows, checkpoint);
  await assert.rejects(db.query("UPDATE v2_billing_invoice_revisions SET detail='{}' WHERE invoice_id=$1", [f.invoiceId]));
  await assert.rejects(db.query("UPDATE v2_billing_invoice_checkpoints SET checkpoint_json='{}' WHERE invoice_id=$1", [f.invoiceId]));
});

check("Shipping revision failure rolls back actual charge/tax/version writes", async () => {
  const f = await fixture(), shipment = await shipping(f), before = await images(f); failpoint = "revision";
  await assert.rejects(shipment.apply(), /Injected downstream/); assert.equal(await images(f), before);
  failpoint = undefined; await shipment.apply(); assert.equal((await readEvidence(f)).status, "unresolved");
});

check("retained zero charge and prior-tax inconsistency remain fail-closed", async () => {
  const f = await fixture(), shipment = await shipping(f, 0);
  await db.query("INSERT INTO v2_billing_invoice_additional_charges(organization_id,invoice_id,sales_order_document_id,charge_kind,source_shipment_id,shipment_shipping_allocation_id,customer_charge_cents,tax_cents,tax_evidence,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,'shipping',$4,$5,0,0,'{}','staff',$6)", [org, f.invoiceId, f.orderId, shipment.request.shipmentId, shipment.request.shipmentAllocationId, user]);
  assert.equal((await readEvidence(f)).status, "not_reusable"); const before = await images(f); await assert.rejects((await shipping(f)).apply(), /destination Invoice.*reusable/); assert.equal(await images(f), before);
  const minimal = { status: "resolved", jurisdiction: { id: "home", name: "Home", receiptLocation: { country: "US", region: "IN" }, rateBasisPoints: 700 }, exemption: { exempt: false } };
  const wrongTax = await fixture({ raw: minimal }), prior = await images(wrongTax);
  await assert.rejects((await shipping(wrongTax)).apply(), /tax total does not match/); assert.equal(await images(wrongTax), prior);
});

try {
  await initialize();
  assert.equal(cases.length, 30);
  const failures: unknown[] = [];
  let passed = 0;
  for (const [name, run] of cases) {
    const previousFailures = failures.length;
    try { await run(); }
    catch (error) { failures.push(error); console.error(`FAIL ${name}`, error); }
    finally {
      failpoint = undefined;
      failureWitness = undefined;
      try { assert.equal(leased, false); }
      catch (error) { failures.push(error); console.error(`FAIL cleanup: ${name}`, error); }
    }
    if (failures.length === previousFailures) { passed++; console.log(`PASS ${name}`); }
  }
  console.log(`Reusable Invoice tax evidence SQL: ${passed}/${cases.length} cases passed, zero skipped.`);
  if (failures.length) throw new AggregateError(failures, "Reusable Invoice tax evidence SQL assertions failed.");
} finally { await db.close(); }
