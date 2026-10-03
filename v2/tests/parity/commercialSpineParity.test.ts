import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import { QuoteConversionApplicationService, type QuoteArtworkConversionPort, type QuoteConversionTransactionRunner } from "../../src/modules/sales/quoteConversionApplication";
import { OrderApplicationService, summarizeOrderTotals, type OrderReadModel } from "../../src/modules/sales/orderApplication";
import { QuoteApplicationService, type QuoteReadModel } from "../../src/modules/sales/quoteApplication";
import { composeSalesTax } from "../../src/modules/sales/taxComposition";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter";
import { brandedId, currencyCode, decimalText, type OrganizationId } from "../../src/modules/shared/commercialValues";
import { quoteCommercialSnapshot, type QuoteCheckpoint, type QuoteCurrentState, type SalesLineSnapshot } from "../../src/modules/sales/contracts";
import { compareParity, normalizeParityValue, requireParity } from "./harness";

const organizationId = brandedId<"OrganizationId">("m5-commercial-org");
const customerContact = {
  organizationId,
  customerId: brandedId<"CustomerId">("customer-acme"),
  contactId: brandedId<"ContactId">("contact-alex"),
} as const;
const usd = currencyCode("USD");
const allCommercialCapabilities = ["quote.create", "quote.send", "quote.edit", "quote.convert", "quote.overridePrice"] as const;
const principal = { kind: "staff" as const, organizationId, userId: "staff-alex", authority: { membershipId: "membership-alex", capabilities: allCommercialCapabilities } };
const context = (request: string): OperationContext => ({ principal, organizationId, operationId: `m5-${request}`, businessRequest: { id: request, payloadFingerprint: `fixture-${request}` } });
const preparedEvidence = (read: QuoteReadModel, recipientEmail: string, documentSha256: string, customerDisplayName = "Acme") => ({
  schemaVersion: 1 as const,
  organizationId,
  quoteId: read.quote.quoteId,
  expectedRevision: read.revision,
  customerContact: read.quote.customerContact,
  commercial: quoteCommercialSnapshot(read.quote),
  customerPresentation: { customerDisplayName, contactDisplayName: "Alex", email: recipientEmail },
  organizationPresentation: { name: "Acme Print" },
  recipientEmail,
  documentSha256,
  documentNumber: read.number.display,
  documentDate: "2026-08-17",
});

const productInput = (productId: string, quantity: number, selections: Readonly<Record<string, unknown>> = {}, dimensions?: Readonly<{ width: string; height: string; unit: "in" }>) => {
  const isBanner = productId === "banner";
  const configurationId = brandedId<"PricingConfigurationId">(`${productId}-configuration`);
  return {
    sellableProduct: {
      organizationId, productId: brandedId<"ProductId">(productId), productTypeId: brandedId<"ProductTypeId">(isBanner ? "print-route" : "stock-no-route"),
      displayName: isBanner ? "Vinyl Banner" : "Yard Sign", lifecycle: "active" as const,
      pricingConfiguration: { id: configurationId, version: "v1-characterized", contentHash: `sha256:${productId}` },
      requiresDimensions: isBanner, pricingCurrency: usd,
    },
    resolvedConfiguration: {
      schemaVersion: 1 as const, organizationId, productId: brandedId<"ProductId">(productId), pricingConfigurationId: configurationId,
      pricingConfigurationVersion: "v1-characterized", pricingConfigurationContentHash: `sha256:${productId}`, quantity,
      ...(dimensions ? { dimensions: { width: decimalText(dimensions.width), height: decimalText(dimensions.height), unit: dimensions.unit } } : {}),
      selections, derivedFacts: {}, productFacts: isBanner ? { measurementMode: "dimension" } : { measurementMode: "quantity_only" },
    },
    rules: isBanner
      ? { base: { perSquareFootCents: decimalText("125") }, optionImpacts: [{ id: "pole-pocket-3in", selectionKey: "polePocket", whenValue: "yes", kind: "fixed" as const, amount: 600 }] }
      : { base: { perPieceCents: 100 } },
  };
};

/** In-memory transaction adapters exercise V2 applications without a shared database. */
const createFixtureRuntime = (options: Readonly<{ yardRouting?: "no_route" | "unconfigured"; unroutable?: boolean }> = {}) => {
  const pricing = new V2PricingParityAdapter();
  let quoteRead: QuoteReadModel | undefined;
  const checkpoints = new Map<string, QuoteCheckpoint>();
  const audits: string[] = [];
  let createdOrder: { orderId: string; lines: readonly SalesLineSnapshot[]; terms: { taxContextReference?: string } } | undefined;
  let invoiceInput: { termsCode?: string; salesLines: readonly { productId: string; quantity: number; sellingLineAmount: { cents: number } }[]; taxInput: { taxContextReference?: string } } | undefined;
  const routes: string[] = [];
  const conversionOperations = new Map<string, { id: string; resultJson: unknown | null }>();
  let productionRouteConfigured = !options.unroutable;
  let currentTaxable = true;
  let currentPaymentTerms = "net_30";
  let taxabilityReads = 0;
  let commercialPolicyReads = 0;
  const acceptedArtwork = new Set<string>();
  const artworkCarries: Parameters<QuoteArtworkConversionPort["carryAcceptedToOrder"]>[0][] = [];
  const products = {
    resolveCurrentTaxability: async (org: OrganizationId) => { expect(org).toBe(organizationId); taxabilityReads++; return { taxable: currentTaxable }; },
    resolveActivePricingInput: async (input: { productId: string; quantity: number; selections?: Record<string, unknown>; dimensions?: { width: string; height: string; unit: "in" } }) => ({ ok: true as const, value: productInput(input.productId, input.quantity, input.selections, input.dimensions) }),
    resolveCurrentRoutingProduct: async (_org: OrganizationId, productId: string) => ({ productTypeId: brandedId<"ProductTypeId">(productId === "banner" ? "print-route" : "stock-no-route") }),
    resolveProductType: async (_org: OrganizationId, productTypeId: string) => ({ id: brandedId<"ProductTypeId">(productTypeId), routePolicy: productTypeId === "print-route" ? { kind: "route_required" as const, defaultRouteTemplateId: brandedId<"RouteTemplateId">("print-template") } : options.yardRouting === "unconfigured" ? { kind: "unconfigured" as const } : { kind: "no_route" as const } }),
    // Existing parity fixtures predate version-bound routing.  Model the
    // compatibility reader explicitly so conversion stays pinned to the
    // priced Product Version instead of consulting mutable Product Type state.
    resolveVersionRoutingPolicy: async (_org: OrganizationId, productId: string) => productId === "banner"
      ? { kind: "route_required" as const, routeTemplateId: brandedId<"RouteTemplateId">("print-template"), routeTemplateName: "Print route", sourceTemplateRevision: "1", sourceTemplateFingerprint: "sha256:route", steps: [{ position: 0, kind: "production" as const }] }
      : options.yardRouting === "unconfigured"
        ? { kind: "unconfigured" as const }
        : { kind: "no_route" as const },
    resolveOrderRoutability: async (_org: OrganizationId, productId: string) => {
      if (productId === "unroutable" && !productionRouteConfigured)
        return { kind: "unroutable" as const, productName: "Unroutable production Product" };
      const routing = productId === "banner"
        ? { kind: "route_required" as const, routeTemplateId: brandedId<"RouteTemplateId">("print-template"), routeTemplateName: "Print route", sourceTemplateRevision: "1", sourceTemplateFingerprint: "sha256:route", steps: [{ position: 0, kind: "production" as const }] }
        : options.yardRouting === "unconfigured"
          ? { kind: "unconfigured" as const }
          : { kind: "no_route" as const };
      return { kind: "routable" as const, productName: productId === "banner" ? "Vinyl Banner" : "Yard Sign", productTypeId: brandedId<"ProductTypeId">(productId === "banner" ? "print-route" : "stock-no-route"), routing };
    },
  };
  const customers = {
    getCommercialPolicy: async (org: OrganizationId, customerId: string) => { expect(org).toBe(organizationId); expect(customerId).toBe(customerContact.customerId); commercialPolicyReads++; return { paymentTerms: currentPaymentTerms }; },
    validateContactReference: async () => true,
    getPresentationIdentity: async () => ({ customerDisplayName: "Acme Signs", contactDisplayName: "Alex" }),
  };
  const quoteTx = {
    customers,
    products,
    pricing,
    reserve: async () => ({ kind: "new" as const, request: { id: "quote-operation", status: "in_progress" as const, resultJson: null } }),
    succeed: async () => undefined,
    attribute: async () => undefined,
    audit: async (input: { event: { eventType: string } }) => { audits.push(input.event.eventType); },
    allocateNumber: async () => ({ kind: "quote" as const, core: 501n, display: "Q-501" }),
    create: async (input: { quoteId: QuoteCurrentState["quoteId"]; number: QuoteReadModel["number"]; customerContact: typeof customerContact; purchaseOrderNumber?: string; terms: { taxContextReference?: string }; lines: readonly SalesLineSnapshot[] }) => {
      // The captured fixture uses a configured zero-rate receipt jurisdiction,
      // not missing tax policy. Use the owner's calculator for document evidence.
      const taxComposition = composeSalesTax({ lines: input.lines.map((line) => ({ lineId: line.lineId, amountCents: line.sellingLineAmount.cents, taxable: line.taxability!.taxable })), exemption: { exempt: false }, resolution: { status: "resolved", receiptLocation: { country: "US", region: "OR" }, jurisdiction: { jurisdictionId: "m5-zero-rate", name: "Fixture zero-rate jurisdiction", receiptLocation: { country: "US", region: "OR" }, rateBasisPoints: 0, active: true, homeBusiness: true } } });
      quoteRead = { quote: { quoteId: input.quoteId, organizationId, customerContact: input.customerContact, purchaseOrderNumber: input.purchaseOrderNumber, currency: usd, terms: input.terms, lines: input.lines, taxComposition, deliveryState: "not_sent", acceptanceState: "not_accepted", lifecycleState: "open" }, number: input.number, revision: "1", checkpoints: [] };
    },
    read: async () => quoteRead ?? null,
    update: async () => false,
    transition: async (input: { kind: "send" | "accept" | "decline" | "void"; checkpoint: QuoteCheckpoint }) => {
      if (!quoteRead) return false;
      checkpoints.set(input.checkpoint.checkpointId, input.checkpoint);
      quoteRead = { ...quoteRead, quote: { ...quoteRead.quote, deliveryState: input.kind === "send" ? "sent" : quoteRead.quote.deliveryState, acceptanceState: input.kind === "accept" ? "accepted" : quoteRead.quote.acceptanceState, lifecycleState: input.kind === "decline" ? "declined" : input.kind === "void" ? "voided" : quoteRead.quote.lifecycleState }, revision: String(Number(quoteRead.revision) + 1), checkpoints: [...quoteRead.checkpoints, { checkpointId: input.checkpoint.checkpointId, kind: input.checkpoint.kind, occurredAt: input.checkpoint.occurredAt }] };
      return true;
    },
  };
  const orderTx = {
    customers,
    products,
    pricing,
    // The captured V1 fixtures deliberately have no version-bound recipe.
    // P7B treats that as a valid zero-requirement Product rather than
    // inventing a physical requirement during commercial conversion.
    materialRequirements: { freeze: async () => undefined, hasFrozen: async () => false },
    billing: {
      createDraftInvoice: async (input: { termsCode?: string; salesLines: readonly { productId: string; quantity: number; sellingLineAmount: { cents: number } }[]; taxInput: { taxContextReference?: string } }) => { invoiceInput = input; return { invoiceId: brandedId<"InvoiceId">("draft-invoice"), status: "created" as const, synchronizationVersion: "1" }; },
      synchronizeDraftInvoice: async () => ({ invoiceId: brandedId<"InvoiceId">("draft-invoice"), status: "unchanged" as const, synchronizationVersion: "1" }),
      readDraftForOrder: async () => null,
    },
    routing: {
      instantiateRoute: async (input: { work: { orderLineId: string } }) => { routes.push(input.work.orderLineId); return { created: true, routeInstance: { routeInstanceId: brandedId<"RouteInstanceId">(`route-${input.work.orderLineId}`), organizationId, work: { kind: "sales_order_line" as const, organizationId, orderId: brandedId<"OrderId">("dynamic"), orderLineId: brandedId<"OrderLineId">(input.work.orderLineId) }, sourceTemplate: { routeTemplateId: brandedId<"RouteTemplateId">("print-template"), revision: "1", definitionFingerprint: "sha256:route" }, state: "pending" as const, revision: "1", steps: [] } }; },
    },
    allocateNumber: async () => ({ kind: "order" as const, core: 601n, display: "O-601" }),
    create: async (input: { orderId: string; lines: readonly SalesLineSnapshot[]; terms: { taxContextReference?: string } }) => { createdOrder = input; },
    read: async (): Promise<OrderReadModel | null> => createdOrder ? ({ order: { orderId: brandedId<"OrderId">(createdOrder.orderId), organizationId, customerContact, currency: usd, terms: createdOrder.terms, lines: createdOrder.lines, commercialState: "open", billingInvoiceReference: brandedId<"InvoiceId">("draft-invoice") }, number: { kind: "order", core: 601n, display: "O-601" }, revision: "1", totals: summarizeOrderTotals(createdOrder.lines, usd), draftInvoice: { invoiceId: brandedId<"InvoiceId">("draft-invoice"), lifecycle: "draft", synchronizationVersion: "1", lineCount: createdOrder.lines.length, total: summarizeOrderTotals(createdOrder.lines, usd).selling }, routes: [] }) : null,
    audit: async () => undefined,
  };
  const conversionQuote = {
    ...quoteTx,
    reserve: async (input: { operation: string; businessRequestId: string }) => {
      const key = `${input.operation}:${input.businessRequestId}`;
      const existing = conversionOperations.get(key);
      if (existing?.resultJson)
        return { kind: "replay" as const, request: { id: existing.id, status: "succeeded" as const, resultJson: existing.resultJson } };
      if (existing)
        return { kind: "new" as const, request: { id: existing.id, status: "in_progress" as const, resultJson: null } };
      const request = { id: key, resultJson: null };
      conversionOperations.set(key, request);
      return { kind: "new" as const, request: { id: request.id, status: "in_progress" as const, resultJson: null } };
    },
    readCheckpoint: async (_org: OrganizationId, _quoteId: string, checkpointId: string) => checkpoints.get(checkpointId) ?? null,
    appendConvertedCheckpoint: async (input: { checkpoint: QuoteCheckpoint }) => {
      checkpoints.set(input.checkpoint.checkpointId, input.checkpoint);
      if (quoteRead) quoteRead = { ...quoteRead, checkpoints: [...quoteRead.checkpoints, { checkpointId: input.checkpoint.checkpointId, kind: input.checkpoint.kind, occurredAt: input.checkpoint.occurredAt }] };
    },
    createConversionLineage: async (input: { orderId: string }) => {
      if (quoteRead) quoteRead = { ...quoteRead, quote: { ...quoteRead.quote, convertedOrderId: brandedId<"OrderId">(input.orderId) } };
    },
    succeedConversion: async (_org: string, requestId: string, _quoteId: string, result: unknown) => {
      const operation = conversionOperations.get(requestId);
      if (operation) operation.resultJson = result;
    },
  };
  // This captured fixture has no Artwork. Retain the empty acceptance checkpoint
  // and validate the complete Sales line map at the Artwork operation boundary.
  const artwork: QuoteArtworkConversionPort = {
    snapshotAccepted: async (org, quoteId, checkpointId) => {
      expect(org).toBe(organizationId);
      expect(checkpoints.get(checkpointId)).toMatchObject({ kind: "quote_accepted", sourceDocument: { quoteId } });
      acceptedArtwork.add(checkpointId);
    },
    carryAcceptedToOrder: async (input) => {
      expect(acceptedArtwork.has(input.acceptanceCheckpointId)).toBe(true);
      expect([...input.lineMap.keys()]).toEqual(quoteRead!.quote.lines.map((line) => line.lineId));
      expect([...input.lineMap.values()]).toEqual(createdOrder!.lines.map((line) => line.lineId));
      artworkCarries.push(input);
    },
  };
  const conversionRunner: QuoteConversionTransactionRunner = {
    transaction: async (action) => {
      const before = { quoteRead, createdOrder, invoiceInput, checkpoints: new Map(checkpoints), operations: new Map([...conversionOperations].map(([key, value]) => [key, { ...value }])), acceptedArtwork: new Set(acceptedArtwork), routes: routes.length, audits: audits.length, artworkCarries: artworkCarries.length };
      try { return await action({ quote: conversionQuote as never, order: orderTx as never, artwork }); }
      catch (error) {
        quoteRead = before.quoteRead; createdOrder = before.createdOrder; invoiceInput = before.invoiceInput;
        checkpoints.clear(); before.checkpoints.forEach((value, key) => checkpoints.set(key, value));
        conversionOperations.clear(); before.operations.forEach((value, key) => conversionOperations.set(key, value));
        acceptedArtwork.clear(); before.acceptedArtwork.forEach((value) => acceptedArtwork.add(value));
        routes.length = before.routes; audits.length = before.audits; artworkCarries.length = before.artworkCarries;
        throw error;
      }
    },
  };
  return { quote: new QuoteApplicationService({ transaction: async (work) => work(quoteTx as never) }), conversion: new QuoteConversionApplicationService(conversionRunner, new OrderApplicationService({ transaction: async (work) => work(orderTx as never) })), setCurrentPolicies() { currentTaxable = false; currentPaymentTerms = "due_on_receipt"; }, setProductionRouteConfigured(value: boolean) { productionRouteConfigured = value; }, get quoteRead() { return quoteRead; }, get createdOrder() { return createdOrder; }, get invoiceInput() { return invoiceInput; }, get routes() { return routes; }, get policyReads() { return { taxabilityReads, commercialPolicyReads }; }, audits, acceptedArtwork, artworkCarries };
};

describe("M5 commercial spine parity baseline", () => {
  test("normalizes only architecture noise and reports material drift by field", () => {
    const parity = compareParity({ domain: "Pricing", fixture: "normalization-guard", v1: { orderId: "v1", totalCents: 12500, lines: [{ lineId: "one", productId: "banner" }] }, v2: { orderId: "v2", totalCents: 12500, lines: [{ lineId: "two", productId: "banner" }] } });
    expect(parity.classification).toBe("PARITY");
    const drift = compareParity({ domain: "Pricing", fixture: "material-guard", v1: { totalCents: 12500 }, v2: { totalCents: 12750 } });
    expect(drift).toMatchObject({ classification: "UNCLASSIFIED_DRIFT", drifts: [{ path: "totalCents", v1: 12500, v2: 12750 }] });
    const identityDrift = compareParity({ domain: "Customer", fixture: "identity-guard", v1: { customer: { id: "acme" } }, v2: { customer: { id: "other" } } });
    expect(identityDrift).toMatchObject({ classification: "UNCLASSIFIED_DRIFT", drifts: [{ path: "customer.id", v1: "acme", v2: "other" }] });
    const reviewedDifference = compareParity({ domain: "Fulfillment", fixture: "reviewed-difference-guard", v1: { legacyCapAllowed: false }, v2: { legacyCapAllowed: true }, classificationWhenDrift: "INTENTIONAL_DIFFERENCE" });
    expect(reviewedDifference).toMatchObject({ classification: "INTENTIONAL_DIFFERENCE", drifts: [{ path: "legacyCapAllowed", v1: false, v2: true }] });
  });

  test.each([
    ["quantity-only-yard-sign", productInput("yard-sign", 6), 600],
    ["dimension-banner-base", productInput("banner", 1, {}, { width: "36", height: "42", unit: "in" }), 1313],
    ["dimension-banner-fixed-option", productInput("banner", 1, { polePocket: "yes" }, { width: "36", height: "42", unit: "in" }), 1913],
  ])("compares captured V1 pricing vector %s through the V2 evaluator", async (fixture, input, expectedCents) => {
    const result = await new V2PricingParityAdapter().calculate({
      organizationId,
      sellableProduct: input.sellableProduct,
      resolvedConfiguration: input.resolvedConfiguration,
      pricingContext: { channel: "staff", effectiveAt: "2026-08-17T00:00:00.000Z" },
      rules: input.rules,
    });
    const parity = compareParity({
      domain: "Pricing",
      fixture,
      v1: { productId: input.sellableProduct.productId, quantity: input.resolvedConfiguration.quantity, calculatedLineCents: expectedCents },
      v2: { productId: result.normalizedInput.productId, quantity: result.normalizedInput.quantity, calculatedLineCents: result.calculatedLineAmount.cents },
    });
    requireParity(parity);
  });

  test("replays captured V1 commercial fixture through V2 Quote lifecycle and conversion", async () => {
    const runtime = createFixtureRuntime();
    const created = await runtime.quote.create(context("quote-create"), { businessRequestId: "quote-create", customerContact, purchaseOrderNumber: "PO-M5-001", terms: { taxContextReference: "tax-context-m5" }, lines: [
      { productId: "banner", quantity: 1, dimensions: { width: "36", height: "42", unit: "in" }, selections: { polePocket: "yes" } },
      { productId: "yard-sign", quantity: 6, selling: { kind: "total_override", totalCents: 525, reason: "approved fixture adjustment" } },
    ] });
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;
    const sent = await runtime.quote.recordDelivered(context("quote-send"), { businessRequestId: "quote-send", quoteId: created.value.quote.quote.quoteId, expectedRevision: created.value.quote.revision, deliveryAttemptId: "fixture-delivery-1", providerMessageId: "fixture-message-1", preparedSnapshot: preparedEvidence(created.value.quote, "alex@example.test", `sha256:${"1".repeat(64)}`) });
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw sent.error;
    runtime.setCurrentPolicies();
    const accepted = await runtime.conversion.accept(context("quote-accept"), { businessRequestId: "quote-accept", quoteId: created.value.quote.quote.quoteId, expectedRevision: sent.value.quote.revision });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw accepted.error;
    const replay = await runtime.conversion.accept(context("quote-accept"), { businessRequestId: "quote-accept", quoteId: created.value.quote.quote.quoteId, expectedRevision: sent.value.quote.revision });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw replay.error;
    expect(replay.value.orderId).toBe(accepted.value.orderId);
    expect(runtime.policyReads).toEqual({ taxabilityReads: 2, commercialPolicyReads: 1 });
    expect(runtime.createdOrder?.terms).toEqual({ taxContextReference: "tax-context-m5", termsCode: "net_30" });
    expect(runtime.invoiceInput?.termsCode).toBe("net_30");
    expect(accepted.value.quote.quote.taxComposition).toMatchObject({ status: "resolved", taxableLineCents: 2438, taxCents: 0, finalTotalCents: 2438 });
    expect(runtime.createdOrder?.lines.map((line) => line.taxability)).toEqual([{ taxable: true, source: "product" }, { taxable: true, source: "product" }]);
    expect(runtime.artworkCarries).toHaveLength(1);
    expect(runtime.artworkCarries[0]).toMatchObject({ organizationId, orderId: accepted.value.orderId });
    expect(runtime.acceptedArtwork.size).toBe(1);
    const quote = accepted.value.quote.quote;
    const invoiceSubtotal = runtime.invoiceInput!.salesLines.reduce((total, line) => total + line.sellingLineAmount.cents, 0);
    const v2 = {
      customer: { customerId: quote.customerContact.customerId, contactId: quote.customerContact.contactId },
      productLines: quote.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, dimensions: line.resolvedConfiguration.dimensions, selections: line.resolvedConfiguration.selections, calculatedLineCents: line.calculatedLineAmount.cents, sellingLineCents: line.sellingLineAmount.cents })),
      quote: { deliveryState: quote.deliveryState, acceptanceState: quote.acceptanceState, lineCount: quote.lines.length, calculatedTotalCents: summarizeOrderTotals(quote.lines, usd).calculated.cents, sellingTotalCents: summarizeOrderTotals(quote.lines, usd).selling.cents },
      order: { lineCount: runtime.invoiceInput!.salesLines.length, sellingTotalCents: invoiceSubtotal },
      draftInvoice: { lineCount: runtime.invoiceInput!.salesLines.length, taxContextReference: runtime.invoiceInput!.taxInput.taxContextReference, subtotalCents: invoiceSubtotal, taxCents: 0, totalCents: invoiceSubtotal },
      routing: { requiredProductIds: quote.lines.filter((line) => line.productId === "banner").map((line) => line.productId), instantiatedCount: runtime.routes.length },
    };
    const v1Captured = {
      customer: { customerId: "customer-acme", contactId: "contact-alex" },
      productLines: [
        { productId: "banner", quantity: 1, dimensions: { width: "36", height: "42", unit: "in" }, selections: { polePocket: "yes" }, calculatedLineCents: 1913, sellingLineCents: 1913 },
        { productId: "yard-sign", quantity: 6, selections: {}, calculatedLineCents: 600, sellingLineCents: 525 },
      ],
      quote: { deliveryState: "sent", acceptanceState: "accepted", lineCount: 2, calculatedTotalCents: 2513, sellingTotalCents: 2438 },
      order: { lineCount: 2, sellingTotalCents: 2438 },
      draftInvoice: { lineCount: 2, taxContextReference: "tax-context-m5", subtotalCents: 2438, taxCents: 0, totalCents: 2438 },
      routing: { requiredProductIds: ["banner"], instantiatedCount: 1 },
    };
    const parity = compareParity({ domain: "Commercial spine", fixture: "banner-and-yard-sign-conversion", v1: v1Captured, v2, normalization: { unorderedArrayPaths: ["$.productLines"] } });
    requireParity(parity);
    expect(parity.classification).toBe("PARITY");
    expect(runtime.audits).toEqual(["quote_created", "quote_sent", "quote_converted"]);
    expect(normalizeParityValue(v2)).toEqual(normalizeParityValue(v1Captured));
  });

  test("converts an accepted Quote without synthesizing Routing when its Product Type is unconfigured", async () => {
    const runtime = createFixtureRuntime({ yardRouting: "unconfigured" });
    const created = await runtime.quote.create(context("unconfigured-create"), {
      businessRequestId: "unconfigured-create", customerContact,
      lines: [{ productId: "yard-sign", quantity: 1 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;
    const sent = await runtime.quote.recordDelivered(context("unconfigured-send"), {
      businessRequestId: "unconfigured-send", quoteId: created.value.quote.quote.quoteId,
      expectedRevision: created.value.quote.revision, deliveryAttemptId: "fixture-delivery-2", providerMessageId: "fixture-message-2",
      preparedSnapshot: preparedEvidence(created.value.quote, "alex@example.test", `sha256:${"2".repeat(64)}`),
    });
    if (!sent.ok) throw sent.error;
    expect(sent.ok).toBe(true);
    const accepted = await runtime.conversion.accept(context("unconfigured-accept"), {
      businessRequestId: "unconfigured-accept", quoteId: created.value.quote.quote.quoteId,
      expectedRevision: sent.value.quote.revision,
    });
    expect(accepted.ok).toBe(true);
    expect(runtime.routes).toEqual([]);
    expect(runtime.invoiceInput?.salesLines).toHaveLength(1);
  });

  test("rejects an unroutable production Product before creating any Order or Draft Invoice", async () => {
    const runtime = createFixtureRuntime({ unroutable: true });
    const created = await runtime.quote.create(context("unroutable-create"), {
      businessRequestId: "unroutable-create", customerContact,
      lines: [{ productId: "unroutable", quantity: 1 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;
    const sent = await runtime.quote.recordDelivered(context("unroutable-send"), {
      businessRequestId: "unroutable-send", quoteId: created.value.quote.quote.quoteId,
      expectedRevision: created.value.quote.revision, deliveryAttemptId: "fixture-delivery-unroutable", providerMessageId: "fixture-message-unroutable",
      preparedSnapshot: preparedEvidence(created.value.quote, "alex@example.test", `sha256:${"3".repeat(64)}`),
    });
    if (!sent.ok) throw sent.error;
    expect(sent.ok).toBe(true);
    const accepted = await runtime.conversion.accept(context("unroutable-accept"), {
      businessRequestId: "unroutable-accept", quoteId: created.value.quote.quote.quoteId,
      expectedRevision: sent.value.quote.revision,
    });
    expect(accepted).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(runtime.createdOrder).toBeUndefined();
    expect(runtime.invoiceInput).toBeUndefined();
    expect(runtime.routes).toEqual([]);
    expect(runtime.quoteRead?.quote.acceptanceState).toBe("not_accepted");
    expect(runtime.quoteRead?.revision).toBe(sent.value.quote.revision);
    expect(runtime.quoteRead?.checkpoints.map((item) => item.kind)).toEqual(["quote_sent"]);
    expect(runtime.acceptedArtwork.size).toBe(0);
    expect(runtime.artworkCarries).toEqual([]);
    expect(runtime.audits).toEqual(["quote_created", "quote_sent"]);

    // A sent Quote is not rewritten. Once a legitimate canonical route is
    // supplied, the same frozen Product Version can pass conversion.
    runtime.setProductionRouteConfigured(true);
    const repaired = await runtime.conversion.accept(context("unroutable-repaired"), {
      businessRequestId: "unroutable-repaired", quoteId: created.value.quote.quote.quoteId,
      expectedRevision: sent.value.quote.revision,
    });
    expect(repaired.ok).toBe(true);
  });
});
