import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createContext, SourceTextModule, SyntheticModule, type Module } from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import type * as OrderAdapterExports from "../../infrastructure/sales/postgresOrderTransaction.js";
import type * as QuoteAdapterExports from "../../infrastructure/sales/postgresQuoteTransaction.js";
import * as customers from "../../infrastructure/compatibility/postgresCustomersRead.js";
import * as products from "../../infrastructure/compatibility/postgresProductsRead.js";
import * as operationRequests from "../../infrastructure/persistence/postgresOperationRequests.js";
import * as routing from "../../infrastructure/routing/postgresRoutingRepository.js";
import * as routePrerequisites from "../../infrastructure/routing/postgresRoutePrerequisites.js";
import * as materials from "../../infrastructure/sales/postgresOrderMaterialRequirements.js";
import * as numbering from "../../infrastructure/sales/postgresCommercialPrimitives.js";
import * as productionRequirements from "../../infrastructure/sales/postgresProductionRequirements.js";
import * as salesTax from "../../infrastructure/sales/postgresSalesTaxComposition.js";
import * as orderApplication from "../../src/modules/sales/orderApplication.js";
import * as orderLifecycle from "../../src/modules/sales/orderLifecycle.js";
import * as persistence from "../../src/modules/sales/persistenceContracts.js";
import * as pricingAdapter from "../../src/modules/pricing/v2PricingAdapter.js";
import * as commercialValues from "../../src/modules/shared/commercialValues.js";
import { reconcileOrderInTransaction } from "../../infrastructure/sales/postgresOrderAutomaticLifecycle.js";
import type { OperationContext } from "../../src/application/operation.js";
import { OrderApplicationService, type OrderOperationResult, type OrderTransaction, type OrderTransactionRunner } from "../../src/modules/sales/orderApplication.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { calculatedDecision } from "../../src/modules/sales/quoteApplication.js";
import type { SalesLineSnapshot } from "../../src/modules/sales/contracts.js";
import { brandedId, currencyCode } from "../../src/modules/shared/commercialValues.js";

// Sole fake module: Billing writes its fixture row on the caller's client. All
// other imports below expose actual, statically inspected V2 implementations.
let failBilling = false;
const billingClients: unknown[] = [];
class SqlWritingBillingFixture {
  constructor(private readonly client: PoolClient) { billingClients.push(client); }
  async createDraftInvoice() { return { status: "created", invoiceId: "invoice", synchronizationVersion: "1" }; }
  async synchronizeDraftInvoice(input: Parameters<OrderTransaction["billing"]["synchronizeDraftInvoice"]>[0]) {
    await this.client.query("UPDATE v2_billing_invoices SET source_sales_state_token=$3 WHERE organization_id=$1 AND order_document_id=$2", [input.organizationId, input.orderId, input.sourceSalesStateToken]);
    return failBilling ? { status: "not_editable", reason: "invoice_missing" } : { status: "synchronized", invoiceId: "invoice", synchronizationVersion: "5" };
  }
  async readInvoiceForOrder() { return { invoiceId: "invoice", lifecycle: "draft", synchronizationVersion: "4", lines: [], total: { currency: "USD", cents: 1000 } }; }
  async readDraftForOrder() { return null; }
}

const workspaceRoot = path.resolve(process.cwd());
const adapterDirectory = path.join(workspaceRoot, "v2/infrastructure/sales");
const adapterSources = new Set(["postgresOrderTransaction.ts", "postgresQuoteTransaction.ts"].map((name) => path.join(adapterDirectory, name)));
const moduleContext = createContext({});
const modules = new Map<string, Module>();
const dependencyExports = new Map<string, object>([
  ["../compatibility/postgresCustomersRead.js", customers], ["../compatibility/postgresProductsRead.js", products],
  ["../persistence/postgresOperationRequests.js", operationRequests], ["../routing/postgresRoutingRepository.js", routing],
  ["../routing/postgresRoutePrerequisites.js", routePrerequisites], ["./postgresOrderMaterialRequirements.js", materials],
  ["./postgresCommercialPrimitives.js", numbering], ["./postgresProductionRequirements.js", productionRequirements],
  ["./postgresSalesTaxComposition.js", salesTax], ["../../src/modules/sales/orderApplication.js", orderApplication],
  ["../../src/modules/sales/orderLifecycle.js", orderLifecycle], ["../../src/modules/sales/persistenceContracts.js", persistence],
  ["../../src/modules/pricing/v2PricingAdapter.js", pricingAdapter], ["../../src/modules/shared/commercialValues.js", commercialValues],
  ["../billing/postgresBillingDraftInvoiceTransaction.js", { PostgresBillingDraftInvoiceTransaction: SqlWritingBillingFixture }],
].map(([specifier, exports]) => [path.resolve(adapterDirectory, specifier as string).replace(/\.js$/u, ".ts"), exports as object]));

// Read-only evaluation of the TWO actual adapters, not hidden dynamic imports.
// Every dependency is exact-listed above; unknown imports fail before evaluation.
const linkAdapterImport = (specifier: string, parent: Module): Module => {
  if (!specifier.startsWith(".")) throw new Error(`Unexpected external adapter import: ${specifier}`);
  const identifier = path.resolve(path.dirname(parent.identifier), specifier).replace(/\.js$/u, ".ts");
  const relative = path.relative(workspaceRoot, identifier).replaceAll("\\", "/");
  if (relative.startsWith("server/") || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`Forbidden V1/outside-workspace adapter import: ${specifier}`);
  const exports = dependencyExports.get(identifier);
  if (!exports) throw new Error(`Unexpected adapter dependency: ${specifier}`);
  if (!modules.has(identifier)) modules.set(identifier, new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { identifier, context: moduleContext }));
  return modules.get(identifier)!;
};
const evaluateAdapter = async (name: string) => {
  const identifier = path.join(adapterDirectory, name);
  if (!adapterSources.has(identifier)) throw new Error(`Unexpected adapter source: ${name}`);
  const source = await readFile(identifier, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName: identifier, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const module = new SourceTextModule(outputText, { identifier, context: moduleContext, importModuleDynamically: () => { throw new Error("Unexpected dynamic adapter import."); } });
  await module.link(linkAdapterImport);
  await module.evaluate();
  return module.namespace;
};
const { PostgresOrderTransaction, PostgresOrderTransactionRunner } = await evaluateAdapter("postgresOrderTransaction.ts") as unknown as typeof OrderAdapterExports;
const { PostgresQuoteTransaction } = await evaluateAdapter("postgresQuoteTransaction.ts") as unknown as typeof QuoteAdapterExports;

const organizationId = brandedId<"OrganizationId">("projection-org");
const orderId = brandedId<"OrderId">("projection-order");
const usd = currencyCode("USD");
const customerContact = { organizationId, customerId: brandedId<"CustomerId">("projection-customer") };
const line = async (id: string, quantity: number): Promise<SalesLineSnapshot> => {
  const resolvedConfiguration = { schemaVersion: 1 as const, organizationId, productId: brandedId<"ProductId">("projection-product"),
    pricingConfigurationId: brandedId<"PricingConfigurationId">("projection-config"), pricingConfigurationVersion: "1", pricingConfigurationContentHash: "sha256:projection-config",
    quantity, selections: {}, derivedFacts: {}, productFacts: {}, productionRequirements: { state: "unconfigured" as const, reason: "product_specification_absent" as const } };
  const result = await new V2PricingParityAdapter().calculate({ organizationId, resolvedConfiguration,
    sellableProduct: { organizationId, productId: resolvedConfiguration.productId, displayName: "Fixture", lifecycle: "active",
      pricingConfiguration: { id: resolvedConfiguration.pricingConfigurationId, version: "1", contentHash: "sha256:projection-config" }, requiresDimensions: false, pricingCurrency: usd },
    rules: { base: { perPieceCents: 100 } }, pricingContext: { channel: "staff", effectiveAt: "2026-09-30T00:00:00.000Z" } });
  const decision = calculatedDecision(result, undefined, { principalKind: "staff", subjectId: "staff" });
  return { lineId: brandedId<"SalesLineId">(id), productId: resolvedConfiguration.productId, description: `Original ${id}`, operationalNote: "Frozen note",
    quantity, resolvedConfiguration, pricingResult: result, sellingPriceDecision: decision, calculatedLineAmount: result.calculatedLineAmount,
    sellingLineAmount: decision.resultingLineAmount, taxability: { taxable: true, source: "product" } };
};

/** Executes actual adapter query methods, not PostgreSQL: fake-client rollback and SQL parameter evidence only. */
const fixture = async () => {
  const lines = [await line("line-a", 2), await line("line-b", 8)];
  const rows = lines.map((value, position) => ({ id: value.lineId, position, product_id: value.productId, product_type_id: null,
    description: value.description, operational_note: value.operationalNote, quantity: value.quantity,
    calculated_line_cents: String(value.calculatedLineAmount.cents), selling_line_cents: String(value.sellingLineAmount.cents), resolved_configuration: value.resolvedConfiguration,
    pricing_result: value.pricingResult, selling_price_decision: value.sellingPriceDecision, taxability_snapshot: value.taxability }));
  const header = { id: orderId, organization_id: organizationId, business_number: "1001", display_number: "O-1001", customer_id: customerContact.customerId,
    contact_id: null, purchase_order_number: "PO-before", job_label: "Original job" as string | null | undefined, requested_due_date: "2026-10-02", currency: "USD", terms_json: { termsCode: "net_30" },
    tax_context_reference: null, sales_representative_id: null, commercial_notes: "Commercial notes", revision: "4", commercial_state: "open",
    completed_at: null, archived_at: null, requested_fulfillment_method: "pickup", requested_destination: null, fulfillment_instructions: null,
    selling_adjustment_cents: "0", selling_adjustment_reason: null, commercial_charge: null, tax_composition: null, expires_at: null, delivery_state: "sent", acceptance_state: "not_accepted", lifecycle_state: "open" };
  const works = [
    { id: "original", organizationId, orderId, lineId: "line-a", quantity: 2 },
    { id: "rework-remaining", organizationId, orderId, lineId: "line-a", quantity: 1 },
    { id: "replacement", organizationId, orderId, lineId: "line-a", quantity: 3 },
    { id: "plain-original", organizationId, orderId, lineId: "line-b", quantity: 8 },
    { id: "foreign-tenant", organizationId: "other-org", orderId, lineId: "line-a", quantity: 9 },
  ];
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  const invoice = { sourceSalesStateToken: "4" };
  let snapshot: { rows: typeof rows; header: typeof header; works: typeof works; invoice: typeof invoice } | undefined;
  let rejectCas = false;
  let released = 0;
  const client = {
    query: async (sql: string, values: readonly unknown[] = []) => {
      queries.push({ sql, values });
      const result = (data: unknown[] = [], rowCount = data.length) => ({ rows: data, rowCount });
      if (sql === "BEGIN") { snapshot = structuredClone({ rows, header, works, invoice }); return result(); }
      if (sql === "COMMIT") { snapshot = undefined; return result(); }
      if (sql === "ROLLBACK") { Object.assign(header, snapshot!.header); Object.assign(invoice, snapshot!.invoice); rows.splice(0, rows.length, ...snapshot!.rows); works.splice(0, works.length, ...snapshot!.works); snapshot = undefined; return result(); }
      if (sql === "UPDATE v2_billing_invoices SET source_sales_state_token=$3 WHERE organization_id=$1 AND order_document_id=$2") {
        expect(values.slice(0, 2)).toEqual([organizationId, orderId]);
        invoice.sourceSalesStateToken = values[2] as string;
        return result([], 1);
      }
      if (sql.startsWith("UPDATE v2_sales_documents SET customer_id=")) {
        expect(values.slice(0, 3)).toEqual([organizationId, orderId, 4]);
        if (rejectCas || Number(header.revision) !== values[2]) return result([], 0);
        Object.assign(header, { customer_id: values[3], contact_id: values[4], purchase_order_number: values[5], requested_due_date: values[6], terms_json: JSON.parse(values[7] as string),
          tax_context_reference: values[8], sales_representative_id: values[9], commercial_notes: values[10], job_label: values[11], revision: "5" });
        return result([], 1);
      }
      if (sql.startsWith("INSERT INTO v2_sales_documents(")) { header.job_label = values[13] as string | null; return result([], 1); }
      if (sql === "SELECT id,quantity FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2") {
        expect(values).toEqual([organizationId, orderId]);
        return result(rows.map((row) => ({ id: row.id, quantity: row.quantity })));
      }
      if (sql.startsWith("INSERT INTO v2_sales_document_lines(")) {
        expect(values.slice(1, 3)).toEqual([organizationId, orderId]);
        const order = sql.includes("operational_note");
        const offset = order ? 1 : 0;
        const written = { id: values[0] as typeof rows[number]["id"], position: values[3] as number, product_id: values[4] as typeof rows[number]["product_id"], product_type_id: null,
          description: values[6] as string, operational_note: order ? values[7] as string : "Frozen note", quantity: values[7 + offset] as number,
          calculated_line_cents: String(values[10 + offset]), selling_line_cents: String(values[12 + offset]),
          resolved_configuration: JSON.parse(values[15 + offset] as string), pricing_result: JSON.parse(values[16 + offset] as string),
          selling_price_decision: JSON.parse(values[17 + offset] as string), taxability_snapshot: JSON.parse(values[18 + offset] as string) };
        const existing = rows.findIndex((row) => row.id === written.id);
        if (existing < 0) rows.push(written); else rows[existing] = written;
        return result([], 1);
      }
      if (sql.startsWith("UPDATE v2_sales_document_lines SET position=")) { rows.forEach((row) => { row.position += 100000; }); return result([], rows.length); }
      if (sql.startsWith("UPDATE v2_sales_document_lines SET production_requirement_state=")) return result([], 0);
      if (sql.startsWith("UPDATE v2_production_works SET ordered_quantity=")) {
        works.filter((work) => work.organizationId === values[0] && work.orderId === values[1] && work.lineId === values[2]).forEach((work) => { work.quantity = values[3] as number; });
        return result([], 1);
      }
      if (sql.startsWith("SELECT d.id,d.organization_id")) { expect(values).toEqual([organizationId, orderId]); return result([{ ...header }]); }
      if (sql.startsWith("SELECT id,product_id,product_type_id,description")) return result([...rows].sort((a, b) => a.position - b.position));
      if (sql === "SELECT id FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2") return result(rows.map((row) => ({ id: row.id })));
      if (sql.startsWith("SELECT id,name,country_code") || sql.startsWith("SELECT is_tax_exempt,") || sql.startsWith("SELECT quote_document_id,")
        || sql.startsWith("SELECT order_document_id FROM v2_sales_quote_conversions") || sql.startsWith("SELECT id,checkpoint_kind,")
        || sql.includes("FROM v2_route_instances") || sql.startsWith("SELECT l.id,l.description,l.quantity")
        || sql.includes("FROM v2_product_recipes r") || sql.startsWith("SELECT tree_json FROM pbv2_tree_versions")
        || sql.startsWith("SELECT id FROM v2_order_line_material_requirements")) return result();
      if (sql.startsWith("UPDATE v2_sales_order_details SET ") || sql.startsWith("UPDATE v2_sales_quote_details SET ")
        || sql.startsWith("INSERT INTO v2_sales_order_details(") || sql.startsWith("INSERT INTO v2_sales_quote_details(")) return result([], 1);
      if (sql.startsWith("DELETE FROM v2_sales_document_lines")) { const retained = values[2] as string[]; const keep = rows.filter((row) => retained.includes(row.id)); rows.splice(0, rows.length, ...keep); return result([], 1); }
      if (sql.startsWith("DELETE FROM v2_sales_line_production_requirements")) return result([], 0);
      throw new Error(`Unexpected fake-client query: ${sql}`);
    },
    release: () => { released++; },
  };
  const tx = new PostgresOrderTransaction(client as unknown as PoolClient);
  const input = (sourceLines: readonly SalesLineSnapshot[] = lines): Parameters<OrderTransaction["update"]>[0] => ({ organizationId, orderId, expectedRevision: 4, customerContact,
    jobLabel: "Revised job", purchaseOrderNumber: "PO-after", requestedDueDate: "2026-10-02", terms: { termsCode: "net_30", commercialNotes: "Commercial notes" }, lines: sourceLines, requestedFulfillment: { method: "pickup" } });
  return { client, tx, input, lines, header, rows, works, invoice, queries, setRejectCas() { rejectCas = true; }, get released() { return released; } };
};

function actualAdapterRegressions() {
  test.each(["../../../server/db.js", "../../../server/services/billing.js", "dotenv", "pg", "node:net", "node:fs", "../../deployment/server.js"])("linker rejects unsafe or unexpected dependency before evaluation: %s", async (specifier) => {
    const probeContext = createContext({ reachedEvaluation: false });
    const probe = new SourceTextModule(`import ${JSON.stringify(specifier)}; globalThis.reachedEvaluation = true;`, { identifier: path.join(adapterDirectory, "isolationProbe.ts"), context: probeContext });
    await expect(probe.link(linkAdapterImport)).rejects.toThrow(/Forbidden|Unexpected/);
    expect(probeContext.reachedEvaluation).toBe(false);
  });

  test("linker reads only the two approved actual adapter source files", async () => {
    await expect(evaluateAdapter("../../../server/db.ts")).rejects.toThrow("Unexpected adapter source");
    await expect(evaluateAdapter("postgresUnreviewedAdapter.ts")).rejects.toThrow("Unexpected adapter source");
  });

  test.each([false, true])("header/description save does not rewrite partial rework or replacement targets (description=%p)", async (description) => {
    const r = await fixture();
    const before = structuredClone(r.works);
    expect(await r.tx.update(r.input(description ? r.lines.map((value) => ({ ...value, description: "Presentation only" })) : r.lines))).toBe(true);
    expect(r.works).toEqual(before);
    expect(r.queries.some(({ sql }) => sql.startsWith("UPDATE v2_production_works"))).toBe(false);
    expect(r.rows.map((row) => row.quantity)).toEqual([2, 8]);
    expect(r.rows.map((row) => row.operational_note)).toEqual(["Frozen note", "Frozen note"]);
    expect(r.header.job_label).toBe("Revised job");
    expect(r.header.terms_json).toEqual({ termsCode: "net_30" });
    const priorRead = r.queries.findIndex(({ sql }) => sql.startsWith("SELECT id,quantity FROM v2_sales_document_lines"));
    const firstUpsert = r.queries.findIndex(({ sql }) => sql.startsWith("INSERT INTO v2_sales_document_lines"));
    expect(priorRead).toBeGreaterThan(0);
    expect(priorRead).toBeLessThan(firstUpsert);
  });

  test("only requested actual commercial quantity change invokes the unchanged declared projection", async () => {
    const r = await fixture();
    expect(await r.tx.update(r.input([r.lines[0]!, await line("line-b", 9)]))).toBe(true);
    expect(r.works.map((work) => work.quantity)).toEqual([2, 1, 3, 9, 9]);
    const writes = r.queries.filter(({ sql }) => sql.startsWith("UPDATE v2_production_works"));
    expect(writes).toEqual([{ sql: "UPDATE v2_production_works SET ordered_quantity=$4 WHERE organization_id=$1 AND order_document_id=$2 AND order_line_id=$3 AND ordered_quantity IS DISTINCT FROM $4", values: [organizationId, orderId, "line-b", 9] }]);
  });

  test("new lines/create have no prior quantity to project; failed CAS stops before reads/upserts", async () => {
    const r = await fixture();
    expect(await r.tx.update(r.input([...r.lines, await line("line-new", 3)]))).toBe(true);
    expect(r.queries.some(({ sql }) => sql.startsWith("UPDATE v2_production_works"))).toBe(false);
    const created = await fixture();
    await created.tx.create({ organizationId, orderId, customerContact, number: { kind: "order", core: 1002n, display: "O-1002" }, terms: {}, jobLabel: "Create job", lines: created.lines });
    expect(created.queries.some(({ sql }) => sql.startsWith("UPDATE v2_production_works"))).toBe(false);
    const insert = created.queries.find(({ sql }) => sql.startsWith("INSERT INTO v2_sales_documents"))!;
    expect(insert.sql).toContain("commercial_notes,job_label)");
    expect(insert.values).toHaveLength(14);
    expect(insert.values[13]).toBe("Create job");
    const stale = await fixture();
    stale.setRejectCas();
    expect(await stale.tx.update(stale.input())).toBe(false);
    expect(stale.queries).toHaveLength(1);
  });

  test.each(["Read job", null, undefined])("Order and Quote reads expose scalar label or historical unset: %p", async (jobLabel) => {
    const r = await fixture();
    r.header.job_label = jobLabel;
    expect((await r.tx.read(organizationId, orderId))!.order.jobLabel).toBe(jobLabel ?? undefined);
    const quote = new PostgresQuoteTransaction(r.client as unknown as PoolClient);
    expect((await quote.read(organizationId, brandedId<"QuoteId">(orderId)))!.quote.jobLabel).toBe(jobLabel ?? undefined);
    expect(r.queries.filter(({ sql }) => sql.startsWith("SELECT d.id,")).every(({ sql }) => sql.includes("d.job_label"))).toBe(true);
  });

  test("Quote create/update bind label as a separate appended scalar parameter", async () => {
    const r = await fixture();
    const quote = new PostgresQuoteTransaction(r.client as unknown as PoolClient);
    await quote.create({ organizationId, quoteId: brandedId<"QuoteId">(orderId), customerContact, number: { kind: "quote", core: 2001n, display: "Q-2001" }, jobLabel: "Quote create", terms: { termsCode: "net_30" }, lines: r.lines });
    expect(r.queries.find(({ sql }) => sql.startsWith("INSERT INTO v2_sales_documents"))!.values[13]).toBe("Quote create");
    expect(await quote.update({ ...r.input(), quoteId: brandedId<"QuoteId">(orderId), jobLabel: "Quote update" })).toBe(true);
    const updated = r.queries.find(({ sql }) => sql.startsWith("UPDATE v2_sales_documents SET customer_id="))!;
    expect(updated.values).toHaveLength(12);
    expect(updated.values[11]).toBe("Quote update");
    expect(JSON.parse(updated.values[7] as string)).toEqual({ termsCode: "net_30" });
  });

  test("actual canonical add sends the normalized note through the real line upsert and returns it on replay", async () => {
    const r = await fixture();
    const newLine = await line("seed-new-line", 1);
    let stored: OrderOperationResult | undefined;
    let storedFingerprint: string | undefined;
    const pgRunner = new PostgresOrderTransactionRunner({ connect: async () => r.client } as unknown as Pool);
    const runner: OrderTransactionRunner = { transaction: (action) => pgRunner.transaction(async (tx) => {
      const read = tx.read.bind(tx);
      tx.read = async (...args) => {
        const value = await read(...args);
        if (!value) return null;
        const decoded = JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry)) as typeof value;
        return { ...decoded, number: { ...decoded.number, core: value.number.core } };
      };
      tx.reserve = async (input) => {
        expect(storedFingerprint ?? input.payloadFingerprint).toBe(input.payloadFingerprint);
        storedFingerprint = input.payloadFingerprint;
        return stored ? { kind: "replay", request: { id: "new-note", status: "succeeded", resultJson: stored } }
          : { kind: "new", request: { id: "new-note", status: "in_progress", resultJson: null } };
      };
      tx.succeed = async (_org, _id, result) => { stored = result; };
      tx.attribute = async () => undefined;
      tx.audit = async () => undefined;
      tx.customers.validateContactReference = async () => true;
      tx.products.resolveActivePricingInput = async () => ({ ok: true, value: {
        sellableProduct: { organizationId, productId: newLine.productId, displayName: "Fixture", lifecycle: "active",
          pricingConfiguration: { id: newLine.resolvedConfiguration.pricingConfigurationId, version: "1", contentHash: "sha256:projection-config" }, requiresDimensions: false, pricingCurrency: usd },
        resolvedConfiguration: newLine.resolvedConfiguration, rules: { base: { perPieceCents: 100 } }, warnings: [],
      } });
      tx.products.resolveCurrentTaxability = async () => ({ taxable: true });
      tx.products.resolveOrderRoutability = async () => ({ kind: "routable", productName: "Fixture", routing: { kind: "no_route" } });
      return action(tx);
    }) };
    const service = new OrderApplicationService(runner);
    const context: OperationContext = { organizationId, operationId: "new-note", businessRequest: { id: "new-note", payloadFingerprint: "context-only" },
      principal: { kind: "staff", organizationId, userId: "staff", authority: { membershipId: "membership", capabilities: ["order.edit"] } } };
    const input = { businessRequestId: "new-note", orderId, expectedRevision: "4", patch: {},
      lineChanges: [{ kind: "add" as const, line: { clientLineKey: "new-note", productId: newLine.productId, quantity: 1, operationalNote: "  Persisted new TEMP note  " } }] };
    const result = await service.update(context, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.value.lineCorrelations![0]!.orderLineId;
    expect(result.value.order.order.lines.find((line) => line.lineId === id)!.operationalNote).toBe("Persisted new TEMP note");
    expect(r.rows.find((row) => row.id === id)!.operational_note).toBe("Persisted new TEMP note");
    expect(r.queries.find(({ sql, values }) => sql.startsWith("INSERT INTO v2_sales_document_lines(") && values[0] === id)!.values[7]).toBe("Persisted new TEMP note");
    expect(r.queries.filter(({ sql }) => sql.startsWith("UPDATE v2_sales_documents SET customer_id="))).toHaveLength(1);
    expect(r.queries.some(({ sql }) => sql.startsWith("UPDATE v2_production_works SET ordered_quantity="))).toBe(false);
    expect(await service.update(context, input)).toEqual(result);
    expect(r.queries.filter(({ sql }) => sql.startsWith("UPDATE v2_sales_documents SET customer_id="))).toHaveLength(1);
    expect(r.queries.filter(({ sql }) => sql === "COMMIT")).toHaveLength(2);
  });

  test("actual Sales production SUMs cannot use replacement surplus; original rework still closes a paid Order", async () => {
    const db = new PGlite();
    const statements: string[] = [];
    const client = { query: async (sql: string, parameters?: unknown[]) => {
      statements.push(sql);
      const result = await db.query(sql, parameters);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    } } as unknown as PoolClient;
    try {
      // Minimal fixture table shapes. Execute the real Production usable-output
      // function and BOTH actual Sales reads; do not mock their aggregates.
      await db.exec(`
        CREATE TABLE v2_sales_document_lines(id varchar,organization_id varchar,document_id varchar,description text,quantity integer,position integer,product_id varchar,resolved_configuration jsonb);
        CREATE TABLE pbv2_tree_versions(id varchar,organization_id varchar,product_id varchar,tree_json jsonb);
        CREATE TABLE v2_sales_line_production_requirements(organization_id varchar,order_line_id varchar,requirement_key varchar);
        CREATE TABLE v2_sales_line_workflow_exceptions(organization_id varchar,order_line_id varchar,production_requirement text);
        CREATE TABLE v2_route_instances(organization_id varchar,order_line_id varchar,route_state text);
        CREATE TABLE v2_production_works(id varchar,organization_id varchar,order_line_id varchar,requirement_key varchar,replacement_obligation_id varchar,rework_cycle_id varchar);
        CREATE TABLE v2_production_attempts(organization_id varchar,production_work_id varchar,good_quantity integer,completed_at timestamptz);
        CREATE TABLE v2_production_output_dispositions(organization_id varchar,production_work_id varchar,rejected_quantity integer);
        CREATE TABLE v2_fulfillment_handoff_lines(organization_id varchar,order_document_id varchar,order_line_id varchar,handoff_id varchar,quantity integer);
        CREATE TABLE v2_fulfillment_handoffs(id varchar,organization_id varchar,replacement_obligation_id varchar);
        CREATE TABLE v2_order_replacement_obligations(id varchar,organization_id varchar,order_document_id varchar,status text);
        CREATE TABLE v2_sales_order_details(document_id varchar,organization_id varchar,commercial_state text,completed_at timestamptz,completed_principal_kind text,completed_principal_subject text,completed_staff_actor_user_id varchar,archived_at timestamptz,archived_principal_kind text,archived_principal_subject text,archived_staff_actor_user_id varchar,updated_at timestamptz);
        CREATE TABLE v2_billing_invoices(id varchar,organization_id varchar,sales_order_document_id varchar,invoice_state text,total_cents bigint);
        CREATE TABLE v2_billing_payment_allocations(organization_id varchar,invoice_id varchar,amount_cents bigint);
        CREATE TABLE v2_billing_refund_allocation_evidence(organization_id varchar,invoice_id varchar,amount_cents bigint);
        CREATE TABLE v2_audit_events(organization_id varchar,operation text,event_type text,resource_type text,resource_id varchar,principal_kind text,principal_subject text,changes jsonb);
      `);
      const migration = await readFile(path.join(workspaceRoot, "server/db/migrations_v2/0282_v2_production_output_rejections.sql"), "utf8");
      const usableOutput = migration.match(/CREATE OR REPLACE FUNCTION v2_usable_production_good_quantity[\s\S]*?\$\$;/u)?.[0];
      expect(usableOutput).toBeDefined();
      await db.exec(usableOutput!);
      await db.query("INSERT INTO v2_sales_document_lines VALUES('line-a',$1,$2,'Original two units',2,0,'product',$3::jsonb)", [organizationId, orderId, JSON.stringify({ productFacts: { workflowIntent: "standard_production", requiresProductionJob: true } })]);
      await db.query("INSERT INTO v2_sales_order_details(document_id,organization_id,commercial_state) VALUES($1,$2,'open')", [orderId, organizationId]);
      await db.query("INSERT INTO v2_sales_line_production_requirements VALUES($1,'line-a','front')", [organizationId]);
      await db.query("INSERT INTO v2_route_instances VALUES($1,'line-a','completed')", [organizationId]);
      await db.query("INSERT INTO v2_production_works VALUES('original',$1,'line-a','front',NULL,NULL),('replacement',$1,'line-a','front','replacement-1',NULL)", [organizationId]);
      await db.query("INSERT INTO v2_production_attempts VALUES($1,'original',2,now()),($1,'replacement',1,now())", [organizationId]);
      await db.query("INSERT INTO v2_production_output_dispositions VALUES($1,'original',1)", [organizationId]);
      await db.query("INSERT INTO v2_order_replacement_obligations VALUES('replacement-1',$1,$2,'fulfilled')", [organizationId, orderId]);
      await db.query("INSERT INTO v2_fulfillment_handoffs VALUES('original-pickup',$1,NULL),('replacement-pickup',$1,'replacement-1')", [organizationId]);
      await db.query("INSERT INTO v2_fulfillment_handoff_lines VALUES($1,$2,'line-a','original-pickup',2),($1,$2,'line-a','replacement-pickup',1)", [organizationId, orderId]);
      await db.query("INSERT INTO v2_billing_invoices VALUES('original-invoice',$1,$2,'issued',1750)", [organizationId, orderId]);
      await db.query("INSERT INTO v2_billing_payment_allocations VALUES($1,'original-invoice',1750)", [organizationId]);
      const invoiceBefore = (await db.query("SELECT * FROM v2_billing_invoices")).rows;
      const paymentsBefore = (await db.query("SELECT * FROM v2_billing_payment_allocations")).rows;
      const tx = new PostgresOrderTransaction(client);
      const incomplete = await tx.completionEligibility(organizationId, orderId);
      expect(incomplete.eligible).toBe(false);
      expect(incomplete.blockers).toContainEqual(expect.objectContaining({ kind: "production_incomplete", orderLineId: "line-a" }));
      await reconcileOrderInTransaction(client, organizationId, orderId);
      expect((await db.query<{ commercial_state: string }>("SELECT commercial_state FROM v2_sales_order_details")).rows[0]!.commercial_state).toBe("open");
      expect((await db.query("SELECT * FROM v2_audit_events")).rows).toHaveLength(0);

      // NULL replacement lineage is original rework, not replacement output.
      await db.query("INSERT INTO v2_production_works VALUES('original-rework',$1,'line-a','front',NULL,'rework-cycle')", [organizationId]);
      await db.query("INSERT INTO v2_production_attempts VALUES($1,'original-rework',1,now())", [organizationId]);
      expect((await tx.completionEligibility(organizationId, orderId)).eligible).toBe(true);
      await reconcileOrderInTransaction(client, organizationId, orderId);
      expect((await db.query<{ commercial_state: string }>("SELECT commercial_state FROM v2_sales_order_details")).rows[0]!.commercial_state).toBe("completed");
      expect((await db.query<{ event_type: string }>("SELECT event_type FROM v2_audit_events")).rows).toEqual([{ event_type: "order_auto_closed" }]);
      expect((await db.query("SELECT * FROM v2_billing_invoices")).rows).toEqual(invoiceBefore);
      expect((await db.query("SELECT * FROM v2_billing_payment_allocations")).rows).toEqual(paymentsBefore);
      const productionReads = statements.filter((sql) => sql.includes("sum(v2_usable_production_good_quantity"));
      expect(productionReads).toHaveLength(4);
      expect(productionReads.every((sql) => sql.includes("w.requirement_key=req.requirement_key AND w.replacement_obligation_id IS NULL"))).toBe(true);
    } finally { await db.close(); }
  });

  test.each(["quantity", "artifact-only"] as const)("canonical %s financial failure rolls Sales, projections and Billing back inside actual PG runner", async (mode) => {
    const r = await fixture();
    const before = structuredClone({ header: r.header, rows: r.rows, works: r.works, invoice: r.invoice });
    const changedLine = await line("line-b", 9);
    const pgRunner = new PostgresOrderTransactionRunner({ connect: async () => r.client } as unknown as Pool);
    let ownerFailure: unknown;
    // M0 persistence and CRM are independent ports; retain real Sales read/update
    // and the actual transaction runner, stubbing only those unrelated operations.
    const runner: OrderTransactionRunner = { transaction: (action) => pgRunner.transaction(async (tx) => {
      // Decode only the real read DTO across VM realms; the host's JSON guard
      // correctly rejects foreign Object prototypes. Keep its exact bigint number.
      const read = tx.read.bind(tx);
      tx.read = async (...args) => {
        const value = await read(...args);
        if (!value) return null;
        const decoded = JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry)) as typeof value;
        return { ...decoded, number: { ...decoded.number, core: value.number.core } };
      };
      tx.reserve = async () => ({ kind: "new", request: { id: "rollback-request", status: "in_progress", resultJson: null } });
      tx.customers.validateContactReference = async () => true;
      tx.products.resolveActivePricingInput = async () => ({ ok: true, value: {
        sellableProduct: { organizationId, productId: changedLine.productId, displayName: "Fixture", lifecycle: "active",
          pricingConfiguration: { id: changedLine.resolvedConfiguration.pricingConfigurationId, version: "1", contentHash: "sha256:projection-config" }, requiresDimensions: false, pricingCurrency: usd },
        resolvedConfiguration: changedLine.resolvedConfiguration, rules: { base: { perPieceCents: 100 } }, warnings: [],
      } });
      tx.products.resolveCurrentTaxability = async () => ({ taxable: true });
      tx.products.resolveOrderRoutability = async () => ({ kind: "routable", productName: "Fixture", routing: { kind: "no_route" } });
      try { return await action(tx); }
      catch (cause) { ownerFailure = cause; throw cause; }
    }) };
    const context: OperationContext = { organizationId, operationId: "rollback", businessRequest: { id: "rollback", payloadFingerprint: "context-only" },
      principal: { kind: "staff", organizationId, userId: "staff", authority: { membershipId: "membership", capabilities: ["order.edit"] } } };
    failBilling = true;
    try {
      const result = await new OrderApplicationService(runner).update(context, { businessRequestId: "rollback", orderId, expectedRevision: "4",
        patch: mode === "quantity" ? { jobLabel: "Rollback job", purchaseOrderNumber: "Rollback PO" } : {},
        ...(mode === "quantity" ? { lineChanges: [{ kind: "update" as const, lineId: changedLine.lineId, line: { productId: changedLine.productId, quantity: changedLine.quantity } }] } : {}),
      }, mode === "artifact-only" ? { touchRevision: true } : undefined);
      expect(ownerFailure).toMatchObject({ code: "CONFLICT" });
      expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    } finally { failBilling = false; }
    expect({ header: r.header, rows: r.rows, works: r.works, invoice: r.invoice }).toEqual(before);
    expect(r.queries[0]!.sql).toBe("BEGIN");
    expect(r.queries.at(-1)!.sql).toBe("ROLLBACK");
    expect(r.queries.some(({ sql }) => sql === "COMMIT")).toBe(false);
    expect(r.queries.filter(({ sql }) => sql.startsWith("UPDATE v2_sales_documents SET customer_id="))).toHaveLength(1);
    expect(r.queries.filter(({ sql }) => sql.startsWith("UPDATE v2_production_works SET ordered_quantity="))).toHaveLength(mode === "quantity" ? 1 : 0);
    expect(r.queries.filter(({ sql }) => sql.startsWith("UPDATE v2_billing_invoices SET source_sales_state_token="))).toHaveLength(1);
    expect(r.released).toBe(1);
    expect(billingClients.at(-1)).toBe(r.client);
  });
}
describe("M1 actual Sales PostgreSQL adapter projection with fake client", actualAdapterRegressions);
