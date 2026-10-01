import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { success, V2ApplicationError } from "../../src/errors/applicationError.js";
import { PostgresOrderEditWorkspace, type OrderEditWorkspaceArtworkPort } from "../../infrastructure/sales/postgresOrderEditWorkspace.js";
import { PostgresSalesWorkspaceStore } from "../../infrastructure/sales/postgresSalesWorkspace.js";
import { PostgresWorkspacePromotion } from "../../infrastructure/sales/postgresWorkspacePromotion.js";
import { OrderApplicationService, type OrderReadModel, type OrderTransaction } from "../../src/modules/sales/orderApplication.js";
import { SalesWorkspaceApplicationService, salesWorkspaceFingerprint } from "../../src/modules/sales/workspaceApplication.js";
import { SalesWorkspaceLineService, workspaceLinePreviewFingerprint } from "../../src/modules/sales/workspaceLines.js";
import { calculatedDecision } from "../../src/modules/sales/quoteApplication.js";
import type { SalesWorkspace, SalesWorkspaceLineInput, SalesWorkspaceLinePreview } from "../../src/modules/sales/workspaceContracts.js";
import { normalizeSalesJobLabel, type SalesLineSnapshot } from "../../src/modules/sales/contracts.js";
import type { ResolvedProductConfiguration } from "../../src/modules/pricing/contracts.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";

const org = "62000000-0000-4000-8000-000000000001", user = "62000000-0000-4000-8000-000000000002";
const otherOrg = "62000000-0000-4000-8000-000000000003", otherUser = "62000000-0000-4000-8000-000000000004";
const customerId = brandedId<"CustomerId">("62000000-0000-4000-8000-000000000005");
const productId = brandedId<"ProductId">("62000000-0000-4000-8000-000000000006");
const configurationId = brandedId<"PricingConfigurationId">("62000000-0000-4000-8000-000000000007");
const principal = { kind: "staff" as const, organizationId: org, userId: user,
  authority: { membershipId: "verified", capabilities: ["order.view", "order.edit", "order.overridePrice", "artwork.adopt", "artwork.assign"] as const } };
const context: OperationContext = { organizationId: org, principal, operationId: "order-edit-test" };
const actor = (requestId: string): OperationContext => ({ ...context, businessRequest: { id: requestId, payloadFingerprint: "transport-only" } });
const json = (value: unknown) => JSON.stringify(value, (_key, entry: unknown) => typeof entry === "bigint" ? entry.toString() : entry);

describe("Persisted Order edit transaction (actual PGlite DDL and rollback)", () => {
  let db: PGlite, pool: Pool, store: PostgresSalesWorkspaceStore;
  let service: PostgresOrderEditWorkspace, drafts: SalesWorkspaceApplicationService, lines: SalesWorkspaceLineService;
  let orderId: string, invoiceId: string, initial: OrderReadModel;
  let failure: string | undefined, artifactChanged: boolean, clock: Date, resolutions: number;
  const statements: string[] = [], sequence: string[] = [];
  const currency = currencyCode("USD");
  const customerContact = { organizationId: brandedId<"OrganizationId">(org), customerId };
  const pricing = new V2PricingParityAdapter();
  const fail = (stage: string) => { sequence.push(stage); if (failure === stage) throw new V2ApplicationError("CONFLICT", `Injected ${stage} failure.`); };
  const configuration = (input: SalesWorkspaceLineInput): ResolvedProductConfiguration => ({ schemaVersion: 1,
    organizationId: brandedId<"OrganizationId">(org), productId: brandedId<"ProductId">(input.productId), pricingConfigurationId: configurationId,
    pricingConfigurationVersion: "1", pricingConfigurationContentHash: "fixture-current", quantity: input.quantity,
    selections: input.selections as never ?? {}, ...(input.dimensions ? { dimensions: input.dimensions } : {}), derivedFacts: {}, productFacts: {} });
  const pricingRequest = (resolvedConfiguration: ResolvedProductConfiguration) => ({ organizationId: brandedId<"OrganizationId">(org), resolvedConfiguration,
    sellableProduct: { organizationId: brandedId<"OrganizationId">(org), productId: resolvedConfiguration.productId, displayName: "Fixture Product", lifecycle: "active" as const,
      requiresDimensions: false, pricingConfiguration: { id: configurationId, version: "1", contentHash: "fixture-current" }, pricingCurrency: currency },
    rules: { base: { perPieceCents: failure === "preview_drift" ? 125 : 100 } }, pricingContext: { channel: "staff" as const, effectiveAt: "2026-10-01T00:00:00Z" } });
  const preview = async (header: SalesWorkspace["header"], input: SalesWorkspaceLineInput): Promise<SalesWorkspaceLinePreview> => {
    const resolvedConfiguration = configuration(input), pricingResult = await pricing.calculate(pricingRequest(resolvedConfiguration));
    return { target: "order", inputFingerprint: workspaceLinePreviewFingerprint(input, header.customerContact), customerContact: header.customerContact,
      resolvedConfiguration, pricingResult, sellingPriceDecision: calculatedDecision(pricingResult, input.selling, { principalKind: "staff", subjectId: user }), calculatedAt: clock.toISOString() };
  };
  async function readOrder(client: PoolClient, organizationId: string, sourceOrderId: string, lock = false): Promise<OrderReadModel | null> {
    const rows = await client.query(`SELECT header_snapshot,job_label,revision::text FROM v2_sales_documents WHERE organization_id=$1 AND id=$2 AND document_kind='order'${lock ? " FOR UPDATE" : ""}`, [organizationId, sourceOrderId]);
    if (!rows.rows[0]) return null;
    const persisted = await client.query("SELECT snapshot_json FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 ORDER BY position", [organizationId, sourceOrderId]);
    const captured = persisted.rows.map((row) => row.snapshot_json as SalesLineSnapshot);
    const header = rows.rows[0].header_snapshot;
    return { order: { ...header, ...(rows.rows[0].job_label === null ? {} : { jobLabel: rows.rows[0].job_label }), lines: captured },
      revision: rows.rows[0].revision, number: { kind: "order", core: 1000n, display: failure === "source_number_overflow" ? "x".repeat(301) : "ORD-1000" },
      totals: { calculated: money(currency, captured.reduce((sum, line) => sum + line.calculatedLineAmount.cents, 0)),
      selling: money(currency, captured.reduce((sum, line) => sum + line.sellingLineAmount.cents, 0)) }, routes: [], completionEligibility: { eligible: false, blockers: [], lines: [] } };
  }
  function orderTransaction(client: PoolClient): OrderTransaction {
    const tx = {
      customers: { validateContactReference: async (reference: { customerId?: string }) => { fail("customer"); return reference.customerId === customerId; } },
      products: { resolveActivePricingInput: async (input: SalesWorkspaceLineInput) => { resolutions++; fail("products"); const resolvedConfiguration = configuration(input); return success({ ...pricingRequest(resolvedConfiguration), resolvedConfiguration, warnings: [] }); },
        resolveCurrentTaxability: async () => ({ taxable: false }), resolveOrderRoutability: async () => ({ kind: "routable", productName: "Fixture",
          routing: { kind: "route_required", routeTemplateId: configurationId, routeTemplateName: "Fixture", steps: [{ kind: "fulfillment", position: 0 }] } }) },
      pricing, customerPricing: { calculateForCustomer: async (_id: string, request: Parameters<typeof pricing.calculate>[0]) => pricing.calculate(request) },
      billing: { createDraftInvoice: async () => { throw new Error("Edit must never create an Invoice"); },
        synchronizeDraftInvoice: async (input: { sourceSalesStateToken: string; salesLines: readonly SalesLineSnapshot[] }) => {
          const total = input.salesLines.reduce((sum, line) => sum + line.sellingLineAmount.cents, 0);
          await client.query("UPDATE v2_billing_invoices SET total_cents=$3,source_sales_state_token=$4,revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, invoiceId, total, input.sourceSalesStateToken]);
          fail("billing"); return { status: "synchronized", invoiceId, synchronizationVersion: input.sourceSalesStateToken };
        } },
      routing: { instantiateRoute: async (input: { work: { orderLineId: string }; organizationId: string; definition: object }) => {
        const id = randomUUID(); await client.query("INSERT INTO v2_route_instances(id,organization_id,order_document_id,order_line_id,payload) VALUES($1,$2,$3,$4,$5::jsonb)", [id, org, orderId, input.work.orderLineId, json(input)]);
        fail("routes"); return { created: true, routeInstance: { routeInstanceId: id, organizationId: org, work: input.work, sourceTemplate: { routeTemplateId: configurationId, revision: "1", definitionFingerprint: "fixture" }, state: "active", revision: "1", steps: [] } };
      } },
      materialRequirements: { hasFrozen: async (_org: string, lineId: string) => (await client.query("SELECT 1 FROM v2_sales_line_material_requirements WHERE organization_id=$1 AND order_line_id=$2", [org, lineId])).rowCount! > 0,
        freeze: async (_org: string, _orderId: string, added: readonly SalesLineSnapshot[]) => { for (const line of added) await client.query("INSERT INTO v2_sales_line_material_requirements(organization_id,order_line_id) VALUES($1,$2)", [org, line.lineId]); fail("materials"); } },
      reserve: async (input: { organizationId: string; businessRequestId: string; payloadFingerprint: string }) => {
        const prior = await client.query("SELECT * FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id=$2", [input.organizationId, input.businessRequestId]);
        if (prior.rows[0]) return { kind: "replay", request: { id: prior.rows[0].id, status: prior.rows[0].status, resultJson: prior.rows[0].result_json } };
        const id = randomUUID(); await client.query("INSERT INTO v2_operation_requests(id,organization_id,business_request_id,fingerprint,status) VALUES($1,$2,$3,$4,'in_progress')", [id, input.organizationId, input.businessRequestId, input.payloadFingerprint]);
        return { kind: "new", request: { id, status: "in_progress", resultJson: null } };
      },
      succeed: async (_org: string, id: string, result: unknown) => { await client.query("UPDATE v2_operation_requests SET status='succeeded',result_json=$2::jsonb WHERE id=$1", [id, json(result)]); },
      attribute: async (input: unknown) => { await client.query("INSERT INTO fixture_attributions(payload) VALUES($1::jsonb)", [json(input)]); },
      audit: async (input: unknown) => { await client.query("INSERT INTO v2_audit_events(payload) VALUES($1::jsonb)", [json(input)]); fail("audit"); },
      allocateNumber: async () => { throw new Error("Edit must never allocate a new number"); }, create: async () => { throw new Error("Edit must never create an Order"); },
      read: (organizationId: string, sourceOrderId: string, lock?: boolean) => readOrder(client, organizationId, sourceOrderId, lock),
      update: async (input: Parameters<OrderTransaction["update"]>[0]) => {
        fail("tax");
        const { lines: currentLines, ...prior } = (await readOrder(client, org, orderId))!.order;
        const header = { ...prior, customerContact: input.customerContact, purchaseOrderNumber: input.purchaseOrderNumber,
          requestedDueDate: input.requestedDueDate, requestedFulfillment: input.requestedFulfillment, jobLabel: input.jobLabel, terms: input.terms };
        const result = await client.query("UPDATE v2_sales_documents SET header_snapshot=$4::jsonb,job_label=$5,revision=revision+1 WHERE organization_id=$1 AND id=$2 AND revision=$3", [org, orderId, input.expectedRevision, json(header), input.jobLabel ?? null]);
        if (result.rowCount !== 1) return false;
        await client.query("UPDATE v2_sales_document_lines SET position=position+100000 WHERE organization_id=$1 AND document_id=$2", [org, orderId]);
        for (const [position, line] of input.lines.entries()) await client.query(`INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,snapshot_json)
          VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET position=EXCLUDED.position,snapshot_json=EXCLUDED.snapshot_json`, [line.lineId, org, orderId, position, json(line)]);
        expect(currentLines.length).toBeGreaterThan(0); fail("sales"); return true;
      },
      removeLinesNotIn: async (_org: string, _orderId: string, ids: readonly string[]) => { await client.query("DELETE FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 AND id<>ALL($3::text[])", [org, orderId, ids]); },
      hasRoute: async (_org: string, _orderId: string, lineId: string) => (await client.query("SELECT 1 FROM v2_route_instances WHERE organization_id=$1 AND order_line_id=$2", [org, lineId])).rowCount! > 0,
      hasFulfillmentHandoff: async () => (await client.query("SELECT 1 FROM fixture_progress WHERE kind='handoff'")).rowCount! > 0,
      reopen: async () => true,
    };
    return tx as unknown as OrderTransaction;
  }
  function artwork(client: PoolClient): OrderEditWorkspaceArtworkPort {
    const fingerprint = async () => salesWorkspaceFingerprint((await client.query("SELECT payload FROM fixture_artwork_history WHERE organization_id=$1 AND order_document_id=$2 ORDER BY id", [org, orderId])).rows);
    return { captureFingerprint: fingerprint, initializeWorkspace: async (_context, workspace) => {
      await client.query("INSERT INTO fixture_artwork_baselines(workspace_id,fingerprint) VALUES($1,$2)", [workspace.id, workspace.sourceArtifactFingerprint]);
    }, validate: async (_context, workspace) => {
      expect([...workspace.lines, ...(workspace.removedLines ?? [])].filter((line) => line.sourceLineId).every((line) => line.sourceLineSnapshot?.lineId === line.sourceLineId)).toBe(true);
      if (await fingerprint() !== workspace.sourceArtifactFingerprint) throw new V2ApplicationError("CONFLICT", "Artwork changed since Edit started.", { reason: "artwork_source_changed" });
      fail("artwork_validate"); return { changed: artifactChanged };
    }, apply: async (_context, workspace, lineMap) => {
      const persisted = await client.query("SELECT canonical_line_id FROM v2_sales_workspace_promotion_lines WHERE workspace_id=$1 ORDER BY position", [workspace.id]);
      expect(persisted.rows.map((row) => row.canonical_line_id)).toEqual(lineMap.map((line) => line.canonicalLineId));
      await client.query("INSERT INTO fixture_artwork_applies(workspace_id,payload) VALUES($1,$2::jsonb)", [workspace.id, json(lineMap)]);
      fail("artwork_apply"); return { changed: artifactChanged };
    }, authorizeReplay: async (actor) => { if (actor.principal.kind !== "staff" || !actor.principal.authority.capabilities.includes("artwork.assign")) throw new V2ApplicationError("FORBIDDEN", "Current Artwork authority required."); } };
  }
  beforeAll(async () => {
    db = new PGlite();
    // Existing canonical tables/ports are intentionally reduced fixtures. TEMP
    // schema, constraints, triggers, locks and rollback are the actual forward DDL.
    await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY); CREATE TABLE users(id varchar PRIMARY KEY);
      CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_kind text NOT NULL,revision bigint NOT NULL,header_snapshot jsonb NOT NULL);
      CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_id varchar NOT NULL,position integer NOT NULL,snapshot_json jsonb NOT NULL,UNIQUE(id,organization_id),UNIQUE(organization_id,document_id,position) DEFERRABLE INITIALLY DEFERRED);
      CREATE TABLE v2_billing_invoices(id varchar PRIMARY KEY,organization_id varchar NOT NULL,sales_order_document_id varchar NOT NULL,total_cents bigint NOT NULL,revision integer NOT NULL,source_sales_state_token text NOT NULL,retained_shipping_charge boolean NOT NULL DEFAULT false);
      CREATE TABLE v2_sales_document_counters(organization_id varchar PRIMARY KEY,last_number bigint NOT NULL);
      CREATE TABLE v2_route_instances(id varchar PRIMARY KEY,organization_id varchar NOT NULL,order_document_id varchar NOT NULL,order_line_id varchar NOT NULL,payload jsonb NOT NULL);
      CREATE TABLE v2_sales_line_material_requirements(organization_id varchar NOT NULL,order_line_id varchar NOT NULL);
      CREATE TABLE v2_operation_requests(id varchar PRIMARY KEY,organization_id varchar NOT NULL,business_request_id text NOT NULL,fingerprint text NOT NULL,status text NOT NULL,result_json jsonb,UNIQUE(organization_id,business_request_id));
      CREATE TABLE v2_audit_events(id serial PRIMARY KEY,payload jsonb NOT NULL); CREATE TABLE fixture_attributions(id serial PRIMARY KEY,payload jsonb NOT NULL);
      CREATE TABLE fixture_artwork_history(id text PRIMARY KEY,organization_id text NOT NULL,order_document_id text NOT NULL,payload jsonb NOT NULL);
      CREATE TABLE fixture_artwork_baselines(workspace_id text PRIMARY KEY,fingerprint text NOT NULL);
      CREATE TABLE fixture_artwork_applies(workspace_id text PRIMARY KEY,payload jsonb NOT NULL);
      CREATE TABLE fixture_progress(kind text NOT NULL,line_id text);
      INSERT INTO organizations VALUES('${org}'),('${otherOrg}'); INSERT INTO users VALUES('${user}'),('${otherUser}');
      INSERT INTO v2_sales_document_counters VALUES('${org}',1000);`);
    await db.exec(readFileSync(resolve(process.cwd(), "server/db/migrations_v2/0294_v2_sales_workspace_foundation.sql"), "utf8"));
    await db.exec(readFileSync(resolve(process.cwd(), "server/db/migrations_v2/0296_v2_order_edit_workspaces.sql"), "utf8"));
    let available = Promise.resolve();
    pool = { async connect() { const prior = available; let unlock!: () => void; available = new Promise<void>((done) => { unlock = done; }); await prior;
      return { async query(sql: string, params?: unknown[]) { statements.push(sql); const result = await db.query(sql, params); return { rows: result.rows, rowCount: result.affectedRows || result.rows.length }; }, release() { unlock(); } };
    } } as unknown as Pool;
    store = new PostgresSalesWorkspaceStore(pool);
    service = new PostgresOrderEditWorkspace(pool, { orderTransaction, artwork, now: () => clock,
      billingEditGuard: async (client, _context, sourceOrderId) => { sequence.push("invoice_lock");
        const rows = await client.query("SELECT retained_shipping_charge FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$2 ORDER BY id FOR UPDATE", [org, sourceOrderId]);
        const hasRetainedShippingCharges = rows.rows.some((row) => row.retained_shipping_charge);
        if (failure === "billing_void") return { hasRetainedShippingCharges, editability: "blocked", reason: "base_invoice_void" };
        return { hasRetainedShippingCharges, editability: hasRetainedShippingCharges ? "blocked" : "editable", ...(hasRetainedShippingCharges ? { reason: "retained_shipping_charges" as const } : {}) }; },
      readProductionContext: async (client, _org, _orderId, ids) => (await client.query("SELECT line_id FROM fixture_progress WHERE line_id=ANY($1::text[])", [ids])).rows.map((row) => row.line_id),
      reconcileOrderInTransaction: async (client) => { await client.query("INSERT INTO v2_audit_events(payload) VALUES('{\"reconciled\":true}')"); fail("reconcile"); } });
    drafts = new SalesWorkspaceApplicationService(store, { now: () => clock, onDiscard: async (transaction, workspace) => {
      const client = (transaction as import("../../infrastructure/sales/postgresSalesWorkspace.js").PostgresSalesWorkspaceTransaction).client;
      await client.query("DELETE FROM fixture_artwork_baselines WHERE workspace_id=$1", [workspace.id]);
    } });
    lines = new SalesWorkspaceLineService(store, { now: () => clock, releaseLineArtwork: async () => {}, pricing: () => ({ preview: async (_context, header, input) => ({ order: await preview(header, input) }) }) });
  }, 60000);
  beforeEach(async () => {
    clock = new Date(); failure = undefined; artifactChanged = false; resolutions = 0; statements.length = 0; sequence.length = 0;
    orderId = randomUUID(); invoiceId = randomUUID();
    const captured: SalesLineSnapshot[] = [];
    for (let position = 0; position < 2; position++) {
      const input = { productId, quantity: 2, description: `Original ${position}`, selling: { kind: "calculated" as const } };
      const evidence = await preview({ customerContact }, input);
      captured.push({ lineId: brandedId<"SalesLineId">(randomUUID()), productId, description: input.description, quantity: 2,
        resolvedConfiguration: evidence.resolvedConfiguration, pricingResult: evidence.pricingResult, sellingPriceDecision: evidence.sellingPriceDecision,
        calculatedLineAmount: evidence.pricingResult.calculatedLineAmount, sellingLineAmount: evidence.sellingPriceDecision.resultingLineAmount,
        operationalNote: `Source note ${position}`, taxability: { taxable: false, source: "product" } });
    }
    const header = { organizationId: org, orderId, customerContact, currency, terms: { termsCode: "net_30", commercialNotes: "Original notes" }, commercialState: "open", billingInvoiceReference: invoiceId };
    await db.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,revision,header_snapshot,job_label) VALUES($1,$2,'order',7,$3::jsonb,'Original Job')", [orderId, org, json(header)]);
    for (const [position, line] of captured.entries()) await db.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,snapshot_json) VALUES($1,$2,$3,$4,$5::jsonb)", [line.lineId, org, orderId, position, json(line)]);
    await db.query("INSERT INTO v2_billing_invoices(id,organization_id,sales_order_document_id,total_cents,revision,source_sales_state_token) VALUES($1,$2,$3,400,1,'7')", [invoiceId, org, orderId]);
    const client = await pool.connect(); try { initial = (await readOrder(client, org, orderId))!; } finally { client.release(); }
    statements.length = 0;
  });
  afterAll(async () => { await db?.close(); });
  const start = (requestId = randomUUID()) => service.start(context, { requestId, sourceOrderId: orderId, expectedSourceRevision: "7" });
  const save = (workspace: SalesWorkspace, requestId = randomUUID()) => service.save(actor(requestId), { workspaceId: workspace.id, target: "order", requestId, expectedRevision: workspace.revision });
  const businessFingerprint = async () => salesWorkspaceFingerprint(await Promise.all([
    db.query("SELECT * FROM v2_sales_documents WHERE id=$1", [orderId]), db.query("SELECT * FROM v2_sales_document_lines WHERE document_id=$1 ORDER BY position", [orderId]),
    db.query("SELECT * FROM v2_billing_invoices WHERE id=$1", [invoiceId]), db.query("SELECT * FROM v2_sales_document_counters"),
    db.query("SELECT * FROM v2_route_instances WHERE order_document_id=$1", [orderId]), db.query("SELECT * FROM fixture_artwork_history WHERE order_document_id=$1 ORDER BY id", [orderId]),
  ]).then((results) => results.map((result) => result.rows)));
  async function noteEdit(workspace: SalesWorkspace) {
    return lines.update(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      lineId: workspace.lines[0].id, line: { ...workspace.lines[0].input, description: "Edited description" }, operationalNote: "Edited operational note",
      header: { ...workspace.header, jobLabel: "Edited Job", notes: "Edited Order notes" } });
  }
  it("captures/reloads every full source field with stable TEMP identity and no canonical writes", async () => {
    const before = await businessFingerprint(), requestId = randomUUID();
    const workspace = await start(requestId);
    expect(workspace).toMatchObject({ kind: "order_edit", baseRevision: "7", header: { jobLabel: "Original Job" }, sourceHeader: { orderNumber: "ORD-1000", jobLabel: "Original Job", terms: { commercialNotes: "Original notes" } } });
    expect(workspace.header).not.toHaveProperty("orderNumber");
    expect(workspace).not.toHaveProperty("editSourceSnapshot");
    expect(workspace.lines.map((line) => line.sourceLineSnapshot)).toEqual(initial.order.lines);
    expect(workspace.lines.map((line) => line.id)).not.toEqual(initial.order.lines.map((line) => line.lineId));
    expect(await drafts.get(context, workspace.id)).toEqual(workspace);
    const edited = await noteEdit(workspace);
    expect(await start(requestId)).toEqual(workspace); // initial response-loss replay, not current edited input
    expect((await service.start(context, { requestId: randomUUID(), sourceOrderId: orderId })).id).toBe(edited.id);
    expect(await businessFingerprint()).toBe(before);
    expect(resolutions).toBe(0);
  });
  it("rejects overlong source display numbers before capturing Artwork or writing a workspace", async () => {
    failure = "source_number_overflow"; const before = await businessFingerprint();
    await expect(start()).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await db.query("SELECT id FROM v2_sales_workspaces WHERE source_document_id=$1", [orderId])).rows).toEqual([]);
    expect(await businessFingerprint()).toBe(before);
    expect(statements.some((sql) => /INSERT INTO (v2_sales_workspaces|fixture_artwork_baselines)/.test(sql))).toBe(false);
  });
  it.each(["x".repeat(301), 42, null])("0296 rejects malformed source display-number JSON (%p)", async (orderNumber) => {
    const { lines: _lines, ...header } = initial.order;
    await expect(db.query(`INSERT INTO v2_sales_workspaces
      (id,organization_id,creator_user_id,kind,state,revision,header_json,creation_request_id,creation_fingerprint,created_at,updated_at,expires_at,
        source_document_kind,source_document_id,base_revision,source_header_json,source_artifact_fingerprint)
      VALUES($1,$2,$3,'order_edit','draft',1,'{}',$4,$5,now(),now(),now()+interval '1 day','order',$6,'7',$7::jsonb,$5)`,
    [randomUUID(), org, user, randomUUID(), "d".repeat(64), orderId, json({ ...header, orderNumber })])).rejects.toMatchObject({ code: "23514" });
  });
  it("Cancel leaves canonical business rows equivalent and only invokes TEMP cleanup", async () => {
    const before = await businessFingerprint();
    const edited = await noteEdit(await start());
    const discarded = await drafts.discard(context, edited.id, { requestId: randomUUID(), expectedRevision: edited.revision });
    expect(discarded.state).toBe("discarded");
    expect(await businessFingerprint()).toBe(before);
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM v2_operation_requests")).rows[0].count).toBe(0);
    expect(resolutions).toBe(0);
    expect((await service.start(context, { requestId: randomUUID(), sourceOrderId: orderId })).id).not.toBe(edited.id);
  });
  it("common new-sales operational-note clearing persists NULL rather than retaining the old note", async () => {
    const createActor: OperationContext = { ...context, principal: { ...principal,
      authority: { ...principal.authority, capabilities: ["order.create", "quote.create"] } } };
    let workspace = await drafts.create(createActor, { requestId: randomUUID(), header: { customerContact } });
    workspace = await lines.add(createActor, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      line: { productId, quantity: 1, selling: { kind: "calculated" } }, operationalNote: "  Preserve until explicitly cleared  " });
    expect((await drafts.get(createActor, workspace.id)).lines[0].operationalNote).toBe("Preserve until explicitly cleared");
    workspace = await lines.update(createActor, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      lineId: workspace.lines[0].id, line: workspace.lines[0].input, operationalNote: "" });
    expect(workspace.lines[0].operationalNote).toBeUndefined();
    expect((await drafts.get(createActor, workspace.id)).lines[0].operationalNote).toBeUndefined();
    expect((await db.query<{ operational_note: string | null }>("SELECT operational_note FROM v2_sales_workspace_lines WHERE id=$1", [workspace.lines[0].id])).rows[0].operational_note).toBeNull();
  });
  it("saves header/description/note once through actual OrderApplication.update without ACTIVE resolution", async () => {
    const edited = await noteEdit(await start()), requestId = randomUUID();
    const result = await save(edited, requestId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.receipt).toMatchObject({ documentId: orderId, documentRevision: "8", target: "order", header: { jobLabel: "Edited Job" } });
    expect(result.value.receipt.lineMap.map((line) => line.canonicalLineId)).toEqual(initial.order.lines.map((line) => line.lineId));
    expect(result.value.receipt.header.notes).toBe("Edited Order notes");
    expect(result.value.receipt.result.order).toMatchObject({ jobLabel: "Edited Job", terms: { commercialNotes: "Original notes" }, lines: [{ description: "Edited description", operationalNote: "Edited operational note" }, {}] });
    expect(resolutions).toBe(0);
    expect((await db.query("SELECT source_sales_state_token,revision FROM v2_billing_invoices WHERE id=$1", [invoiceId])).rows).toEqual([{ source_sales_state_token: "8", revision: 2 }]);
    expect((await db.query("SELECT last_number::text FROM v2_sales_document_counters WHERE organization_id=$1", [org])).rows).toEqual([{ last_number: "1000" }]);
    expect(sequence.indexOf("invoice_lock")).toBeLessThan(sequence.indexOf("sales"));
    const replay = await save(edited, requestId);
    expect(replay).toEqual({ ok: true, value: { ...result.value, replayed: true } });
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM v2_operation_requests WHERE organization_id=$1", [org])).rows[0].count).toBeGreaterThan(0);
    expect((await service.start(context, { requestId: randomUUID(), sourceOrderId: orderId })).baseRevision).toBe("8");
  });
  it("add/remove/reorder correlates complete live mapping while source tombstones survive canonical removal", async () => {
    let workspace = await start();
    const removed = workspace.lines[0], retained = workspace.lines[1];
    workspace = await lines.remove(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, lineId: removed.id });
    expect(workspace.removedLines?.[0].sourceLineSnapshot).toEqual(initial.order.lines[0]);
    workspace = await lines.add(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, line: { productId, quantity: 3, description: "Added", selling: { kind: "calculated" } } });
    const added = workspace.lines[1];
    workspace = await lines.reorder(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, lineIds: [added.id, retained.id] });
    const result = await save(workspace);
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.receipt.lineMap.map((line) => line.workspaceLineId)).toEqual([added.id, retained.id]);
    expect(result.value.receipt.lineMap[1].canonicalLineId).toBe(retained.sourceLineId);
    expect(result.value.receipt.lineMap[0].canonicalLineId).not.toBe(added.id);
    expect((await db.query("SELECT id FROM v2_sales_document_lines WHERE id=$1", [removed.sourceLineId])).rows).toEqual([]);
    const reloaded = await drafts.get(context, workspace.id);
    expect(reloaded.removedLines?.[0].sourceLineId).toBe(removed.sourceLineId);
    expect(reloaded.promotion?.lineMap).toEqual(result.value.receipt.lineMap);
  });
  it.each(["sales", "materials", "billing", "routes", "audit", "artwork_apply", "reconcile", "tax", "preview_drift"])("%s failure rolls every owner write and receipt back in PostgreSQL", async (stage) => {
    let workspace = await noteEdit(await start());
    workspace = await lines.add(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, line: { productId, quantity: 1, description: "New for rollback", selling: { kind: "calculated" } } });
    const before = await businessFingerprint();
    const ownerRowsBefore = (await db.query<{ count: number }>("SELECT count(*)::int AS count FROM v2_operation_requests")).rows[0].count;
    failure = stage;
    const result = await save(workspace);
    expect(result.ok).toBe(false);
    expect(await businessFingerprint()).toBe(before);
    expect((await drafts.get(context, workspace.id)).state).toBe("draft");
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM v2_operation_requests")).rows[0].count).toBe(ownerRowsBefore);
    expect((await db.query("SELECT * FROM v2_sales_workspace_promotions WHERE workspace_id=$1", [workspace.id])).rows).toEqual([]);
    expect((await db.query("SELECT * FROM v2_sales_workspace_promotion_lines WHERE workspace_id=$1", [workspace.id])).rows).toEqual([]);
    expect((await db.query("SELECT * FROM fixture_artwork_applies WHERE workspace_id=$1", [workspace.id])).rows).toEqual([]);
  });
  it("no-op finalizes TEMP receipt at the same source revision, including retained shipping charges", async () => {
    const workspace = await start(), before = await businessFingerprint();
    await db.query("UPDATE v2_billing_invoices SET retained_shipping_charge=true WHERE id=$1", [invoiceId]);
    const withCharge = await businessFingerprint();
    const result = await save(workspace);
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.receipt.documentRevision).toBe("7");
    expect(await businessFingerprint()).toBe(withCharge); expect(withCharge).not.toBe(before);
    expect(sequence).not.toContain("sales"); expect(sequence).not.toContain("billing");
  });
  it.each(["editable", "retained_shipping", "billing_void"])("workspace-notes-only Save is a receipt-only no-op with %s finance", async (finance) => {
    let workspace = await start();
    workspace = await drafts.saveDraft(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      header: { ...workspace.header, notes: "Workspace-only scheduling reminder" } });
    if (finance === "retained_shipping") await db.query("UPDATE v2_billing_invoices SET retained_shipping_charge=true WHERE id=$1", [invoiceId]);
    if (finance === "billing_void") failure = "billing_void";
    const before = await businessFingerprint(), requestId = randomUUID(); statements.length = 0; sequence.length = 0;
    const result = await save(workspace, requestId);
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.receipt).toMatchObject({ documentId: orderId, documentRevision: "7", header: { notes: "Workspace-only scheduling reminder" }, artworkPromoted: false });
    expect((result.value.receipt.result.order as unknown as OrderReadModel["order"]).terms).toEqual(initial.order.terms);
    expect(await businessFingerprint()).toBe(before);
    const writes = statements.filter((sql) => /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+/i.test(sql));
    expect(writes.every((sql) => /^\s*(?:INSERT\s+INTO|UPDATE)\s+v2_sales_workspace(?:s|_)/i.test(sql))).toBe(true);
    expect(sequence).toEqual(["invoice_lock", "artwork_validate"]);
    expect((await db.query("SELECT * FROM fixture_artwork_applies WHERE workspace_id=$1", [workspace.id])).rows).toEqual([]);
    const client = await pool.connect();
    try {
      const fresh = await new OrderApplicationService({ transaction: (action) => action(orderTransaction(client)) })
        .read(context, brandedId<"OrderId">(orderId));
      expect(fresh).toEqual({ ok: true, value: initial });
    } finally { client.release(); }
    expect((await drafts.get(context, workspace.id)).promotion?.header.notes).toBe("Workspace-only scheduling reminder");
    expect(await save(workspace, requestId)).toMatchObject({ ok: true, value: { replayed: true, receipt: { documentRevision: "7" } } });
  });
  it("commercial-notes-only Save uses terms and preserves other source terms", async () => {
    const terms = { ...initial.order.terms, taxContextReference: "source-tax-context", salesRepresentativeId: user };
    await db.query("UPDATE v2_sales_documents SET header_snapshot=header_snapshot||$2::jsonb WHERE id=$1", [orderId, json({ terms })]);
    let workspace = await start();
    workspace = await drafts.saveDraft(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      header: { ...workspace.header, notes: "Workspace-only reminder", terms: { commercialNotes: "Updated canonical commercial notes" } } });
    const result = await save(workspace); expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.receipt).toMatchObject({ documentRevision: "8", header: { notes: "Workspace-only reminder" } });
    expect(result.value.receipt.result.order).toMatchObject({ terms: { ...terms, commercialNotes: "Updated canonical commercial notes" } });
  });
  it.each<[string | null, string | undefined]>([
    [null, undefined], [null, ""], [null, "   "], [null, "\u00a0"], ["", undefined], ["   ", ""],
    ["  Historical Job  ", "Historical Job"], ["  Historical Job  ", "  Historical Job  "],
  ])("owner-equivalent Job Labels (%p, %p) finalize without changing historical source", async (sourceLabel, jobLabel) => {
    await db.query("UPDATE v2_sales_documents SET job_label=$2 WHERE id=$1", [orderId, sourceLabel]);
    let workspace = await start();
    workspace = await drafts.saveDraft(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      header: { ...workspace.header, jobLabel } });
    const before = await businessFingerprint(); statements.length = 0; sequence.length = 0;
    const result = await save(workspace);
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.receipt.documentRevision).toBe("7");
    expect(result.value.receipt.header.jobLabel).toBe(jobLabel);
    expect(await businessFingerprint()).toBe(before);
    expect(sequence).toEqual(["invoice_lock", "artwork_validate"]);
    expect(statements.filter((sql) => /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+/i.test(sql))
      .every((sql) => /^\s*(?:INSERT\s+INTO|UPDATE)\s+v2_sales_workspace(?:s|_)/i.test(sql))).toBe(true);
    expect((await db.query<{ job_label: string | null }>("SELECT job_label FROM v2_sales_documents WHERE id=$1", [orderId])).rows[0].job_label).toBe(sourceLabel);
    expect((await drafts.get(context, workspace.id)).sourceHeader?.jobLabel).toBe(sourceLabel ?? undefined);
  });
  it.each([false, true])("empty label is receipt-only with retained Shipping charges=%s", async (retained) => {
    await db.query("UPDATE v2_sales_documents SET job_label=NULL WHERE id=$1", [orderId]);
    let workspace = await start();
    workspace = await drafts.saveDraft(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      header: { ...workspace.header, jobLabel: "" } });
    await db.query("UPDATE v2_billing_invoices SET retained_shipping_charge=$2 WHERE id=$1", [invoiceId, retained]);
    const before = await businessFingerprint(); sequence.length = 0;
    const result = await save(workspace); expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.receipt).toMatchObject({ documentRevision: "7", header: { jobLabel: "" } });
    expect(await businessFingerprint()).toBe(before);
    expect(sequence).toEqual(["invoice_lock", "artwork_validate"]);
    expect((await drafts.get(context, workspace.id)).state).toBe("promoted");
  });
  it.each(["2026-10-10T00:00:00Z", "2026-10-10T00:00:00.000Z", "2026-10-10"])("unchanged source due-date representation %s finalizes without an owner mutation", async (sourceDate) => {
    await db.query("UPDATE v2_sales_documents SET header_snapshot=header_snapshot||$2::jsonb WHERE id=$1", [orderId, json({ requestedDueDate: sourceDate })]);
    let workspace = await start();
    const requestedDueDate = sourceDate.length === 10 ? workspace.header.requestedDueDate : sourceDate;
    workspace = await drafts.saveDraft(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      header: { ...workspace.header, requestedDueDate } });
    const before = await businessFingerprint(); sequence.length = 0;
    const result = await save(workspace); expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.receipt.documentRevision).toBe("7");
    expect((result.value.receipt.result.order as unknown as OrderReadModel["order"]).requestedDueDate).toBe(sourceDate);
    expect(await businessFingerprint()).toBe(before);
    expect(sequence).toEqual(["invoice_lock", "artwork_validate"]);
  });
  it("characterizes canonical null clears and does not equate empty PO or distinct ISO spellings", async () => {
    await db.query("UPDATE v2_sales_documents SET job_label=NULL WHERE id=$1", [orderId]);
    const client = await pool.connect();
    try {
      const requestId = randomUUID(); sequence.length = 0;
      const result = await new OrderApplicationService({ transaction: (action) => action(orderTransaction(client)) }).update(actor(requestId), {
        businessRequestId: requestId, orderId: brandedId<"OrderId">(orderId), expectedRevision: "7",
        patch: { jobLabel: null, purchaseOrderNumber: null, requestedDueDate: null }, lineChanges: [],
      });
      expect(result).toMatchObject({ ok: true, value: { order: { revision: "7" } } });
      expect(sequence).toEqual(["customer"]);
    } finally { client.release(); }
    let workspace = await start();
    await expect(drafts.saveDraft(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      header: { ...workspace.header, jobLabel: null } as unknown as SalesWorkspace["header"] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    workspace = await drafts.saveDraft(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      header: { ...workspace.header, purchaseOrderNumber: "" } });
    const changed = await save(workspace); expect(changed.ok).toBe(true); if (!changed.ok) throw changed.error;
    expect(changed.value.receipt).toMatchObject({ documentRevision: "8", result: { order: { purchaseOrderNumber: "" } } });
  });
  it("different due-date spelling retains the existing owner's strict change semantics", async () => {
    await db.query("UPDATE v2_sales_documents SET header_snapshot=header_snapshot||$2::jsonb WHERE id=$1", [orderId, json({ requestedDueDate: "2026-10-10T00:00:00Z" })]);
    let workspace = await start();
    workspace = await drafts.saveDraft(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      header: { ...workspace.header, requestedDueDate: "2026-10-10T02:00:00+02:00" } });
    const result = await save(workspace); expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.receipt.documentRevision).toBe("8");
    expect((result.value.receipt.result.order as unknown as OrderReadModel["order"]).requestedDueDate).toBe("2026-10-10T02:00:00+02:00");
  });
  it("changed Save rejects any blocked Billing owner reason", async () => {
    const workspace = await noteEdit(await start()); failure = "billing_void"; const before = await businessFingerprint();
    expect(await save(workspace)).toMatchObject({ ok: false, error: { context: { reason: "base_invoice_void" } } });
    expect(await businessFingerprint()).toBe(before); expect(sequence).not.toContain("sales");
  });
  it("non-noop with retained shipping charges is explicitly blocked before canonical writes", async () => {
    const workspace = await noteEdit(await start()); await db.query("UPDATE v2_billing_invoices SET retained_shipping_charge=true WHERE id=$1", [invoiceId]);
    const before = await businessFingerprint(), result = await save(workspace);
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT", context: { reason: "retained_shipping_additional_charges" } } });
    expect(await businessFingerprint()).toBe(before); expect(sequence).not.toContain("sales");
  });
  it("locked/discounted inactive source saves presentation changes and retains tax/pricing/note evidence", async () => {
    const locked = { ...initial.order.lines[0], sellingPriceDecision: { ...initial.order.lines[0].sellingPriceDecision, kind: "locked", reason: "Historical locked approval" } };
    const discounted = { ...initial.order.lines[1], sellingPriceDecision: { ...initial.order.lines[1].sellingPriceDecision, kind: "discount", reason: "Historical discount", discountBasisPoints: 0 } };
    await db.query("UPDATE v2_sales_document_lines SET snapshot_json=$2::jsonb WHERE id=$1", [locked.lineId, json(locked)]);
    await db.query("UPDATE v2_sales_document_lines SET snapshot_json=$2::jsonb WHERE id=$1", [discounted.lineId, json(discounted)]);
    const workspace = await noteEdit(await start()); failure = "products";
    const result = await save(workspace);
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    const order = result.value.receipt.result.order as unknown as OrderReadModel["order"];
    expect(order.lines[0]).toMatchObject({ sellingPriceDecision: locked.sellingPriceDecision, pricingResult: locked.pricingResult, taxability: locked.taxability, operationalNote: "Edited operational note" });
    expect(order.lines[1]).toEqual(discounted); expect(resolutions).toBe(0);
  });
  it("clears explicit operational notes once and preserves all hidden source commercial terms", async () => {
    const terms = { termsCode: "net_30", commercialNotes: "Original notes", taxContextReference: "62000000-0000-4000-8000-000000000008", salesRepresentativeId: "62000000-0000-4000-8000-000000000009" };
    await db.query("UPDATE v2_sales_documents SET header_snapshot=header_snapshot||$2::jsonb WHERE id=$1", [orderId, json({ terms })]);
    let workspace = await start();
    workspace = await lines.update(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, lineId: workspace.lines[0].id,
      line: workspace.lines[0].input, operationalNote: "", header: { ...workspace.header, notes: "Changed notes only" } });
    const result = await save(workspace); expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.receipt.header.notes).toBe("Changed notes only");
    expect(result.value.receipt.result.order).toMatchObject({ terms });
    expect((result.value.receipt.result.order as unknown as OrderReadModel["order"]).lines[0].operationalNote).toBeUndefined();
  });
  it("start request replay checks exact creator before reading the immutable source response", async () => {
    const requestId = randomUUID(); await start(requestId); statements.length = 0;
    await expect(service.start({ ...context, principal: { ...principal, userId: otherUser } }, { requestId, sourceOrderId: orderId, expectedSourceRevision: "7" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(statements.some((sql) => sql.includes("result_json"))).toBe(false);
  });
  it("stale source revision and changed empty-set Artwork baseline fail without mutation", async () => {
    const workspace = await noteEdit(await start());
    await db.query("UPDATE v2_sales_documents SET revision=revision+1 WHERE id=$1", [orderId]);
    expect(await save(workspace)).toMatchObject({ ok: false, error: { code: "STALE_STATE", context: { reason: "source_revision" } } });
    await db.query("UPDATE v2_sales_documents SET revision=7 WHERE id=$1", [orderId]);
    await db.query("INSERT INTO fixture_artwork_history(id,organization_id,order_document_id,payload) VALUES($1,$2,$3,'{}')", [randomUUID(), org, orderId]);
    expect(await save(workspace)).toMatchObject({ ok: false, error: { code: "CONFLICT", context: { reason: "artwork_source_changed" } } });
    expect((await drafts.get(context, workspace.id)).state).toBe("draft");
  });
  it("fresh revoked authority and foreign tenant/creator deny resume, mutation and cached Save", async () => {
    const workspace = await noteEdit(await start()), requestId = randomUUID();
    expect((await save(workspace, requestId)).ok).toBe(true);
    for (const capabilities of [[], ["order.create"], ["order.edit"]]) {
      const revoked: OperationContext = { ...actor(requestId), principal: { ...principal, authority: { membershipId: "verified", capabilities: capabilities as never } } };
      expect(await service.save(revoked, { workspaceId: workspace.id, target: "order", requestId, expectedRevision: workspace.revision })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      await expect(drafts.get(revoked, workspace.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const foreign of [{ ...context, principal: { ...principal, userId: otherUser } }, { ...context, organizationId: otherOrg, principal: { ...principal, organizationId: otherOrg } }]) {
      await expect(drafts.get(foreign, workspace.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    const mismatch = await service.save(actor(randomUUID()), { workspaceId: workspace.id, target: "order", requestId, expectedRevision: workspace.revision });
    expect(mismatch).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
  it("source evidence is physically bounded/immutable and canonical deletion is not permanently vetoed", async () => {
    const workspace = await start();
    await expect(db.query("UPDATE v2_sales_workspaces SET base_revision='8',revision=revision+1 WHERE id=$1", [workspace.id])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE v2_sales_workspace_lines SET source_snapshot=$2::jsonb WHERE id=$1", [workspace.lines[0].id, json({ ...initial.order.lines[0], description: "Forged" })])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("DELETE FROM v2_sales_workspace_lines WHERE id=$1", [workspace.lines[0].id])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE v2_sales_workspace_lines SET operational_note=$2 WHERE id=$1", [workspace.lines[0].id, "x".repeat(4001)])).rejects.toMatchObject({ code: "22001" });
    expect((await db.query("DELETE FROM v2_sales_document_lines WHERE id=$1", [initial.order.lines[0].lineId])).affectedRows).toBe(1);
    expect((await drafts.get(context, workspace.id)).lines[0].sourceLineSnapshot).toEqual(initial.order.lines[0]);
    expect((await save(workspace)).ok).toBe(false);
  });
  it("expired reads/replay agree and archived/cancelled source Save is blocked", async () => {
    const workspace = await start(); clock = new Date(Date.parse(workspace.expiresAt) + 1);
    expect((await drafts.get(context, workspace.id)).state).toBe("expired");
    expect(await save(workspace)).toMatchObject({ ok: false, error: { context: { reason: "workspace_expired" } } });
    clock = new Date();
    for (const patch of [{ archivedAt: "2026-10-01T00:00:00Z" }, { commercialState: "cancelled" }]) {
      await db.query("UPDATE v2_sales_documents SET header_snapshot=header_snapshot||$2::jsonb WHERE id=$1", [orderId, json(patch)]);
      expect(await save(workspace)).toMatchObject({ ok: false, error: { context: { reason: "source_order_terminal" } } });
    }
  });
  it("progressed configuration, frozen material removal and unknown customer/tax owner failures fail closed", async () => {
    let workspace = await start(); const sourceLine = workspace.lines[0];
    workspace = await lines.update(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, lineId: sourceLine.id,
      line: { ...sourceLine.input, quantity: 3 } });
    await db.query("INSERT INTO fixture_progress(kind,line_id) VALUES('replacement',$1)", [sourceLine.sourceLineId]);
    expect(await save(workspace)).toMatchObject({ ok: false, error: { context: { reason: "progressed_order_configuration" } } });
    await drafts.discard(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision });
    workspace = await start();
    await db.query("INSERT INTO v2_sales_line_material_requirements(organization_id,order_line_id) VALUES($1,$2)", [org, workspace.lines[0].sourceLineId]);
    workspace = await lines.remove(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, lineId: workspace.lines[0].id });
    expect(await save(workspace)).toMatchObject({ ok: false, error: { publicMessage: expect.stringMatching(/frozen material/) } });
    await drafts.discard(context, workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision });
    workspace = await noteEdit(await start()); failure = "customer";
    expect((await save(workspace)).ok).toBe(false);
  });
  it("dispatches existing promotion order_edit through its injected same-client handler", async () => {
    const workspace = await noteEdit(await start()), requestId = randomUUID();
    const promotion = new PostgresWorkspacePromotion(pool, async () => { throw new Error("New Sales Artwork path must not run"); }, {
      quoteTransaction: () => { throw new Error("Quote must not run"); }, orderTransaction: () => { throw new Error("New Order creation must not run"); },
      orderEditHandler: service.saveInTransaction });
    const result = await promotion.promote(actor(requestId), { workspaceId: workspace.id, target: "order", requestId, expectedRevision: workspace.revision });
    expect(result).toMatchObject({ ok: true, value: { receipt: { documentId: orderId, documentRevision: "8" } } });
  });
  it("0296 backfills only unambiguous tenant/document-bound string job labels and never overwrites", async () => {
    const migrationDb = new PGlite();
    try {
      await migrationDb.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY); CREATE TABLE users(id varchar PRIMARY KEY);
        CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_kind text NOT NULL,revision bigint NOT NULL);
        CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_id varchar NOT NULL,UNIQUE(id,organization_id));
        INSERT INTO organizations VALUES('${org}'),('${otherOrg}'); INSERT INTO users VALUES('${user}');`);
      await migrationDb.exec(readFileSync(resolve(process.cwd(), "server/db/migrations_v2/0294_v2_sales_workspace_foundation.sql"), "utf8"));
      const cases: Readonly<{ values: readonly unknown[]; expected: string | null }>[] = [
        { values: ["Expected Job"], expected: "Expected Job" }, { values: [123], expected: null },
        { values: [{ nested: "Not a string" }], expected: null }, { values: ["Ambiguous first", "Ambiguous second"], expected: null },
        { values: ["x".repeat(301)], expected: null }, { values: ["Other tenant"], expected: "Other tenant" },
        { values: ["Historical\nunsafe label"], expected: null },
        ...[1, 31, 127, 128, 159, 0x202a, 0x202e, 0x2066, 0x2069].map((point) => ({ values: [`Historical${String.fromCodePoint(point)}unsafe label`], expected: null })),
        ...["  Legitimate whitespace  ", "Caf\u00e9 \u6771\u4eac", "Allowed\u00a0\u2029\u206a", "\ud83d\ude00".repeat(150)]
          .map((value) => ({ values: [value], expected: value })),
        { values: ["\ud83d\ude00".repeat(151)], expected: null }, { values: [null], expected: null }, { values: [undefined], expected: null },
      ];
      const documentIds: string[] = [], historicalReceipts: Readonly<{ id: string; header: unknown }>[] = [];
      for (const [index, { values: labels }] of cases.entries()) {
        const documentId = randomUUID(), canonicalLineId = randomUUID(), organizationId = index === 5 ? otherOrg : org;
        documentIds.push(documentId);
        await migrationDb.query("INSERT INTO v2_sales_documents VALUES($1,$2,'order',1)", [documentId, organizationId]);
        await migrationDb.query("INSERT INTO v2_sales_document_lines VALUES($1,$2,$3)", [canonicalLineId, organizationId, documentId]);
        for (const label of labels) {
          const workspaceId = randomUUID(), lineId = randomUUID(), requestId = randomUUID(), fingerprint = "b".repeat(64);
          const header = { jobLabel: label };
          historicalReceipts.push({ id: workspaceId, header: JSON.parse(json(header)) });
          await migrationDb.exec("BEGIN");
          await migrationDb.query(`INSERT INTO v2_sales_workspaces(id,organization_id,creator_user_id,kind,state,revision,header_json,creation_request_id,creation_fingerprint,created_at,updated_at,expires_at)
            VALUES($1,$2,$3,'new_sales','draft',1,$4::jsonb,$5,$6,now(),now(),now()+interval '1 day')`, [workspaceId, organizationId, user, json(header), requestId, fingerprint]);
          await migrationDb.query("INSERT INTO v2_sales_workspace_lines(id,organization_id,workspace_id,position,input_json,revision) VALUES($1,$2,$3,0,'{}',1)", [lineId, organizationId, workspaceId]);
          await migrationDb.query("UPDATE v2_sales_workspaces SET state='promoting',promotion_request_id=$2,promotion_target='order',promotion_fingerprint=$3 WHERE id=$1", [workspaceId, requestId, fingerprint]);
          await migrationDb.query(`INSERT INTO v2_sales_workspace_promotion_lines(organization_id,workspace_id,workspace_line_id,target,document_id,canonical_line_id,position)
            VALUES($1,$2,$3,'order',$4,$5,0)`, [organizationId, workspaceId, lineId, documentId, canonicalLineId]);
          await migrationDb.query(`INSERT INTO v2_sales_workspace_promotions(organization_id,workspace_id,request_id,fingerprint,input_revision,target,document_id,document_revision,display_number,header_json,promoted_at,result_json)
            VALUES($1,$2,$3,$4,1,'order',$5,'1','ORD-1000',$6::jsonb,now(),'{}')`, [organizationId, workspaceId, requestId, fingerprint, documentId, json(header)]);
          await migrationDb.query("UPDATE v2_sales_workspaces SET state='promoted',revision=2 WHERE id=$1", [workspaceId]);
          await migrationDb.exec("COMMIT");
        }
      }
      const sql = readFileSync(resolve(process.cwd(), "server/db/migrations_v2/0296_v2_order_edit_workspaces.sql"), "utf8");
      await migrationDb.exec(sql);
      const labels = (await migrationDb.query<{ job_label: string | null }>("SELECT job_label FROM v2_sales_documents WHERE id=ANY($1::text[]) ORDER BY array_position($1::text[],id)", [documentIds])).rows.map((row) => row.job_label);
      expect(labels).toEqual(cases.map((entry) => entry.expected));
      for (const label of labels) if (label !== null) expect(() => normalizeSalesJobLabel(label)).not.toThrow();
      const receipts = await migrationDb.query<{ workspace_id: string; header_json: unknown }>("SELECT workspace_id,header_json FROM v2_sales_workspace_promotions");
      for (const original of historicalReceipts) expect(receipts.rows.find((row) => row.workspace_id === original.id)?.header_json).toEqual(original.header);
      await migrationDb.query("UPDATE v2_sales_documents SET job_label='Canonical wins' WHERE id=$1", [documentIds[0]]);
      const backfill = sql.match(/WITH candidates AS[\s\S]*?;\r?\n/);
      expect(backfill).not.toBeNull(); await migrationDb.exec(backfill![0]);
      expect((await migrationDb.query<{ job_label: string }>("SELECT job_label FROM v2_sales_documents WHERE id=$1", [documentIds[0]])).rows[0].job_label).toBe("Canonical wins");
      await expect(migrationDb.query("UPDATE v2_sales_documents SET job_label=$2 WHERE id=$1", [documentIds[0], "x".repeat(301)])).rejects.toMatchObject({ code: "22001" });
    } finally { await migrationDb.close(); }
  }, 60000);
});
