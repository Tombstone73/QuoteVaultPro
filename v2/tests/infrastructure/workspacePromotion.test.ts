import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import type { PricingCalculationRequest, PricingPort } from "../../src/modules/pricing/contracts.js";
import { CustomerCommercialPricingAdapter, type CustomerCommercialStore, type CustomerScopedPricingPort } from "../../src/modules/products/customerCommercial.js";
import type { SalesLineSnapshot, SellingPriceDecision } from "../../src/modules/sales/contracts.js";
import type { OrderReadModel, OrderTransaction } from "../../src/modules/sales/orderApplication.js";
import { calculatedDecision, type QuoteReadModel, type QuoteTransaction } from "../../src/modules/sales/quoteApplication.js";
import type { SalesWorkspace, SalesWorkspaceLineMapEntry, SalesWorkspaceTransaction, WorkspaceLine } from "../../src/modules/sales/workspaceContracts.js";
import { workspaceLinePreviewFingerprint } from "../../src/modules/sales/workspaceLines.js";
import type { PromoteSalesWorkspaceInput, WorkspacePromotionReceipt } from "../../src/modules/sales/workspacePromotion.js";
import { brandedId, canonicalJson, currencyCode } from "../../src/modules/shared/commercialValues.js";
import { PostgresWorkspacePromotion, type WorkspaceArtworkPromotionRunner } from "../../infrastructure/sales/postgresWorkspacePromotion.js";

const org = brandedId<"OrganizationId">("00000000-0000-4000-8000-000000000001");
const otherOrg = "00000000-0000-4000-8000-000000000002";
const workspaceId = "00000000-0000-4000-8000-000000000010";
const userId = "00000000-0000-4000-8000-000000000020";
const customerId = brandedId<"CustomerId">("00000000-0000-4000-8000-000000000030");
const productId = brandedId<"ProductId">("00000000-0000-4000-8000-000000000040");
const configurationId = brandedId<"PricingConfigurationId">("00000000-0000-4000-8000-000000000050");
const usd = currencyCode("USD");
const now = new Date("2026-10-01T00:00:00.000Z");
const capabilities: readonly Capability[] = ["quote.create", "quote.edit", "order.create", "quote.overridePrice", "order.overridePrice", "artwork.adopt", "artwork.assign"];
const context = (requestId = "save-1", caps = capabilities): OperationContext => ({
  organizationId: org, operationId: "sales.workspace.promote.v1",
  principal: { kind: "staff", organizationId: org, userId, authority: { membershipId: "membership", capabilities: caps } },
  businessRequest: { id: requestId, payloadFingerprint: "untrusted-transport-fingerprint" },
});
const input = (target: "quote" | "order" = "quote", requestId = "save-1"): PromoteSalesWorkspaceInput => ({ workspaceId, target, requestId, expectedRevision: 3 });
type Stage = "customer" | "configuration" | "pricing" | "insert" | "material" | "billing" | "routing" | "audit" | "map" | "artwork" | "receipt";
type State = {
  workspace: SalesWorkspace;
  quote?: QuoteReadModel;
  order?: OrderReadModel;
  number: bigint;
  requests: string[];
  attribution: string[];
  audits: string[];
  materials: string[];
  invoices: string[];
  routes: string[];
  outbox: string[];
  artwork: string[];
  lineMap: SalesWorkspaceLineMapEntry[];
  receipt?: WorkspacePromotionReceipt;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value,
  (_key, entry) => typeof entry === "bigint" ? { $bigint: entry.toString() } : entry),
  (_key, entry) => entry && typeof entry === "object" && "$bigint" in entry ? BigInt(entry.$bigint) : entry) as T;
const unexpected = async (): Promise<never> => { throw new Error("Unexpected owner method in creation-only promotion"); };

/** Fake PG transaction state is explicit. These tests prove coordinator/owner
 * choreography; the independent PGlite suite proves physical SQL atomicity. */
async function fixture(options: { artwork?: boolean; agreement?: boolean; lineCount?: number; override?: boolean; omitCustomerPricing?: boolean; rawInsertError?: boolean } = {}) {
  let failureStage: Stage | undefined;
  let rate = 100;
  let version = "1";
  let hash = "sha256:configuration-1";
  let agreementValue = 150;
  let readMode: "normal" | "reverse" | "missing" | "duplicate" = "normal";
  let snapshot: State | undefined;
  let held = false;
  let releaseWaiter = () => {};
  let prior = Promise.resolve();
  let connections = 0;
  let canonicalReads = 0;
  const events: string[] = [];
  const clients: PoolClient[] = [];
  const base = new V2PricingParityAdapter();
  const trip = (stage: Stage) => { if (failureStage === stage) throw new V2ApplicationError("CONFLICT", `Injected ${stage} failure.`); };
  const pricing: PricingPort = { calculate: async (request) => { trip("pricing"); return base.calculate(request); } };
  const customerPricing = new CustomerCommercialPricingAdapter(pricing, {
    isEntitled: async () => true,
    resolveAgreement: async () => options.agreement ? {
      id: "agreement-1", organizationId: org, customerId, productId, currency: usd,
      mode: "fixed_unit", value: agreementValue, active: true, effectiveFrom: now.toISOString(), createdAt: now.toISOString(),
    } : null,
    setEntitlement: async () => { throw new Error("Unexpected agreement mutation"); },
    replaceAgreement: async () => { throw new Error("Unexpected agreement mutation"); },
    listEntitlements: async () => [],
    listActivePricingAgreements: async () => [],
  } satisfies CustomerCommercialStore);
  const resolve = (quantity: number): PricingCalculationRequest => ({
    organizationId: org,
    sellableProduct: { organizationId: org, productId, displayName: "Fixture product", lifecycle: "active",
      pricingConfiguration: { id: configurationId, version, contentHash: hash }, requiresDimensions: false, pricingCurrency: usd },
    resolvedConfiguration: { schemaVersion: 1, organizationId: org, productId, pricingConfigurationId: configurationId,
      pricingConfigurationVersion: version, pricingConfigurationContentHash: hash, quantity, selections: {}, derivedFacts: {}, productFacts: {} },
    pricingContext: { channel: "staff", effectiveAt: now.toISOString() }, rules: { base: { perPieceCents: rate } },
  });
  const lines: WorkspaceLine[] = [];
  for (let position = 0; position < (options.lineCount ?? 2); position++) {
    const lineInput = { productId, quantity: position + 2, description: `Line ${position}`,
      ...(options.override ? { selling: { kind: "total_override" as const, totalCents: 700, reason: "Authorized adjustment" } } : {}) };
    const request = resolve(lineInput.quantity);
    const previews: NonNullable<WorkspaceLine["previews"]> = {};
    for (const target of ["quote", "order"] as const) {
      const result = target === "quote" ? await base.calculate(request) : await customerPricing.calculateForCustomer(customerId, request);
      const selling: SellingPriceDecision = calculatedDecision(result, lineInput.selling, { principalKind: "staff", subjectId: userId });
      Object.assign(previews, { [target]: { target, customerContact: { organizationId: org, customerId },
        inputFingerprint: workspaceLinePreviewFingerprint(lineInput, { organizationId: org, customerId }),
        resolvedConfiguration: request.resolvedConfiguration, pricingResult: result, sellingPriceDecision: selling, calculatedAt: now.toISOString() } });
    }
    lines.push({ id: `00000000-0000-4000-8000-${String(position + 100).padStart(12, "0")}`, workspaceId, position, input: lineInput, previews, revision: 1 });
  }
  let state: State = {
    workspace: { id: workspaceId, organizationId: org, creatorUserId: userId, kind: "new_sales", state: "draft", revision: 3,
      header: { customerContact: { organizationId: org, customerId }, jobLabel: "Durable job label", notes: "Workspace planning note",
        purchaseOrderNumber: "PO-1", terms: { commercialNotes: "Canonical note" } }, lines,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: "2026-10-31T00:00:00.000Z" },
    number: 9007199254740993n, requests: [], attribution: [], audits: [], materials: [], invoices: [], routes: [], outbox: [], artwork: [], lineMap: [],
  };
  const client = {
    query: async (sql: string, params?: readonly unknown[]) => {
      events.push(sql);
      if (sql === "BEGIN") { expect(held).toBe(false); held = true; snapshot = clone(state); }
      else if (sql === "ROLLBACK") { expect(snapshot).toBeDefined(); state = snapshot!; held = false; }
      else if (sql === "COMMIT") { expect(held).toBe(true); held = false; }
      else if (sql.includes("FROM v2_customer_product_pricing_agreements")) {
        expect(held).toBe(true); expect(params?.slice(0, 3)).toEqual([org, customerId, productId]); trip("pricing");
        return { rows: options.agreement ? [{ id: "agreement-1", organization_id: org, customer_id: customerId,
          product_id: productId, currency: usd, pricing_mode: "fixed_unit", pricing_value: agreementValue,
          active: true, effective_from: now.toISOString(), created_at: now.toISOString() }] : [], rowCount: options.agreement ? 1 : 0 };
      }
      else throw new Error(`Unexpected coordinator SQL: ${sql}`);
      return { rows: [], rowCount: 0 };
    },
    release: () => { events.push("release"); releaseWaiter(); },
  } as unknown as PoolClient;
  const pool = { connect: async () => {
    const wait = prior;
    prior = new Promise<void>((resolveWait) => { releaseWaiter = resolveWait; });
    const releaseThis = releaseWaiter;
    await wait;
    releaseWaiter = releaseThis;
    connections++;
    return client;
  } } as Pick<Pool, "connect">;
  const sameClient = (value: PoolClient) => { expect(value).toBe(client); expect(held).toBe(true); clients.push(value); };
  const workspaceTransaction = (value: PoolClient): SalesWorkspaceTransaction => {
    sameClient(value);
    const tx: Pick<SalesWorkspaceTransaction, "get" | "lockPromotionRequest" | "findPromotionRequest" | "getPromotion" | "beginPromotion" | "update" | "recordPromotionLineMap" | "recordPromotion"> = {
      get: async (organizationId, creator, id, lock) => {
        expect(lock).toBe(true); events.push("workspace-lock");
        return organizationId === state.workspace.organizationId && creator === state.workspace.creatorUserId && id === state.workspace.id ? clone(state.workspace) : null;
      },
      lockPromotionRequest: async (organizationId, id) => { expect(organizationId).toBe(org); events.push(`promotion-lock:${id}`); },
      findPromotionRequest: async (_org, id) => state.receipt?.requestId === id ? state.receipt : null,
      getPromotion: async () => state.receipt ?? null,
      beginPromotion: async (organizationId, id, revision, requestId, target, fingerprint) => {
        expect(organizationId).toBe(org); expect(id).toBe(workspaceId); expect(revision).toBe(state.workspace.revision);
        expect(state.workspace.state).toBe("draft"); expect(requestId).toBeTruthy(); expect(["quote", "order"]).toContain(target);
        expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
        state.workspace = { ...state.workspace, state: "promoting" }; events.push("workspace:promoting");
      },
      update: async (workspace, expected) => {
        expect(state.workspace.revision).toBe(expected);
        expect(workspace.revision).toBe(expected + 1);
        state.workspace = clone(workspace); events.push(`workspace:${workspace.state}`);
      },
      recordPromotionLineMap: async (_org, id, _target, _doc, map) => {
        expect(id).toBe(workspaceId); state.lineMap = [...map]; trip("map");
      },
      recordPromotion: async (receipt) => { state.receipt = clone(receipt) as WorkspacePromotionReceipt; trip("receipt"); },
    };
    return tx as SalesWorkspaceTransaction;
  };
  const projectedLines = (source: readonly SalesLineSnapshot[]) => readMode === "reverse" ? [...source].reverse()
    : readMode === "missing" ? source.slice(1) : readMode === "duplicate" ? source.map(() => source[0]!) : source;
  const shared = {
    customers: { validateContactReference: async () => { trip("customer"); return true; } },
    products: {
      resolveActivePricingInput: async ({ quantity }: { quantity: number }) => {
        trip("configuration"); const value = resolve(quantity);
        return { ok: true, value: { sellableProduct: value.sellableProduct, resolvedConfiguration: value.resolvedConfiguration, rules: value.rules, warnings: [] } };
      },
      resolveCurrentTaxability: async () => ({ taxable: true }),
      resolveOrderRoutability: async () => ({ kind: "routable", productName: "Fixture product", routing: {
        kind: "route_required", routeTemplateId: "route-template", sourceTemplateRevision: "1", sourceTemplateFingerprint: "route-hash", steps: [{ position: 0, kind: "proofing" }],
      } }),
    },
    pricing,
    reserve: async (request: { organizationId: string; businessRequestId: string; operation: string }) => {
      expect(state.workspace.state).toBe("promoting"); expect(request.organizationId).toBe(org);
      expect(request.businessRequestId).toMatch(/^workspace:(quote|order):[a-f0-9]{64}$/);
      expect(request.businessRequestId.length).toBeLessThanOrEqual(128);
      expect(state.requests).not.toContain(request.businessRequestId);
      state.requests.push(request.businessRequestId); events.push(request.operation);
      return { kind: "new", request: { id: "owner-request", status: "in_progress", resultJson: null } };
    },
    succeed: async () => { events.push("owner-succeed"); },
    attribute: async () => { state.attribution.push("owner"); },
    audit: async () => { state.audits.push("created"); trip("audit"); },
    allocateNumber: async () => { state.number++; return { kind: "quote", core: state.number, display: `DOC-${state.number}` }; },
  };
  const quoteTransaction = (value: PoolClient): QuoteTransaction => {
    sameClient(value);
    const tx: Pick<QuoteTransaction, "create" | "read"> = { ...shared,
      create: async (created) => {
        state.quote = { quote: { ...created, currency: usd, deliveryState: "not_sent", acceptanceState: "not_accepted", lifecycleState: "open" },
          number: created.number, revision: "1", checkpoints: [] };
        if (options.rawInsertError) throw Object.assign(new Error("private constraint detail"), { code: "23514" });
        trip("insert");
      },
      read: async () => { canonicalReads++; return state.quote ? { ...state.quote, quote: { ...state.quote.quote, lines: projectedLines(state.quote.quote.lines) } } : null; },
    };
    return tx as QuoteTransaction;
  };
  const orderTransaction = (value: PoolClient, scopedPricing: CustomerScopedPricingPort): OrderTransaction => {
    sameClient(value);
    const tx: Pick<OrderTransaction, "create" | "read" | "customerPricing" | "materialRequirements" | "billing" | "routing"> = { ...shared, customerPricing: options.omitCustomerPricing ? undefined : scopedPricing,
      create: async (created) => {
        state.order = { order: { ...created, currency: usd, commercialState: "open" }, number: { ...created.number, kind: "order" }, revision: "1",
          totals: { calculated: { currency: usd, cents: 0 }, selling: { currency: usd, cents: 0 } }, routes: [], completionEligibility: { eligible: false, blockers: [], lines: [] } };
        trip("insert");
      },
      read: async () => { canonicalReads++; return state.order ? { ...state.order, order: { ...state.order.order, lines: projectedLines(state.order.order.lines) } } : null; },
      materialRequirements: { freeze: async () => { state.materials.push("frozen"); trip("material"); }, hasFrozen: unexpected },
      billing: {
        createDraftInvoice: async () => { state.invoices.push("invoice"); state.outbox.push("durable-queue"); trip("billing"); return { status: "created", invoiceId: brandedId<"InvoiceId">("invoice"), synchronizationVersion: "1" }; },
        synchronizeDraftInvoice: unexpected, readDraftForOrder: unexpected, readInvoiceForOrder: unexpected,
      },
      routing: {
        instantiateRoute: async (request) => { state.routes.push("route"); trip("routing"); return { created: true, routeInstance: {
          routeInstanceId: brandedId<"RouteInstanceId">("route"), organizationId: org, work: request.work,
          sourceTemplate: request.definition!.sourceTemplate, state: "pending", revision: "1", steps: [],
        } }; },
        resolveRouteTemplate: unexpected, readRouteInstance: unexpected, readRouteForWork: unexpected,
      },
    };
    return tx as OrderTransaction;
  };
  const artwork: WorkspaceArtworkPromotionRunner = async (value, request) => {
    sameClient(value);
    expect(request.lineMap).toEqual(state.lineMap);
    expect(request.lineMap).toHaveLength(state.workspace.lines.length);
    if (options.artwork) {
      expect(request.actor.principal.kind).toBe("staff");
      state.artwork.push("assigned");
      if (state.quote) state.quote = { ...state.quote, revision: "4" };
    }
    trip("artwork");
    return { promotedCount: options.artwork ? 1 : 0, claims: [] };
  };
  const service = new PostgresWorkspacePromotion(pool, artwork, { workspaceTransaction, quoteTransaction, orderTransaction, now: () => now });
  return {
    service, events, clients, get state() { return state; }, get connections() { return connections; }, get canonicalReads() { return canonicalReads; },
    fail: (stage?: Stage) => { failureStage = stage; },
    drift: (kind: "rate" | "version" | "hash" | "agreement") => {
      if (kind === "rate") rate++;
      if (kind === "version") version = "2";
      if (kind === "hash") hash = "sha256:configuration-2";
      if (kind === "agreement") agreementValue++;
    },
    readMode: (mode: typeof readMode) => { readMode = mode; },
    patch: (patch: Partial<SalesWorkspace>) => { state.workspace = { ...state.workspace, ...patch }; },
  };
}

afterEach(() => { jest.restoreAllMocks(); });

describe("atomic Sales workspace promotion", () => {
  test("Quote creates only the Draft owner, persists complete map and rereads final Artwork revision with JSON-safe number", async () => {
    const f = await fixture({ artwork: true });
    const result = await f.service.promote(context(), input());
    if (!result.ok) throw result.error;
    expect(result.value.receipt.documentRevision).toBe("4");
    expect(result.value.receipt.header).toMatchObject({ jobLabel: "Durable job label", notes: "Workspace planning note" });
    expect(result.value.promotedWorkspaceHeader).toEqual(result.value.receipt.header);
    expect(result.value.receipt.result.quote).not.toHaveProperty("jobLabel");
    expect(f.state.quote?.quote.terms.commercialNotes).toBe("Canonical note");
    expect(f.state.quote?.quote).toMatchObject({ deliveryState: "not_sent", acceptanceState: "not_accepted", lifecycleState: "open" });
    expect(result.value.receipt.lineMap.map((line) => line.workspaceLineId)).toEqual(f.state.workspace.lines.map((line) => line.id));
    expect(new Set(result.value.receipt.lineMap.map((line) => line.canonicalLineId)).size).toBe(2);
    expect(JSON.parse(JSON.stringify(result.value.receipt)).result.number.core).toBe("9007199254740994");
    expect(f.state.materials).toEqual([]); expect(f.state.invoices).toEqual([]); expect(f.state.routes).toEqual([]); expect(f.state.outbox).toEqual([]);
    expect(f.events.filter((event) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(event))).toEqual(["BEGIN", "COMMIT"]);
    expect(f.state.workspace.state).toBe("promoted"); expect(f.state.workspace.revision).toBe(4);
  });

  test("Order retains customer pricing, full owner side effects and key correlation independent of returned order", async () => {
    const f = await fixture({ agreement: true }); f.readMode("reverse");
    const result = await f.service.promote(context(), input("order"));
    if (!result.ok) throw result.error;
    expect(result.value.promotedWorkspaceHeader).toEqual(f.state.workspace.header);
    const mapped = result.value.receipt.lineMap.map((entry) => f.state.order!.order.lines.find((line) => line.lineId === entry.canonicalLineId)!);
    expect(mapped.map((line) => line.quantity)).toEqual([2, 3]);
    expect(mapped.map((line) => line.calculatedLineAmount.cents)).toEqual([300, 450]);
    expect(f.state.materials).toHaveLength(1); expect(f.state.invoices).toHaveLength(1); expect(f.state.routes).toHaveLength(2); expect(f.state.outbox).toHaveLength(1);
    expect(f.state.quote).toBeUndefined(); expect(f.state.audits).toHaveLength(1); expect(f.state.attribution).toHaveLength(1);
    expect(new Set(f.clients).size).toBe(1);
  });

  test("Quote intentionally keeps base pricing even when Order preview has a customer agreement", async () => {
    const f = await fixture({ agreement: true });
    expect((await f.service.promote(context(), input())).ok).toBe(true);
    expect(f.state.quote!.quote.lines.map((line) => line.calculatedLineAmount.cents)).toEqual([200, 300]);
  });

  test.each(["quote", "order"] as const)("%s replay returns exact receipt with no owner work and races allocate once", async (target) => {
    const f = await fixture();
    const results = await Promise.all([f.service.promote(context(), input(target)), f.service.promote(context(), input(target))]);
    expect(results.every((result) => result.ok)).toBe(true);
    if (!results[0]!.ok || !results[1]!.ok) throw new Error("Promotion failed");
    expect(results[0]!.value.receipt).toEqual(results[1]!.value.receipt);
    expect(results[1]!.value.promotedWorkspaceHeader).toEqual(results[0]!.value.receipt.header);
    expect(results.map((result) => result.ok && result.value.replayed)).toEqual([false, true]);
    expect(f.state.requests).toHaveLength(1); expect(f.state.number).toBe(9007199254740994n);
    const reads = f.canonicalReads;
    expect((await f.service.promote(context(), input(target))).ok).toBe(true);
    expect(f.canonicalReads).toBe(reads);
  });

  test("racing different requests cannot create two documents", async () => {
    const f = await fixture();
    const results = await Promise.all([f.service.promote(context(), input()), f.service.promote(context("save-2"), input("order", "save-2"))]);
    expect(results[0]!.ok).toBe(true); expect(results[1]).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.state.requests).toHaveLength(1); expect(f.state.order).toBeUndefined();
  });

  test("changed target, revision, payload or request identity conflicts without canonical reread", async () => {
    const f = await fixture(); expect((await f.service.promote(context(), input())).ok).toBe(true);
    const reads = f.canonicalReads;
    for (const command of [input("order"), { ...input(), expectedRevision: 4 }, input("quote", "different")]) {
      expect(await f.service.promote(context(command.requestId), command)).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    }
    f.patch({ header: { ...f.state.workspace.header, purchaseOrderNumber: "changed" } });
    expect(await f.service.promote(context(), input())).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.canonicalReads).toBe(reads); expect(f.state.requests).toHaveLength(1);
  });

  test("fresh authority, exact creator and organization are required even on replay", async () => {
    const f = await fixture({ artwork: true }); expect((await f.service.promote(context(), input())).ok).toBe(true);
    const reads = f.canonicalReads;
    expect(await f.service.promote(context("save-1", ["order.create"]), input())).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await f.service.promote(context("save-1", ["quote.create"]), input())).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await f.service.promote(context("save-1", ["quote.create", "artwork.adopt", "artwork.assign"]), input())).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const other = context();
    expect(await f.service.promote({ ...other, principal: { ...other.principal, userId: "another", authority: { membershipId: "admin", role: "admin", capabilities } } } as OperationContext, input())).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await f.service.promote({ ...context(), organizationId: otherOrg }, input())).toMatchObject({ ok: false, error: { code: "WRONG_TENANT" } });
    expect(f.canonicalReads).toBe(reads);
  });

  test("no-file Quote does not require Artwork capability", async () => {
    const f = await fixture();
    expect((await f.service.promote(context("save-1", ["quote.create"]), input())).ok).toBe(true);
    expect((await f.service.promote(context("save-1", ["quote.create"]), input())).ok).toBe(true);
  });

  test.each(["quote", "order"] as const)("%s override authority must be fresh on initial save and exact replay", async (target) => {
    const f = await fixture({ override: true }); const before = clone(f.state);
    const createOnly: Capability[] = [target === "quote" ? "quote.create" : "order.create"];
    expect(await f.service.promote(context("save-1", createOnly), input(target))).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(f.state).toEqual(before); expect(f.state.requests).toEqual([]);
    expect((await f.service.promote(context(), input(target))).ok).toBe(true);
    const reads = f.canonicalReads;
    expect(await f.service.promote(context("save-1", createOnly), input(target))).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(f.canonicalReads).toBe(reads);
    expect((f.state.quote?.quote.lines ?? f.state.order!.order.lines).map((line) => line.sellingLineAmount.cents)).toEqual([700, 700]);
  });

  test("a promotion request cannot be reused by another workspace in the organization", async () => {
    const f = await fixture(); expect((await f.service.promote(context(), input())).ok).toBe(true);
    const secondId = "00000000-0000-4000-8000-000000000999";
    f.patch({ id: secondId, state: "draft", revision: 3, promotion: undefined,
      lines: f.state.workspace.lines.map((line) => ({ ...line, workspaceId: secondId })) });
    const before = clone(f.state);
    expect(await f.service.promote(context(), { ...input(), workspaceId: secondId })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.state).toEqual(before); expect(f.state.number).toBe(9007199254740994n);
  });

  test("factory cannot accidentally bypass current Order customer commercial policy", async () => {
    const f = await fixture({ omitCustomerPricing: true }); const before = clone(f.state);
    expect(await f.service.promote(context(), input("order"))).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(f.state).toEqual(before); expect(f.state.requests).toEqual([]);
  });

  test("unexpected permanent insert errors cannot leak private details or commit partial state", async () => {
    const f = await fixture({ rawInsertError: true }); const before = clone(f.state);
    const result = await f.service.promote(context(), input());
    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(result)).not.toContain("private constraint detail");
    expect(f.state).toEqual(before); expect(f.events.at(-2)).toBe("ROLLBACK");
  });

  test.each(["expired", "invalid", "stale", "discarded", "promoting", "edit", "empty"])("rejects %s workspace before canonical reads/writes", async (kind) => {
    const f = await fixture();
    if (kind === "expired") f.patch({ expiresAt: "2026-09-30T00:00:00.000Z" });
    if (kind === "invalid") f.patch({ expiresAt: "not-a-date" });
    if (kind === "stale") f.patch({ revision: 9 });
    if (kind === "discarded" || kind === "promoting") f.patch({ state: kind });
    if (kind === "edit") f.patch({ kind: "order_edit" });
    if (kind === "empty") f.patch({ lines: [] });
    expect(await f.service.promote(context(), input())).toMatchObject({ ok: false, error: { code: kind === "empty" ? "VALIDATION_ERROR" : "CONFLICT" } });
    expect(f.canonicalReads).toBe(0); expect(f.state.requests).toEqual([]); expect(f.state.quote).toBeUndefined();
  });

  test.each(["rate", "version", "hash", "agreement"] as const)("current %s drift rolls back numbers, documents, lines and downstream effects", async (kind) => {
    const f = await fixture({ agreement: kind === "agreement" }); const before = clone(f.state);
    f.drift(kind);
    expect(await f.service.promote(context(), input("order"))).toMatchObject({ ok: false, error: { code: "CONFLICT", context: { reason: "preview_stale" } } });
    expect(f.state).toEqual(before); expect(f.events).toContain("owner-succeed"); expect(f.events.at(-2)).toBe("ROLLBACK");
  });

  describe.each(["quote", "order"] as const)("%s complete pricing evidence", (target) => {
    test.each(["rounding.policyVersion", "id", "components[0].label"] as const)("rejects changed %s despite identical hash, configuration and amounts", async (field) => {
      const f = await fixture({ agreement: true });
      const first = f.state.workspace.lines[0]!;
      const preview = first.previews![target]!;
      const pricingResult = field === "rounding.policyVersion"
        ? { ...preview.pricingResult, rounding: { ...preview.pricingResult.rounding, policyVersion: "changed-policy" } }
        : field === "id"
          ? { ...preview.pricingResult, id: brandedId<"PricingResultId">("changed-result-id") }
          : { ...preview.pricingResult, components: preview.pricingResult.components.map((component, index) =>
            index === 0 ? { ...component, label: "changed-component-label" } : component) };
      expect(canonicalJson(pricingResult)).not.toBe(canonicalJson(preview.pricingResult));
      expect(pricingResult.evidenceFingerprint).toBe(preview.pricingResult.evidenceFingerprint);
      expect(pricingResult.calculatedLineAmount).toEqual(preview.pricingResult.calculatedLineAmount);
      expect(pricingResult.calculatedUnitAmount).toEqual(preview.pricingResult.calculatedUnitAmount);
      f.patch({ lines: [{ ...first, previews: { ...first.previews, [target]: { ...preview, pricingResult } } }, ...f.state.workspace.lines.slice(1)] });
      const before = clone(f.state);
      expect(await f.service.promote(context(), input(target))).toMatchObject({ ok: false, error: { code: "CONFLICT", context: { reason: "preview_stale" } } });
      expect(f.events).toContain("owner-succeed");
      expect(f.events.filter((event) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(event))).toEqual(["BEGIN", "ROLLBACK"]);
      expect(f.state).toEqual(before);
    });

    test("does not compare preview and selling-decision timestamps as PricingResult evidence", async () => {
      const f = await fixture();
      f.patch({ lines: f.state.workspace.lines.map((line) => {
        const preview = line.previews![target]!;
        return { ...line, previews: { ...line.previews, [target]: { ...preview, calculatedAt: "2020-01-01T00:00:00.000Z",
          sellingPriceDecision: { ...preview.sellingPriceDecision, decidedAt: "2020-01-01T00:00:00.000Z" } } } };
      }) });
      const result = await f.service.promote(context(), input(target));
      if (!result.ok) throw result.error;
      expect(result.value.replayed).toBe(false);
      expect(f.state.workspace.state).toBe("promoted");
    });
  });

  test("absent target or stale original-input provenance requires explicit refresh", async () => {
    for (const absent of [true, false]) {
      const f = await fixture(); const first = f.state.workspace.lines[0]!;
      f.patch({ lines: [{ ...first, ...(absent ? { previews: { quote: first.previews!.quote } } : { input: { ...first.input, quantity: 99 } }) }, ...f.state.workspace.lines.slice(1)] });
      expect(await f.service.promote(context(), input("order"))).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(f.state.requests).toEqual([]);
    }
  });

  test.each(["customer", "configuration", "pricing", "insert", "material", "billing", "routing", "audit", "map", "artwork", "receipt"] as const)("%s failure escapes owner envelope and restores all transactional state", async (stage) => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const f = await fixture({ artwork: true }); const before = clone(f.state); f.fail(stage);
    expect(await f.service.promote(context(), input("order"))).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.state).toEqual(before);
    expect(f.events.filter((event) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(event))).toEqual(["BEGIN", "ROLLBACK"]);
    expect(f.events.at(-1)).toBe("release");
    f.fail(); expect((await f.service.promote(context(), input("order"))).ok).toBe(true);
    expect(f.state.requests).toHaveLength(1); expect(f.state.number).toBe(9007199254740994n);
  });

  test.each(["missing", "duplicate", "reverse"] as const)("Quote %s returned lines cannot produce a partial or wrong map", async (mode) => {
    const f = await fixture(); const before = clone(f.state); f.readMode(mode);
    expect(await f.service.promote(context(), input())).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(f.state).toEqual(before);
  });

  test("command/body injection and request-context mismatch are rejected before a connection", async () => {
    const f = await fixture();
    expect(await f.service.promote(context("other"), input())).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(await f.service.promote(context(), { ...input(), artifactPrices: [1] } as PromoteSalesWorkspaceInput)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(await f.service.promote({ ...context(), principal: { kind: "service", organizationId: org, clientId: "bot", capabilities } }, input())).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(f.connections).toBe(0);
  });
});
