import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import type { CustomersReadPort } from "../../src/modules/customers/contracts.js";
import type { ProductPricingCompatibilityPort } from "../../src/modules/products/contracts.js";
import type { CustomerScopedPricingPort } from "../../src/modules/products/customerCommercial.js";
import type { QuoteTransaction, QuoteReadModel } from "../../src/modules/sales/quoteApplication.js";
import type { OrderTransaction, OrderReadModel } from "../../src/modules/sales/orderApplication.js";
import type { SalesWorkspace, SalesWorkspaceLineMapEntry } from "../../src/modules/sales/workspaceContracts.js";
import type { ApplicationResult } from "../../src/errors/applicationError.js";
import type { WorkspacePromotionResult } from "../../src/modules/sales/workspacePromotion.js";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic", "Use cleanEnvironment/run; no ambient database is allowed.");
assert.deepEqual(Object.keys(process.env).filter((key) => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);
const { PostgresSalesWorkspaceStore, PostgresSalesWorkspaceTransaction } = await import("../../infrastructure/sales/postgresSalesWorkspace.js");
const { PostgresWorkspacePromotion } = await import("../../infrastructure/sales/postgresWorkspacePromotion.js");
const { PostgresWorkspaceLinePricing } = await import("../../infrastructure/sales/postgresWorkspaceLinePricing.js");
const { SalesWorkspaceApplicationService } = await import("../../src/modules/sales/workspaceApplication.js");
const { SalesWorkspaceLineService } = await import("../../src/modules/sales/workspaceLines.js");
const { V2PricingParityAdapter } = await import("../../src/modules/pricing/v2PricingAdapter.js");
const { promoteWorkspaceArtworkInTransaction } = await import("../../infrastructure/artwork/postgresWorkspaceArtwork.js");
const { V2ApplicationError } = await import("../../src/errors/applicationError.js");
const { brandedId, currencyCode } = await import("../../src/modules/shared/commercialValues.js");

const org = brandedId<"OrganizationId">(randomUUID()), otherOrg = randomUUID(), user = randomUUID(), otherUser = randomUUID();
const customer = brandedId<"CustomerId">(randomUUID()), product = brandedId<"ProductId">(randomUUID());
const config = brandedId<"PricingConfigurationId">(randomUUID()), usd = currencyCode("USD");
const capabilities: readonly Capability[] = ["quote.create", "quote.edit", "order.create", "quote.overridePrice", "order.overridePrice", "artwork.adopt", "artwork.assign"];
const context = (requestId = "promote", organizationId: string = org, userId = user, caps = capabilities): OperationContext => ({
  organizationId, operationId: "sales.workspace.promote.v1", businessRequest: { id: requestId, payloadFingerprint: "not-authoritative" },
  principal: { kind: "staff", organizationId, userId, authority: { membershipId: randomUUID(), capabilities: caps } },
});
const header = { customerContact: { organizationId: org, customerId: customer }, jobLabel: "Persistent job label", notes: "TEMP planning notes", terms: { commercialNotes: "Canonical customer notes" } };
const stringify = (value: unknown) => JSON.stringify(value, (_key, entry: unknown) => typeof entry === "bigint" ? entry.toString() : entry);
const wire = <T>(value: T): T => JSON.parse(stringify(value));
const errorCode = (expected: string) => (error: unknown) => { assert.equal((error as { code?: string }).code, expected); return true; };
function value(result: ApplicationResult<WorkspacePromotionResult>) {
  assert.ok(result.ok, !result.ok ? `${result.error.code}: ${result.error.message} ${result.error.cause ?? ""}` : "");
  return result.value;
}
function rejected(result: ApplicationResult<WorkspacePromotionResult>, expected: string) {
  assert.equal(result.ok, false, "An invalid promotion must not commit.");
  if (!result.ok) assert.equal(result.error.code, expected, result.error.message);
}
type Fault = "customer" | "product" | "insert" | "material" | "billing" | "routing" | "artwork";

async function fixture() {
  const db = new PGlite();
  const events: string[] = [];
  let leased = false, inTransaction = false, fault: Fault | undefined, rate = 100, version = "1", clock = new Date(), artworkWrites = false;
  const client = Object.freeze({
    async query(text: string, parameters?: readonly unknown[]) {
      if (text === "BEGIN") assert.equal(inTransaction, false, "Production must not nest BEGIN.");
      events.push(text);
      const result = await db.query(text, parameters ? [...parameters] : []);
      if (text === "BEGIN") inTransaction = true;
      if (text === "ROLLBACK" || text === "COMMIT") inTransaction = false;
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    },
    release() { assert.ok(leased); leased = false; },
  }) as unknown as PoolClient;
  const pool = Object.freeze({ async connect() { assert.equal(leased, false, "Only the caller-owned client is used."); leased = true; return client; } }) as unknown as Pool;
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),document_kind text NOT NULL,revision integer NOT NULL DEFAULT 1,payload jsonb NOT NULL,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_id varchar NOT NULL,position integer NOT NULL,payload jsonb NOT NULL,UNIQUE(id,organization_id),UNIQUE(id,organization_id,document_id),FOREIGN KEY(document_id,organization_id) REFERENCES v2_sales_documents(id,organization_id));
    CREATE TABLE acceptance_numbers(organization_id varchar REFERENCES organizations(id),kind text,value bigint NOT NULL,PRIMARY KEY(organization_id,kind));
    CREATE TABLE acceptance_requests(id varchar PRIMARY KEY,organization_id varchar REFERENCES organizations(id),operation text,request_id text,fingerprint text,status text,result jsonb,UNIQUE(organization_id,operation,request_id));
    CREATE TABLE acceptance_audits(id varchar PRIMARY KEY,document_id varchar REFERENCES v2_sales_documents(id),payload jsonb NOT NULL);
    CREATE TABLE acceptance_attribution(id varchar PRIMARY KEY,document_id varchar REFERENCES v2_sales_documents(id),payload jsonb NOT NULL);
    CREATE TABLE v2_billing_invoices(id varchar PRIMARY KEY,organization_id varchar NOT NULL,order_id varchar NOT NULL,FOREIGN KEY(order_id,organization_id) REFERENCES v2_sales_documents(id,organization_id));
    CREATE TABLE v2_route_instances(id varchar PRIMARY KEY,organization_id varchar NOT NULL,order_id varchar NOT NULL,order_line_id varchar NOT NULL,FOREIGN KEY(order_line_id,organization_id,order_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id));
    CREATE TABLE acceptance_material_requirements(id varchar PRIMARY KEY,organization_id varchar NOT NULL,order_id varchar NOT NULL,line_id varchar NOT NULL,FOREIGN KEY(line_id,organization_id,order_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id));
    CREATE TABLE acceptance_artwork_assignments(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_id varchar NOT NULL,line_id varchar NOT NULL,FOREIGN KEY(line_id,organization_id,document_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id));
    CREATE TABLE v2_artwork_files(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),storage_provider text NOT NULL,object_key text NOT NULL,content_type text NOT NULL,byte_size bigint NOT NULL,checksum_algorithm text,checksum_value text,UNIQUE(id,organization_id));
    CREATE TABLE v2_customer_product_pricing_agreements(id varchar PRIMARY KEY,organization_id varchar,customer_id varchar,product_id varchar,product_version_id varchar,currency text,pricing_mode text,pricing_value integer,active boolean,effective_from timestamptz,created_at timestamptz);`);
  for (const id of [org, otherOrg]) await db.query("INSERT INTO organizations VALUES($1)", [id]);
  for (const id of [user, otherUser]) await db.query("INSERT INTO users VALUES($1)", [id]);
  await db.query("INSERT INTO v2_customer_product_pricing_agreements VALUES($1,$2,$3,$4,NULL,'USD','fixed_unit',180,true,'2020-01-01','2020-01-01')", [randomUUID(), org, customer, product]);
  for (const name of ["0294_v2_sales_workspace_foundation.sql", "0246_v2_artwork_storage_reconciliation.sql", "0295_v2_sales_workspace_artwork.sql"]) {
    await db.exec(await readFile(new URL(`../../../server/db/migrations_v2/${name}`, import.meta.url), "utf8"));
  }
  const trip = (stage: Fault) => { events.push(`owner:${stage}`); if (fault === stage) throw new V2ApplicationError("CONFLICT", `Injected ${stage} owner failure.`); };
  const pricing = new V2PricingParityAdapter();
  const customers = {
    async validateContactReference(reference) { trip("customer"); return reference.organizationId === org && reference.customerId === customer; },
    async getContact() { return null; },
    async getCommercialPolicy() { return { paymentTerms: "net_30" }; },
  } as Pick<CustomersReadPort, "validateContactReference" | "getContact" | "getCommercialPolicy"> as CustomersReadPort;
  const products = {
    async resolveActivePricingInput(input) {
      trip("product");
      return { ok: true, value: {
        sellableProduct: { organizationId: org, productId: product, displayName: "Fixture product", lifecycle: "active", requiresDimensions: false, pricingCurrency: usd, pricingConfiguration: { id: config, version, contentHash: `configuration-${version}` } },
        resolvedConfiguration: { schemaVersion: 1, organizationId: org, productId: product, pricingConfigurationId: config, pricingConfigurationVersion: version, pricingConfigurationContentHash: `configuration-${version}`, quantity: input.quantity, selections: input.selections ?? {}, derivedFacts: {}, productFacts: {} },
        rules: { base: { perPieceCents: rate } }, warnings: [],
      } };
    },
    async resolveCurrentTaxability() { return { taxable: true }; },
    async resolveOrderRoutability() { return { kind: "routable", productName: "Fixture product", routing: { kind: "route_required", routeTemplateId: randomUUID(), routeTemplateName: "Test template", steps: [] } }; },
  } as Pick<ProductPricingCompatibilityPort, "resolveActivePricingInput" | "resolveCurrentTaxability" | "resolveOrderRoutability"> as ProductPricingCompatibilityPort;
  const store = () => new PostgresSalesWorkspaceStore(pool);
  const app = () => new SalesWorkspaceApplicationService(store(), { now: () => clock });
  const lines = () => new SalesWorkspaceLineService(store(), {
    now: () => clock,
    pricing: (tx) => { assert.ok(tx instanceof PostgresSalesWorkspaceTransaction); return new PostgresWorkspaceLinePricing(tx.client, { products, customers, pricing, now: () => clock }); },
    releaseLineArtwork: async () => { throw Error("Promotion fixture never removes lines."); },
  });
  // These are transaction-scoped persistence/owner ports, NOT substitutes for
  // QuoteApplicationService.create or OrderApplicationService.create. Production
  // promotion invokes both real applications; PostgreSQL performs rollback.
  function canonicalTransaction(supplied: PoolClient, target: "quote" | "order", customerPricing?: CustomerScopedPricingPort) {
    assert.equal(supplied, client); assert.equal(inTransaction, true);
    const common = {
      customers, products, pricing, customerPricing,
      async reserve(input: Parameters<QuoteTransaction["reserve"]>[0]) {
        const id = randomUUID();
        await supplied.query("INSERT INTO acceptance_requests(id,organization_id,operation,request_id,fingerprint,status) VALUES($1,$2,$3,$4,$5,'in_progress')", [id, input.organizationId, input.operation, input.businessRequestId, input.payloadFingerprint]);
        return { kind: "new" as const, request: { id, status: "in_progress" as const, resultJson: null } };
      },
      async succeed(organizationId: string, requestId: string, result: unknown) { await supplied.query("UPDATE acceptance_requests SET status='succeeded',result=$3::jsonb WHERE organization_id=$1 AND id=$2", [organizationId, requestId, stringify(result)]); },
      async attribute(input: Parameters<QuoteTransaction["attribute"]>[0]) { await supplied.query("INSERT INTO acceptance_attribution VALUES($1,$2,$3::jsonb)", [randomUUID(), input.resourceId, stringify(input)]); },
      async audit(input: Parameters<QuoteTransaction["audit"]>[0]) { await supplied.query("INSERT INTO acceptance_audits VALUES($1,$2,$3::jsonb)", [randomUUID(), input.event.resourceId, stringify(input)]); },
      async allocateNumber(organizationId: string) {
        const result = await supplied.query<{ value: string }>("INSERT INTO acceptance_numbers VALUES($1,$2,1000) ON CONFLICT(organization_id,kind) DO UPDATE SET value=acceptance_numbers.value+1 RETURNING value::text", [organizationId, target]);
        const core = BigInt(result.rows[0].value);
        return { kind: target, core, prefix: target === "quote" ? "Q-" : "O-", display: `${target === "quote" ? "Q-" : "O-"}${core}` };
      },
      async create(input: Parameters<QuoteTransaction["create"]>[0] | Parameters<OrderTransaction["create"]>[0]) {
        const id = "quoteId" in input ? input.quoteId : input.orderId;
        await supplied.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,payload) VALUES($1,$2,$3,$4::jsonb)", [id, input.organizationId, target, stringify(input)]);
        for (const [position, line] of input.lines.entries()) await supplied.query("INSERT INTO v2_sales_document_lines VALUES($1,$2,$3,$4,$5::jsonb)", [line.lineId, input.organizationId, id, position, stringify(line)]);
        trip("insert");
      },
      async read(organizationId: string, documentId: string) {
        const document = (await supplied.query<{ payload: Record<string, unknown>; revision: number }>("SELECT payload,revision FROM v2_sales_documents WHERE organization_id=$1 AND id=$2 AND document_kind=$3", [organizationId, documentId, target])).rows[0];
        if (!document) return null;
        const payload = document.payload as Parameters<QuoteTransaction["create"]>[0];
        const persisted = (await supplied.query<{ payload: unknown }>("SELECT payload FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 ORDER BY position", [organizationId, documentId])).rows.map((row) => row.payload);
        const number = { ...payload.number, core: BigInt(payload.number.core) };
        const state = { ...payload, lines: persisted, currency: usd };
        return target === "quote"
          ? { quote: { ...state, quoteId: brandedId<"QuoteId">(documentId), deliveryState: "not_sent", acceptanceState: "not_accepted", lifecycleState: "open" }, number, revision: String(document.revision), checkpoints: [] } as unknown as QuoteReadModel
          : { order: { ...state, orderId: documentId, commercialState: "open" }, number, revision: String(document.revision), routes: [], completionEligibility: { eligible: false, blockers: [] } } as unknown as OrderReadModel;
      },
    };
    if (target === "quote") return { ...common,
      async update() { throw Error("Creation must not call Quote update."); },
      async transition() { throw Error("Creation must not send, accept, or transition a Quote."); },
      async freezeTaxComposition() { throw Error("Creation must not freeze a Quote checkpoint."); },
    } as QuoteTransaction;
    return { ...common,
      materialRequirements: { async freeze(organizationId: string, orderId: string, sourceLines: Parameters<OrderTransaction["materialRequirements"]["freeze"]>[2]) {
        for (const line of sourceLines) await supplied.query("INSERT INTO acceptance_material_requirements VALUES($1,$2,$3,$4)", [randomUUID(), organizationId, orderId, line.lineId]);
        trip("material");
      } },
      billing: { async createDraftInvoice(input: Parameters<OrderTransaction["billing"]["createDraftInvoice"]>[0]) {
        const invoiceId = randomUUID(); await supplied.query("INSERT INTO v2_billing_invoices VALUES($1,$2,$3)", [invoiceId, input.organizationId, input.orderId]); trip("billing");
        return { status: "created", invoiceId, synchronizationVersion: "1" };
      } },
      routing: { async instantiateRoute(input: Parameters<OrderTransaction["routing"]["instantiateRoute"]>[0]) {
        assert.equal(input.work.kind, "sales_order_line");
        if (input.work.kind !== "sales_order_line") throw Error("Unexpected route work");
        const id = randomUUID(); await supplied.query("INSERT INTO v2_route_instances VALUES($1,$2,$3,$4)", [id, input.organizationId, input.work.orderId, input.work.orderLineId]); trip("routing");
        return { routeInstance: { id, ...input } };
      } },
    } as unknown as OrderTransaction;
  }
  const promotion = () => new PostgresWorkspacePromotion(pool, async (supplied, input) => {
    assert.equal(supplied, client); assert.equal(inTransaction, true);
    // Exercise actual Artwork's persisted-map and canonical tenant/kind checks.
    // Assignment failure injection below is explicitly a SQL-writing owner-port
    // fixture, not proof of the complete canonical Artwork adoption workflow.
    const empty = await promoteWorkspaceArtworkInTransaction(supplied, input);
    if (!artworkWrites && fault !== "artwork") return empty;
    const maps = await new PostgresSalesWorkspaceTransaction(supplied).getPromotionLineMap(org, input.workspaceId);
    assert.deepEqual(maps, input.lineMap, "The complete durable map exists before Artwork runs.");
    for (const mapping of maps) await supplied.query("INSERT INTO acceptance_artwork_assignments VALUES($1,$2,$3,$4)", [randomUUID(), org, input.documentId, mapping.canonicalLineId]);
    if (input.documentKind === "quote") await supplied.query("UPDATE v2_sales_documents SET revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, input.documentId]);
    trip("artwork"); return { promotedCount: maps.length, claims: [] };
  }, { now: () => clock,
    quoteTransaction: (supplied) => canonicalTransaction(supplied, "quote") as QuoteTransaction,
    orderTransaction: (supplied, customerPricing) => canonicalTransaction(supplied, "order", customerPricing) as OrderTransaction,
  });
  const create = async () => {
    let workspace = await app().create(context(), { requestId: randomUUID(), header });
    for (const quantity of [2, 3]) workspace = await lines().add(context(), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, line: { productId: product, quantity, description: `Line ${quantity}` } });
    return workspace;
  };
  const promote = (workspace: SalesWorkspace, target: "quote" | "order" = "order", requestId = "promote", caller = context(requestId)) =>
    promotion().promote(caller, { workspaceId: workspace.id, target, requestId, expectedRevision: workspace.revision });
  const counts = async () => {
    const tables = ["v2_sales_documents", "v2_sales_document_lines", "acceptance_numbers", "acceptance_requests", "acceptance_audits", "acceptance_attribution", "v2_billing_invoices", "v2_route_instances", "acceptance_material_requirements", "acceptance_artwork_assignments", "v2_sales_workspace_promotions", "v2_sales_workspace_promotion_lines"];
    const result: Record<string, number> = {};
    for (const table of tables) result[table] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    return result;
  };
  const assertRollback = async (workspace: SalesWorkspace) => {
    assert.deepEqual(await app().get(context(), workspace.id), wire(workspace));
    assert.ok(Object.values(await counts()).every((count) => count === 0), stringify(await counts()));
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM v2_sales_workspaces WHERE state='promoting'")).rows[0].n, 0);
  };
  return { db, client, store, app, lines, create, promote, promotion, events, counts, assertRollback,
    setFault(stage?: Fault) { fault = stage; }, setRate(value: number) { rate = value; }, setVersion(value: string) { version = value; }, setClock(value: Date) { clock = value; },
    enableArtwork() { artworkWrites = true; },
    async close() { assert.equal(leased, false); await db.close(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const cases: [string, (f: Fixture) => Promise<void>][] = [];
const acceptance = (name: string, run: (f: Fixture) => Promise<void>) => cases.push([name, run]);

// These M groups cover new-entry promotion, not deferred campaign edit cases 15-17.
acceptance("M01 complete ordered unique TEMP mapping survives reload and real canonical FKs reject fabricated identity", async (f) => {
  const workspace = await f.create();
  const map: SalesWorkspaceLineMapEntry[] = workspace.lines.map((line) => ({ workspaceLineId: line.id, canonicalLineId: randomUUID(), position: line.position }));
  const record = (mapping: readonly SalesWorkspaceLineMapEntry[]) => f.store().run(async (tx) => {
    await tx.get(org, user, workspace.id, true);
    await tx.beginPromotion(org, workspace.id, workspace.revision, "map-probe", "order", "b".repeat(64));
    await tx.recordPromotionLineMap(org, workspace.id, "order", randomUUID(), mapping);
  });
  for (const malformed of [map.slice(0, 1), [map[0], { ...map[1], canonicalLineId: map[0].canonicalLineId }], [...map].reverse()]) {
    await assert.rejects(record(malformed), (error: unknown) => { assert.equal((error as Error).message, "Promotion requires a complete ordered TEMP-to-canonical line map."); return errorCode("CONFLICT")(error); });
  }
  await assert.rejects(record(map), (error: unknown) => { assert.equal((error as Error & { cause: { code: string } }).cause.code, "23503"); return errorCode("VALIDATION_ERROR")(error); });
  for (const wrongTenant of [false, true]) {
    await assert.rejects(f.store().run(async (tx) => {
      const documentId = randomUUID(), canonicalOrg = wrongTenant ? otherOrg : org;
      await tx.get(org, user, workspace.id, true);
      await tx.beginPromotion(org, workspace.id, workspace.revision, "foreign-map", "order", "b".repeat(64));
      await tx.client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,payload) VALUES($1,$2,'order','{}')", [documentId, canonicalOrg]);
      for (const line of map) await tx.client.query("INSERT INTO v2_sales_document_lines VALUES($1,$2,$3,$4,'{}')", [line.canonicalLineId, canonicalOrg, documentId, line.position]);
      await tx.recordPromotionLineMap(org, workspace.id, "order", wrongTenant ? documentId : randomUUID(), map);
    }), (error: unknown) => { assert.equal((error as Error & { cause: { code: string } }).cause.code, "23503"); return errorCode("VALIDATION_ERROR")(error); });
  }
  await assert.rejects(f.store().run(async (tx) => { await tx.get(org, user, workspace.id, true); await tx.beginPromotion(org, workspace.id, workspace.revision, "incomplete", "order", "b".repeat(64)); await tx.update({ ...workspace, state: "promoted", revision: workspace.revision + 1 }, workspace.revision); }), errorCode("VALIDATION_ERROR"));
  await f.assertRollback(workspace);
  const result = value(await f.promote(workspace));
  const persisted = await f.store().run((tx) => tx.getPromotionLineMap(org, workspace.id));
  assert.deepEqual(persisted, result.receipt.lineMap); assert.equal(persisted.length, workspace.lines.length);
  assert.equal(new Set(persisted.map((line) => line.canonicalLineId)).size, workspace.lines.length);
  for (const mapped of persisted) assert.notEqual(mapped.workspaceLineId, mapped.canonicalLineId);
  assert.equal((await f.db.query<{ n: number }>("SELECT count(*)::int AS n FROM v2_sales_workspace_promotion_lines m JOIN v2_sales_document_lines l ON l.id=m.canonical_line_id AND l.organization_id=m.organization_id AND l.document_id=m.document_id")).rows[0].n, 2);
  await assert.rejects(f.db.query("DELETE FROM v2_sales_workspace_promotion_lines"), errorCode("23514"));
});

acceptance("M02 Quote promotion is exactly once, never calls transition, and stores the final post-Artwork revision", async (f) => {
  const workspace = await f.create(); f.enableArtwork();
  const first = value(await f.promote(workspace, "quote"));
  assert.deepEqual(first.promotedWorkspaceHeader, header);
  assert.equal(first.replayed, false); assert.equal(first.receipt.documentRevision, "2"); assert.equal(first.receipt.artworkPromoted, true);
  const result = first.receipt.result as unknown as QuoteReadModel;
  assert.equal(result.quote.lines[0].calculatedLineAmount.cents, 200); assert.equal(typeof result.number.core, "string");
  assert.equal(result.quote.terms.commercialNotes, "Canonical customer notes"); assert.equal(first.receipt.header.jobLabel, header.jobLabel);
  const before = await f.counts(); const replay = value(await f.promote(workspace, "quote"));
  assert.deepEqual(replay.promotedWorkspaceHeader, header);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.receipt, first.receipt); assert.deepEqual(await f.counts(), before);
  assert.equal(before.v2_sales_documents, 1); assert.equal(before.v2_billing_invoices, 0); assert.equal(before.v2_route_instances, 0); assert.equal(before.acceptance_material_requirements, 0);
  const reloaded = await f.app().get(context(), workspace.id); assert.equal(reloaded.revision, workspace.revision + 1); assert.deepEqual(reloaded.promotion, first.receipt);
  await assert.rejects(f.db.query("UPDATE v2_sales_workspace_promotions SET document_revision='999'"), errorCode("23514"));
});

acceptance("M03 Order promotion uses customer pricing and exactly-once owner effects on the same SQL client", async (f) => {
  const workspace = await f.create(); const start = f.events.length;
  const first = value(await f.promote(workspace));
  const result = first.receipt.result as unknown as OrderReadModel;
  assert.equal(result.order.lines[0].calculatedLineAmount.cents, 360);
  assert.equal(result.order.lines[0].pricingResult.customerPricing?.value, 180);
  const trace = f.events.slice(start);
  assert.equal(trace.filter((event) => event === "BEGIN").length, 1); assert.equal(trace.filter((event) => event === "COMMIT").length, 1);
  assert.ok(trace.indexOf("owner:material") < trace.indexOf("owner:billing")); assert.ok(trace.indexOf("owner:billing") < trace.indexOf("owner:routing"));
  const before = await f.counts();
  assert.equal(before.v2_sales_documents, 1); assert.equal(before.v2_sales_document_lines, 2); assert.equal(before.v2_billing_invoices, 1); assert.equal(before.v2_route_instances, 2); assert.equal(before.acceptance_material_requirements, 2);
  assert.equal(before.acceptance_requests, 1); assert.equal(before.acceptance_audits, 1); assert.equal(before.acceptance_attribution, 1);
  const replay = value(await f.promote(workspace)); assert.ok(replay.replayed); assert.deepEqual(replay.receipt, first.receipt); assert.deepEqual(await f.counts(), before);
});

acceptance("M04 a changed target, request, revision or cross-workspace request reuse conflicts without a second document", async (f) => {
  const workspace = await f.create(); const first = value(await f.promote(workspace, "quote"));
  const before = await f.counts();
  rejected(await f.promote(workspace, "order"), "CONFLICT"); rejected(await f.promote(workspace, "quote", "different"), "CONFLICT");
  rejected(await f.promote({ ...workspace, revision: workspace.revision + 1 }, "quote"), "CONFLICT");
  const another = await f.create(); rejected(await f.promote(another, "quote"), "CONFLICT");
  assert.deepEqual(await f.counts(), before); assert.equal((await f.app().get(context(), another.id)).state, "draft");
  assert.equal((await f.app().get(context(), workspace.id)).promotion?.documentId, first.receipt.documentId);
});

acceptance("M05 stale/expired input and revoked or foreign authority are rejected before execution and replay", async (f) => {
  const workspace = await f.create();
  rejected(await f.promote({ ...workspace, revision: workspace.revision - 1 }), "CONFLICT"); await f.assertRollback(workspace);
  f.setClock(new Date(Date.parse(workspace.expiresAt) + 1)); rejected(await f.promote(workspace), "CONFLICT"); await f.assertRollback({ ...workspace, state: "expired" });
  f.setClock(new Date()); f.enableArtwork(); const first = value(await f.promote(workspace)); const before = await f.counts();
  for (const [caller, expected] of [
    [context("promote", otherOrg), "NOT_FOUND"], [context("promote", org, otherUser), "NOT_FOUND"],
    [context("promote", org, user, ["quote.create"]), "FORBIDDEN"],
    [context("promote", org, user, ["order.create"]), "FORBIDDEN"],
  ] as const) rejected(await f.promote(workspace, "order", "promote", caller), expected);
  assert.deepEqual(await f.counts(), before); assert.equal(value(await f.promote(workspace)).receipt.documentId, first.receipt.documentId);
});

acceptance("M06 changed Product configuration, base price and customer agreement conflict then refresh permits retry", async (f) => {
  for (const drift of ["configuration", "price", "agreement"] as const) {
    const workspace = await f.create();
    const countsBefore = await f.counts(); const numbersBefore = (await f.db.query("SELECT * FROM acceptance_numbers ORDER BY kind")).rows;
    if (drift === "configuration") f.setVersion("2");
    if (drift === "price") f.setRate(101);
    if (drift === "agreement") await f.db.query("UPDATE v2_customer_product_pricing_agreements SET pricing_value=181");
    const target = drift === "agreement" ? "order" : "quote";
    rejected(await f.promote(workspace, target, drift), "CONFLICT");
    assert.deepEqual(await f.counts(), countsBefore); assert.deepEqual((await f.db.query("SELECT * FROM acceptance_numbers ORDER BY kind")).rows, numbersBefore);
    const snapshot = await f.app().get(context(), workspace.id); assert.equal(snapshot.state, "draft"); assert.equal(snapshot.revision, workspace.revision);
    const refreshed = await f.lines().refresh(context(), workspace.id, { requestId: `${drift}-refresh`, expectedRevision: workspace.revision });
    const saved = value(await f.promote(refreshed, target, drift)); assert.equal(saved.receipt.lineMap.length, 2);
    assert.deepEqual(value(await f.promote(refreshed, target, drift)).receipt, saved.receipt);
    f.setVersion("1"); f.setRate(100); await f.db.query("UPDATE v2_customer_product_pricing_agreements SET pricing_value=180");
  }
  assert.equal((await f.counts()).v2_sales_documents, 3);
});

acceptance("M07 actual canonical customer and Product validation failures leave an editable retryable draft", async (f) => {
  const workspace = await f.create();
  for (const failure of ["customer", "product"] as const) {
    f.setFault(failure); rejected(await f.promote(workspace), "CONFLICT"); await f.assertRollback(workspace);
  }
  f.setFault(); const first = value(await f.promote(workspace)); assert.deepEqual(value(await f.promote(workspace)).receipt, first.receipt);
});

acceptance("M08 canonical insert failure rolls back document, lines, number and operation request; retry commits once", async (f) => {
  const workspace = await f.create(); const start = f.events.length; f.setFault("insert");
  rejected(await f.promote(workspace), "CONFLICT");
  assert.ok(f.events.slice(start).some((event) => event.startsWith("INSERT INTO v2_sales_document_lines")));
  assert.ok(f.events.slice(start).includes("ROLLBACK")); assert.equal(f.events.slice(start).includes("COMMIT"), false);
  await f.assertRollback(workspace); f.setFault();
  const first = value(await f.promote(workspace)); assert.deepEqual(value(await f.promote(workspace)).receipt, first.receipt);
  assert.equal((await f.db.query<{ value: string }>("SELECT value::text FROM acceptance_numbers")).rows[0].value, "1000");
});

acceptance("M09 Billing, Routing and material owner failures undo their own SQL effects and all upstream writes", async (f) => {
  const workspace = await f.create();
  for (const failure of ["material", "billing", "routing"] as const) {
    const start = f.events.length; f.setFault(failure); rejected(await f.promote(workspace), "CONFLICT");
    assert.ok(f.events.slice(start).includes(`owner:${failure}`)); assert.ok(f.events.slice(start).includes("ROLLBACK"));
    await f.assertRollback(workspace);
  }
  f.setFault(); const first = value(await f.promote(workspace)); assert.deepEqual(value(await f.promote(workspace)).receipt, first.receipt);
  assert.equal((await f.counts()).v2_billing_invoices, 1); assert.equal((await f.counts()).v2_route_instances, 2);
});

acceptance("M10 Artwork failure after durable map and assignment writes rolls back everything before successful retry", async (f) => {
  const workspace = await f.create(); f.enableArtwork(); f.setFault("artwork");
  const start = f.events.length; rejected(await f.promote(workspace), "CONFLICT");
  const trace = f.events.slice(start);
  assert.ok(trace.some((event) => event.includes("INSERT INTO v2_sales_workspace_promotion_lines")));
  assert.ok(trace.some((event) => event.startsWith("INSERT INTO acceptance_artwork_assignments")));
  await f.assertRollback(workspace); f.setFault();
  const first = value(await f.promote(workspace)); const replay = value(await f.promote(workspace));
  assert.equal(first.receipt.artworkPromoted, true); assert.deepEqual(replay.receipt, first.receipt);
  assert.equal((await f.counts()).acceptance_artwork_assignments, 2); assert.equal((await f.counts()).v2_sales_workspace_promotion_lines, 2);
});

let failed = 0;
for (const [name, run] of cases) {
  const f = await fixture();
  try { await run(f); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
  finally { await f.close(); }
}
console.log(`Workspace promotion acceptance: ${cases.length - failed}/${cases.length} categories passed. Real Sales applications and PostgreSQL rollback; downstream owner ports are SQL-writing fixtures, not live provider or multi-connection concurrency proof.`);
console.log("Campaign cases 15-17 (D transactional source edits) are NOT IMPLEMENTED; P/M group totals are not campaign completion.");
if (failed) process.exitCode = 1;
