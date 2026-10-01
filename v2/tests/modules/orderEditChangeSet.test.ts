import { describe, expect, jest, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import type { ResolveActivePricingInput, ResolvedPricingInput } from "../../src/modules/products/contracts.js";
import { normalizeSalesJobLabel, type SalesLineSnapshot } from "../../src/modules/sales/contracts.js";
import {
  OrderApplicationService, summarizeOrderTotals, type OrderOperationResult, type OrderReadModel,
  type OrderTransaction, type OrderTransactionRunner, type UpdateOrderInput,
} from "../../src/modules/sales/orderApplication.js";
import {
  calculatedDecision, createQuoteLifecycleCheckpoint, QuoteApplicationService,
  type QuoteReadModel, type QuoteTransaction,
} from "../../src/modules/sales/quoteApplication.js";
import { QuoteConversionApplicationService } from "../../src/modules/sales/quoteConversionApplication.js";
import { toQuoteCheckpointPersistenceEnvelope, toSalesDocumentTermsPersistence } from "../../src/modules/sales/persistenceContracts.js";
import { brandedId, currencyCode } from "../../src/modules/shared/commercialValues.js";

const organizationId = brandedId<"OrganizationId">("edit-org");
const orderId = brandedId<"OrderId">("edit-order");
const customerContact = { organizationId, customerId: brandedId<"CustomerId">("edit-customer") };
const invoiceId = brandedId<"InvoiceId">("edit-invoice");
const usd = currencyCode("USD");
const principal = { kind: "staff" as const, organizationId, userId: "edit-staff", authority: {
  membershipId: "edit-membership", capabilities: ["order.view", "order.create", "order.edit", "order.overridePrice", "quote.view", "quote.create", "quote.edit", "quote.convert"] as const,
} };
const context = (id: string): OperationContext => ({ organizationId, principal, operationId: id, businessRequest: { id, payloadFingerprint: "context-only" } });
const pricing = new V2PricingParityAdapter();
const productInput = (input: Pick<ResolveActivePricingInput, "productId" | "quantity" | "selections" | "dimensions">): ResolvedPricingInput => ({
  sellableProduct: { organizationId, productId: input.productId, displayName: "Fixture Product", lifecycle: "active",
    pricingConfiguration: { id: brandedId<"PricingConfigurationId">("edit-config"), version: "1", contentHash: "sha256:edit-config" }, requiresDimensions: false, pricingCurrency: usd },
  resolvedConfiguration: { schemaVersion: 1, organizationId, productId: input.productId,
    pricingConfigurationId: brandedId<"PricingConfigurationId">("edit-config"), pricingConfigurationVersion: "1", pricingConfigurationContentHash: "sha256:edit-config",
    quantity: input.quantity, selections: input.selections ?? {}, ...(input.dimensions ? { dimensions: input.dimensions } : {}), derivedFacts: {}, productFacts: {} },
  rules: { base: { perPieceCents: 100 } }, warnings: [],
});
const makeLine = async (id: string, quantity = 2, kind: "calculated" | "locked" | "discount" = "calculated"): Promise<SalesLineSnapshot> => {
  const input = productInput({ productId: brandedId<"ProductId">("edit-product"), quantity });
  const result = await pricing.calculate({ organizationId, ...input, pricingContext: { channel: "staff", effectiveAt: "2026-09-30T00:00:00.000Z" } });
  const decision = calculatedDecision(result, kind === "discount" ? { kind: "discount", discountBasisPoints: 1000, reason: "Historical discount" } : undefined,
    { principalKind: "staff", subjectId: "historical-staff" });
  return { lineId: brandedId<"SalesLineId">(id), productId: input.sellableProduct.productId, description: `Original ${id}`, operationalNote: "Keep exact operational note",
    quantity, resolvedConfiguration: input.resolvedConfiguration, pricingResult: result,
    sellingPriceDecision: kind === "locked" ? { ...decision, kind: "locked", reason: "Historical lock" } : decision,
    calculatedLineAmount: result.calculatedLineAmount, sellingLineAmount: decision.resultingLineAmount, taxability: { taxable: true, source: "product" } };
};

/** Mock transaction ports, but all validation, pricing choreography and CAS decisions run at the real Sales application boundary. */
const runtime = async (options: { kind?: "calculated" | "locked" | "discount"; frozen?: boolean; routed?: boolean; handoff?: boolean; failBilling?: boolean; rejectCas?: boolean } = {}) => {
  let current: OrderReadModel = { order: { organizationId, orderId, customerContact, currency: usd, jobLabel: "Original job", purchaseOrderNumber: "PO-before",
    requestedDueDate: "2026-10-02T00:00:00.000Z", terms: { termsCode: "net_30", commercialNotes: "Original commercial notes" }, requestedFulfillment: { method: "pickup" },
    lines: [await makeLine("line-a", 2, options.kind), await makeLine("line-b")], commercialState: "open", billingInvoiceReference: invoiceId },
    number: { kind: "order", core: 1001n, display: "O-1001" }, revision: "4", totals: summarizeOrderTotals([], usd), routes: [], completionEligibility: { eligible: false, blockers: [], lines: [] } };
  const requests = new Map<string, { fingerprint: string; result: OrderOperationResult | null }>();
  const sequence: string[] = [];
  const tx = {
    customers: { getCustomer: async () => null, getContact: async () => null, validateContactReference: async (reference) => reference.organizationId === organizationId,
      getPresentationIdentity: async () => ({ customerDisplayName: "Fixture Customer" }) },
    products: {
      getSellableProduct: async () => null, resolveProductType: async () => null, getActivePricingConfiguration: async () => null,
      validateSellableProduct: async () => true, resolveCurrentRoutingProduct: async () => null,
      resolveVersionRoutingPolicy: async () => ({ kind: "no_route" as const }),
      resolveOrderRoutability: jest.fn<OrderTransaction["products"]["resolveOrderRoutability"]>(async () => ({ kind: "routable", productName: "Fixture Product", routing: { kind: "no_route" } })),
      resolveCurrentTaxability: async () => ({ taxable: true }), resolveHistoricalPricingConfiguration: async () => null,
      resolveActivePricingInput: jest.fn<OrderTransaction["products"]["resolveActivePricingInput"]>(async (input) => ({ ok: true, value: productInput(input) })),
    },
    pricing: { calculate: jest.fn<OrderTransaction["pricing"]["calculate"]>((input) => pricing.calculate(input)) },
    billing: {
      createDraftInvoice: async () => ({ status: "created" as const, invoiceId, synchronizationVersion: "1" }),
      synchronizeDraftInvoice: jest.fn<OrderTransaction["billing"]["synchronizeDraftInvoice"]>(async () => {
        sequence.push("billing");
        return options.failBilling ? { status: "not_editable", reason: "invoice_missing" } : { status: "synchronized", invoiceId, synchronizationVersion: current.revision };
      }), readDraftForOrder: async () => null, readInvoiceForOrder: async () => null,
    },
    routing: { resolveRouteTemplate: async () => null, readRouteInstance: async () => null, readRouteForWork: async () => null,
      instantiateRoute: async () => { throw new Error("No route should be invented for this fixture."); } },
    materialRequirements: { freeze: jest.fn<OrderTransaction["materialRequirements"]["freeze"]>(async () => { sequence.push("freeze"); }), hasFrozen: async () => options.frozen ?? false },
    reserve: async (input) => {
      const existing = requests.get(input.businessRequestId);
      if (existing && existing.fingerprint !== input.payloadFingerprint) throw new V2ApplicationError("CONFLICT", "Request payload changed.");
      if (existing?.result) return { kind: "replay" as const, request: { id: input.businessRequestId, status: "succeeded" as const, resultJson: existing.result } };
      requests.set(input.businessRequestId, { fingerprint: input.payloadFingerprint, result: null });
      return { kind: "new" as const, request: { id: input.businessRequestId, status: "in_progress" as const, resultJson: null } };
    },
    succeed: async (_org, id, result) => { requests.get(id)!.result = result; },
    attribute: jest.fn<OrderTransaction["attribute"]>(async () => undefined), audit: jest.fn<OrderTransaction["audit"]>(async () => undefined),
    allocateNumber: async () => ({ kind: "order" as const, core: 1002n, display: "O-1002" }),
    create: async (input) => { current = { ...current, order: { ...input, currency: usd, commercialState: "open", billingInvoiceReference: invoiceId }, number: input.number, revision: "1" }; },
    read: async (org, id) => org === organizationId && id === current.order.orderId ? current : null,
    update: jest.fn<OrderTransaction["update"]>(async (input) => {
      sequence.push("cas");
      if (options.rejectCas || input.expectedRevision !== Number(current.revision)) return false;
      current = { ...current, order: { ...current.order, ...input }, revision: String(input.expectedRevision + 1), totals: summarizeOrderTotals(input.lines, usd, input.sellingAdjustment?.cents) };
      return true;
    }),
    removeLinesNotIn: jest.fn<OrderTransaction["removeLinesNotIn"]>(async () => { sequence.push("remove"); }),
    hasRoute: async () => options.routed ?? false, hasFulfillmentHandoff: async () => options.handoff ?? false,
    cancellationBlockers: async () => [], completionEligibility: async () => current.completionEligibility,
    reopen: async () => false, complete: async () => false, archive: async () => false, unarchive: async () => false, cancel: async () => false,
  } satisfies OrderTransaction;
  const runner: OrderTransactionRunner = { transaction: async (action) => {
    const before = current;
    const priorRequests = new Map([...requests].map(([key, value]) => [key, { ...value }]));
    try { return await action(tx); }
    catch (cause) { current = before; requests.clear(); priorRequests.forEach((value, key) => requests.set(key, value)); throw cause; }
  } };
  return { service: new OrderApplicationService(runner), tx, runner, sequence, get current() { return current; },
    input: (id: string, input: Partial<UpdateOrderInput> = {}): UpdateOrderInput => ({ businessRequestId: id, orderId: current.order.orderId, expectedRevision: current.revision, patch: {}, ...input }) };
};

describe("M1 canonical Order edit change set", () => {
  test("unchanged default edit keeps the legacy no-op without Sales, Billing or audit writes", async () => {
    const r = await runtime();
    const before = r.current;
    expect(await r.service.update(context("noop"), r.input("noop"))).toMatchObject({ ok: true });
    expect(r.current).toBe(before);
    expect(r.tx.update).not.toHaveBeenCalled();
    expect(r.tx.billing.synchronizeDraftInvoice).not.toHaveBeenCalled();
    expect(r.tx.audit).not.toHaveBeenCalled();
  });

  test("trusted third-argument Artwork coordination makes exactly one Sales CAS, sync and meaningful audit", async () => {
    const r = await runtime({ kind: "locked", frozen: true, routed: true });
    const before = r.current;
    const input = r.input("artifact-only");
    const result = await r.service.update(context("artifact-only"), input, { touchRevision: true });
    expect(result).toMatchObject({ ok: true, value: { order: { revision: "5" } } });
    expect(r.current.order.lines).toEqual(before.order.lines);
    expect(r.current.order.lines[0]!.sellingPriceDecision).toBe(before.order.lines[0]!.sellingPriceDecision);
    expect(r.tx.update).toHaveBeenCalledTimes(1);
    expect(r.tx.billing.synchronizeDraftInvoice).toHaveBeenCalledTimes(1);
    expect(r.tx.billing.synchronizeDraftInvoice.mock.calls[0]![0].sourceSalesStateToken).toBe("5");
    expect(r.tx.audit).toHaveBeenCalledTimes(1);
    expect(r.tx.audit.mock.calls[0]![0].event.changes).toContainEqual({ group: "lifecycle", kind: "order_edit_coordinated", summary: "Order revised as part of a coordinated Artwork edit." });
    expect(r.tx.materialRequirements.freeze).not.toHaveBeenCalled();
    expect(r.tx.pricing.calculate).not.toHaveBeenCalled();
    expect(await r.service.update(context("artifact-only"), input, { touchRevision: true })).toEqual(result);
    expect(r.tx.update).toHaveBeenCalledTimes(1);
  });

  test("forged body touchRevision/options/actor never become the trusted coordination option", async () => {
    const r = await runtime();
    const body = JSON.parse(JSON.stringify({ ...r.input("forged-touch"), touchRevision: true, options: { touchRevision: true }, actor: { principalSubject: "forged" } })) as UpdateOrderInput;
    expect(await r.service.update(context("forged-touch"), body)).toMatchObject({ ok: true });
    expect(r.current.revision).toBe("4");
    expect(r.tx.update).not.toHaveBeenCalled();
    expect(r.tx.billing.synchronizeDraftInvoice).not.toHaveBeenCalled();
    expect(r.tx.audit).not.toHaveBeenCalled();
    expect(r.tx.attribute.mock.calls[0]![0].principalSubject).toBe(principal.userId);
  });

  test("internal touch cannot replay an unrelated successful default no-op request", async () => {
    const r = await runtime();
    const input = r.input("mode-replay");
    expect(await r.service.update(context("mode-replay"), input)).toMatchObject({ ok: true });
    expect(await r.service.update(context("mode-replay"), input, { touchRevision: true })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(r.tx.update).not.toHaveBeenCalled();
  });

  test("unauthorized internal touch fails before transaction entry, including revoked-authority replay", async () => {
    const r = await runtime();
    const transaction = jest.spyOn(r.runner, "transaction");
    const denied: OperationContext = { ...context("denied-touch"), principal: { ...principal, authority: { membershipId: "denied", capabilities: ["order.view"] } } };
    expect(await r.service.update(denied, r.input("denied-touch"), { touchRevision: true })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(transaction).not.toHaveBeenCalled();
    const input = r.input("replay-touch");
    expect(await r.service.update(context("replay-touch"), input, { touchRevision: true })).toMatchObject({ ok: true });
    transaction.mockClear();
    expect(await r.service.update({ ...denied, ...context("replay-touch"), principal: denied.principal }, input, { touchRevision: true })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(transaction).not.toHaveBeenCalled();
    expect(r.tx.update).toHaveBeenCalledTimes(1);
  });

  test("failed internal touch rolls back and retries with the same request without repricing", async () => {
    const options = { failBilling: true };
    const r = await runtime(options);
    const before = r.current;
    const input = r.input("touch-failure");
    expect(await r.service.update(context("touch-failure"), input, { touchRevision: true })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(r.current).toBe(before);
    expect(r.tx.update).toHaveBeenCalledTimes(1);
    expect(r.tx.audit).not.toHaveBeenCalled();
    options.failBilling = false;
    expect(await r.service.update(context("touch-failure"), input, { touchRevision: true })).toMatchObject({ ok: true, value: { order: { revision: "5" } } });
    expect(r.tx.update).toHaveBeenCalledTimes(2);
    expect(r.tx.pricing.calculate).not.toHaveBeenCalled();
  });

  test("combines all header fields, deletion, presentation edits, add, duplicate and final ordering under one CAS", async () => {
    const r = await runtime();
    const retained = r.current.order.lines[0]!;
    const input = r.input("combined", { patch: { jobLabel: "  Revised job  ", purchaseOrderNumber: "PO-after", requestedDueDate: "2026-10-03T00:00:00.000Z",
      terms: { termsCode: "net_15", commercialNotes: "Revised commercial notes", salesRepresentativeId: "rep", taxContextReference: "tax" },
      requestedFulfillment: { method: "shipping", destination: { addressLine1: "1 Main", city: "Portland" } }, sellingAdjustment: { cents: -25, reason: "Approved" }, commercialCharge: { kind: "handling", cents: 10, description: "Fee" } },
      lineChanges: [{ kind: "remove", lineId: brandedId<"SalesLineId">("line-b") }, { kind: "update_description", lineId: retained.lineId, description: "Revised description" },
        { kind: "update_note", lineId: retained.lineId, note: "Revised operational note" }, { kind: "add", line: { clientLineKey: "new_1", productId: "edit-product", quantity: 3, operationalNote: "  New TEMP staff note  " } },
        { kind: "duplicate", sourceLineId: retained.lineId, clientLineKey: "copy-1" }],
      finalLineOrder: [{ clientLineKey: "copy-1" }, { lineId: retained.lineId }, { clientLineKey: "new_1" }],
    });
    const result = await r.service.update(context("combined"), input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = new Map(result.value.lineCorrelations!.map((entry) => [entry.clientLineKey, entry.orderLineId]));
    expect(result.value.order.order.lines.map((line) => line.lineId)).toEqual([ids.get("copy-1"), retained.lineId, ids.get("new_1")]);
    expect([...ids.values()]).toEqual(expect.arrayContaining([expect.stringMatching(/^[0-9a-f-]{36}$/), expect.stringMatching(/^[0-9a-f-]{36}$/)]));
    expect(new Set([...ids.values(), retained.lineId]).size).toBe(3);
    expect(result.value.order.order).toMatchObject({ jobLabel: "Revised job", purchaseOrderNumber: "PO-after", requestedDueDate: input.patch.requestedDueDate, terms: input.patch.terms });
    expect(result.value.order.order.lines[1]).toMatchObject({ lineId: retained.lineId, description: "Revised description", operationalNote: "Revised operational note", pricingResult: retained.pricingResult, sellingPriceDecision: retained.sellingPriceDecision });
    expect(result.value.order.order.lines[2]!.operationalNote).toBe("New TEMP staff note");
    expect(result.value.order.order.lines[0]!.operationalNote).toBe("Revised operational note");
    expect(r.tx.update).toHaveBeenCalledTimes(1);
    expect(r.tx.billing.synchronizeDraftInvoice).toHaveBeenCalledTimes(1);
    expect(r.tx.billing.synchronizeDraftInvoice.mock.calls[0]![0]).toMatchObject({ sourceSalesStateToken: "5", purchaseOrderNumber: "PO-after", termsCode: "net_15", salesAdjustment: { cents: -25 } });
    expect(r.tx.materialRequirements.freeze.mock.calls[0]![2].map((line) => line.lineId)).toEqual([ids.get("copy-1"), ids.get("new_1")]);
    expect(r.sequence).toEqual(["cas", "freeze", "billing", "remove"]);
    expect(r.tx.audit.mock.calls[0]![0].event.changes).toEqual(expect.arrayContaining([{ group: "commercial_terms", kind: "terms_changed", summary: "Job Label updated." }]));
    const replay = await r.service.update(context("combined"), input);
    expect(replay).toEqual(result);
    if (replay.ok) expect(replay.value.order.order.lines[2]!.operationalNote).toBe("New TEMP staff note");
    expect(r.tx.update).toHaveBeenCalledTimes(1);
    expect(r.tx.pricing.calculate).toHaveBeenCalledTimes(2);
    expect(await r.service.update(context("combined"), { ...input, finalLineOrder: [...input.finalLineOrder!].reverse() })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await r.service.update(context("combined"), { ...input, lineChanges: input.lineChanges!.map((change) => change.kind === "add" ? { ...change, line: { ...change.line, operationalNote: "Changed request note" } } : change) })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  test.each(["locked", "discount"] as const)("header/description/reorder preserves historical %s evidence without Products or Pricing", async (kind) => {
    const r = await runtime({ kind, frozen: true, routed: true });
    const source = r.current.order.lines;
    const result = await r.service.update(context("presentation"), r.input("presentation", { patch: { jobLabel: "Header-only" },
      lineChanges: [{ kind: "update_description", lineId: source[0]!.lineId, description: "Presentation only" }], finalLineOrder: source.map((line) => ({ lineId: line.lineId })).reverse() }));
    expect(result.ok).toBe(true);
    expect(r.current.order.lines[1]!.lineId).toBe(source[0]!.lineId);
    expect(r.current.order.lines[1]!.pricingResult).toBe(source[0]!.pricingResult);
    expect(r.current.order.lines[1]!.sellingPriceDecision).toBe(source[0]!.sellingPriceDecision);
    expect(r.current.order.lines[1]!.operationalNote).toBe(source[0]!.operationalNote);
    expect(r.tx.products.resolveActivePricingInput).not.toHaveBeenCalled();
    expect(r.tx.pricing.calculate).not.toHaveBeenCalled();
    expect(r.tx.materialRequirements.freeze).not.toHaveBeenCalled();
  });

  test("generic quantity/configuration replacement retains the original operational note and line ID", async () => {
    const r = await runtime();
    const source = r.current.order.lines[0]!;
    const result = await r.service.update(context("quantity"), r.input("quantity", { lineChanges: [{ kind: "update", lineId: source.lineId, line: { productId: source.productId, quantity: 4 } }] }));
    expect(result.ok).toBe(true);
    expect(r.current.order.lines[0]).toMatchObject({ lineId: source.lineId, operationalNote: source.operationalNote, quantity: 4 });
    expect(r.tx.update).toHaveBeenCalledTimes(1);
  });

  test.each(["x".repeat(4001), "bad\u0000note", 123, false, {}])("rejects malformed new-line operational notes before pricing or writes: %p", async (operationalNote) => {
    const r = await runtime();
    expect(await r.service.update(context("bad-new-note"), r.input("bad-new-note", { lineChanges: [{ kind: "add", line: { productId: "edit-product", quantity: 1, operationalNote } }] as unknown as UpdateOrderInput["lineChanges"] }))).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(r.tx.pricing.calculate).not.toHaveBeenCalled();
    expect(r.tx.update).not.toHaveBeenCalled();
    expect(r.tx.billing.synchronizeDraftInvoice).not.toHaveBeenCalled();
    expect(r.tx.materialRequirements.freeze).not.toHaveBeenCalled();
    expect(r.tx.audit).not.toHaveBeenCalled();
    expect(r.tx.removeLinesNotIn).not.toHaveBeenCalled();
  });

  test("new-line omitted, nullable and blank notes retain the default unset state", async () => {
    const r = await runtime();
    const result = await r.service.update(context("unset-notes"), r.input("unset-notes", { lineChanges: [
      { kind: "add", line: { productId: "edit-product", quantity: 1, clientLineKey: "omitted" } },
      { kind: "add", line: { productId: "edit-product", quantity: 1, clientLineKey: "nullable", operationalNote: null } },
      { kind: "add", line: { productId: "edit-product", quantity: 1, clientLineKey: "blank", operationalNote: " \t " } },
    ] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.order.order.lines.slice(2).map((line) => line.operationalNote)).toEqual([undefined, undefined, undefined]);
    expect(r.tx.update).toHaveBeenCalledTimes(1);
  });

  test("only an explicit nullable note clears an existing note under the existing order.edit authority", async () => {
    const r = await runtime();
    const source = r.current.order.lines[0]!;
    const input = r.input("clear-note", { lineChanges: [{ kind: "update", lineId: source.lineId, line: { productId: source.productId, quantity: source.quantity, operationalNote: null } }] });
    const denied: OperationContext = { ...context("clear-note"), principal: { ...principal, authority: { membershipId: "view-only", capabilities: ["order.view"] } } };
    expect(await r.service.update(denied, input)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(r.current.order.lines[0]!.operationalNote).toBe(source.operationalNote);
    expect(r.tx.update).not.toHaveBeenCalled();
    expect(r.tx.pricing.calculate).not.toHaveBeenCalled();
    expect(await r.service.update(context("clear-note"), input)).toMatchObject({ ok: true });
    expect(r.current.order.lines[0]!.lineId).toBe(source.lineId);
    expect(r.current.order.lines[0]!.operationalNote).toBeUndefined();
    expect(r.tx.update).toHaveBeenCalledTimes(1);
  });

  test("the independent note command uses the same normalization without repricing", async () => {
    const r = await runtime({ frozen: true, routed: true });
    const source = r.current.order.lines[0]!;
    expect(await r.service.update(context("note-command"), r.input("note-command", { lineChanges: [{ kind: "update_note", lineId: source.lineId, note: "  Normalized note  " }] }))).toMatchObject({ ok: true });
    expect(r.current.order.lines[0]!.operationalNote).toBe("Normalized note");
    expect(r.current.order.lines[0]!.sellingPriceDecision).toBe(source.sellingPriceDecision);
    expect(r.tx.pricing.calculate).not.toHaveBeenCalled();
    expect(await r.service.update(context("note-command-clear"), r.input("note-command-clear", { lineChanges: [{ kind: "update_note", lineId: source.lineId, note: null }] }))).toMatchObject({ ok: true });
    expect(r.current.order.lines[0]!.operationalNote).toBeUndefined();
  });

  test("customer/contact-only header edit preserves source lines and validates tenant before writes", async () => {
    const r = await runtime();
    const source = r.current.order.lines;
    const reference = { ...customerContact, contactId: brandedId<"ContactId">("revised-contact") };
    expect(await r.service.update(context("contact"), r.input("contact", { patch: { customerContact: reference } }))).toMatchObject({ ok: true });
    expect(r.current.order.customerContact).toEqual(reference);
    expect(r.current.order.lines[0]).toBe(source[0]);
    expect(r.tx.pricing.calculate).not.toHaveBeenCalled();
    expect(r.tx.billing.synchronizeDraftInvoice.mock.calls[0]![0].customerContact).toEqual(reference);
    expect(await r.service.update(context("wrong-tenant"), r.input("wrong-tenant", { patch: { customerContact: { ...reference, organizationId: brandedId<"OrganizationId">("foreign-org") } } }))).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(r.tx.update).toHaveBeenCalledTimes(1);
  });

  test.each(["", "bad key", "x".repeat(121), null, 123])("rejects malformed add/duplicate keys %p before pricing or writes", async (key) => {
    for (const duplicate of [false, true]) {
      const r = await runtime();
      const change = duplicate ? { kind: "duplicate", sourceLineId: r.current.order.lines[0]!.lineId, clientLineKey: key }
        : { kind: "add", line: { productId: "edit-product", quantity: 1, clientLineKey: key } };
      expect(await r.service.update(context("bad-key"), r.input("bad-key", { lineChanges: [change] as UpdateOrderInput["lineChanges"] }))).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
      expect(r.tx.pricing.calculate).not.toHaveBeenCalled();
      expect(r.tx.update).not.toHaveBeenCalled();
    }
  });

  test("rejects cloned keys across add and duplicate", async () => {
    const r = await runtime();
    expect(await r.service.update(context("cloned-key"), r.input("cloned-key", { lineChanges: [
      { kind: "add", line: { productId: "edit-product", quantity: 1, clientLineKey: "cloned" } },
      { kind: "duplicate", sourceLineId: r.current.order.lines[0]!.lineId, clientLineKey: "cloned" },
    ] }))).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(r.tx.update).not.toHaveBeenCalled();
  });

  test.each([
    [], [{ lineId: "line-a" }, { lineId: "line-a" }], [{ lineId: "line-a" }, { lineId: "foreign-line" }],
    [{ lineId: "line-a" }, { clientLineKey: "unknown" }], [{ lineId: "line-a" }, { lineId: "line-b", clientLineKey: "ambiguous" }],
    [{ lineId: "line-a" }, null],
  ].map((references) => ({ references })))("requires exact final permutation and unambiguous references: $references", async ({ references }) => {
    const r = await runtime();
    expect(await r.service.update(context("bad-order"), r.input("bad-order", { finalLineOrder: references as UpdateOrderInput["finalLineOrder"] }))).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(r.tx.update).not.toHaveBeenCalled();
    expect(r.tx.billing.synchronizeDraftInvoice).not.toHaveBeenCalled();
  });

  test("accepts legacy reorder and missing optional correlations", async () => {
    const r = await runtime();
    expect(await r.service.update(context("legacy"), r.input("legacy", { lineChanges: [{ kind: "reorder", lineIds: r.current.order.lines.map((line) => line.lineId).reverse() }] }))).toMatchObject({ ok: true });
    expect(r.current.order.lines.map((line) => line.lineId)).toEqual(["line-b", "line-a"]);
    expect(await r.service.update(context("unkeyed"), r.input("unkeyed", { lineChanges: [{ kind: "duplicate", sourceLineId: r.current.order.lines[0]!.lineId }] }))).toMatchObject({ ok: true });
  });

  test("stale source and rejected final CAS cannot produce owner side effects", async () => {
    const r = await runtime();
    expect(await r.service.update(context("stale"), r.input("stale", { expectedRevision: "3", patch: { jobLabel: "Stale" } }))).toMatchObject({ ok: false, error: { code: "STALE_STATE" } });
    expect(r.tx.update).not.toHaveBeenCalled();
    const rejected = await runtime({ rejectCas: true });
    expect(await rejected.service.update(context("cas"), rejected.input("cas", { patch: { jobLabel: "Rejected" } }))).toMatchObject({ ok: false, error: { code: "STALE_STATE" } });
    expect(rejected.tx.update).toHaveBeenCalledTimes(1);
    expect(rejected.tx.billing.synchronizeDraftInvoice).not.toHaveBeenCalled();
  });

  test("retains frozen material, route removal, handoff and override authority guards", async () => {
    for (const options of [{ frozen: true }, { routed: true }]) {
      const r = await runtime(options);
      expect(await r.service.update(context("remove"), r.input("remove", { lineChanges: [{ kind: "remove", lineId: r.current.order.lines[0]!.lineId }] }))).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(r.tx.update).not.toHaveBeenCalled();
    }
    const frozen = await runtime({ frozen: true });
    expect(await frozen.service.update(context("frozen"), frozen.input("frozen", { lineChanges: [{ kind: "update", lineId: frozen.current.order.lines[0]!.lineId, line: { productId: "edit-product", quantity: 4 } }] }))).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const handoff = await runtime({ handoff: true });
    expect(await handoff.service.update(context("handoff"), handoff.input("handoff", { patch: { requestedFulfillment: null } }))).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const r = await runtime();
    const limited: OperationContext = { ...context("override"), principal: { ...principal, authority: { membershipId: "limited", capabilities: ["order.edit"] } } };
    expect(await r.service.update(limited, r.input("override", { lineChanges: [{ kind: "add", line: { productId: "edit-product", quantity: 1, selling: { kind: "total_override", totalCents: 50, reason: "Override" } } }] }))).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(r.tx.update).not.toHaveBeenCalled();
  });

  test("failed Billing result rolls the mock transaction back and permits a fresh retry", async () => {
    const options = { failBilling: true };
    const r = await runtime(options);
    const source = r.current;
    const input = r.input("billing-fails", { patch: { jobLabel: "Must roll back" } });
    const result = await r.service.update(context("billing-fails"), input);
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(r.current).toBe(source);
    expect(r.tx.update).toHaveBeenCalledTimes(1);
    expect(r.tx.audit).not.toHaveBeenCalled();
    expect(r.tx.attribute).not.toHaveBeenCalled();
    options.failBilling = false;
    expect(await r.service.update(context("billing-fails"), input)).toMatchObject({ ok: true });
    expect(r.current.order.jobLabel).toBe("Must roll back");
    expect(r.tx.update).toHaveBeenCalledTimes(2);
    expect(r.tx.audit).toHaveBeenCalledTimes(1);
  });
});

describe("canonical Job Label", () => {
  test.each(["bad\u0000label", "bad\nlabel", "bad\u007flabel", "bad\u0085label", "bad\u202elabel", "x".repeat(301), 123])("rejects invalid labels at the owner: %p", async (jobLabel) => {
    const r = await runtime();
    expect(await r.service.update(context("invalid-label"), r.input("invalid-label", { patch: { jobLabel } as UpdateOrderInput["patch"] }))).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(r.tx.update).not.toHaveBeenCalled();
  });

  test("trims, bounds, clears and recognizes no-op labels without touching commercial notes", async () => {
    expect(normalizeSalesJobLabel("x".repeat(300))).toHaveLength(300);
    const r = await runtime();
    expect(await r.service.update(context("noop-label"), r.input("noop-label", { patch: { jobLabel: "  Original job  " }, finalLineOrder: r.current.order.lines.map((line) => ({ lineId: line.lineId })) }))).toMatchObject({ ok: true });
    expect(r.tx.update).not.toHaveBeenCalled();
    expect(await r.service.update(context("clear-label"), r.input("clear-label", { patch: { jobLabel: null } }))).toMatchObject({ ok: true });
    expect(r.current.order.jobLabel).toBeUndefined();
    expect(r.current.order.terms.commercialNotes).toBe("Original commercial notes");
    expect(await r.service.update(context("blank-label"), r.input("blank-label", { patch: { jobLabel: "  " } }))).toMatchObject({ ok: true });
    expect(r.tx.update).toHaveBeenCalledTimes(1);
    expect(toSalesDocumentTermsPersistence(r.current.order.terms).termsJson).toEqual({ termsCode: "net_30" });
  });

  test("direct Order create persists the normalized label and still returns generated line correlations", async () => {
    const r = await runtime();
    const result = await r.service.create(context("create-label"), { businessRequestId: "create-label", customerContact, jobLabel: "  Created job  ", lines: [{ productId: "edit-product", quantity: 1, clientLineKey: "created", operationalNote: "x".repeat(4000) }] });
    expect(result).toMatchObject({ ok: true, value: { order: { order: { jobLabel: "Created job" } }, lineCorrelations: [{ clientLineKey: "created", orderLineId: expect.stringMatching(/^[0-9a-f-]{36}$/) }] } });
    if (result.ok) expect(result.value.order.order.lines[0]!.operationalNote).toHaveLength(4000);
  });

  test("Quote create/update/checkpoint and conversion use one header label and retain historical unset", async () => {
    const r = await runtime();
    let current: QuoteReadModel | undefined;
    const quoteTx = {
      ...r.tx,
      create: async (input: Parameters<QuoteTransaction["create"]>[0]) => { current = { quote: { ...input, currency: usd, deliveryState: "not_sent", acceptanceState: "not_accepted", lifecycleState: "open" }, number: input.number, revision: "1", checkpoints: [] }; },
      update: jest.fn<QuoteTransaction["update"]>(async (input) => { current = { ...current!, quote: { ...current!.quote, ...input }, revision: String(input.expectedRevision + 1) }; return true; }),
      read: async () => current ?? null,
      reserve: async () => ({ kind: "new" as const, request: { id: "quote-request", status: "in_progress" as const, resultJson: null } }),
      succeed: async () => undefined, allocateNumber: async () => ({ kind: "quote" as const, core: 2001n, display: "Q-2001" }),
      transition: async () => false, freezeTaxComposition: async () => current ?? null,
    };
    const quotes = new QuoteApplicationService({ transaction: async (work) => work(quoteTx as QuoteTransaction) });
    expect(await quotes.create(context("quote-create"), { businessRequestId: "quote-create", customerContact, jobLabel: "  Quote job  ", terms: { commercialNotes: "Separate notes" }, lines: [{ productId: "edit-product", quantity: 2 }] })).toMatchObject({ ok: true });
    expect(current!.quote.jobLabel).toBe("Quote job");
    expect(await quotes.update(context("quote-noop"), { businessRequestId: "quote-noop", quoteId: current!.quote.quoteId, expectedRevision: "1", patch: { jobLabel: " Quote job " } })).toMatchObject({ ok: true });
    expect(quoteTx.update).not.toHaveBeenCalled();
    expect(await quotes.update(context("quote-update"), { businessRequestId: "quote-update", quoteId: current!.quote.quoteId, expectedRevision: "1", patch: { jobLabel: "Converted job" } })).toMatchObject({ ok: true });
    const checkpoint = createQuoteLifecycleCheckpoint(current!.quote, "accept", brandedId<"QuoteCheckpointId">("accepted"), { customerDisplayName: "Fixture Customer" }, context("quote-update"));
    expect(JSON.parse(toQuoteCheckpointPersistenceEnvelope(checkpoint).canonicalPayload).commercial).toMatchObject({ jobLabel: "Converted job", terms: { commercialNotes: "Separate notes" } });
    for (const historicalUnset of [false, true]) {
      const commercial = { ...checkpoint.commercial };
      if (historicalUnset) delete commercial.jobLabel;
      const accepted = { ...checkpoint, kind: "quote_accepted" as const, commercial };
      current = { ...current!, quote: { ...current!.quote, jobLabel: "Current must not substitute", deliveryState: "sent", acceptanceState: "accepted" } };
      const conversion = new QuoteConversionApplicationService({ transaction: async (work) => work({
        order: r.tx,
        quote: { ...quoteTx, readCheckpoint: async () => accepted, appendConvertedCheckpoint: async () => undefined, createConversionLineage: async () => undefined, succeedConversion: async () => undefined } as never,
        artwork: { snapshotAccepted: async () => undefined, carryAcceptedToOrder: async () => undefined },
      }) }, r.service);
      expect(await conversion.convert(context(`convert-${historicalUnset}`), { organizationId, quoteId: current!.quote.quoteId, sourceCheckpointId: accepted.checkpointId, businessRequestId: brandedId<"BusinessRequestId">(`convert-${historicalUnset}`), expectedStateToken: current!.revision })).toMatchObject({ ok: true });
      expect(r.current.order.jobLabel).toBe(historicalUnset ? undefined : "Converted job");
    }
  });
});
