import { describe, expect, test } from "@jest/globals";
import type { PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { PostgresWorkspaceLinePricing } from "../../infrastructure/sales/postgresWorkspaceLinePricing.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import type { ResolveActivePricingInput, ResolvedPricingInput } from "../../src/modules/products/contracts.js";
import { CustomerCommercialPricingAdapter, type CustomerCommercialStore } from "../../src/modules/products/customerCommercial.js";
import { SalesWorkspaceApplicationService, validateSalesWorkspaceLineInput } from "../../src/modules/sales/workspaceApplication.js";
import { SalesWorkspaceLineService, workspaceLinePreviewFingerprint } from "../../src/modules/sales/workspaceLines.js";
import type { SalesWorkspace, SalesWorkspaceHeader, SalesWorkspaceLineInput, SalesWorkspaceRequestReceipt, SalesWorkspaceStore, SalesWorkspaceTransaction } from "../../src/modules/sales/workspaceContracts.js";
import { brandedId, currencyCode } from "../../src/modules/shared/commercialValues.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const organizationId = brandedId<"OrganizationId">(id(1));
const customerId = brandedId<"CustomerId">(id(4));
const now = new Date("2026-10-01T00:00:00.000Z");
const context: OperationContext = { organizationId, operationId: "test-workspace-lines", principal: {
  kind: "staff", organizationId, userId: id(2), authority: { membershipId: id(3), capabilities: ["order.create"] },
} };
const header: SalesWorkspaceHeader = { customerContact: { organizationId, customerId } };
const entry: SalesWorkspaceLineInput = { productId: id(5), quantity: 2 };
const currency = currencyCode("USD");
const initial = (): SalesWorkspace => ({ id: id(6), organizationId, creatorUserId: id(2), kind: "new_sales", state: "draft",
  revision: 1, header, lines: [], createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: "2026-10-31T00:00:00.000Z" });
const unused = async (): Promise<never> => { throw new Error("Unexpected persistence port"); };

function pricingFixture() {
  let version = "1", hash = "hash-1", baseCents = 100, fail = false, calls = 0, failAt = Number.POSITIVE_INFINITY;
  const dbCalls: string[] = [];
  const client = { query: async (text: string) => { dbCalls.push(text); throw new Error("Unexpected SQL"); } } as unknown as PoolClient;
  const base = new V2PricingParityAdapter();
  const commercial: CustomerCommercialStore = {
    resolveAgreement: async () => ({ id: "agreement-1", organizationId, customerId, productId: brandedId<"ProductId">(entry.productId),
      currency, mode: "fixed_unit", value: 325, active: true, effectiveFrom: now.toISOString(), createdAt: now.toISOString() }),
    isEntitled: async () => false, listEntitlements: async () => [], listActivePricingAgreements: async () => [],
    setEntitlement: unused, replaceAgreement: unused,
  };
  const products = { resolveActivePricingInput: async (input: ResolveActivePricingInput) => {
    calls += 1;
    if (fail) throw new V2ApplicationError("CONFLICT", "Configuration is unavailable.");
    const resolved: ResolvedPricingInput = {
      sellableProduct: { organizationId: input.organizationId, productId: input.productId, displayName: "Product", lifecycle: "active",
        pricingConfiguration: { id: brandedId<"PricingConfigurationId">(id(7)), version, contentHash: hash }, requiresDimensions: false, pricingCurrency: currency },
      resolvedConfiguration: { schemaVersion: 1, organizationId: input.organizationId, productId: input.productId,
        pricingConfigurationId: brandedId<"PricingConfigurationId">(id(7)), pricingConfigurationVersion: version,
        pricingConfigurationContentHash: hash, quantity: input.quantity, selections: input.selections ?? {},
        ...(input.dimensions ? { dimensions: input.dimensions } : {}), derivedFacts: {}, productFacts: {} },
      rules: { base: { perPieceCents: baseCents } }, warnings: [],
    };
    return { ok: true as const, value: resolved };
  } };
  const pricing = new PostgresWorkspaceLinePricing(client, { products, pricing: { calculate: async (request) => {
    if (calls >= failAt) throw new V2ApplicationError("CONFLICT", "Current Pricing is unavailable.");
    return base.calculate(request);
  } },
    customers: { validateContactReference: async () => true, getContact: async () => ({ id: brandedId<"ContactId">(id(8)), displayName: "Contact" }) },
    customerPricing: new CustomerCommercialPricingAdapter(base, commercial), now: () => now });
  return { pricing, dbCalls, calls: () => calls,
    fail: (value = true) => { fail = value; }, failPricingAt: (call: number) => { failAt = call; },
    change: () => { version = "2"; hash = "hash-2"; baseCents = 200; } };
}

function fixture() {
  let workspace = initial(), serial = 100, failCleanup = false, failCas = false;
  let currentTime = now;
  let receipts = new Map<string, SalesWorkspaceRequestReceipt>();
  const events: string[] = [];
  const prices = pricingFixture();
  const tx: SalesWorkspaceTransaction = {
    lockCreationRequest: unused, findCreation: unused, create: unused, list: unused,
    get: async (org, creator, workspaceId, lock) => {
      events.push(lock ? "lock" : "read");
      return org === workspace.organizationId && creator === workspace.creatorUserId && workspaceId === workspace.id ? structuredClone(workspace) : null;
    },
    putLine: async (org, line) => {
      expect(org).toBe(organizationId); expect(line.workspaceId).toBe(workspace.id); events.push("put_line");
      expect(line.revision).toBe((workspace.lines.find((existing) => existing.id === line.id)?.revision ?? 0) + 1);
      workspace = { ...workspace, lines: [...workspace.lines.filter((existing) => existing.id !== line.id), line].sort((a, b) => a.position - b.position) };
    },
    deleteLine: async (org, ws, lineId) => {
      expect([org, ws]).toEqual([organizationId, workspace.id]); events.push("delete_line");
      workspace = { ...workspace, lines: workspace.lines.filter((line) => line.id !== lineId) };
    },
    reorderLines: async (org, ws, ids) => {
      expect([org, ws]).toEqual([organizationId, workspace.id]); expect(ids.length).toBeGreaterThan(0); events.push("reorder");
      workspace = { ...workspace, lines: ids.map((lineId, position) => {
        const prior = workspace.lines.find((line) => line.id === lineId)!;
        return { ...prior, position, revision: prior.revision + 1 };
      }) };
    },
    invalidatePreviews: async () => {
      events.push("invalidate"); workspace = { ...workspace, lines: workspace.lines.map((line) => ({ ...line, previews: undefined, revision: line.revision + 1 })) };
    },
    update: async (result, expectedRevision) => {
      if (failCas || workspace.revision !== expectedRevision) throw new V2ApplicationError("CONFLICT", "CAS failed.");
      events.push("cas"); workspace = structuredClone(result);
    },
    getRequest: async (_org, _ws, requestId) => receipts.get(requestId) ?? null,
    recordRequest: async (_org, _ws, requestId, receipt) => { events.push("receipt"); receipts.set(requestId, structuredClone(receipt)); },
    lockPromotionRequest: unused, findPromotionRequest: unused, beginPromotion: unused, recordPromotionLineMap: unused, getPromotionLineMap: unused,
    getPromotion: unused, recordPromotion: unused, expireDrafts: unused,
  };
  const store: SalesWorkspaceStore = {
    run: async (work) => {
      const before = structuredClone(workspace), priorReceipts = new Map(receipts);
      try { return await work(tx); }
      catch (error) { workspace = before; receipts = priorReceipts; events.push("rollback"); throw error; }
    },
    withWorkspace: unused,
  };
  const options: ConstructorParameters<typeof SalesWorkspaceLineService>[1] = { now: () => currentTime, newId: () => id(serial++),
    pricing: (sameTx) => { expect(sameTx).toBe(tx); return prices.pricing; },
    releaseLineArtwork: async (sameTx, current, lineId) => {
      expect(sameTx).toBe(tx); expect(current.lines.some((line) => line.id === lineId)).toBe(true); events.push("artwork_cleanup");
      if (failCleanup) throw new V2ApplicationError("CONFLICT", "Cleanup reservation failed.");
    } };
  return { service: new SalesWorkspaceLineService(store, options), reload: () => new SalesWorkspaceApplicationService(store, { now: () => currentTime }).get(context, workspace.id),
    prices, events, state: () => structuredClone(workspace), receipts: () => receipts.size,
    receipt: (requestId: string) => structuredClone(receipts.get(requestId)), at: (time: Date) => { currentTime = time; },
    failCleanup: () => { failCleanup = true; }, failCas: () => { failCas = true; },
    expire: () => { workspace = { ...workspace, expiresAt: now.toISOString() }; },
    close: (state: "expired" | "discarded" | "promoted" = "promoted") => {
      const promotion: SalesWorkspace["promotion"] = state === "promoted" ? {
        workspaceId: workspace.id, organizationId, requestId: "promotion", fingerprint: "promotion-fingerprint",
        inputRevision: workspace.revision, target: "order", documentId: id(50), documentRevision: "1", header: workspace.header,
        lineMap: workspace.lines.map((line, position) => ({ workspaceLineId: line.id, canonicalLineId: id(200 + position), position })),
        promotedAt: currentTime.toISOString(),
      } : undefined;
      workspace = { ...workspace, state, revision: workspace.revision + 1, ...(promotion ? { promotion } : {}) };
    } };
}

describe("TEMP line lifecycle", () => {
  test("persists stable server UUIDs, dual prices and read/reload without canonical writes", async () => {
    const f = fixture();
    const saved = await f.service.add(context, id(6), { requestId: "add", expectedRevision: 1, line: entry });
    expect(saved.revision).toBe(2);
    expect(saved.lines[0]).toMatchObject({ id: id(100), workspaceId: id(6), position: 0, input: entry, revision: 1 });
    expect(saved.lines[0].previews?.quote?.pricingResult.calculatedLineAmount.cents).toBe(200);
    expect(saved.lines[0].previews?.order?.pricingResult.calculatedLineAmount.cents).toBe(650);
    expect(await f.reload()).toEqual(saved);
    expect(f.prices.dbCalls).toEqual([]);
    expect(f.events).toEqual(["lock", "put_line", "cas", "receipt", "read"]);
  });

  test("updates input and previews atomically while preserving line identity", async () => {
    const f = fixture();
    const first = await f.service.add(context, id(6), { requestId: "add", expectedRevision: 1, line: entry });
    const line = { ...entry, quantity: 3, selections: { side: "double" } };
    const updated = await f.service.update(context, id(6), { requestId: "update", expectedRevision: 2, lineId: first.lines[0].id, line });
    expect(updated.lines[0]).toMatchObject({ id: first.lines[0].id, revision: 2, input: line });
    expect(updated.lines[0]).not.toHaveProperty("preview");
    expect(updated.lines[0].previews?.quote?.pricingResult.calculatedLineAmount.cents).toBe(300);
    expect(updated.lines[0].previews?.order?.pricingResult.calculatedLineAmount.cents).toBe(975);
    expect(updated.lines[0].previews?.order?.inputFingerprint).not.toBe(first.lines[0].previews?.order?.inputFingerprint);
  });

  test("header plus line is one CAS and invalidates other customer-dependent previews", async () => {
    const f = fixture();
    await f.service.add(context, id(6), { requestId: "one", expectedRevision: 1, line: entry });
    await f.service.add(context, id(6), { requestId: "two", expectedRevision: 2, line: entry });
    const nextHeader: SalesWorkspaceHeader = { customerContact: { organizationId, customerId: brandedId<"CustomerId">(id(9)) }, jobLabel: "New Job" };
    const updated = await f.service.update(context, id(6), { requestId: "update", expectedRevision: 3, lineId: id(100), line: entry, header: nextHeader });
    expect(updated.revision).toBe(4); expect(updated.header).toEqual(nextHeader);
    expect(updated.lines[0].previews?.order?.customerContact).toEqual(nextHeader.customerContact);
    expect(updated.lines[1].previews).toBeUndefined();
    updated.lines.forEach((line) => expect(line).not.toHaveProperty("preview"));
    expect(updated.lines.map((line) => line.revision)).toEqual([3, 2]);
    expect(f.events.filter((event) => event === "cas")).toHaveLength(3);
  });

  test("configuration failure leaves prior TEMP input, price, header and revision intact", async () => {
    const f = fixture();
    await f.service.add(context, id(6), { requestId: "add", expectedRevision: 1, line: entry });
    const before = f.state(); f.prices.fail();
    await expect(f.service.update(context, id(6), { requestId: "bad", expectedRevision: 2, lineId: id(100), line: { ...entry, quantity: 9 }, header: {} })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state()).toEqual(before); expect(f.receipts()).toBe(1);
  });

  test("late CAS failure rolls back accepted line writes and request receipt", async () => {
    const f = fixture(); f.failCas();
    await expect(f.service.add(context, id(6), { requestId: "add", expectedRevision: 1, line: entry })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state()).toEqual(initial()); expect(f.receipts()).toBe(0);
  });

  test("Pricing failure on the second refreshed line rolls back the first refreshed line", async () => {
    const f = fixture();
    await f.service.add(context, id(6), { requestId: "one", expectedRevision: 1, line: entry });
    await f.service.add(context, id(6), { requestId: "two", expectedRevision: 2, line: entry });
    const before = f.state(); f.prices.change(); f.prices.failPricingAt(4);
    await expect(f.service.refresh(context, id(6), { requestId: "refresh", expectedRevision: 3 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state()).toEqual(before); expect(f.receipts()).toBe(2);
  });

  test("another workspace's line ID cannot be edited or deleted", async () => {
    const f = fixture();
    await f.service.add(context, id(6), { requestId: "one", expectedRevision: 1, line: entry });
    const before = f.state();
    await expect(f.service.update(context, id(6), { requestId: "edit", expectedRevision: 2, lineId: id(999), line: entry })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.service.remove(context, id(6), { requestId: "delete", expectedRevision: 2, lineId: id(999) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.state()).toEqual(before); expect(f.events).not.toContain("artwork_cleanup");
  });

  test("reorder preserves identity/evidence and accepts only exact permutations", async () => {
    const f = fixture();
    await f.service.add(context, id(6), { requestId: "one", expectedRevision: 1, line: entry });
    const before = await f.service.add(context, id(6), { requestId: "two", expectedRevision: 2, line: entry });
    for (const lineIds of [[], [id(100)], [id(100), id(100)], [id(100), id(999)], [id(100), ""]]) {
      await expect(f.service.reorder(context, id(6), { requestId: "invalid", expectedRevision: 3, lineIds })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(f.state()).toEqual(before);
    }
    const result = await f.service.reorder(context, id(6), { requestId: "reorder", expectedRevision: 3, lineIds: [id(101), id(100)] });
    expect(result.lines.map((line) => [line.id, line.position])).toEqual([[id(101), 0], [id(100), 1]]);
    expect(result.lines[0].previews).toEqual(before.lines[1].previews); expect(f.prices.calls()).toBe(2);
  });

  test("deletion requests Artwork cleanup first and compacts positions; final empty line list is valid", async () => {
    const f = fixture();
    await f.service.add(context, id(6), { requestId: "one", expectedRevision: 1, line: entry });
    await f.service.add(context, id(6), { requestId: "two", expectedRevision: 2, line: entry });
    f.events.length = 0;
    const result = await f.service.remove(context, id(6), { requestId: "remove", expectedRevision: 3, lineId: id(100) });
    expect(result.lines.map((line) => [line.id, line.position])).toEqual([[id(101), 0]]);
    expect(f.events).toEqual(["lock", "artwork_cleanup", "delete_line", "reorder", "cas", "receipt"]);
    f.events.length = 0;
    expect((await f.service.remove(context, id(6), { requestId: "last", expectedRevision: 4, lineId: id(101) })).lines).toEqual([]);
    expect(f.events).not.toContain("reorder");
  });

  test("failed Artwork cleanup does not remove a line or advance revision", async () => {
    const f = fixture();
    await f.service.add(context, id(6), { requestId: "one", expectedRevision: 1, line: entry });
    const before = f.state(); f.failCleanup(); f.events.length = 0;
    await expect(f.service.remove(context, id(6), { requestId: "remove", expectedRevision: 2, lineId: id(100) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state()).toEqual(before); expect(f.events).not.toContain("delete_line");
  });

  test("retries replay one UUID without pricing or writes; altered request conflicts", async () => {
    const f = fixture(), input = { requestId: "add", expectedRevision: 1, line: entry };
    const result = await f.service.add(context, id(6), input);
    expect(await f.service.add(context, id(6), input)).toEqual(result);
    expect(f.prices.calls()).toBe(1); expect(f.receipts()).toBe(1);
    await expect(f.service.add(context, id(6), { ...input, line: { ...entry, quantity: 3 } })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.service.add(context, id(6), { ...input, requestId: "stale" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test.each([-1, 0, 1])("line retry at expiry offset %i ms matches GET without altering stored receipt or workspace", async (offset) => {
    const f = fixture(), input = { requestId: "add", expectedRevision: 1, line: entry };
    const saved = await f.service.add(context, id(6), input);
    const receipt = f.receipt(input.requestId);
    f.at(new Date(Date.parse(saved.expiresAt) + offset)); f.prices.fail(); f.events.length = 0;
    const replayed = await f.service.add(context, id(6), input);
    expect(replayed).toEqual({ ...saved, state: offset < 0 ? "draft" : "expired" });
    expect(replayed).toEqual(await f.reload());
    expect(f.state()).toEqual(saved); expect(f.receipt(input.requestId)).toEqual(receipt);
    expect(f.prices.calls()).toBe(1); expect(f.receipts()).toBe(1);
    expect(f.events).toEqual(["lock", "read"]);
  });

  test("changing only the customer header on retry conflicts without pricing or replacing the receipt", async () => {
    const f = fixture(), input = { requestId: "add", expectedRevision: 1, line: entry, header };
    const saved = await f.service.add(context, id(6), input), receipt = f.receipt(input.requestId);
    f.events.length = 0;
    await expect(f.service.add(context, id(6), { ...input, header: { customerContact: {
      organizationId, customerId: brandedId<"CustomerId">(id(9)),
    } } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state()).toEqual(saved); expect(f.receipt(input.requestId)).toEqual(receipt);
    expect(f.prices.calls()).toBe(1); expect(f.events).toEqual(["lock", "rollback"]);
  });

  test.each(["expired", "discarded", "promoted"] as const)("retry after %s preserves historical receipt semantics and current terminal state", async (state) => {
    const f = fixture(), input = { requestId: "add", expectedRevision: 1, line: entry };
    const saved = await f.service.add(context, id(6), input), receipt = f.receipt(input.requestId);
    if (state === "expired") f.at(new Date(saved.expiresAt));
    f.close(state);
    const current = f.state(); f.prices.fail(); f.events.length = 0;
    // Like A1 header retries, a line retry returns its historical result with natural expiry only.
    const replayed = await f.service.add(context, id(6), input);
    expect(replayed).toEqual({ ...saved, state: state === "expired" ? "expired" : "draft" });
    expect(f.state()).toEqual(current); expect(await f.reload()).toEqual(current);
    expect(f.receipt(input.requestId)).toEqual(receipt);
    expect(f.prices.calls()).toBe(1); expect(f.receipts()).toBe(1);
    expect(f.events).toEqual(["lock", "read"]);
  });

  test("foreign tenant, other user and revoked creator capability cannot mutate or replay", async () => {
    const f = fixture(), input = { requestId: "add", expectedRevision: 1, line: entry };
    await f.service.add(context, id(6), input);
    const before = f.state();
    for (const denied of [
      { ...context, organizationId: id(90) },
      { ...context, principal: { ...context.principal, userId: id(91) } },
      { ...context, principal: { ...context.principal, authority: { membershipId: id(3), capabilities: [] } } },
    ] as OperationContext[]) await expect(f.service.add(denied, id(6), input)).rejects.toBeInstanceOf(V2ApplicationError);
    expect(f.state()).toEqual(before); expect(f.prices.calls()).toBe(1);
  });

  test("expired and promoted drafts reject new mutations before pricing", async () => {
    const expired = fixture(); expired.expire();
    const promoted = fixture(); promoted.close();
    for (const f of [expired, promoted]) {
      await expect(f.service.add(context, id(6), { requestId: "add", expectedRevision: 1, line: entry })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.prices.calls()).toBe(0);
    }
  });

  test("refresh replaces stale Product tokens and price together, retaining original input/UUID", async () => {
    const f = fixture();
    const before = await f.service.add(context, id(6), { requestId: "add", expectedRevision: 1, line: entry });
    f.prices.change();
    expect(f.state()).toEqual(before);
    const after = await f.service.refresh(context, id(6), { requestId: "refresh", expectedRevision: 2 });
    expect(after.lines[0].id).toBe(before.lines[0].id); expect(after.lines[0].input).toEqual(entry);
    expect(after.lines[0]).not.toHaveProperty("preview");
    expect(after.lines[0].previews?.quote?.resolvedConfiguration).toMatchObject({ pricingConfigurationVersion: "2", pricingConfigurationContentHash: "hash-2" });
    expect(after.lines[0].previews?.quote?.pricingResult.calculatedLineAmount.cents).toBe(400);
    expect(after.lines[0].previews?.quote?.pricingResult.evidenceFingerprint).not.toBe(before.lines[0].previews?.quote?.pricingResult.evidenceFingerprint);
  });

  test("unknown command fields cannot smuggle client preview/final prices", async () => {
    const f = fixture();
    await expect(f.service.add(context, id(6), { requestId: "add", expectedRevision: 1, line: entry, previews: {} } as never)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(f.events).toEqual([]);
  });
});

describe("server-only preview and input bounds", () => {
  test("order-only staff needs neither quote.create nor quote.view; incomplete header omits Order guarantee", async () => {
    const { pricing } = pricingFixture();
    const result = await pricing.preview(context, {}, entry);
    expect(result.quote?.pricingResult.calculatedLineAmount.cents).toBe(200); expect(result.order).toBeUndefined();
    expect(Object.isFrozen(result.quote?.pricingResult)).toBe(true);
  });

  test("contact-only preview preserves canonical Order fallback, never invents customer linkage", async () => {
    const { pricing } = pricingFixture();
    const result = await pricing.preview(context, { customerContact: { organizationId, contactId: brandedId<"ContactId">(id(8)) } }, entry);
    expect(result.order?.pricingResult.calculatedLineAmount.cents).toBe(200);
    expect(result.order?.pricingResult.customerPricing).toBeUndefined();
  });

  test("override requires a creatable target's capability, preserves calculated evidence, and uses canonical Sales math", async () => {
    const { pricing } = pricingFixture();
    const input = { ...entry, selling: { kind: "unit_override" as const, unitCents: 199, reason: "Negotiated" } };
    await expect(pricing.preview(context, header, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const permitted: OperationContext = { ...context, principal: { kind: "staff", organizationId, userId: id(2), authority: {
      membershipId: id(3), capabilities: ["order.create", "order.overridePrice"],
    } } };
    const result = await pricing.preview(permitted, header, input);
    expect(result.order?.pricingResult.calculatedLineAmount.cents).toBe(650);
    expect(result.order?.sellingPriceDecision.resultingLineAmount.cents).toBe(398);
    expect(result.order?.sellingPriceDecision.pricingResultId).toBe(result.order?.pricingResult.id);
    const total = await pricing.preview(permitted, header, { ...entry, selling: { kind: "total_override", totalCents: 501, reason: "Agreed total" } });
    expect(total.order?.sellingPriceDecision.resultingLineAmount.cents).toBe(501);
    expect(total.order?.sellingPriceDecision.resultingUnitAmount.cents).toBe(251);
  });

  test.each([
    { create: "order.create", override: "quote.overridePrice" },
    { create: "quote.create", override: "order.overridePrice" },
  ] as const)("crossed capabilities $create and $override cannot authorize an override", async ({ create, override }) => {
    const f = pricingFixture();
    const crossed: OperationContext = { ...context, principal: { kind: "staff", organizationId, userId: id(2),
      authority: { membershipId: id(3), capabilities: [create, override] } } };
    await expect(f.pricing.preview(crossed, header, { ...entry, selling: {
      kind: "unit_override", unitCents: 199, reason: "Negotiated",
    } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.calls()).toBe(0); expect(f.dbCalls).toEqual([]);
  });

  test.each([
    { ...entry, quantity: 0 }, { ...entry, quantity: 1.5 }, { ...entry, finalPrice: 1 },
    { ...entry, selling: { kind: "discount", discountBasisPoints: 100, reason: "no" } },
    { ...entry, selling: { kind: "total_override", totalCents: 3, reason: "   " } },
    { ...entry, selections: JSON.parse('{"__proto__":{"polluted":true}}') },
    { ...entry, selections: { x: { constructor: true } } },
    { ...entry, selections: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`key${index}`, true])) },
    { ...entry, selections: { x: "x".repeat(4001) } },
    { ...entry, dimensions: { width: "1e100", height: "1", unit: "in" } },
  ])("rejects malformed or client-authoritative input %#", (input) => {
    expect(() => validateSalesWorkspaceLineInput(input)).toThrow(V2ApplicationError);
  });

  test("fingerprint binds original options, quantity and header customer; key order is immaterial", () => {
    const original = workspaceLinePreviewFingerprint(entry, header.customerContact);
    expect(workspaceLinePreviewFingerprint({ quantity: 2, productId: entry.productId }, header.customerContact)).toBe(original);
    expect(workspaceLinePreviewFingerprint({ ...entry, quantity: 3 }, header.customerContact)).not.toBe(original);
    expect(workspaceLinePreviewFingerprint(entry)).not.toBe(original);
  });

  test("default composition uses only existing scoped owner reads on the supplied client", async () => {
    const queries: { sql: string; params?: unknown[] }[] = [];
    const client = { query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("FROM customers")) return { rows: [{ id: customerId, company_name: "Customer" }] };
      if (sql.includes("FROM products p")) return { rows: [{ product_id: entry.productId, product_name: "Product", product_type_id: null,
        measurement_mode: "quantity_only", pricing_profile_key: "qty", product_formula_id: null, product_formula: null,
        tree_id: id(7), tree_schema_version: 2, tree_published_at: now,
        tree_json: { schemaVersion: 2, rootNodeIds: ["sides"], nodes: {
          sides: { id: "sides", kind: "question", label: "Sides", input: { type: "select", selectionKey: "sides", defaultValue: "single" },
            choices: [{ value: "single", label: "Single" }] },
        }, meta: { pricingV2: { base: { perPieceCents: 100 } } } },
        formula_id: null, formula_revision_id: null }] };
      if (sql.includes("FROM v2_customer_product_pricing_agreements")) return { rows: [{ id: id(11), organization_id: organizationId,
        customer_id: customerId, product_id: entry.productId, currency: "USD", pricing_mode: "fixed_unit", pricing_value: 325,
        active: true, effective_from: now, created_at: now }] };
      throw new Error(`Unexpected owner query: ${sql}`);
    } } as unknown as PoolClient;
    const previews = await new PostgresWorkspaceLinePricing(client, { now: () => now }).preview(context, header, entry);
    expect(previews.quote?.pricingResult.calculatedLineAmount.cents).toBe(200);
    expect(previews.order?.pricingResult.calculatedLineAmount.cents).toBe(650);
    expect(queries).toHaveLength(3);
    for (const query of queries) { expect(query.sql.trim()).toMatch(/^SELECT/); expect(query.params?.[0]).toBe(organizationId); }
  });
});
