import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { capabilityIds } from "../../src/authorization/capabilities";
import { QuoteConversionApplicationService, createQuoteConversionTrace } from "../../src/modules/sales/quoteConversionApplication";
import { OrderApplicationService } from "../../src/modules/sales/orderApplication";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter";
import { composeSalesTax } from "../../src/modules/sales/taxComposition";

const conversionFixture = async (failAt?: string) => {
  const organizationId = "contract-org";
  const customerContact = { organizationId, customerId: "customer-a", contactId: "contact-a" };
  const context: any = { organizationId, operationId: "operation-a", businessRequest: { id: "business-request-a", payloadFingerprint: "request-fingerprint" }, principal: { kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "member-a", capabilities: ["quote.edit", "quote.convert"] } } };
  const resolvedConfiguration: any = { schemaVersion: 1, organizationId, productId: "product-a", pricingConfigurationId: "version-a", pricingConfigurationVersion: "1", pricingConfigurationContentHash: "sha256:version-a", quantity: 2, selections: {}, derivedFacts: {}, productFacts: { measurementMode: "quantity_only" } };
  const pricingResult = await new V2PricingParityAdapter().calculate({ organizationId, resolvedConfiguration, sellableProduct: { organizationId, productId: "product-a", displayName: "Product", lifecycle: "active", requiresDimensions: false, pricingCurrency: "USD", pricingConfiguration: { id: "version-a", version: "1", contentHash: "sha256:version-a" } }, pricingContext: { channel: "staff", effectiveAt: "2026-09-01T00:00:00.000Z" }, rules: { base: { perPieceCents: 100 } } } as any);
  const line: any = { lineId: "quote-line-a", productId: "product-a", description: "Product", quantity: 2, resolvedConfiguration, pricingResult, sellingPriceDecision: { kind: "calculated", pricingResultId: pricingResult.id, calculatedUnitAmount: pricingResult.calculatedUnitAmount, calculatedLineAmount: pricingResult.calculatedLineAmount, resultingUnitAmount: pricingResult.calculatedUnitAmount, resultingLineAmount: pricingResult.calculatedLineAmount, decidedAt: "2026-09-01T00:00:00.000Z" }, calculatedLineAmount: pricingResult.calculatedLineAmount, sellingLineAmount: pricingResult.calculatedLineAmount, taxability: { taxable: true, source: "product" } };
  const taxComposition = composeSalesTax({ lines: [{ lineId: line.lineId, amountCents: line.sellingLineAmount.cents, taxable: true }], exemption: { exempt: false }, resolution: { status: "resolved", receiptLocation: { country: "US", region: "OR" }, jurisdiction: { jurisdictionId: "jurisdiction-a", name: "Zero rate", receiptLocation: { country: "US", region: "OR" }, rateBasisPoints: 0, active: true, homeBusiness: true } } });
  const initial = { quote: { quoteId: "quote-a", organizationId, customerContact, currency: "USD", terms: {}, lines: [line], taxComposition, deliveryState: "sent", acceptanceState: "not_accepted", lifecycleState: "open" }, revision: "1", checkpoints: [] };
  let state: any = { quoteRead: initial, checkpoints: [], orderRead: null, invoice: null, lineage: null, artwork: [] };
  const calls: string[] = [], messages: string[] = [];
  const step = (name: string) => { calls.push(name); if (name === failAt) throw Object.assign(new Error("secret customer email token SQL must not be logged"), { code: "23505", constraint: "contract_constraint" }); };
  const customers = { validateContactReference: async () => true, getPresentationIdentity: async () => ({ customerDisplayName: "Customer", contactDisplayName: "Contact" }) };
  const forbidden = async () => { throw new Error("Frozen conversion must not reprice or resolve mutable configuration"); };
  const orderTx: any = {
    customers, pricing: { calculate: forbidden }, products: { resolveActivePricingInput: forbidden, resolveOrderRoutability: async () => { step("routing_resolution"); return { kind: "routable", productName: "Product", routing: { kind: "no_route" } }; } },
    allocateNumber: async () => ({ kind: "order", core: 1000n, display: "ORD-1000" }),
    create: async (input: any) => { step("order_persistence"); state.orderRead = { order: { ...input, commercialState: "open" }, number: input.number, revision: "1" }; },
    materialRequirements: { freeze: async () => { step("material_freeze"); } },
    billing: { createDraftInvoice: async (input: any) => { step("draft_invoice"); state.invoice = input; return { status: "created", invoiceId: "invoice-a" }; } },
    read: async () => state.orderRead, audit: async () => undefined, attribute: async () => undefined,
  };
  const quoteTx: any = {
    customers,
    reserve: async () => ({ kind: "new", request: { id: "request-a" } }), read: async () => state.quoteRead,
    transition: async (input: any) => { step("acceptance_checkpoint"); state.checkpoints.push(input.checkpoint); state.quoteRead = { ...state.quoteRead, quote: { ...state.quoteRead.quote, acceptanceState: "accepted" }, revision: "2" }; return true; },
    readCheckpoint: async (_org: string, _quote: string, id: string) => state.checkpoints.find((item: any) => item.checkpointId === id),
    appendConvertedCheckpoint: async (input: any) => { step("conversion_link"); state.checkpoints.push(input.checkpoint); },
    createConversionLineage: async (input: any) => { state.lineage = input; state.quoteRead = { ...state.quoteRead, quote: { ...state.quoteRead.quote, convertedOrderId: input.orderId } }; },
    succeedConversion: async () => { step("durable_request_completed"); }, audit: async () => undefined, attribute: async () => undefined,
  };
  const artwork: any = { snapshotAccepted: async (...args: unknown[]) => { step("accepted_artwork_snapshot"); state.artwork.push(args); }, carryAcceptedToOrder: async (input: unknown) => { step("artwork_lineage"); state.artwork.push(input); } };
  let transactions = 0;
  const runner: any = { transaction: async (action: any) => {
    transactions++; calls.push("begin"); const before = structuredClone(state);
    try { const result = await action({ quote: quoteTx, order: orderTx, artwork }); calls.push("commit"); return result; }
    catch (error) { state = before; calls.push("rollback"); throw error; }
  } };
  const orders = new OrderApplicationService({ transaction: async () => { throw new Error("Order core must reuse the conversion transaction"); } });
  const service = new QuoteConversionApplicationService(runner, orders);
  return { accept: () => service.accept(context, { quoteId: "quote-a", expectedRevision: "1", businessRequestId: "business-request-a" } as any, createQuoteConversionTrace({ requestId: "trace-a", sink: message => messages.push(message) })),
    corruptAcceptedCheckpoint: (kind?: "quote_sent") => {
      state.quoteRead = { ...initial, quote: { ...initial.quote, acceptanceState: "accepted" }, checkpoints: [{ kind: "quote_accepted", checkpointId: "missing-or-invalid" }] };
      state.checkpoints = kind ? [{ kind, checkpointId: "missing-or-invalid" }] : [];
    }, state: () => state, transactions: () => transactions, initial, line, calls, messages };
};

describe("M1.10 Quote to Order conversion contract", () => {
  test("uses the explicit conversion capability rather than order-create authority", () => {
    expect(capabilityIds).toContain("quote.convert");
  });

  test("acceptance creates the accepted checkpoint and canonical Order in one transaction without recalculating pricing", async () => {
    const fixture = await conversionFixture();
    const result = await fixture.accept();
    expect(result).toMatchObject({ ok: true });
    expect(fixture.transactions()).toBe(1);
    const state = fixture.state();
    const [accepted, converted] = state.checkpoints;
    expect(accepted).toMatchObject({ kind: "quote_accepted", sourceDocument: { quoteId: "quote-a" }, commercial: { lines: [fixture.line], taxComposition: fixture.initial.quote.taxComposition } });
    expect(converted).toMatchObject({ kind: "quote_converted", sourceCheckpointId: accepted.checkpointId, commercial: accepted.commercial });
    const orderLine = state.orderRead.order.lines[0];
    expect(orderLine.lineId).not.toBe(fixture.line.lineId);
    expect(orderLine.pricingResult).toEqual(fixture.line.pricingResult);
    expect(orderLine.resolvedConfiguration).toEqual(fixture.line.resolvedConfiguration);
    expect(state.orderRead.order.taxComposition).toEqual(accepted.commercial.taxComposition);
    expect(state.invoice.salesLines[0].sellingLineAmount).toEqual(fixture.line.sellingLineAmount);
    expect(state.artwork[0]).toEqual(["contract-org", "quote-a", accepted.checkpointId]);
    expect(state.artwork[1].lineMap.get(fixture.line.lineId)).toBe(orderLine.lineId);
    expect(state.lineage).toMatchObject({ sourceCheckpointId: accepted.checkpointId, convertedCheckpointId: converted.checkpointId, orderId: state.orderRead.order.orderId });
    expect(result).toMatchObject({ ok: true, value: { quoteId: "quote-a", sourceCheckpointId: accepted.checkpointId, conversionCheckpointId: converted.checkpointId, orderId: state.orderRead.order.orderId, draftInvoiceId: "invoice-a", orderNumber: "ORD-1000", quote: state.quoteRead } });
    if (result.ok) expect(Object.keys(result.value).sort()).toEqual(["conversionCheckpointId", "draftInvoiceId", "orderId", "orderNumber", "quote", "quoteId", "sourceCheckpointId"]);
    expect(fixture.calls.indexOf("material_freeze")).toBeLessThan(fixture.calls.indexOf("draft_invoice"));
    expect(fixture.calls.at(-1)).toBe("commit");
    expect(fixture.messages).toContain("V2_QUOTE_CONVERSION_TRACE request=trace-a stage=transaction result=committed");
  });

  test("acceptance uses an opaque plaintext trace without changing its response contract", async () => {
    const messages: string[] = [];
    const trace = createQuoteConversionTrace({ requestId: "trace-a", sink: message => messages.push(message) });
    trace.durableRequest("secret-business-request", "new");
    trace.failure("draft_invoice", { code: "23505", constraint: "unsafe customer token SQL", message: "secret email cookie" });
    expect(messages[0]).toMatch(/^V2_QUOTE_CONVERSION_TRACE request=trace-a stage=durable_request result=ok durable=[a-f0-9]{16}$/);
    expect(messages[1]).toBe("V2_QUOTE_CONVERSION_TRACE request=trace-a stage=draft_invoice result=failed class=DATABASE_CONSTRAINT");
    expect(messages.join("\n")).not.toMatch(/secret|customer|email|token|cookie|sql/i);
    const brokenSink = createQuoteConversionTrace({ sink: () => { throw new Error("unavailable"); } });
    expect(() => brokenSink.event("transaction", "rolled_back")).not.toThrow();
  });

  test("an already accepted Quote requires an accepted checkpoint, not missing or sent evidence", async () => {
    for (const kind of [undefined, "quote_sent"] as const) {
      const fixture = await conversionFixture();
      fixture.corruptAcceptedCheckpoint(kind);
      const before = structuredClone(fixture.state());
      await expect(fixture.accept()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(fixture.state()).toEqual(before);
      expect(fixture.calls).toEqual(["begin", "rollback"]);
    }
  });

  test("accepted and converted commercial evidence remains pinned to the sent tax composition", async () => {
    const quote = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteApplication.ts"), "utf8");
    const conversion = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteConversionApplication.ts"), "utf8");

    // The sent checkpoint captures the exact composition committed at the
    // customer-document boundary.  Acceptance and conversion consume that
    // evidence rather than consulting mutable tenant tax settings again.
    expect(quote).toMatch(/quote\.taxComposition \? \{ taxComposition: quote\.taxComposition \} : \{\}/);
    expect(conversion).toMatch(/taxComposition: source\.commercial\.taxComposition/);
    expect(conversion).toMatch(/commercial: source\.commercial/);
    expect(conversion).not.toMatch(/composePostgresSalesTax|resolveTaxJurisdiction|TaxSettings/);
  });

  test("duplicating a Quote creates a fresh mutable document without copying its frozen tax snapshot", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteApplication.ts"), "utf8");
    const duplicate = source.slice(source.indexOf("async duplicate("), source.indexOf("async update(", source.indexOf("async duplicate(")));

    expect(duplicate).toMatch(/await tx\.create\(/);
    expect(duplicate).not.toMatch(/taxComposition:/);
    expect(duplicate).not.toMatch(/convertedOrderId/);
  });

  test("the normal Quote HTTP and UI flows do not expose standalone acceptance or conversion", async () => {
    const routes = await readFile(path.join(process.cwd(), "v2", "src", "interfaces", "http", "quoteRoutes.ts"), "utf8");
    const ui = await readFile(path.join(process.cwd(), "v2", "ui", "src", "App.tsx"), "utf8");
    expect(routes).toMatch(/dependencies\.conversion\.accept/);
    expect(routes).not.toMatch(/dependencies\.service\[action\]/);
    expect(ui).toMatch(/Accept Quote &amp; Create Order/);
    expect(ui).not.toMatch(/>Convert to Order</);
  });

  test("the canonical Order core is shared and does not reserve an operation request", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "orderApplication.ts"), "utf8");
    const core = source.slice(source.indexOf("async createFromCommercialSnapshot"), source.indexOf("async read(", source.indexOf("async createFromCommercialSnapshot")));
    expect(core).toMatch(/materialRequirements\.freeze/);
    expect(core.indexOf("materialRequirements.freeze")).toBeLessThan(core.indexOf("createDraftInvoice"));
    expect(core).toMatch(/createDraftInvoice/);
    expect(core).toMatch(/instantiateRoutes/);
    expect(core).toMatch(/resolveOrderRoutability/);
    expect(core).toMatch(/not fully configured for production routing/);
    expect(core).not.toMatch(/\.reserve\(/);
    expect(core).not.toMatch(/\.pricing\.calculate\(/);
  });

  test("Order construction retains bounded persistence-stage diagnostics", async () => {
    for (const stage of ["acceptance_checkpoint", "accepted_artwork_snapshot", "routing_resolution", "order_persistence", "material_freeze", "draft_invoice", "artwork_lineage", "conversion_link", "durable_request_completed"]) {
      const fixture = await conversionFixture(stage);
      await expect(fixture.accept()).resolves.toMatchObject({ ok: false });
      expect(fixture.transactions()).toBe(1);
      expect(fixture.state()).toMatchObject({ quoteRead: fixture.initial, checkpoints: [], orderRead: null, invoice: null, lineage: null, artwork: [] });
      expect(fixture.calls.at(-1)).toBe("rollback");
      expect(fixture.messages).toContain(`V2_QUOTE_CONVERSION_TRACE request=trace-a stage=${stage} result=failed class=DATABASE_CONSTRAINT constraint=contract_constraint detail=error_without_database_code`);
      expect(fixture.messages).toContain("V2_QUOTE_CONVERSION_TRACE request=trace-a stage=transaction result=rolled_back");
      expect(fixture.messages.some(message => /secret customer email token SQL/.test(message))).toBe(false);
      expect(fixture.messages.some(message => /result=committed/.test(message))).toBe(false);
      if (["routing_resolution", "draft_invoice"].includes(stage)) expect(fixture.messages).toContain(`V2_QUOTE_CONVERSION_TRACE request=trace-a stage=${stage} result=started`);
    }
  });

  test("Quote send readiness and send both reject unroutable production lines before a document freeze or provider preparation", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresQuoteDelivery.ts"), "utf8");
    const send = source.slice(source.indexOf("async send("), source.indexOf("private async prepare("));
    const prepare = source.slice(source.indexOf("private async prepare("), source.indexOf("private async routability("));

    expect(source).toMatch(/resolveOrderRoutability/);
    expect(source).toMatch(/routability: Readonly<\{ status: "ready" \| "unroutable"/);
    expect(send).toMatch(/await this\.requireRoutability/);
    expect(send.indexOf("requireRoutability")).toBeLessThan(send.indexOf("integrations.requireReady"));
    expect(send.indexOf("requireRoutability")).toBeLessThan(send.indexOf("this.prepare"));
    expect(prepare).toMatch(/await this\.requireRoutability/);
    expect(prepare.indexOf("requireRoutability")).toBeLessThan(prepare.indexOf("quoteRecipientInTransaction"));
    expect(prepare.indexOf("requireRoutability")).toBeLessThan(prepare.indexOf("renderCustomerSalesPdf"));
  });

  test("conversion has one same-client orchestration boundary and no V1 or HTTP dependency", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteConversionApplication.ts"), "utf8");
    const transaction = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresQuoteConversionTransaction.ts"), "utf8");
    expect(source).not.toMatch(/express|server\/|v2-poc|PricingService/);
    expect(transaction).toMatch(/BEGIN/);
    expect(transaction).toMatch(/PostgresQuoteTransaction/);
    expect(transaction).toMatch(/PostgresOrderTransaction/);
  });

  test("freezes expected material requirements inside the same PostgreSQL conversion boundary", async () => {
    const transaction = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresOrderTransaction.ts"), "utf8");
    const requirements = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresOrderMaterialRequirements.ts"), "utf8");
    expect(transaction).toMatch(/afterMaterialRequirements/);
    expect(requirements).toMatch(/v2_order_line_material_requirements/);
    expect(requirements).toMatch(/ON CONFLICT\(organization_id,order_line_id,source_definition_id\) DO NOTHING/);
    expect(requirements).toMatch(/resolvedConfiguration\.pricingConfigurationId/);
    expect(requirements).toMatch(/inventoryConsumption/);
  });
});
