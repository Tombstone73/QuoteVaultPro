import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule, type Module } from "node:vm";
import { afterAll, afterEach, beforeAll, describe, jest, test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import type { Pool, PoolClient } from "pg";
import type * as OrderAdapterExports from "../../infrastructure/sales/postgresOrderTransaction.js";
import * as customerExports from "../../infrastructure/compatibility/postgresCustomersRead.js";
import * as productExports from "../../infrastructure/compatibility/postgresProductsRead.js";
import * as requestExports from "../../infrastructure/persistence/postgresOperationRequests.js";
import * as routingExports from "../../infrastructure/routing/postgresRoutingRepository.js";
import * as prerequisiteExports from "../../infrastructure/routing/postgresRoutePrerequisites.js";
import * as materialExports from "../../infrastructure/sales/postgresOrderMaterialRequirements.js";
import * as numberingExports from "../../infrastructure/sales/postgresCommercialPrimitives.js";
import * as requirementExports from "../../infrastructure/sales/postgresProductionRequirements.js";
import * as taxExports from "../../infrastructure/sales/postgresSalesTaxComposition.js";
import * as orderExports from "../../src/modules/sales/orderApplication.js";
import * as lifecycleExports from "../../src/modules/sales/orderLifecycle.js";
import * as persistenceExports from "../../src/modules/sales/persistenceContracts.js";
import * as pricingExports from "../../src/modules/pricing/v2PricingAdapter.js";
import * as valueExports from "../../src/modules/shared/commercialValues.js";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { success, V2ApplicationError } from "../../src/errors/applicationError.js";
import type { DraftInvoiceReadModel, DraftInvoiceSynchronizationInput } from "../../src/modules/billing/contracts.js";
import type { SalesLineSnapshot } from "../../src/modules/sales/contracts.js";
import type { SalesWorkspace } from "../../src/modules/sales/workspaceContracts.js";
import type { OrderReadModel, OrderTransaction } from "../../src/modules/sales/orderApplication.js";
import { SalesWorkspaceApplicationService } from "../../src/modules/sales/workspaceApplication.js";
import { SalesWorkspaceLineService } from "../../src/modules/sales/workspaceLines.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";
import { resolveProductionRequirementSnapshot } from "../../src/modules/shared/productionRequirements.js";
import type { ArtworkBinaryStorage } from "../../infrastructure/artwork/artworkBinaryStorage.js";
import { PostgresArtworkTransactionRunner } from "../../infrastructure/artwork/postgresArtworkTransaction.js";
import { ArtworkApplicationService } from "../../src/modules/artwork/artworkApplication.js";
import { applyOrderEditArtworkInTransaction, authorizeOrderEditArtworkReplay, captureOrderEditArtwork, captureOrderEditArtworkFingerprint,
  PostgresOrderEditArtwork, validateOrderEditArtworkInTransaction } from "../../infrastructure/artwork/postgresOrderEditArtwork.js";
import { assessOrderEditBillingInTransaction } from "../../infrastructure/billing/postgresOrderEditSafety.js";
import { PostgresWorkspaceArtwork, requestWorkspaceArtworkCleanupInTransaction } from "../../infrastructure/artwork/postgresWorkspaceArtwork.js";
import { WorkspaceArtworkUploadService } from "../../infrastructure/artwork/workspaceArtworkUpload.js";
import { PostgresRoutingRepository } from "../../infrastructure/routing/postgresRoutingRepository.js";
import { PostgresSalesWorkspaceStore, PostgresSalesWorkspaceTransaction } from "../../infrastructure/sales/postgresSalesWorkspace.js";
import { PostgresWorkspaceLinePricing } from "../../infrastructure/sales/postgresWorkspaceLinePricing.js";
import { synchronizeProductionRequirements } from "../../infrastructure/sales/postgresProductionRequirements.js";
import { PostgresOrderEditWorkspace } from "../../infrastructure/sales/postgresOrderEditWorkspace.js";
import { readOrderEditBlockedLines } from "../../infrastructure/sales/postgresOrderEditOperationalContext.js";
import { PostgresWorkspacePromotion } from "../../infrastructure/sales/postgresWorkspacePromotion.js";

// In-memory PostgreSQL only. No dotenv, root Jest setup, URL, pool callback or
// object-restoration rollback. The classified runner supplies the clean env.
assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
assert.deepEqual(Object.keys(process.env).filter(key => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);
jest.setTimeout(90000);

// Evaluate the actual Sales adapter bytes without loading its unrelated default
// Billing/provider closure. Every real dependency stays statically visible above.
// The fixture supplies Billing's SQL port below; this constructor has no methods
// and cannot accidentally fabricate a successful Billing operation.
// VM modules use the current context, with exact host implementation exports.
class UnusedDefaultBilling { constructor(readonly client: PoolClient) {} }
const adapterPath = fileURLToPath(new URL("../../infrastructure/sales/postgresOrderTransaction.ts", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const dependencies = new Map<string, object>([
  ["../compatibility/postgresCustomersRead.js", customerExports], ["../compatibility/postgresProductsRead.js", productExports],
  ["../persistence/postgresOperationRequests.js", requestExports], ["../routing/postgresRoutingRepository.js", routingExports],
  ["../routing/postgresRoutePrerequisites.js", prerequisiteExports], ["./postgresOrderMaterialRequirements.js", materialExports],
  ["./postgresCommercialPrimitives.js", numberingExports], ["./postgresProductionRequirements.js", requirementExports],
  ["./postgresSalesTaxComposition.js", taxExports], ["../../src/modules/sales/orderApplication.js", orderExports],
  ["../../src/modules/sales/orderLifecycle.js", lifecycleExports], ["../../src/modules/sales/persistenceContracts.js", persistenceExports],
  ["../../src/modules/pricing/v2PricingAdapter.js", pricingExports], ["../../src/modules/shared/commercialValues.js", valueExports],
  ["../billing/postgresBillingDraftInvoiceTransaction.js", { PostgresBillingDraftInvoiceTransaction: UnusedDefaultBilling }],
]);
const linked = new Map<string, Module>();
const denyDynamicAdapterImport = (): never => { throw new Error("Dynamic adapter imports are forbidden."); };
function linkAdapterImport(specifier: string, parent: Module): Module {
  if (parent.identifier !== adapterPath) throw new Error("Unexpected adapter parent.");
  if (!specifier.startsWith(".")) throw new Error(`Unexpected external adapter dependency: ${specifier}`);
  const identifier = path.resolve(path.dirname(parent.identifier), specifier).replace(/\.js$/u, ".ts");
  const relative = path.relative(workspaceRoot, identifier).replaceAll("\\", "/");
  if (relative.startsWith("server/") || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`Forbidden V1/outside adapter dependency: ${specifier}`);
  const exports = dependencies.get(specifier);
  if (!exports) throw new Error(`Unexpected adapter dependency: ${specifier}`);
  if (!linked.has(specifier)) linked.set(specifier, new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { identifier }));
  return linked.get(specifier)!;
}
async function evaluateOrderAdapter(name: string) {
  if (name !== "postgresOrderTransaction.ts") throw new Error("Unexpected adapter source.");
  const source = await readFile(adapterPath, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName: adapterPath, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const module = new SourceTextModule(outputText, { identifier: adapterPath,
    importModuleDynamically: denyDynamicAdapterImport });
  await module.link(linkAdapterImport); await module.evaluate(); return module.namespace;
}
const { PostgresOrderTransaction } = await evaluateOrderAdapter("postgresOrderTransaction.ts") as unknown as typeof OrderAdapterExports;

function registerAdapterIsolationTests() {
  describe("Actual SQL adapter evaluation has a closed, reviewed import boundary", () => {
    test.each(["../../../server/db.js", "../../../server/quickbooksService.js", "../../../../outside.js", "pg", "dotenv/config", "node:net", "node:fs", "./unreviewedDependency.js"])("rejects %s before dependency evaluation", specifier => {
      const parent = new SourceTextModule("", { identifier: adapterPath });
      assert.throws(() => linkAdapterImport(specifier, parent), /Unexpected|Forbidden/);
    });
    test("rejects any source except the actual Sales adapter before reading it", async () => {
      await assert.rejects(evaluateOrderAdapter("../../../server/db.ts"), /Unexpected adapter source/);
      await assert.rejects(evaluateOrderAdapter("postgresQuoteTransaction.ts"), /Unexpected adapter source/);
      assert.equal(dependencies.size, 15); assert.equal(linked.size, 15);
    });
    test("rejects dynamic imports before any future dependency or provider can load", async () => {
      const probe = new SourceTextModule("await import('../../../server/db.js');", { identifier: adapterPath, importModuleDynamically: denyDynamicAdapterImport });
      await probe.link(linkAdapterImport);
      await assert.rejects(probe.evaluate(), /Dynamic adapter imports are forbidden/);
    });
    test("uses the exact host canonical application and error constructor identity", async () => {
      const probe = new SourceTextModule("import { OrderApplicationService } from '../../src/modules/sales/orderApplication.js'; export { OrderApplicationService };", { identifier: adapterPath });
      await probe.link(linkAdapterImport); await probe.evaluate();
      const { OrderApplicationService: Owner } = probe.namespace as unknown as typeof orderExports;
      assert.equal(Owner, orderExports.OrderApplicationService);
      const application = new Owner({ transaction: async () => { throw new Error("Revoked authority must fail before the transaction."); } });
      const actor = context("vm-host-error-identity", ["order.view"]);
      const result = await application.update(actor, { orderId: brandedId<"OrderId">(randomUUID()), expectedRevision: "1", businessRequestId: brandedId<"BusinessRequestId">(actor.businessRequest!.id), patch: {} }, { touchRevision: true });
      assert.equal(result.ok, false);
      if (!result.ok) { assert.ok(result.error instanceof V2ApplicationError); assert.equal(result.error.code, "FORBIDDEN"); }
    });
  });
}
registerAdapterIsolationTests();

const org = brandedId<"OrganizationId">(randomUUID()), foreignOrg = brandedId<"OrganizationId">(randomUUID()), staff = randomUUID(), otherStaff = randomUUID();
const customer = brandedId<"CustomerId">(randomUUID()), otherCustomer = brandedId<"CustomerId">(randomUUID()), product = randomUUID(), version = randomUUID();
const material = randomUUID(), recipe = randomUUID(), component = randomUUID(), routeTemplate = randomUUID();
const usd = currencyCode("USD");
const grants: readonly Capability[] = ["order.view", "order.edit", "order.overridePrice", "artwork.view", "artwork.adopt", "artwork.assign"];
function context(requestId: string = randomUUID(), capabilities = grants, userId: string = staff, organizationId: string = org): OperationContext {
  return { organizationId, operationId: "sales.order-edit.acceptance", businessRequest: { id: requestId, payloadFingerprint: "untrusted-wire-fingerprint" },
    principal: { kind: "staff", organizationId, userId, authority: { membershipId: `${userId}-membership`, capabilities, authorityRevision: "fresh" } } };
}
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? String(item) : item));
const errorCode = (code: string) => (error: unknown) => { assert.equal((error as { code?: string }).code, code); return true; };

async function fixture() {
  const db = new PGlite();
  let checkedOut = false, insideTransaction = false, failure: string | undefined;
  let writes = false, catalogActive = true, rate = 125, pricingCalls = 0, productCalls = 0, deleteCalls = 0, putCalls = 0;
  const sql: { text: string; values: readonly unknown[] }[] = [];
  const steps: string[] = [];
  const pricedCustomers: string[] = [];
  let readFailure = "";
  const reached = (step: string) => { steps.push(step); if (failure === step) throw new Error(`Injected owner failure: ${step}`); };
  const client = {
    async query(text: string, values: readonly unknown[] = []) {
      sql.push({ text, values });
      if (text === "BEGIN") assert.equal(insideTransaction, false, "No nested SQL transaction.");
      const result = await db.query<Record<string, unknown>>(text, [...values]);
      // Match node-postgres int8 decoding; JSONB remains actual PostgreSQL JSON.
      const rows = result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, value != null && result.fields.find(field => field.name === key)?.dataTypeID === 20 ? String(value) : value])));
      if (text === "BEGIN") insideTransaction = true;
      if (text === "COMMIT" || text === "ROLLBACK") insideTransaction = false;
      if (/^UPDATE v2_sales_documents SET/.test(text) && /revision=revision\+1/.test(text)) { writes = true; reached("sales.cas"); }
      if (/^INSERT INTO v2_sales_workspace_promotion_lines/.test(text)) reached("workspace.line-map");
      if (/^INSERT INTO v2_artwork_assignment_removals/.test(text)) reached("artwork.remove");
      if (/^INSERT INTO v2_artwork_files/.test(text)) reached("artwork.file");
      if (/^INSERT INTO v2_artwork_assignments/.test(text)) reached("artwork.assignment");
      if (/^INSERT INTO v2_artwork_workspace_edit_applications/.test(text)) reached("artwork.application");
      if (/^UPDATE v2_artwork_workspace_claims SET/.test(text) && /state='promoted'/.test(text)) reached("artwork.claim");
      if (/^UPDATE v2_artwork_storage_upload_intents SET/.test(text) && /state='adopted'/.test(text)) reached("artwork.ledger");
      if (/^INSERT INTO v2_sales_workspace_promotions/.test(text)) reached("workspace.receipt");
      if (/^UPDATE v2_sales_workspaces SET/.test(text) && values.includes("promoted")) reached("workspace.final-state");
      return { ...result, rows, rowCount: result.affectedRows ?? rows.length };
    },
    release() { assert.equal(checkedOut, true); checkedOut = false; },
  } as unknown as PoolClient;
  const pool = { async connect() { assert.equal(checkedOut, false, "Every owner must join the caller's client, not acquire a second pool connection."); checkedOut = true; return client; } } as unknown as Pool;
  const transaction = async <T>(action: () => Promise<T>): Promise<T> => {
    await client.query("BEGIN");
    try { const result = await action(); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  };
  const migration = (name: string) => readFile(new URL(`../../../server/db/migrations_v2/${name}`, import.meta.url), "utf8");
  const apply = async (name: string, before?: string, from?: string) => {
    let ddl = await migration(name);
    if (from) { const offset = ddl.indexOf(from); assert.ok(offset >= 0, `Original migration marker missing: ${name}`); ddl = ddl.slice(offset); }
    if (before) { const offset = ddl.indexOf(before); assert.ok(offset >= 0, `Original migration marker missing: ${name}`); ddl = ddl.slice(0, offset); }
    await db.exec(ddl);
  };
  // Foreign-owner prerequisites only. Workspace, Artwork, Sales, Billing,
  // Routing, Proof, Prepress, Production and material tables use real DDL below.
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),is_tax_exempt boolean NOT NULL DEFAULT false,tax_exempt_reason text,tax_exempt_certificate_ref text,UNIQUE(id,organization_id));
    CREATE TABLE customer_contacts(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),UNIQUE(id,organization_id));
    CREATE TABLE products(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id));
    CREATE TABLE product_types(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id));
    CREATE TABLE pbv2_tree_versions(id varchar PRIMARY KEY);
    CREATE TABLE materials(id varchar PRIMARY KEY);
    CREATE TABLE v2_product_recipes(id varchar PRIMARY KEY);
    CREATE TABLE v2_product_recipe_components(id varchar PRIMARY KEY,quantity_kind text CONSTRAINT v2_product_recipe_components_quantity_kind_check CHECK(quantity_kind IN ('fixed','per_line')));
    CREATE TABLE v2_order_replacement_obligations(id varchar PRIMARY KEY,organization_id varchar,order_document_id varchar,order_line_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_order_replacement_obligation_events(event_kind varchar CONSTRAINT v2_replacement_obligation_events_kind_chk CHECK(event_kind IN ('created')));
    CREATE TABLE v2_fulfillment_shipments(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_fulfillment_shipment_shipping_allocations(id varchar PRIMARY KEY,organization_id varchar);`);
  for (const id of [org, foreignOrg]) await db.query("INSERT INTO organizations VALUES($1)", [id]);
  for (const id of [staff, otherStaff]) await db.query("INSERT INTO users VALUES($1)", [id]);
  for (const id of [customer, otherCustomer]) await db.query("INSERT INTO customers(id,organization_id) VALUES($1,$2)", [id, org]);
  await db.query("INSERT INTO products VALUES($1,$2)", [product, org]);
  for (const [table, id] of [["pbv2_tree_versions", version], ["materials", material], ["v2_product_recipes", recipe]] as const) await db.query(`INSERT INTO ${table} VALUES($1)`, [id]);
  await db.query("INSERT INTO v2_product_recipe_components VALUES($1,'per_line')", [component]);
  await apply("0180_v2_foundation_persistence.sql");
  await apply("0187_v2_sales_commercial_persistence.sql");
  await apply("0189_v2_sales_document_and_conversion_integrity.sql");
  await apply("0192_v2_quote_operation_audit_and_override_capability.sql", "-- Selling-price authority");
  await apply("0193_v2_routing_identity_foundation.sql");
  await apply("0194_v2_route_completed_current_step_repair.sql");
  await apply("0195_v2_order_draft_invoice_vertical_slice.sql", "-- Override authority");
  await apply("0197_v2_artwork_domain_foundation.sql", "-- Only future template-derived");
  await apply("0199_v2_proofing_domain_foundation.sql", "\nINSERT INTO v2_permission_capabilities");
  await apply("0201_v2_prepress_domain_foundation.sql", "\nINSERT INTO v2_permission_capabilities");
  await apply("0202_v2_required_production_unit_specification.sql");
  await apply("0203_v2_production_requirement_count_integrity.sql");
  await apply("0204_v2_production_domain_foundation.sql", "\nINSERT INTO v2_permission_capabilities");
  await apply("0205_v2_fulfillment_domain_foundation.sql", "\nINSERT INTO v2_permission_capabilities");
  await apply("0283_v2_replacement_obligations_shipping_economics.sql", "-- Shipping cost", "ALTER TABLE v2_fulfillment_handoffs ADD COLUMN");
  await apply("0206_v2_invoice_lifecycle_foundation.sql");
  await apply("0211_v2_order_line_material_requirements.sql");
  await apply("0227_v2_order_commercial_context.sql");
  await apply("0228_v2_sales_tax_and_quote_commercial_continuity.sql");
  await apply("0239_v2_destination_sales_tax_jurisdictions.sql");
  await apply("0242_v2_quote_artwork_lineage.sql");
  await apply("0244_v2_order_artwork_replacement_lineage.sql");
  await apply("0246_v2_artwork_storage_reconciliation.sql");
  await apply("0247_v2_job_derived_invoice_numbering.sql");
  await apply("0258_v2_order_completion_archive_lifecycle.sql");
  await apply("0260_v2_live_order_invoice_revisions.sql");
  await apply("0266_v2_frozen_route_destination_snapshot.sql");
  await apply("0278_v2_order_line_operational_notes.sql");
  await apply("0285_v2_billable_replacement_invoices.sql");
  await apply("0287_v2_shipment_shipping_invoice_projection.sql");
  await apply("0289_v2_billing_invoice_revision_history_immutability.sql");
  await apply("0290_v2_artwork_additive_line_assignments.sql");
  await apply("0291_v2_artwork_assignment_removal.sql");
  await apply("0294_v2_sales_workspace_foundation.sql");
  await apply("0295_v2_sales_workspace_artwork.sql");
  await apply("0296_v2_order_edit_workspaces.sql");
  await apply("0297_v2_order_edit_artwork.sql");
  await db.query("INSERT INTO v2_sales_tax_jurisdictions(id,organization_id,name,country_code,region_code,rate_basis_points,home_business) VALUES($1,$2,'Fixture zero-rate','US','WA',0,true)", [randomUUID(), org]);
  await db.query("INSERT INTO v2_route_templates(id,organization_id,name,normalized_name,definition_fingerprint) VALUES($1,$2,'Acceptance route','acceptance-route','frozen-route')", [routeTemplate, org]);
  await db.query("INSERT INTO v2_route_template_steps(id,organization_id,route_template_id,position,step_kind) VALUES($1,$2,$3,0,'fulfillment')", [randomUUID(), org, routeTemplate]);
  // This fixture route has no Production step, so its destination relation is
  // only a foreign-owner read target, not a simulated Routing mutation.
  await db.exec("CREATE TABLE v2_route_template_production_destinations(organization_id varchar,route_template_step_id varchar,station_key varchar)");

  const pricing = new V2PricingParityAdapter();
  const unexpectedProductRead = async (): Promise<never> => { throw new Error("Unexpected Product API outside the explicit active-pricing fixture port."); };
  const products: OrderTransaction["products"] = {
    resolveHistoricalPricingConfiguration: unexpectedProductRead,
    getSellableProduct: unexpectedProductRead,
    resolveProductType: unexpectedProductRead,
    getActivePricingConfiguration: unexpectedProductRead,
    validateSellableProduct: unexpectedProductRead,
    resolveCurrentRoutingProduct: unexpectedProductRead,
    resolveVersionRoutingPolicy: unexpectedProductRead,
    async resolveActivePricingInput(input) {
      productCalls++;
      if (!catalogActive) throw new Error("Inactive Product lookup must not occur for inherited presentation edits.");
      return success({ sellableProduct: { organizationId: brandedId<"OrganizationId">(org), productId: brandedId<"ProductId">(product), displayName: "Current fixture product",
        lifecycle: "active", requiresDimensions: false, pricingCurrency: usd, pricingConfiguration: { id: brandedId<"PricingConfigurationId">(version), version: "1", contentHash: "current-fixture-v1" } },
      resolvedConfiguration: { schemaVersion: 1, organizationId: brandedId<"OrganizationId">(org), productId: brandedId<"ProductId">(product),
        pricingConfigurationId: brandedId<"PricingConfigurationId">(version), pricingConfigurationVersion: "1", pricingConfigurationContentHash: "current-fixture-v1",
        quantity: input.quantity, selections: input.selections ?? {}, derivedFacts: {}, productFacts: {} }, rules: { base: { perPieceCents: rate } }, warnings: [] });
    },
    async resolveCurrentTaxability() { return { taxable: true }; },
    async resolveOrderRoutability() { return { kind: "routable", productName: "Current fixture product", routing: { kind: "route_required", routeTemplateId: brandedId<"RouteTemplateId">(routeTemplate), routeTemplateName: "Acceptance route",
      sourceTemplateRevision: "1", sourceTemplateFingerprint: "frozen-route", steps: [{ position: 0, kind: "fulfillment" }] } }; },
  };
  const customers: OrderTransaction["customers"] = {
    async validateContactReference(reference) { return reference.organizationId === org && !!reference.customerId && [customer, otherCustomer].includes(reference.customerId); },
    async getContact() { return null; },
    async getCustomer() { return null; },
    async getPresentationIdentity() { return {}; },
  };
  const customerPricing: NonNullable<OrderTransaction["customerPricing"]> = {
    async calculateForCustomer(id, input) { pricingCalls++; pricedCustomers.push(id); assert.equal(input.pricingContext.channel, "staff");
      const result = await pricing.calculate({ ...input, rules: { ...input.rules, base: { perPieceCents: id === otherCustomer ? rate + 500 : rate } } });
      reached("pricing.evaluate"); return result; },
  };
  const routing = new PostgresRoutingRepository(client, { afterInstance: () => reached("routing.instance"), afterFrozenStep: () => reached("routing.step") });
  const invoiceRead = async (organizationId: string, orderId: string): Promise<DraftInvoiceReadModel | null> => {
    const row = (await client.query<any>("SELECT * FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$2 AND replacement_obligation_id IS NULL", [organizationId, orderId])).rows[0];
    if (!row) return null;
    const lines = (await client.query<any>("SELECT * FROM v2_billing_invoice_lines WHERE organization_id=$1 AND invoice_id=$2 ORDER BY position", [organizationId, row.id])).rows;
    return { invoiceId: row.id, organizationId: brandedId<"OrganizationId">(organizationId), sourceOrderId: brandedId<"OrderId">(orderId), lifecycle: row.invoice_state,
      currency: usd, synchronizationVersion: String(row.synchronization_version), subtotal: money(usd, Number(row.subtotal_cents)), taxTotal: money(usd, Number(row.tax_total_cents)), total: money(usd, Number(row.total_cents)),
      lines: lines.map(line => ({ sourceOrderLineId: line.source_sales_line_id, productId: line.product_id, description: line.description, quantity: line.quantity,
        sellingUnitAmount: money(usd, Number(line.selling_unit_cents)), lineAmount: money(usd, Number(line.selling_line_cents)) })), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  };
  const synchronizeInvoice = async (input: DraftInvoiceSynchronizationInput) => {
    const invoice = await invoiceRead(input.organizationId, input.orderId); assert.ok(invoice);
    const subtotal = input.salesLines.reduce((sum, line) => sum + line.sellingLineAmount.cents, 0);
    await client.query("UPDATE v2_billing_invoices SET customer_id=$3,purchase_order_number=$4,terms_code=$5,source_sales_state_token=$6,synchronization_version=synchronization_version+1,subtotal_cents=$7,total_cents=$7,updated_at=now() WHERE organization_id=$1 AND id=$2",
      [input.organizationId, invoice.invoiceId, input.customerContact.customerId ?? null, input.purchaseOrderNumber ?? null, input.termsCode ?? null, input.sourceSalesStateToken, subtotal]);
    await client.query("DELETE FROM v2_billing_invoice_lines WHERE organization_id=$1 AND invoice_id=$2", [input.organizationId, invoice.invoiceId]);
    for (const [position, line] of input.salesLines.entries()) await client.query(`INSERT INTO v2_billing_invoice_lines(id,organization_id,invoice_id,sales_order_document_id,source_sales_line_id,position,product_id,description,quantity,currency,selling_unit_cents,selling_line_cents,sales_pricing_evidence_fingerprint)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'USD',$10,$11,$12)`, [randomUUID(), input.organizationId, invoice.invoiceId, input.orderId, line.lineId, position, line.productId, line.description, line.quantity, line.sellingUnitAmount.cents, line.sellingLineAmount.cents, line.salesPricingEvidenceFingerprint]);
    reached("billing.synchronize");
    return { status: "synchronized" as const, invoiceId: invoice.invoiceId, synchronizationVersion: String(Number(invoice.synchronizationVersion) + 1) };
  };
  const freezeMaterial = async (organizationId: string, orderId: string, lines: readonly SalesLineSnapshot[]) => {
    for (const line of lines) await client.query(`INSERT INTO v2_order_line_material_requirements(id,organization_id,order_document_id,order_line_id,source_product_version_id,source_recipe_id,source_recipe_component_id,source_configuration_id,material_id,material_name_snapshot,quantity,quantity_unit,quantity_mode)
      VALUES($1,$2,$3,$4,$5,$6,$7,$5,$8,'Frozen fixture requirement',1,'each','per_line')`, [randomUUID(), organizationId, orderId, line.lineId, version, recipe, component, material]);
    reached("materials.freeze");
  };
  const sourceRead = async (organizationId: string, orderId: string, lock = false): Promise<OrderReadModel | null> => {
    const adapter = new PostgresOrderTransaction(client);
    Object.assign(adapter, { routing, billing: { readInvoiceForOrder: invoiceRead, readDraftForOrder: invoiceRead },
      completionEligibility: async () => ({ eligible: false, blockers: [], lines: [] }) });
    const actual = await adapter.read(brandedId<"OrganizationId">(organizationId), brandedId<"OrderId">(orderId), lock).catch(error => { readFailure = String(error); throw error; });
    if (!actual) return null;
    // Only decode the actual read DTO into the host JSON realm. SQL state and
    // rollback remain in PGlite; retain the owner's bigint number exactly.
    return { ...wire(actual), number: { ...wire(actual.number), core: actual.number.core } };
  };
  const orderTransaction = (sameClient: PoolClient): OrderTransaction => {
    assert.equal(sameClient, client); assert.equal(insideTransaction, true);
    const canonical = new PostgresOrderTransaction(client);
    return { ...canonical, customers, products, pricing, customerPricing, routing,
      billing: { createDraftInvoice: async () => { throw new Error("Edit must never create another Invoice."); }, synchronizeDraftInvoice: synchronizeInvoice,
        readDraftForOrder: invoiceRead, readInvoiceForOrder: invoiceRead },
      materialRequirements: { freeze: freezeMaterial, async hasFrozen(organizationId, lineId) {
        return (await client.query("SELECT id FROM v2_order_line_material_requirements WHERE organization_id=$1 AND order_line_id=$2", [organizationId, lineId])).rows.length > 0;
      } },
      reserve: async input => { const result = await canonical.reserve(input); reached("sales.reserve"); return result; },
      read: sourceRead,
      update: async input => { const result = await canonical.update(input); reached("sales.persist-lines"); return result; },
      removeLinesNotIn: async (...args) => { await canonical.removeLinesNotIn(...args); reached("sales.remove-lines"); },
      hasRoute: async (...args) => canonical.hasRoute(...args),
      hasFulfillmentHandoff: (...args) => canonical.hasFulfillmentHandoff(...args),
      reopen: (...args) => canonical.reopen(...args),
      cancellationBlockers: (...args) => canonical.cancellationBlockers(...args),
      completionEligibility: (...args) => canonical.completionEligibility(...args),
      complete: (...args) => canonical.complete(...args),
      archive: (...args) => canonical.archive(...args),
      unarchive: (...args) => canonical.unarchive(...args),
      cancel: (...args) => canonical.cancel(...args),
      audit: async input => { await canonical.audit(input); reached("sales.audit"); },
      attribute: async input => { await canonical.attribute(input); reached("sales.attribute"); },
      succeed: async (...args) => { await canonical.succeed(...args); reached("sales.succeed"); },
      allocateNumber: async () => { throw new Error("Edit must never allocate another Order number."); },
      create: async () => { throw new Error("Edit must never create another Order."); },
    };
  };
  const orderView = new orderExports.OrderApplicationService({
    transaction: action => transaction(() => action(orderTransaction(client))),
  });
  let nextNumber = 7000;
  const freshOrder = async (lineCount = 3, options: Readonly<{ historicalPrice?: "locked" | "discount"; issued?: boolean; production?: boolean }> = {}) => {
    const orderId = brandedId<"OrderId">(randomUUID()), invoiceId = randomUUID(); nextNumber++;
    const terms = { termsCode: "net_30", taxContextReference: "source-tax-evidence", salesRepresentativeId: staff, commercialNotes: "Full source commercial notes" };
    await transaction(async () => {
      await client.query(`INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency,terms_json,tax_context_reference,sales_representative_id,commercial_notes,job_label,purchase_order_number)
        VALUES($1,$2,'order',$3,$4,$5,'USD',$6::jsonb,$7,$8,$9,'Source canonical Job Label','SOURCE-PO')`, [orderId, org, nextNumber, `ORD-${nextNumber}`, customer, JSON.stringify({ termsCode: terms.termsCode }), terms.taxContextReference, terms.salesRepresentativeId, terms.commercialNotes]);
      await client.query("INSERT INTO v2_sales_order_details(document_id,organization_id,requested_fulfillment_method,fulfillment_instructions) VALUES($1,$2,'pickup','Source pickup instructions')", [orderId, org]);
      const lines: SalesLineSnapshot[] = [];
      for (let position = 0; position < lineCount; position++) {
        const input = { organizationId: brandedId<"OrganizationId">(org), productId: brandedId<"ProductId">(product), quantity: position + 2, selections: {} };
        const resolved = await products.resolveActivePricingInput(input); if (!resolved.ok) throw resolved.error;
        const configuration = { ...resolved.value.resolvedConfiguration,
          ...(options.production ? { productionRequirements: resolveProductionRequirementSnapshot({ schemaVersion: 1, rules: [{ key: "single" }] }, {}) } : {}) };
        const calculated = await pricing.calculate({ ...resolved.value, resolvedConfiguration: configuration, organizationId: input.organizationId, pricingContext: { channel: "staff", effectiveAt: new Date().toISOString() } });
        const selling = options.historicalPrice ? money(usd, calculated.calculatedLineAmount.cents - 50) : calculated.calculatedLineAmount;
        const decision = { kind: options.historicalPrice ?? "calculated", pricingResultId: calculated.id, calculatedUnitAmount: calculated.calculatedUnitAmount,
          calculatedLineAmount: calculated.calculatedLineAmount, resultingUnitAmount: money(usd, Math.round(selling.cents / input.quantity)), resultingLineAmount: selling,
          decidedAt: "2026-09-01T00:00:00.000Z", authorityReference: { principalKind: "staff" as const, subjectId: staff },
          ...(options.historicalPrice ? { reason: "Frozen source price evidence", ...(options.historicalPrice === "discount" ? { discountBasisPoints: 1000 } : {}) } : {}) };
        const line = { lineId: brandedId<"SalesLineId">(randomUUID()), productId: brandedId<"ProductId">(product), description: `Source line ${position}`, quantity: input.quantity,
          operationalNote: `Source staff note ${position}`, resolvedConfiguration: configuration, pricingResult: calculated, sellingPriceDecision: decision,
          calculatedLineAmount: calculated.calculatedLineAmount, sellingLineAmount: selling, taxability: { taxable: true, source: "product" as const } } as SalesLineSnapshot;
        lines.push(line);
        await client.query(`INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,operational_note,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision,taxability_snapshot)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb)`, [line.lineId, org, orderId, position, product, line.description, line.operationalNote, line.quantity,
          calculated.calculatedUnitAmount.cents, calculated.calculatedLineAmount.cents, decision.resultingUnitAmount.cents, selling.cents, calculated.id, calculated.evidenceFingerprint,
          JSON.stringify(line.resolvedConfiguration), JSON.stringify(calculated), JSON.stringify(decision), JSON.stringify(line.taxability)]);
        if (options.production) await synchronizeProductionRequirements(client, brandedId<"OrganizationId">(org), brandedId<"OrderId">(orderId), line);
      }
      const total = lines.reduce((sum, line) => sum + line.sellingLineAmount.cents, 0);
      await client.query(`INSERT INTO v2_billing_invoices(id,organization_id,sales_order_document_id,customer_id,invoice_state,currency,source_sales_state_token,subtotal_cents,total_cents,tax_calculator_version)
        VALUES($1,$2,$3,$4,'draft','USD','1',$5,$5,'fixture-zero-tax')`, [invoiceId, org, orderId, customer, total]);
      await synchronizeInvoice({ organizationId: brandedId<"OrganizationId">(org), orderId: brandedId<"OrderId">(orderId), businessRequestId: brandedId<"BusinessRequestId">(randomUUID()),
        customerContact: { organizationId: brandedId<"OrganizationId">(org), customerId: brandedId<"CustomerId">(customer) }, currency: usd, sourceSalesStateToken: "1", termsCode: terms.termsCode,
        salesLines: lines.map(line => ({ lineId: line.lineId, productId: line.productId, description: line.description, quantity: line.quantity, sellingUnitAmount: line.sellingPriceDecision.resultingUnitAmount,
          sellingLineAmount: line.sellingLineAmount, salesPricingEvidenceFingerprint: line.pricingResult.evidenceFingerprint })), taxInput: {} });
      if (options.issued) {
        await client.query("UPDATE v2_billing_invoices SET invoice_state='issued',issued_at=now(),issued_principal_kind='staff',issued_principal_subject=$3,invoice_display_number=$4,invoice_sequence=1 WHERE organization_id=$1 AND id=$2", [org, invoiceId, staff, `ORD-${nextNumber}-I1`]);
        await client.query("INSERT INTO v2_billing_invoice_checkpoints(id,organization_id,invoice_id,schema_version,evidence_fingerprint,checkpoint_json) VALUES($1,$2,$3,1,'frozen-issuance',$4::jsonb)", [randomUUID(), org, invoiceId, JSON.stringify({ orderId, invoiceId, total })]);
      }
    });
    return { orderId, invoiceId, terms, source: (await sourceRead(org, orderId))! };
  };
  const store = () => new PostgresSalesWorkspaceStore(pool);
  const sales = () => new SalesWorkspaceApplicationService(store(), { onDiscard: (tx, workspace) => {
    assert.ok(tx instanceof PostgresSalesWorkspaceTransaction); return requestWorkspaceArtworkCleanupInTransaction(tx.client, { organizationId: workspace.organizationId, workspaceId: workspace.id });
  } });
  const lines = () => new SalesWorkspaceLineService(store(), { pricing: tx => {
    assert.ok(tx instanceof PostgresSalesWorkspaceTransaction); return new PostgresWorkspaceLinePricing(tx.client, { products, customers, pricing, customerPricing });
  }, releaseLineArtwork: (tx, workspace, lineId) => {
    assert.ok(tx instanceof PostgresSalesWorkspaceTransaction); return requestWorkspaceArtworkCleanupInTransaction(tx.client, { organizationId: workspace.organizationId, workspaceId: workspace.id, workspaceLineId: lineId });
  } });
  const objects = new Map<string, Uint8Array>();
  const storage: ArtworkBinaryStorage = { async put(input) { assert.equal(insideTransaction, false); putCalls++; objects.set(input.objectKey, input.bytes); return { storageProvider: "supabase", objectKey: input.objectKey, created: true }; },
    async read(key) { assert.ok(objects.has(key)); return Buffer.from(objects.get(key)!); }, async exists(key) { return objects.has(key); },
    async remove(key) { assert.equal(insideTransaction, false); deleteCalls++; objects.delete(key); } };
  const claims = new PostgresWorkspaceArtwork(pool, storage), uploads = new WorkspaceArtworkUploadService(claims, storage);
  const artwork = () => new ArtworkApplicationService(new PostgresArtworkTransactionRunner(pool));
  const references = () => new PostgresOrderEditArtwork(pool);
  const edit = new PostgresOrderEditWorkspace(pool, {
    orderTransaction,
    artwork: sameClient => {
      assert.equal(sameClient, client); assert.equal(insideTransaction, true);
      const source = (actor: OperationContext, workspace: SalesWorkspace) => ({ context: actor, workspaceId: workspace.id, orderId: workspace.sourceDocumentId! });
      return {
        captureFingerprint: (actor, orderId) => captureOrderEditArtworkFingerprint(client, { context: actor, orderId }),
        async initializeWorkspace(actor, workspace) {
          const captured = await captureOrderEditArtwork(client, { ...source(actor, workspace), lineMap: workspace.lines.map(line => ({ workspaceLineId: line.id, canonicalLineId: line.sourceLineId! })) });
          assert.equal(captured.fingerprint, workspace.sourceArtifactFingerprint);
        },
        async validate(actor, workspace) { const result = await validateOrderEditArtworkInTransaction(client, source(actor, workspace)); reached("artwork.validate"); return { changed: result.hasChanges }; },
        async apply(actor, workspace, lineMap) { const result = await applyOrderEditArtworkInTransaction(client, { ...source(actor, workspace), lineMap });
          reached("artwork.apply"); return { changed: result.removedCount + result.promotedCount > 0 }; },
        authorizeReplay: (actor, workspace) => authorizeOrderEditArtworkReplay(client, source(actor, workspace)),
      };
    },
    async billingEditGuard(sameClient, actor, orderId) {
      assert.equal(sameClient, client);
      const assessment = await assessOrderEditBillingInTransaction(client, { organizationId: actor.organizationId, orderId });
      reached("billing.guard"); return assessment;
    },
    async readProductionContext(sameClient, organizationId, orderId, lineIds) {
      assert.equal(sameClient, client);
      return readOrderEditBlockedLines(client, organizationId, orderId, lineIds);
    },
    async reconcileOrderInTransaction(sameClient, organizationId, orderId) {
      assert.equal(sameClient, client); assert.equal(insideTransaction, true);
      const order = (await client.query("SELECT commercial_state FROM v2_sales_order_details WHERE organization_id=$1 AND document_id=$2", [organizationId, orderId])).rows[0];
      assert.equal(order?.commercial_state, "open", "The fixture exercises an open Order, not an invented completion policy."); reached("sales.reconcile");
    },
  });
  const promotion = new PostgresWorkspacePromotion(pool, async () => { throw new Error("Order edit Artwork must use the edit owner protocol."); }, {
    quoteTransaction: () => { throw new Error("Order edit must never call Quote.create."); },
    orderTransaction: () => { throw new Error("Order edit must dispatch to canonical Order.update, never Order.create."); },
    orderEditHandler: edit.saveInTransaction,
  });
  const pdf = new Uint8Array(await readFile(new URL("../fixtures/p7-qa-artwork.pdf", import.meta.url)));
  const canonicalTables = ["v2_sales_documents", "v2_sales_order_details", "v2_sales_document_lines", "v2_sales_document_number_counters", "v2_sales_quote_checkpoints", "v2_sales_quote_conversions",
    "v2_billing_invoices", "v2_billing_invoice_lines", "v2_billing_invoice_checkpoints", "v2_billing_invoice_additional_charges", "v2_billing_invoice_revisions",
    "v2_route_instances", "v2_route_instance_steps", "v2_artwork_files", "v2_artwork_assignments", "v2_artwork_assignment_removals", "v2_quote_accepted_artwork_snapshots",
    "v2_proof_works", "v2_proof_versions", "v2_proof_responses", "v2_proof_version_artwork", "v2_prepress_units", "v2_production_works", "v2_production_attempts",
    "v2_fulfillment_handoffs", "v2_fulfillment_handoff_lines", "v2_fulfillment_shipments", "v2_fulfillment_shipment_shipping_allocations", "v2_order_replacement_obligations", "v2_order_line_material_requirements", "v2_sales_line_production_requirements", "v2_audit_events"];
  const snapshot = async (tables = canonicalTables) => {
    const result: Record<string, unknown> = {};
    for (const table of tables) result[table] = (await db.query<{ evidence: unknown }>(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS evidence FROM ${table} t`)).rows[0]!.evidence;
    return result;
  };
  return { db, client, pool, sql, steps, pricedCustomers, reached, transaction, orderTransaction, orderView, freshOrder, sourceRead, sales, lines, artwork, references, claims, uploads, pdf, objects, snapshot, canonicalTables, edit, promotion,
    counts: () => ({ pricingCalls, productCalls, deleteCalls, putCalls }),
    clearTrace() { sql.length = 0; steps.length = 0; writes = false; pricedCustomers.length = 0; readFailure = ""; },
    readFailure: () => readFailure,
    reset() { assert.equal(checkedOut, false); assert.equal(insideTransaction, false); failure = undefined; writes = false; steps.length = 0; sql.length = 0; catalogActive = true; rate = 125; readFailure = ""; },
    inject(step?: string) { failure = step; }, setCatalog(active: boolean, cents = rate) { catalogActive = active; rate = cents; }, written: () => writes,
    async close() { assert.equal(checkedOut, false); assert.equal(insideTransaction, false); await db.close(); } };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
let f: Fixture;
beforeAll(async () => { f = await fixture(); });
afterEach(() => f?.reset());
afterAll(async () => { await f?.close(); });

const open = (orderId: string, actor = context(), expectedSourceRevision = "1") =>
  f.edit.start(actor, { requestId: actor.businessRequest!.id, sourceOrderId: orderId, expectedSourceRevision });
const get = (workspace: SalesWorkspace, actor = context()) => f.sales().get(actor, workspace.id);
async function header(workspace: SalesWorkspace, patch: Partial<SalesWorkspace["header"]>, actor = context()) {
  return f.sales().saveDraft(actor, workspace.id, { requestId: actor.businessRequest!.id, expectedRevision: workspace.revision, header: { ...workspace.header, ...patch } });
}
async function add(workspace: SalesWorkspace, input: Partial<SalesWorkspace["lines"][number]["input"]> = {}, actor = context()) {
  return f.lines().add(actor, workspace.id, { requestId: actor.businessRequest!.id, expectedRevision: workspace.revision,
    line: { productId: product, description: "Explicit new commercial line", quantity: 5, ...input } });
}
async function editLine(workspace: SalesWorkspace, index: number, patch: Partial<SalesWorkspace["lines"][number]["input"]>, note?: string, actor = context()) {
  return f.lines().update(actor, workspace.id, { lineId: workspace.lines[index]!.id, requestId: actor.businessRequest!.id, expectedRevision: workspace.revision,
    line: { ...workspace.lines[index]!.input, ...patch }, ...(note === undefined ? {} : { operationalNote: note }) });
}
async function save(workspace: SalesWorkspace, actor = context()) {
  const input = { workspaceId: workspace.id, target: "order" as const, requestId: actor.businessRequest!.id, expectedRevision: workspace.revision };
  const result = await f.promotion.promote(actor, input);
  if (!result.ok) throw result.error;
  return { ...result.value, input, actor };
}
async function stage(workspace: SalesWorkspace, lineId = workspace.lines[0]!.id, actor = context()) {
  const result = await f.uploads.upload(actor, { workspaceId: workspace.id, workspaceLineId: lineId, requestId: actor.businessRequest!.id,
    expectedRevision: workspace.revision, filename: "M1 explicit TEMP source.pdf", contentType: "application/pdf", bytes: f.pdf });
  if (!result.ok) throw result.error;
  return { ...result.value, workspace: await get(workspace, actor) };
}
async function canonicalArtwork(order: Awaited<ReturnType<Fixture["freshOrder"]>>, index = 0, purpose: "customer_supplied" | "production" = "customer_supplied") {
  const actor = context(), businessRequestId = actor.businessRequest!.id;
  const result = await f.artwork().adopt(actor, { businessRequestId,
    objectReference: { storageProvider: "supabase", objectKey: `immutable-canonical/${randomUUID()}.pdf` }, originalFilename: "Existing canonical source.pdf",
    contentType: "application/pdf", byteSize: f.pdf.byteLength, source: "customer_upload",
    usage: { orderId: brandedId<"OrderId">(order.orderId), orderLineId: brandedId<"OrderLineId">(order.source.order.lines[index]!.lineId), purpose } });
  if (!result.ok) throw result.error;
  return result.value;
}
async function removeArtwork(workspace: SalesWorkspace, assignmentId: string, actor = context()) {
  await f.references().stageOrderEditArtworkIntent(actor, workspace.id, assignmentId, "REMOVE", workspace.revision, actor.businessRequest!.id);
  return get(workspace, actor);
}
async function retainShippingCharge(order: Awaited<ReturnType<Fixture["freshOrder"]>>) {
  const shipmentId = randomUUID(), allocationId = randomUUID();
  await f.transaction(async () => {
    await f.client.query("INSERT INTO v2_fulfillment_shipments VALUES($1,$2)", [shipmentId, org]);
    await f.client.query("INSERT INTO v2_fulfillment_shipment_shipping_allocations(id,organization_id) VALUES($1,$2)", [allocationId, org]);
    await f.client.query(`INSERT INTO v2_billing_invoice_additional_charges(organization_id,invoice_id,sales_order_document_id,charge_kind,source_shipment_id,shipment_shipping_allocation_id,customer_charge_cents,tax_cents,tax_evidence,created_principal_kind,created_principal_subject)
      VALUES($1,$2,$3,'shipping',$4,$5,211,0,'{}','staff',$6)`, [org, order.invoiceId, order.orderId, shipmentId, allocationId, staff]);
    await f.client.query("UPDATE v2_billing_invoices SET subtotal_cents=subtotal_cents+211,total_cents=total_cents+211 WHERE organization_id=$1 AND id=$2", [org, order.invoiceId]);
    await f.client.query("INSERT INTO v2_billing_invoice_revisions(organization_id,invoice_id,revision_number,revision_kind,detail,created_principal_kind,created_principal_subject) VALUES($1,$2,1,'additional_charge','{}','staff',$3)", [org, order.invoiceId, staff]);
  });
}
const casCount = () => f.sql.filter(query => /^UPDATE v2_sales_documents SET/.test(query.text) && /revision=revision\+1/.test(query.text)).length;
const editPersistenceTables = () => [...f.canonicalTables, "v2_operation_requests", "v2_principal_attributions", "v2_sales_workspaces", "v2_sales_workspace_lines", "v2_sales_workspace_requests",
  "v2_sales_order_edit_starts", "v2_sales_workspace_promotions", "v2_sales_workspace_promotion_lines", "v2_artwork_workspace_edit_sessions", "v2_artwork_workspace_edit_refs",
  "v2_artwork_workspace_edit_intents", "v2_artwork_workspace_edit_applications", "v2_artwork_workspace_claims", "v2_artwork_storage_upload_intents"];

describe("Transactional Order edit acceptance with actual PostgreSQL-compatible persistence", () => {
  test("M1 SQL proof uses the original 0294-0297 schema and a real rollback primitive", async () => {
    const triggers = await f.db.query<{ tgname: string }>("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('v2_sales_order_edit_workspace_source_guard','v2_sales_order_edit_line_source_guard','v2_artwork_workspace_edit_session_validate','aa_v2_artwork_order_coordination') ORDER BY tgname");
    assert.deepEqual(triggers.rows.map(row => row.tgname), ["aa_v2_artwork_order_coordination", "aa_v2_artwork_order_coordination", "v2_artwork_workspace_edit_session_validate", "v2_sales_order_edit_line_source_guard", "v2_sales_order_edit_workspace_source_guard"]);
    const order = await f.freshOrder(), before = await f.snapshot();
    await assert.rejects(f.transaction(async () => {
      await f.client.query("UPDATE v2_sales_documents SET purchase_order_number='must rollback',revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, order.orderId]);
      throw new Error("Actual transaction abort");
    }), /Actual transaction abort/);
    assert.deepEqual(await f.snapshot(), before);
    assert.equal((await f.sourceRead(org, order.orderId))?.revision, "1");
  });

  test("M1 opening from a fresh Order view uses view+edit, never create, and preserves full immutable source evidence", async () => {
    const order = await f.freshOrder(3, { historicalPrice: "locked" }), before = await f.snapshot();
    const actor = context(randomUUID(), ["order.view", "order.edit"]), counts = f.counts(); f.setCatalog(false);
    const view = await f.orderView.read(actor, order.orderId); if (!view.ok) throw view.error;
    assert.deepEqual(wire(view.value), wire(order.source));
    const workspace = await open(order.orderId, actor);
    assert.equal(workspace.kind, "order_edit"); assert.equal(workspace.sourceDocumentId, order.orderId); assert.equal(workspace.baseRevision, "1");
    assert.equal(workspace.header.jobLabel, "Source canonical Job Label"); assert.deepEqual(workspace.header.terms, order.terms);
    assert.deepEqual(workspace.sourceHeader?.terms, order.terms);
    assert.equal(workspace.sourceHeader?.orderNumber, order.source.number.display);
    assert.deepEqual(wire(workspace.lines.map(line => line.sourceLineSnapshot)), wire(order.source.order.lines));
    assert.equal(new Set(workspace.lines.map(line => line.id)).size, 3);
    assert.ok(workspace.lines.every(line => line.id !== line.sourceLineId));
    assert.match(workspace.sourceArtifactFingerprint!, /^(?:sha256:)?[a-f0-9]{64}$/);
    assert.deepEqual(f.counts(), counts); assert.deepEqual(await f.snapshot(), before);
    const persisted = await get(workspace, actor);
    assert.deepEqual(wire(persisted), wire(workspace));
    assert.equal((await open(order.orderId, context(randomUUID(), ["order.view", "order.edit"]))).id, workspace.id, "Resume is creator/source scoped.");
    await assert.rejects(open(order.orderId, context(randomUUID(), ["order.create"])), errorCode("FORBIDDEN"));
  });

  test("M1 a stale Staff-view source revision fails before any workspace or canonical write", async () => {
    const order = await f.freshOrder(), before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(open(order.orderId, context(), "999"), errorCode("STALE_STATE"));
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
  });

  test("M1 actual source snapshot DDL prevents workspace/header/line evidence tampering with primitive rollback", async () => {
    const order = await f.freshOrder(), workspace = await open(order.orderId), line = workspace.lines[0]!;
    const before = await f.snapshot(editPersistenceTables());
    const attacks = [
      { text: "UPDATE v2_sales_workspaces SET revision=revision+1,base_revision='999' WHERE id=$1", id: workspace.id },
      { text: "UPDATE v2_sales_workspaces SET revision=revision+1,source_header_json='{}'::jsonb WHERE id=$1", id: workspace.id },
      { text: "UPDATE v2_sales_workspaces SET revision=revision+1,source_artifact_fingerprint='forged' WHERE id=$1", id: workspace.id },
      { text: "UPDATE v2_sales_workspace_lines SET revision=revision+1,source_snapshot='{}'::jsonb WHERE id=$1", id: line.id },
    ];
    for (const attack of attacks) {
      await assert.rejects(f.transaction(() => f.client.query(attack.text, [attack.id])), (error: unknown) => { assert.equal((error as { code?: string }).code, "23514", attack.text); return true; });
      assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
    }
  });

  test("M1 header, description, note, add, remove, mixed reorder and staged Artwork mutate only TEMP state until Cancel", async () => {
    const order = await f.freshOrder(), baseline = await canonicalArtwork(order), before = await f.snapshot();
    let workspace = await open(order.orderId);
    workspace = await header(workspace, { jobLabel: "TEMP edited label", purchaseOrderNumber: "TEMP-PO", terms: { ...workspace.header.terms, commercialNotes: "TEMP commercial notes" } });
    workspace = await editLine(workspace, 0, { description: "TEMP description" }, "TEMP staff note");
    workspace = await add(workspace);
    const added = workspace.lines.at(-1)!;
    workspace = await f.lines().remove(context(), workspace.id, { lineId: workspace.lines[1]!.id, requestId: randomUUID(), expectedRevision: workspace.revision });
    const orderIds = [added.id, workspace.lines[1]!.id, workspace.lines[0]!.id];
    workspace = await f.lines().reorder(context(), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, lineIds: orderIds });
    workspace = await removeArtwork(workspace, baseline.assignment.id);
    const staged = await stage(workspace, added.id); workspace = staged.workspace;
    assert.deepEqual(await f.snapshot(), before);
    const bytes = [...f.objects.entries()].map(([key, value]) => [key, Buffer.from(value).toString("hex")]);
    const deleted = f.counts().deleteCalls;
    const cancelled = await f.sales().discard(context(), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision });
    assert.equal(cancelled.state, "discarded"); assert.deepEqual(await f.snapshot(), before);
    assert.equal(f.counts().deleteCalls, deleted); assert.deepEqual([...f.objects.entries()].map(([key, value]) => [key, Buffer.from(value).toString("hex")]), bytes);
    const canonical = await f.sourceRead(org, order.orderId);
    assert.equal(canonical?.number.display, order.source.number.display); assert.equal(canonical?.revision, "1");
    assert.equal((await f.db.query<{ state: string }>("SELECT state FROM v2_artwork_workspace_claims WHERE id=$1", [staged.claim.id])).rows[0]!.state, "cleanup_pending");
    assert.equal((await f.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM v2_artwork_assignment_removals WHERE artwork_assignment_id=$1", [baseline.assignment.id])).rows[0]!.n, 0);
    await assert.rejects(save(cancelled), errorCode("CONFLICT"));
  });

  test("M1 removing every TEMP line then Cancel creates no canonical assignments and never deletes bytes", async () => {
    const order = await f.freshOrder(1), before = await f.snapshot(); let workspace = await open(order.orderId);
    const staged = await stage(workspace); workspace = staged.workspace;
    workspace = await f.lines().remove(context(), workspace.id, { lineId: workspace.lines[0]!.id, requestId: randomUUID(), expectedRevision: workspace.revision });
    assert.equal(workspace.lines.length, 0); assert.equal(workspace.removedLines?.length, 1);
    await f.sales().discard(context(), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision });
    assert.deepEqual(await f.snapshot(), before); assert.equal(f.counts().deleteCalls, 0); assert.ok(f.objects.size > 0);
  });

  test.each(["locked", "discount"] as const)("M1 %s source price survives header/description/note Save with inactive Product and no Pricing service", async historicalPrice => {
    const order = await f.freshOrder(2, { historicalPrice }), beforeLines = wire(order.source.order.lines), counts = f.counts(); f.setCatalog(false);
    let workspace = await open(order.orderId);
    workspace = await header(workspace, { jobLabel: "Updated Sales label", purchaseOrderNumber: "UPDATED-PO", terms: { ...workspace.header.terms, commercialNotes: "Updated Sales note" } });
    workspace = await editLine(workspace, 1, { description: "Presentation-only description" }, "Updated operational note");
    f.clearTrace(); const result = await save(workspace), current = (await f.sourceRead(org, order.orderId))!;
    assert.equal(result.receipt.documentId, order.orderId); assert.equal(result.receipt.displayNumber, order.source.number.display); assert.equal(current.revision, "2"); assert.equal(casCount(), 1);
    assert.equal(current.order.jobLabel, "Updated Sales label"); assert.deepEqual(current.order.terms, { ...order.terms, commercialNotes: "Updated Sales note" });
    assert.equal(current.order.lines[1]!.description, "Presentation-only description"); assert.equal(current.order.lines[1]!.operationalNote, "Updated operational note");
    for (const [index, line] of current.order.lines.entries()) {
      assert.deepEqual(wire(line.pricingResult), beforeLines[index]!.pricingResult); assert.deepEqual(wire(line.resolvedConfiguration), beforeLines[index]!.resolvedConfiguration);
      assert.deepEqual(wire(line.sellingPriceDecision), beforeLines[index]!.sellingPriceDecision); assert.equal(line.lineId, beforeLines[index]!.lineId);
    }
    assert.deepEqual(f.counts(), counts); assert.equal((await f.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM v2_sales_documents WHERE id=$1", [order.orderId])).rows[0]!.n, 1);
  });

  test.each(["locked", "discount"] as const)("M1 %s source commercial changes block before writes instead of inventing legacy-price policy", async historicalPrice => {
    const order = await f.freshOrder(2, { historicalPrice }); let workspace = await open(order.orderId);
    const beforeStage = await f.snapshot(editPersistenceTables()), counts = f.counts(); f.clearTrace();
    await assert.rejects(editLine(workspace, 0, { quantity: 17, selling: { kind: "calculated" } }), (error: unknown) => {
      assert.equal((error as V2ApplicationError).code, "CONFLICT"); assert.equal((error as V2ApplicationError).context.reason, "unsupported_source_selling_rebuild"); return true;
    });
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), beforeStage); assert.deepEqual(f.counts(), counts);
    // Persisted TEMP corruption must also fail at Save's independent boundary.
    const line = workspace.lines[0]!;
    await new PostgresSalesWorkspaceStore(f.pool).run(async tx => {
      const locked = await tx.get(org, staff, workspace.id, true); assert.ok(locked);
      await tx.putLine(org, { ...line, input: { ...line.input, quantity: 17 }, previews: undefined, revision: line.revision + 1 });
      await tx.update({ ...locked, revision: locked.revision + 1, updatedAt: new Date().toISOString() }, locked.revision);
    });
    workspace = await get(workspace); const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace), (error: unknown) => { assert.equal((error as V2ApplicationError).code, "CONFLICT"); assert.equal((error as V2ApplicationError).context.reason, "unsupported_source_selling_rebuild"); return true; });
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
  });

  test("M1 explicit new lines, duplicate input and arbitrary mixed reorder produce an exact durable bijection", async () => {
    const order = await f.freshOrder(3); let workspace = await open(order.orderId);
    workspace = await add(workspace, { description: "Added A" });
    const a = workspace.lines.at(-1)!;
    workspace = await add(workspace, { ...workspace.lines[0]!.input, description: "Explicit duplicate input" });
    const duplicate = workspace.lines.at(-1)!;
    workspace = await add(workspace, { description: "Added B", quantity: 7 });
    const b = workspace.lines.at(-1)!;
    workspace = await f.lines().update(context(), workspace.id, { lineId: a.id, requestId: randomUUID(), expectedRevision: workspace.revision, line: a.input, operationalNote: "Added line staff note" });
    const finalIds = [b.id, workspace.lines[2]!.id, a.id, workspace.lines[0]!.id, duplicate.id, workspace.lines[1]!.id];
    workspace = await f.lines().reorder(context(), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, lineIds: finalIds });
    f.clearTrace(); const result = await save(workspace), current = (await f.sourceRead(org, order.orderId))!;
    assert.equal(casCount(), 1); assert.equal(current.revision, "2"); assert.equal(current.order.lines.length, 6);
    assert.deepEqual(result.receipt.lineMap.map(item => item.workspaceLineId), finalIds);
    assert.deepEqual(current.order.lines.map(line => line.lineId), result.receipt.lineMap.map(item => item.canonicalLineId));
    assert.equal(new Set(result.receipt.lineMap.map(item => item.canonicalLineId)).size, 6);
    for (const line of workspace.lines.filter(line => line.sourceLineId)) assert.equal(result.receipt.lineMap.find(item => item.workspaceLineId === line.id)!.canonicalLineId, line.sourceLineId);
    for (const line of workspace.lines.filter(line => !line.sourceLineId)) assert.ok(!order.source.order.lines.some(source => source.lineId === result.receipt.lineMap.find(item => item.workspaceLineId === line.id)!.canonicalLineId));
    assert.equal(current.order.lines[2]!.operationalNote, "Added line staff note");
    const persisted = (await f.db.query<any>("SELECT workspace_line_id,canonical_line_id,position FROM v2_sales_workspace_promotion_lines WHERE organization_id=$1 AND workspace_id=$2 ORDER BY position", [org, workspace.id])).rows;
    assert.deepEqual(persisted, result.receipt.lineMap.map(item => ({ workspace_line_id: item.workspaceLineId, canonical_line_id: item.canonicalLineId, position: item.position })));
    assert.equal(current.number.display, order.source.number.display); assert.equal(current.order.billingInvoiceReference, order.invoiceId);
  });

  test("M1 mixed customer plus reprice/add is explicitly blocked before writes, never silently priced for the old customer", async () => {
    const order = await f.freshOrder(2); let workspace = await open(order.orderId);
    workspace = await header(workspace, { customerContact: { organizationId: org, customerId: otherCustomer }, purchaseOrderNumber: "NEW-CUSTOMER-PO" });
    workspace = await editLine(workspace, 0, { quantity: 9, selling: { kind: "calculated" } });
    workspace = await add(workspace, { quantity: 4 });
    const previews = workspace.lines.filter(line => line.previews?.order).map(line => ({ id: line.id, preview: wire(line.previews!.order!) }));
    assert.ok(previews.every(item => item.preview.customerContact?.customerId === otherCustomer));
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace), (error: unknown) => {
      assert.equal((error as V2ApplicationError).code, "CONFLICT");
      assert.equal((error as V2ApplicationError).context.reason, "customer_change_with_repricing"); return true;
    });
    assert.equal(casCount(), 0); assert.equal(f.pricedCustomers.length, 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
    assert.equal((await f.sourceRead(org, order.orderId))!.order.customerContact.customerId, customer);
  });

  test("M1 explicit commercial reprice and addition match the captured full Preview and current pricing fixture", async () => {
    const order = await f.freshOrder(2); let workspace = await open(order.orderId);
    workspace = await editLine(workspace, 0, { quantity: 9, selling: { kind: "calculated" } });
    workspace = await add(workspace, { quantity: 4 });
    const previews = workspace.lines.filter(line => line.previews?.order).map(line => ({ id: line.id, preview: wire(line.previews!.order!) }));
    f.clearTrace(); const result = await save(workspace), current = (await f.sourceRead(org, order.orderId))!;
    assert.ok(f.pricedCustomers.length >= 2); assert.ok(f.pricedCustomers.every(id => id === customer));
    for (const item of previews) {
      const id = result.receipt.lineMap.find(mapping => mapping.workspaceLineId === item.id)!.canonicalLineId;
      const canonical = current.order.lines.find(line => line.lineId === id)!;
      assert.deepEqual(wire(canonical.pricingResult), item.preview.pricingResult); assert.deepEqual(wire(canonical.resolvedConfiguration), item.preview.resolvedConfiguration);
      assert.deepEqual(wire(canonical.sellingLineAmount), item.preview.sellingPriceDecision.resultingLineAmount);
      assert.equal(canonical.sellingLineAmount.cents, canonical.quantity * 125);
    }
    assert.deepEqual(wire(current.order.lines[1]!.pricingResult), wire(order.source.order.lines[1]!.pricingResult), "Inherited commercial evidence is not silently repriced.");
  });

  test("M1 stale full Preview versus current Product fixture rolls all writes back instead of silently accepting new pricing", async () => {
    const order = await f.freshOrder(); let workspace = await open(order.orderId); workspace = await add(workspace);
    const preview = wire(workspace.lines.at(-1)!.previews!.order!), before = await f.snapshot(editPersistenceTables());
    f.setCatalog(true, 999); f.clearTrace(); await assert.rejects(save(workspace), errorCode("CONFLICT"));
    assert.deepEqual(await f.snapshot(editPersistenceTables()), before); assert.deepEqual(wire((await get(workspace)).lines.at(-1)!.previews!.order!), preview);
    assert.ok(f.sql.some(query => query.text === "ROLLBACK")); assert.equal((await f.sourceRead(org, order.orderId))!.revision, "1");
  });

  test.each(["id", "rounding", "component"])("M1 full PricingResult %s drift is rejected even when hash, prices and configuration are unchanged", async field => {
    const order = await f.freshOrder(); let workspace = await open(order.orderId); workspace = await add(workspace);
    const line = workspace.lines.at(-1)!, preview = line.previews!.order!;
    const result: any = wire(preview.pricingResult);
    if (field === "id") result.id = "unchanged-money-but-different-result-id";
    if (field === "rounding") result.rounding.policyVersion = "unreviewed-rounding-evidence";
    if (field === "component") result.components[0].label = "Changed component evidence";
    assert.equal(result.evidenceFingerprint, preview.pricingResult.evidenceFingerprint);
    assert.deepEqual(result.calculatedLineAmount, wire(preview.pricingResult.calculatedLineAmount));
    await new PostgresSalesWorkspaceStore(f.pool).run(async tx => {
      const locked = await tx.get(org, staff, workspace.id, true); assert.ok(locked);
      await tx.putLine(org, { ...line, revision: line.revision + 1, previews: { ...line.previews, order: { ...preview, pricingResult: result } } });
      await tx.update({ ...locked, revision: locked.revision + 1, updatedAt: new Date().toISOString() }, locked.revision);
    });
    workspace = await get(workspace); const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace), (error: unknown) => { assert.equal((error as V2ApplicationError).code, "CONFLICT"); assert.equal((error as V2ApplicationError).context.reason, "preview_stale"); return true; });
    assert.deepEqual(await f.snapshot(editPersistenceTables()), before); assert.ok(f.sql.some(query => query.text === "ROLLBACK"));
  });

  test("M1 two creator-isolated workspaces opened at one base revision serialize: first Save +1, second stale before writes", async () => {
    const order = await f.freshOrder(), secondActor = context(randomUUID(), grants, otherStaff);
    let first = await open(order.orderId), second = await open(order.orderId, secondActor);
    assert.notEqual(first.id, second.id); assert.equal(first.baseRevision, second.baseRevision);
    first = await header(first, { purchaseOrderNumber: "FIRST-SAVED" });
    second = await header(second, { purchaseOrderNumber: "SECOND-MUST-FAIL" }, context(randomUUID(), grants, otherStaff));
    await save(first); const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(second, context(randomUUID(), grants, otherStaff)), errorCode("STALE_STATE"));
    assert.equal(f.written(), false); assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
    assert.equal((await f.sourceRead(org, order.orderId))!.order.purchaseOrderNumber, "FIRST-SAVED");
  });

  test("M1 creator isolation, foreign tenant no-existence disclosure, revoked edit and exact persisted receipt replay", async () => {
    const order = await f.freshOrder(); let workspace = await open(order.orderId);
    await assert.rejects(get(workspace, context(randomUUID(), grants, otherStaff)), errorCode("NOT_FOUND"));
    await assert.rejects(open(order.orderId, context(randomUUID(), grants, staff, foreignOrg)), errorCode("NOT_FOUND"));
    await assert.rejects(open(randomUUID(), context(randomUUID(), grants, staff, foreignOrg)), errorCode("NOT_FOUND"));
    workspace = await header(workspace, { purchaseOrderNumber: "REPLAY-PO" });
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace, context(randomUUID(), ["order.view"])), errorCode("FORBIDDEN"));
    assert.equal(f.written(), false); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
    const result = await save(workspace), after = await f.snapshot(editPersistenceTables()); f.clearTrace();
    const replay = await f.promotion.promote(result.actor, result.input); if (!replay.ok) throw replay.error;
    assert.equal(replay.value.replayed, true); assert.deepEqual(wire(replay.value.receipt), wire(result.receipt));
    assert.deepEqual(await f.snapshot(editPersistenceTables()), after); assert.equal(casCount(), 0);
    const denied = await f.promotion.promote(context(result.input.requestId, ["order.view"]), result.input);
    assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, "FORBIDDEN");
    assert.deepEqual(await f.snapshot(editPersistenceTables()), after);
    assert.equal(typeof result.receipt.result, "object"); assert.doesNotThrow(() => JSON.stringify(result.receipt));
  });

  test("M1 a root Save request cannot be reused by a second workspace", async () => {
    const firstOrder = await f.freshOrder(), secondOrder = await f.freshOrder();
    const first = await header(await open(firstOrder.orderId), { purchaseOrderNumber: "FIRST-ROOT" });
    const second = await header(await open(secondOrder.orderId), { purchaseOrderNumber: "SECOND-ROOT" });
    const actor = context(), saved = await save(first, actor), before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    const result = await f.promotion.promote(actor, { ...saved.input, workspaceId: second.id, expectedRevision: second.revision });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "CONFLICT");
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
  });

  test("M1 a true no-op freezes only the workspace receipt and does not bump canonical revision", async () => {
    const order = await f.freshOrder(), workspace = await open(order.orderId), before = await f.snapshot(); f.clearTrace();
    const result = await save(workspace);
    assert.equal(result.receipt.documentId, order.orderId); assert.equal(result.receipt.documentRevision, "1"); assert.equal(result.receipt.artworkPromoted, false);
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(), before);
    assert.equal((await get(workspace)).state, "promoted");
  });

  test.each([false, true])("M1 owner-equivalent empty label is a true no-op even with retained Shipping charges=%s", async shipping => {
    const order = await f.freshOrder(2, { issued: shipping });
    await f.db.query("UPDATE v2_sales_documents SET job_label=NULL WHERE organization_id=$1 AND id=$2", [org, order.orderId]);
    if (shipping) await retainShippingCharge(order);
    let workspace = await open(order.orderId); assert.equal(workspace.sourceHeader?.jobLabel, undefined);
    workspace = await header(workspace, { jobLabel: "" }); const before = await f.snapshot(); f.clearTrace();
    const result = await save(workspace);
    assert.equal(result.receipt.documentRevision, "1"); assert.equal(result.receipt.documentId, order.orderId); assert.equal(casCount(), 0);
    assert.deepEqual(await f.snapshot(), before); assert.equal((await get(workspace)).state, "promoted");
  });

  test("M1 explicit partial commercial terms preserve full hidden source terms and inactive-Product price evidence", async () => {
    const order = await f.freshOrder(2, { historicalPrice: "locked" }); let workspace = await open(order.orderId);
    const counts = f.counts(); f.setCatalog(false);
    workspace = await header(workspace, { notes: "Workspace-only operator preparation", terms: { termsCode: "net_15", commercialNotes: "Explicit edited commercial note" } });
    f.clearTrace(); const saved = await save(workspace), current = (await f.sourceRead(org, order.orderId))!;
    assert.equal(saved.receipt.header.notes, "Workspace-only operator preparation"); assert.equal(saved.receipt.documentRevision, "2"); assert.equal(casCount(), 1);
    assert.deepEqual(current.order.terms, { ...order.terms, termsCode: "net_15", commercialNotes: "Explicit edited commercial note" });
    assert.deepEqual(wire(current.order.lines), wire(order.source.order.lines)); assert.deepEqual(f.counts(), counts);
  });

  test("M1 workspace-only notes freeze in a durable receipt without a canonical write or source terms replacement", async () => {
    const order = await f.freshOrder(); let workspace = await open(order.orderId);
    workspace = await header(workspace, { notes: "Workspace-only operator preparation" });
    const before = await f.snapshot(); f.clearTrace(); const saved = await save(workspace);
    assert.equal(saved.receipt.header.notes, "Workspace-only operator preparation"); assert.equal(saved.receipt.documentRevision, "1");
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(), before); assert.deepEqual((await f.sourceRead(org, order.orderId))!.order.terms, order.terms);
  });

  test("M1 source Artwork KEEP requires no newly reserved Artwork capability for a non-Artwork edit or its replay", async () => {
    const order = await f.freshOrder(), source = await canonicalArtwork(order);
    const actor = context(randomUUID(), ["order.view", "order.edit"]); let workspace = await open(order.orderId, actor);
    workspace = await header(workspace, { purchaseOrderNumber: "UNCHANGED-ARTWORK-KEEP" }, context(randomUUID(), ["order.view", "order.edit"]));
    const before = await f.snapshot(["v2_artwork_files", "v2_artwork_assignments", "v2_artwork_assignment_removals"]); f.clearTrace();
    const saved = await save(workspace, context(randomUUID(), ["order.view", "order.edit"]));
    assert.equal(saved.receipt.artworkPromoted, false); assert.equal(casCount(), 1); assert.deepEqual(await f.snapshot(["v2_artwork_files", "v2_artwork_assignments", "v2_artwork_assignment_removals"]), before);
    const replay = await f.promotion.promote(saved.actor, saved.input); assert.ok(replay.ok);
    assert.equal((await f.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM v2_artwork_assignments WHERE id=$1", [source.assignment.id])).rows[0]!.n, 1);
  });

  test("M1 explicit KEEP intent never re-adopts canonical Artwork or turns a no-op into a canonical CAS", async () => {
    const order = await f.freshOrder(), source = await canonicalArtwork(order); let workspace = await open(order.orderId);
    const actor = context(); await f.references().stageOrderEditArtworkIntent(actor, workspace.id, source.assignment.id, "KEEP", workspace.revision, actor.businessRequest!.id);
    workspace = await get(workspace); const before = await f.snapshot(), counts = f.counts(); f.setCatalog(false); f.clearTrace();
    const saved = await save(workspace, context(randomUUID(), ["order.view", "order.edit"]));
    assert.equal(saved.receipt.artworkPromoted, false); assert.equal(saved.receipt.documentRevision, "1"); assert.equal(casCount(), 0);
    assert.deepEqual(await f.snapshot(), before); assert.deepEqual(f.counts(), counts);
  });

  test.each([false, true])("M1 Artwork baseline conflict before Sales writes, initially empty=%s", async initiallyEmpty => {
    const order = await f.freshOrder(); if (!initiallyEmpty) await canonicalArtwork(order);
    let workspace = await open(order.orderId); workspace = await header(workspace, { purchaseOrderNumber: "FINGERPRINT-CONFLICT" });
    const external = await canonicalArtwork(order, initiallyEmpty ? 0 : 1);
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace), (error: unknown) => { assert.equal((error as V2ApplicationError).code, "CONFLICT"); assert.match((error as Error).message, /Artwork changed/); return true; });
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
    assert.equal((await f.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM v2_artwork_assignments WHERE id=$1", [external.assignment.id])).rows[0]!.n, 1);
    const lockCalls = f.sql.filter(query => /pg_advisory_xact_lock\(hashtextextended/.test(query.text));
    assert.ok(lockCalls.some(query => query.values[0] === `order-artwork:${org}:${order.orderId}`), "Actual owner coordination lock was invoked; this is not a physical multi-node race proof.");
  });

  test("M1 Artwork-only Save advances canonical CAS exactly once; no-op KEEP does not adopt or reprice the source", async () => {
    const order = await f.freshOrder(), original = await canonicalArtwork(order);
    let workspace = await open(order.orderId); const counts = f.counts(), baseline = await f.snapshot();
    const refs = await f.references().readOrderEditArtwork(context(), workspace.id);
    assert.equal(refs[0]!.sourceAssignmentId, original.assignment.id); assert.equal(refs[0]!.action, "KEEP");
    assert.deepEqual(await f.snapshot(), baseline);
    workspace = await removeArtwork(workspace, original.assignment.id);
    f.setCatalog(false); f.clearTrace(); const saved = await save(workspace), current = (await f.sourceRead(org, order.orderId))!;
    assert.equal(saved.receipt.documentId, order.orderId); assert.equal(saved.receipt.artworkPromoted, true); assert.equal(current.revision, "2"); assert.equal(casCount(), 1);
    assert.deepEqual(wire(current.order.lines), wire(order.source.order.lines)); assert.deepEqual(f.counts(), counts);
    assert.equal((await f.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM v2_artwork_assignment_removals WHERE artwork_assignment_id=$1", [original.assignment.id])).rows[0]!.n, 1);
    assert.equal((await f.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM v2_artwork_files WHERE id=$1", [original.artworkFile.id])).rows[0]!.n, 1);
    const beforeReplay = await f.snapshot(editPersistenceTables()); f.clearTrace();
    const replay = await f.promotion.promote(saved.actor, saved.input); assert.ok(replay.ok); assert.equal(casCount(), 0);
    assert.deepEqual(await f.snapshot(editPersistenceTables()), beforeReplay);
  });

  test("M1 REMOVE intent cannot authorize deleting a Sales line whose canonical Artwork history retains its FK", async () => {
    const order = await f.freshOrder(), original = await canonicalArtwork(order); let workspace = await open(order.orderId);
    workspace = await removeArtwork(workspace, original.assignment.id);
    workspace = await f.lines().remove(context(), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, lineId: workspace.lines[0]!.id });
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace), (error: unknown) => { assert.equal((error as V2ApplicationError).code, "CONFLICT"); assert.match((error as Error).message, /Artwork assignment history/); return true; });
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
    assert.equal((await f.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM v2_sales_document_lines WHERE id=$1", [order.source.order.lines[0]!.lineId])).rows[0]!.n, 1);
  });

  test("M1 current Proof history vetoes staged REMOVE through the physical owner guard and rolls back earlier Invoice/Sales writes", async () => {
    const order = await f.freshOrder(), original = await canonicalArtwork(order), proofWork = randomUUID(), proofVersion = randomUUID();
    await f.transaction(async () => {
      await f.client.query("INSERT INTO v2_proof_works(id,organization_id,order_document_id,order_line_id,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,$4,'staff',$5)", [proofWork, org, order.orderId, order.source.order.lines[0]!.lineId, staff]);
      await f.client.query("INSERT INTO v2_proof_versions(id,organization_id,proof_work_id,sequence,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,1,'staff',$4)", [proofVersion, org, proofWork, staff]);
      await f.client.query("INSERT INTO v2_proof_version_artwork(organization_id,proof_version_id,position,artwork_assignment_id,artwork_file_id) VALUES($1,$2,0,$3,$4)", [org, proofVersion, original.assignment.id, original.artworkFile.id]);
      await f.client.query("UPDATE v2_proof_versions SET issued_at=now(),issued_principal_kind='staff',issued_principal_subject=$3 WHERE organization_id=$1 AND id=$2", [org, proofVersion, staff]);
    });
    let workspace = await open(order.orderId); workspace = await removeArtwork(workspace, original.assignment.id);
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace), (error: unknown) => { assert.equal((error as V2ApplicationError).code, "CONFLICT"); assert.match((error as Error).message, /current Proof/); return true; });
    assert.deepEqual(await f.snapshot(editPersistenceTables()), before); assert.equal((await f.sourceRead(org, order.orderId))!.revision, "1");
    assert.ok(f.sql.some(query => query.text === "ROLLBACK")); assert.equal(f.counts().deleteCalls, 0);
  });

  test("M1 staged claims map to retained and newly allocated canonical IDs exactly once with fresh Artwork capability checks", async () => {
    const order = await f.freshOrder(); let workspace = await open(order.orderId), retainedId = workspace.lines[0]!.sourceLineId!;
    workspace = await add(workspace); const addedId = workspace.lines.at(-1)!.id;
    const retainedClaim = await stage(workspace, workspace.lines[0]!.id); workspace = retainedClaim.workspace;
    const newClaim = await stage(workspace, addedId); workspace = newClaim.workspace;
    const withoutAssign = context(randomUUID(), grants.filter(capability => capability !== "artwork.assign"));
    const before = await f.snapshot(editPersistenceTables()), io = f.counts(); f.clearTrace();
    await assert.rejects(save(workspace, withoutAssign), errorCode("FORBIDDEN"));
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
    const saved = await save(workspace), newCanonicalId = saved.receipt.lineMap.find(mapping => mapping.workspaceLineId === addedId)!.canonicalLineId;
    assert.notEqual(newCanonicalId, retainedId);
    const assignments = (await f.db.query<any>("SELECT a.order_line_id,c.id AS claim_id,c.state,a.artwork_file_id FROM v2_artwork_workspace_claims c JOIN v2_artwork_assignments a ON a.organization_id=c.organization_id AND a.id=c.assignment_id WHERE c.organization_id=$1 AND c.workspace_id=$2 ORDER BY c.id", [org, workspace.id])).rows;
    assert.equal(assignments.length, 2); assert.equal(assignments.find(row => row.claim_id === retainedClaim.claim.id)!.order_line_id, retainedId);
    assert.equal(assignments.find(row => row.claim_id === newClaim.claim.id)!.order_line_id, newCanonicalId); assert.ok(assignments.every(row => row.state === "promoted"));
    assert.equal(f.counts().putCalls, io.putCalls); assert.equal(f.counts().deleteCalls, io.deleteCalls);
    const after = await f.snapshot(editPersistenceTables()); f.clearTrace();
    const denied = await f.promotion.promote(context(saved.input.requestId, grants.filter(capability => capability !== "artwork.adopt")), saved.input);
    assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, "FORBIDDEN");
    const replay = await f.promotion.promote(saved.actor, saved.input); assert.ok(replay.ok); assert.equal(casCount(), 0);
    assert.deepEqual(await f.snapshot(editPersistenceTables()), after); assert.equal(f.counts().putCalls, io.putCalls);
  });

  test("M1 inherited override evidence needs no new override grant; a newly requested override requires current authority on Save and replay", async () => {
    const order = await f.freshOrder(2, { historicalPrice: "locked" }); let workspace = await open(order.orderId, context(randomUUID(), ["order.view", "order.edit"]));
    workspace = await header(workspace, { purchaseOrderNumber: "INHERITED-OVERRIDE" }, context(randomUUID(), ["order.view", "order.edit"]));
    await save(workspace, context(randomUUID(), ["order.view", "order.edit"]));
    let changed = await open(order.orderId, context(), "2"); changed = await add(changed, { selling: { kind: "total_override", totalCents: 451, reason: "New explicit commercial decision" } });
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(changed, context(randomUUID(), ["order.view", "order.edit"])), errorCode("FORBIDDEN"));
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
    const saved = await save(changed), after = await f.snapshot(editPersistenceTables()); f.clearTrace();
    const denied = await f.promotion.promote(context(saved.input.requestId, ["order.view", "order.edit"]), saved.input);
    assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, "FORBIDDEN");
    assert.deepEqual(await f.snapshot(editPersistenceTables()), after);
  });

  test("M1 retained Shipping charges block changed Save rather than repairing financial totals", async () => {
    const order = await f.freshOrder(2, { issued: true }); await retainShippingCharge(order);
    let workspace = await open(order.orderId); workspace = await header(workspace, { purchaseOrderNumber: "SHIPPING-MUST-BLOCK" });
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace), (error: unknown) => { assert.equal((error as V2ApplicationError).code, "CONFLICT"); assert.equal((error as V2ApplicationError).context.reason, "retained_shipping_additional_charges"); return true; });
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
  });

  test("M1 retained Shipping charges also block Artifact-only dirty Save before canonical CAS", async () => {
    const order = await f.freshOrder(2, { issued: true }), original = await canonicalArtwork(order); await retainShippingCharge(order);
    let workspace = await open(order.orderId); workspace = await removeArtwork(workspace, original.assignment.id);
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace), (error: unknown) => { assert.equal((error as V2ApplicationError).code, "CONFLICT"); assert.equal((error as V2ApplicationError).context.reason, "retained_shipping_additional_charges"); return true; });
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
  });

  test("M1 issued Invoice without shipping is not blanket locked and immutable issuance evidence survives Save", async () => {
    const order = await f.freshOrder(2, { issued: true }), checkpoints = await f.snapshot(["v2_billing_invoice_checkpoints"]);
    let workspace = await open(order.orderId); workspace = await header(workspace, { purchaseOrderNumber: "ISSUED-ALLOWED" });
    const result = await save(workspace);
    assert.equal(result.receipt.documentRevision, "2"); assert.equal(result.receipt.documentId, order.orderId);
    assert.deepEqual(await f.snapshot(["v2_billing_invoice_checkpoints"]), checkpoints);
    assert.equal((await f.db.query<{ invoice_state: string; invoice_sequence: number | null }>("SELECT invoice_state,invoice_sequence FROM v2_billing_invoices WHERE id=$1", [order.invoiceId])).rows[0]!.invoice_state, "issued");
  });

  test("M1 frozen material quantity edits preserve requirements and fail before canonical mutation", async () => {
    const order = await f.freshOrder(); await f.transaction(async () => {
      const tx = f.orderTransaction(f.client); await tx.materialRequirements!.freeze(org, order.orderId, [order.source.order.lines[0]!]);
    });
    let workspace = await open(order.orderId); workspace = await editLine(workspace, 0, { quantity: 13, selling: { kind: "calculated" } });
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace), (error: unknown) => { assert.equal((error as V2ApplicationError).code, "CONFLICT"); assert.match((error as Error).message, /frozen material requirements/); return true; });
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
  });

  test("M1 progressed Production quantity is blocked explicitly; presentation Save leaves partial target unchanged", async () => {
    const order = await f.freshOrder(2, { production: true }), artwork = await canonicalArtwork(order, 0, "production"), workId = randomUUID();
    await f.transaction(async () => {
      await f.client.query(`INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,ordered_quantity,created_principal_kind,created_principal_subject)
        VALUES($1,$2,$3,$4,'single',$5,$6,1,'staff',$7)`, [workId, org, order.orderId, order.source.order.lines[0]!.lineId, artwork.assignment.id, artwork.artworkFile.id, staff]);
      await f.client.query("INSERT INTO v2_production_attempts(id,organization_id,production_work_id,sequence,attempt_kind,station_key,good_quantity,started_principal_kind,started_principal_subject) VALUES($1,$2,$3,1,'initial','roll',1,'staff',$4)", [randomUUID(), org, workId, staff]);
    });
    let workspace = await open(order.orderId); workspace = await editLine(workspace, 0, { quantity: 22, selling: { kind: "calculated" } });
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace();
    await assert.rejects(save(workspace), (error: unknown) => { assert.equal((error as V2ApplicationError).code, "CONFLICT"); assert.equal((error as V2ApplicationError).context.reason, "progressed_order_configuration"); assert.match((error as Error).message, /BDR-2\/BDR-4/); return true; });
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
    const discarded = await f.sales().discard(context(), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision }); assert.equal(discarded.state, "discarded");
    let safe = await open(order.orderId); safe = await header(safe, { jobLabel: "Safe progressed presentation" });
    safe = await editLine(safe, 0, { description: "Safe progressed description" }, "Safe progressed note");
    const productionBefore = await f.snapshot(["v2_production_works", "v2_production_attempts", "v2_sales_line_production_requirements"]); f.clearTrace();
    await save(safe); assert.deepEqual(await f.snapshot(["v2_production_works", "v2_production_attempts", "v2_sales_line_production_requirements"]), productionBefore);
    assert.equal((await f.db.query<{ ordered_quantity: number }>("SELECT ordered_quantity FROM v2_production_works WHERE id=$1", [workId])).rows[0]!.ordered_quantity, 1);
    assert.equal(f.sql.some(query => /^UPDATE v2_production_works SET ordered_quantity/.test(query.text)), false);
  });

  test("M1 Fulfillment handoff freezes requested logistics, without an invented repair policy", async () => {
    const order = await f.freshOrder(); await f.db.query("INSERT INTO v2_fulfillment_handoffs(id,organization_id,order_document_id,handoff_method,completed_principal_kind,completed_principal_subject) VALUES($1,$2,$3,'pickup','staff',$4)", [randomUUID(), org, order.orderId, staff]);
    let workspace = await open(order.orderId); workspace = await header(workspace, { requestedFulfillment: { method: "pickup", instructions: "Changed after actual handoff" } });
    const before = await f.snapshot(editPersistenceTables()); f.clearTrace(); await assert.rejects(save(workspace), errorCode("CONFLICT"));
    assert.equal(casCount(), 0); assert.deepEqual(await f.snapshot(editPersistenceTables()), before);
  });

  test.each(["billing.guard", "artwork.validate", "sales.reserve", "pricing.evaluate", "sales.cas", "sales.persist-lines", "materials.freeze", "billing.synchronize", "sales.remove-lines", "routing.instance", "routing.step", "sales.audit", "sales.attribute", "sales.succeed",
    "workspace.line-map", "artwork.remove", "artwork.file", "artwork.assignment", "artwork.claim", "artwork.ledger", "artwork.application", "artwork.apply", "sales.reconcile", "workspace.receipt", "workspace.final-state"])("M1 real ROLLBACK restores every canonical owner and edit receipt after %s failure", async ownerStep => {
    const order = await f.freshOrder(), original = await canonicalArtwork(order); let workspace = await open(order.orderId);
    workspace = await header(workspace, { purchaseOrderNumber: "ATOMIC-COMBINED-SAVE" });
    workspace = await f.lines().remove(context(), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, lineId: workspace.lines[2]!.id });
    workspace = await add(workspace, { description: "Atomic new line" }); const newLineId = workspace.lines.at(-1)!.id;
    workspace = await f.lines().reorder(context(), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, lineIds: [newLineId, workspace.lines[0]!.id, workspace.lines[1]!.id] });
    workspace = await removeArtwork(workspace, original.assignment.id); workspace = (await stage(workspace, newLineId)).workspace;
    const before = await f.snapshot(editPersistenceTables()), io = f.counts(); f.clearTrace(); f.inject(ownerStep);
    const actor = context(), input = { workspaceId: workspace.id, target: "order" as const, expectedRevision: workspace.revision, requestId: actor.businessRequest!.id };
    const result = await f.promotion.promote(actor, input); assert.equal(result.ok, false, `Failure hook was not reached: ${ownerStep}`);
    assert.ok(f.steps.includes(ownerStep), `Wrong earlier failure; requested ${ownerStep}, reached ${f.steps.join(",")}; source read: ${f.readFailure()}`);
    assert.deepEqual(await f.snapshot(editPersistenceTables()), before, ownerStep); assert.equal((await f.sourceRead(org, order.orderId))!.revision, "1");
    assert.ok(f.sql.some(query => query.text === "ROLLBACK")); assert.equal(f.sql.some(query => query.text === "COMMIT"), false);
    assert.equal(f.counts().putCalls, io.putCalls); assert.equal(f.counts().deleteCalls, io.deleteCalls);
    f.inject(); f.clearTrace(); const retry = await f.promotion.promote(actor, input); if (!retry.ok) throw retry.error;
    assert.equal(retry.value.receipt.documentId, order.orderId); assert.equal(retry.value.receipt.displayNumber, order.source.number.display); assert.equal(retry.value.receipt.documentRevision, "2"); assert.equal(casCount(), 1);
    const canonical = (await f.sourceRead(org, order.orderId))!;
    assert.equal(canonical.order.lines.length, 3); assert.equal(canonical.order.lines.some(line => line.lineId === order.source.order.lines[2]!.lineId), false);
    assert.deepEqual(canonical.order.lines.map(line => line.lineId), retry.value.receipt.lineMap.map(mapping => mapping.canonicalLineId));
    assert.deepEqual(canonical.order.lines.slice(1).map(line => line.lineId), order.source.order.lines.slice(0, 2).map(line => line.lineId));
  });
});
