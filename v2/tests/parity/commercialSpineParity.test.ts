import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import { QuoteConversionApplicationService } from "../../src/modules/sales/quoteConversionApplication";
import { OrderApplicationService, summarizeOrderTotals, type OrderReadModel } from "../../src/modules/sales/orderApplication";
import { QuoteApplicationService, type QuoteReadModel } from "../../src/modules/sales/quoteApplication";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter";
import { brandedId, currencyCode, decimalText, type OrganizationId } from "../../src/modules/shared/commercialValues";
import type { QuoteCheckpoint, QuoteCurrentState, SalesLineSnapshot } from "../../src/modules/sales/contracts";
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
const createFixtureRuntime = () => {
  const pricing = new V2PricingParityAdapter();
  let quoteRead: QuoteReadModel | undefined;
  const checkpoints = new Map<string, QuoteCheckpoint>();
  const audits: string[] = [];
  let createdOrder: { orderId: string; lines: readonly SalesLineSnapshot[] } | undefined;
  let invoiceInput: { salesLines: readonly { productId: string; quantity: number; sellingLineAmount: { cents: number } }[] } | undefined;
  const routes: string[] = [];
  const products = {
    resolveActivePricingInput: async (input: { productId: string; quantity: number; selections?: Record<string, unknown>; dimensions?: { width: string; height: string; unit: "in" } }) => ({ ok: true as const, value: productInput(input.productId, input.quantity, input.selections, input.dimensions) }),
    resolveCurrentRoutingProduct: async (_org: OrganizationId, productId: string) => ({ productTypeId: brandedId<"ProductTypeId">(productId === "banner" ? "print-route" : "stock-no-route") }),
    resolveProductType: async (_org: OrganizationId, productTypeId: string) => ({ id: brandedId<"ProductTypeId">(productTypeId), routePolicy: productTypeId === "print-route" ? { kind: "route_required" as const, defaultRouteTemplateId: brandedId<"RouteTemplateId">("print-template") } : { kind: "no_route" as const } }),
  };
  const customers = {
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
    create: async (input: { quoteId: QuoteCurrentState["quoteId"]; number: QuoteReadModel["number"]; customerContact: typeof customerContact; purchaseOrderNumber?: string; terms: {}; lines: readonly SalesLineSnapshot[] }) => {
      quoteRead = { quote: { quoteId: input.quoteId, organizationId, customerContact: input.customerContact, purchaseOrderNumber: input.purchaseOrderNumber, currency: usd, terms: input.terms, lines: input.lines, deliveryState: "not_sent", acceptanceState: "not_accepted" }, number: input.number, revision: "1", checkpoints: [] };
    },
    read: async () => quoteRead ?? null,
    update: async () => false,
    transition: async (input: { kind: "send" | "accept"; checkpoint: QuoteCheckpoint }) => {
      if (!quoteRead) return false;
      checkpoints.set(input.checkpoint.checkpointId, input.checkpoint);
      quoteRead = { ...quoteRead, quote: { ...quoteRead.quote, deliveryState: input.kind === "send" ? "sent" : quoteRead.quote.deliveryState, acceptanceState: input.kind === "accept" ? "accepted" : quoteRead.quote.acceptanceState }, revision: String(Number(quoteRead.revision) + 1), checkpoints: [...quoteRead.checkpoints, { checkpointId: input.checkpoint.checkpointId, kind: input.checkpoint.kind, occurredAt: input.checkpoint.occurredAt }] };
      return true;
    },
  };
  const orderTx = {
    customers,
    products,
    pricing,
    billing: {
      createDraftInvoice: async (input: { salesLines: readonly { productId: string; quantity: number; sellingLineAmount: { cents: number } }[] }) => { invoiceInput = input; return { invoiceId: brandedId<"InvoiceId">("draft-invoice"), status: "created" as const, synchronizationVersion: "1" }; },
      synchronizeDraftInvoice: async () => ({ invoiceId: brandedId<"InvoiceId">("draft-invoice"), status: "unchanged" as const, synchronizationVersion: "1" }),
      readDraftForOrder: async () => null,
    },
    routing: {
      instantiateRoute: async (input: { work: { orderLineId: string } }) => { routes.push(input.work.orderLineId); return { created: true, routeInstance: { routeInstanceId: brandedId<"RouteInstanceId">(`route-${input.work.orderLineId}`), organizationId, work: { kind: "sales_order_line" as const, organizationId, orderId: brandedId<"OrderId">("dynamic"), orderLineId: brandedId<"OrderLineId">(input.work.orderLineId) }, sourceTemplate: { routeTemplateId: brandedId<"RouteTemplateId">("print-template"), revision: "1", definitionFingerprint: "sha256:route" }, state: "pending" as const, revision: "1", steps: [] } }; },
    },
    allocateNumber: async () => ({ kind: "order" as const, core: 601n, display: "O-601" }),
    create: async (input: { orderId: string; lines: readonly SalesLineSnapshot[] }) => { createdOrder = input; },
    read: async (): Promise<OrderReadModel | null> => createdOrder ? ({ order: { orderId: brandedId<"OrderId">(createdOrder.orderId), organizationId, customerContact, currency: usd, terms: {}, lines: createdOrder.lines, commercialState: "open", billingInvoiceReference: brandedId<"InvoiceId">("draft-invoice") }, number: { kind: "order", core: 601n, display: "O-601" }, revision: "1", totals: summarizeOrderTotals(createdOrder.lines, usd), draftInvoice: { invoiceId: brandedId<"InvoiceId">("draft-invoice"), lifecycle: "draft", synchronizationVersion: "1", lineCount: createdOrder.lines.length, total: summarizeOrderTotals(createdOrder.lines, usd).selling }, routes: [] }) : null,
    audit: async () => undefined,
  };
  const conversionQuote = {
    ...quoteTx,
    readCheckpoint: async (_org: OrganizationId, _quoteId: string, checkpointId: string) => checkpoints.get(checkpointId) ?? null,
    appendConvertedCheckpoint: async (input: { checkpoint: QuoteCheckpoint }) => { checkpoints.set(input.checkpoint.checkpointId, input.checkpoint); },
    createConversionLineage: async () => undefined,
    succeedConversion: async () => undefined,
  };
  return { quote: new QuoteApplicationService({ transaction: async (work) => work(quoteTx as never) }), conversion: new QuoteConversionApplicationService({ transaction: async (work) => work({ quote: conversionQuote as never, order: orderTx as never }) }, new OrderApplicationService({ transaction: async (work) => work(orderTx as never) })), get quoteRead() { return quoteRead; }, get invoiceInput() { return invoiceInput; }, get routes() { return routes; }, audits };
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
    const created = await runtime.quote.create(context("quote-create"), { businessRequestId: "quote-create", customerContact, purchaseOrderNumber: "PO-M5-001", lines: [
      { productId: "banner", quantity: 1, dimensions: { width: "36", height: "42", unit: "in" }, selections: { polePocket: "yes" } },
      { productId: "yard-sign", quantity: 6, selling: { kind: "total_override", totalCents: 525, reason: "approved fixture adjustment" } },
    ] });
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;
    const sent = await runtime.quote.send(context("quote-send"), { businessRequestId: "quote-send", quoteId: created.value.quote.quote.quoteId, expectedRevision: created.value.quote.revision });
    expect(sent.ok).toBe(true);
    if (!sent.ok) throw sent.error;
    const accepted = await runtime.quote.accept(context("quote-accept"), { businessRequestId: "quote-accept", quoteId: created.value.quote.quote.quoteId, expectedRevision: sent.value.quote.revision });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw accepted.error;
    const converted = await runtime.conversion.convert(context("quote-convert"), { organizationId, quoteId: created.value.quote.quote.quoteId, sourceCheckpointId: accepted.value.checkpointId!, businessRequestId: brandedId<"BusinessRequestId">("quote-convert"), expectedStateToken: accepted.value.quote.revision });
    expect(converted.ok).toBe(true);
    if (!converted.ok) throw converted.error;
    const quote = accepted.value.quote.quote;
    const invoiceSubtotal = runtime.invoiceInput!.salesLines.reduce((total, line) => total + line.sellingLineAmount.cents, 0);
    const v2 = {
      customer: { customerId: quote.customerContact.customerId, contactId: quote.customerContact.contactId },
      productLines: quote.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, dimensions: line.resolvedConfiguration.dimensions, selections: line.resolvedConfiguration.selections, calculatedLineCents: line.calculatedLineAmount.cents, sellingLineCents: line.sellingLineAmount.cents })),
      quote: { deliveryState: quote.deliveryState, acceptanceState: quote.acceptanceState, lineCount: quote.lines.length, calculatedTotalCents: summarizeOrderTotals(quote.lines, usd).calculated.cents, sellingTotalCents: summarizeOrderTotals(quote.lines, usd).selling.cents },
      order: { lineCount: runtime.invoiceInput!.salesLines.length, sellingTotalCents: invoiceSubtotal },
      draftInvoice: { lineCount: runtime.invoiceInput!.salesLines.length, subtotalCents: invoiceSubtotal, taxCents: 0, totalCents: invoiceSubtotal },
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
      draftInvoice: { lineCount: 2, subtotalCents: 2438, taxCents: 0, totalCents: 2438 },
      routing: { requiredProductIds: ["banner"], instantiatedCount: 1 },
    };
    const parity = compareParity({ domain: "Commercial spine", fixture: "banner-and-yard-sign-conversion", v1: v1Captured, v2, normalization: { unorderedArrayPaths: ["$.productLines"] } });
    requireParity(parity);
    expect(parity.classification).toBe("PARITY");
    expect(runtime.audits).toEqual(expect.arrayContaining(["quote_created", "quote_sent", "quote_accepted"]));
    expect(normalizeParityValue(v2)).toEqual(normalizeParityValue(v1Captured));
  });
});
