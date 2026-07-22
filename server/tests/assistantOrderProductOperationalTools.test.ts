import { describe, expect, jest, test } from "@jest/globals";
import { createAssistantOrderProductToolAdapters, createOrderProductOperationalTools } from "../services/assistant/orderProductOperationalTools";

const capturedAt = "2026-07-21T12:00:00.000Z";
const fixedNow = () => new Date(capturedAt);
const context = {
  contextVersion: "v1" as const,
  route: "/orders/order-1",
  pageTitle: "Order 16309",
  entityType: "order" as const,
  entityId: "order-1",
  selectedRecordIds: ["line-1"],
  activeFilters: [],
  capturedAt,
  unsavedChanges: false,
};
const invocation = { organizationId: "org-a", userId: "user-a", context, correlationId: "correlation-1" };

function repo() {
  return {
    getOrder: jest.fn(async (organizationId: string) => (organizationId === "org-a" ? {
      order: { id: "order-1", orderNumber: "16309", displayNumber: null, status: "in_production", state: "open", canonicalState: null, statusPillValue: null, dueDate: "2026-07-22T00:00:00.000Z", fulfillmentStatus: "pending", updatedAt: capturedAt, customerId: "customer-1", customerName: "OTB Graphics" },
      lineItems: [{ id: "line-1", description: "Yard signs", productName: "Economy Yard Sign Stakes", quantity: 5, status: "new", workflowState: "new", requiresDesign: true, designStatus: "pending", requiresProofApproval: true, approvedProofVersionId: null, requiresPrepress: true, sortOrder: 0 }],
      production: [{ id: "job-1", stationKey: "flatbed", stepKey: "prepress", status: "queued", updatedAt: capturedAt }],
      invoices: [{ id: "invoice-1", displayNumber: "INV-1", invoiceNumber: 1, status: "draft", updatedAt: capturedAt }],
    } : null)),
    getProduct: jest.fn(async (organizationId: string) => (organizationId === "org-a" ? {
      product: { id: "product-1", name: "Economy Yard Sign Stakes", isActive: true, category: "Signs", pricingMode: "area", pricingEngine: "pricingProfile", pricingProfileKey: "yard-sign", requiresProductionJob: true, requiresProofApproval: true, artworkPolicy: "required", pbv2ActiveTreeVersionId: "tree-1", updatedAt: capturedAt },
      versions: [{ id: "tree-1", status: "ACTIVE", schemaVersion: 2, publishedAt: capturedAt, updatedAt: capturedAt }],
      options: [{ id: "option-1", name: "Size", type: "select", isActive: true, displayOrder: 0 }],
      materials: [{ id: "material-1", name: "Coroplast", sku: "CORO" }],
    } : null)),
  };
}

describe("assistant order/product/operational tools", () => {
  test("order summary reduces canonical records and omits invoices without finance permission", async () => {
    const tools = createOrderProductOperationalTools({ repository: repo(), now: fixedNow });
    const result = await tools.ordersGetSummary.execute(invocation, { orderNumber: "16309" });
    expect(result.status).toBe("ok");
    expect(result.data.order?.customer).toBe("OTB Graphics");
    expect(result.data.invoices).toBeUndefined();
    expect(result.sourceLinks[0]?.href).toBe("/orders/order-1");
    expect(result.data.blockingIssues).toHaveLength(0);
  });

  test("uses persisted order-line dimensions and selected-option snapshots without inferring print progress", async () => {
    const repository = {
      ...repo(),
      getOrderLineItems: jest.fn(async () => [{
        id: "line-1", description: "ACM panel", productName: "ACM", materialName: "Aluminum composite", quantity: 3,
        width: "24", height: "48", status: "in_production", workflowState: "production",
        selectedOptions: [{ optionName: "Print Sides", value: "double-sided" }],
      }]),
      getOrderProduction: jest.fn(async () => [{ id: "job-1", lineItemId: "line-1", stationKey: "flatbed", stepKey: "print", status: "in_progress" }]),
      getOrderInvoices: jest.fn(async () => []),
    };
    const tools = createOrderProductOperationalTools({ repository, now: fixedNow });
    const result = await tools.ordersGetSummary.execute({ ...invocation, permissions: ["finance:read"] }, { orderNumber: "16309" });

    expect(result.data.lineItems).toEqual([expect.objectContaining({
      lineItemSequence: 1,
      quantity: 3,
      dimensions: { widthInches: 24, heightInches: 48 },
      finishedSquareFeet: 24,
      sidedness: "double_sided",
      stationLabels: ["Flatbed"],
    })]);
    expect(result.data.productionOverview).toMatchObject({ inProductionJobs: 1, printProgressAvailable: false });
    expect(result.data.productionOverview.printProgressWarning).toContain("authoritative completed quantities");
  });

  test("keeps the core order summary valid when optional workflow columns are unavailable", async () => {
    const repository = {
      getOrder: jest.fn(async () => ({
        order: {
          id: "order-20002", orderNumber: "20002", displayNumber: "ORD-20002", status: "fulfillment",
          dueDate: null, updatedAt: capturedAt, customerId: "customer-1", customerName: "T3 Signs",
        },
        lineItems: [], production: [], invoices: [],
      })),
      getProduct: repo().getProduct,
    };
    const tools = createOrderProductOperationalTools({ repository, now: fixedNow });

    const result = await tools.ordersGetSummary.execute({ ...invocation, permissions: ["finance:read"] }, { orderNumber: "ORD-20002" });

    expect(result).toMatchObject({
      status: "ok",
      data: { order: { number: "ORD-20002", customer: "T3 Signs", status: "fulfillment", fulfillmentStatus: "unavailable" } },
      sourceLinks: [expect.objectContaining({ href: "/orders/order-20002" })],
      warning: expect.stringContaining("Some optional workflow details are unavailable for this order."),
    });
    expect(() => (tools.ordersGetSummary.definition.resultSchema as any).parse(result)).not.toThrow();
  });

  test("returns a validated partial summary when every optional order enrichment fails", async () => {
    const logOrderSummaryStep = jest.fn();
    const repository = {
      getOrder: jest.fn(async () => ({
        order: {
          id: "order-20002", orderNumber: "20002", displayNumber: "ORD-20002", status: "fulfillment",
          dueDate: null, updatedAt: capturedAt, customerId: "customer-1", customerName: "T3 Signs",
        },
        lineItems: [], production: [], invoices: [],
      })),
      getOrderLineItems: jest.fn(async () => { throw new Error("schema drift"); }),
      getOrderProduction: jest.fn(async () => { throw new Error("production unavailable"); }),
      getOrderInvoices: jest.fn(async () => { throw new Error("billing unavailable"); }),
      getProduct: repo().getProduct,
    };
    const tools = createOrderProductOperationalTools({ repository, now: fixedNow, logOrderSummaryStep });

    const result = await tools.ordersGetSummary.execute({ ...invocation, permissions: ["finance:read"] }, { orderNumber: "ORD-20002" });

    expect(result).toMatchObject({
      status: "ok",
      data: {
        order: { id: "order-20002", customer: "T3 Signs", dueDate: null },
        lineItems: [], productionJobs: [], invoices: [],
      },
      sourceLinks: [expect.objectContaining({ href: "/orders/order-20002" })],
    });
    expect(result.warning).toContain("Some optional workflow details are unavailable");
    expect(logOrderSummaryStep).toHaveBeenCalledWith(expect.objectContaining({ step: "lookup_line_items", outcome: "failed", correlationId: "correlation-1", organizationId: "org-a", errorCode: "dependency_failed" }));
    expect(logOrderSummaryStep).toHaveBeenCalledWith(expect.objectContaining({ step: "validate_result", outcome: "succeeded" }));
    expect(() => (tools.ordersGetSummary.definition.resultSchema as any).parse(result)).not.toThrow();
  });

  test("starts independent optional enrichments concurrently after the core lookup", async () => {
    const started: string[] = [];
    const resolvers: Array<() => void> = [];
    const pending = <T,>(name: string, value: T) => new Promise<T>((resolve) => {
      started.push(name);
      resolvers.push(() => resolve(value));
    });
    const repository = {
      getOrder: jest.fn(async () => ({
        order: { id: "order-20002", orderNumber: "20002", displayNumber: "ORD-20002", status: "fulfillment", dueDate: null, updatedAt: capturedAt, customerId: "customer-1", customerName: "T3 Signs" },
        lineItems: [], production: [], invoices: [],
      })),
      getOrderLineItems: jest.fn(() => pending("line_items", [])),
      getOrderProduction: jest.fn(() => pending("production", [])),
      getOrderInvoices: jest.fn(() => pending("billing", [])),
      getProduct: repo().getProduct,
    };
    const tools = createOrderProductOperationalTools({ repository, now: fixedNow });
    const resultPromise = tools.ordersGetSummary.execute(invocation, { orderNumber: "20002" });

    await new Promise((resolve) => setImmediate(resolve));
    expect(started.sort()).toEqual(["billing", "line_items", "production"]);
    resolvers.forEach((resolve) => resolve());
    await expect(resultPromise).resolves.toMatchObject({ status: "ok" });
  });

  test("times out an individual optional enrichment without losing the core summary", async () => {
    const logOrderSummaryStep = jest.fn();
    const repository = {
      getOrder: jest.fn(async () => ({
        order: { id: "order-20002", orderNumber: "20002", displayNumber: "ORD-20002", status: "fulfillment", dueDate: null, updatedAt: capturedAt, customerId: "customer-1", customerName: "T3 Signs" },
        lineItems: [], production: [], invoices: [],
      })),
      getOrderLineItems: jest.fn(() => new Promise(() => undefined)),
      getOrderProduction: jest.fn(async () => []),
      getOrderInvoices: jest.fn(async () => []),
      getProduct: repo().getProduct,
    };
    const tools = createOrderProductOperationalTools({ repository, now: fixedNow, logOrderSummaryStep, optionalOrderEnrichmentTimeoutMs: 10 });

    const result = await tools.ordersGetSummary.execute(invocation, { orderNumber: "20002" });

    expect(result).toMatchObject({ status: "ok", data: { order: { id: "order-20002" }, lineItems: [] } });
    expect(result.warning).toContain("Line-item details are unavailable.");
    expect(logOrderSummaryStep).toHaveBeenCalledWith(expect.objectContaining({ step: "lookup_line_items", outcome: "failed", errorCode: "tool_timeout" }));
  });

  test("drops malformed optional records and preserves the validated core summary", async () => {
    const repository = {
      getOrder: jest.fn(async () => ({
        order: { id: "order-20002", orderNumber: "20002", displayNumber: "ORD-20002", status: "fulfillment", dueDate: null, updatedAt: capturedAt, customerId: "customer-1", customerName: "T3 Signs" },
        lineItems: [], production: [], invoices: [],
      })),
      getOrderLineItems: jest.fn(async () => [
        { id: "line-bad", description: "   ", productName: "Product", quantity: 1, status: "new" },
        { id: "line-good", description: "  Good line  ", productName: "  ", quantity: 2, status: null },
      ]),
      getOrderProduction: jest.fn(async () => [
        { id: "job-bad", stationKey: " ", stepKey: "prepress", status: "queued" },
        { id: "job-good", stationKey: " flatbed ", stepKey: " prepress ", status: null },
      ]),
      getOrderInvoices: jest.fn(async () => []),
      getProduct: repo().getProduct,
    };
    const tools = createOrderProductOperationalTools({ repository, now: fixedNow });

    const result = await tools.ordersGetSummary.execute({ ...invocation, permissions: ["finance:read"] }, { orderNumber: "20002" });

    expect(result).toMatchObject({
      status: "ok",
      data: {
        order: { id: "order-20002" },
        lineItems: [{ id: "line-good", description: "Good line", productName: null, status: "unavailable" }],
        productionJobs: [{ id: "job-good", stationKey: "flatbed", stepKey: "prepress", status: "unavailable" }],
      },
    });
    expect(result.warning).toContain("Malformed line-item details were omitted.");
    expect(result.warning).toContain("Malformed production details were omitted.");
    expect(() => (tools.ordersGetSummary.definition.resultSchema as any).parse(result)).not.toThrow();
  });

  test.each(["20002", "ORD-20002", "ord-20002", "ORD 20002", "Order 20002."])("normalizes %s before using the tenant-scoped order repository", async (orderNumber) => {
    const repository = repo();
    const tools = createOrderProductOperationalTools({ repository, now: fixedNow });

    await tools.ordersGetSummary.execute(invocation, { orderNumber });

    expect(repository.getOrder).toHaveBeenCalledWith("org-a", { orderNumber: "20002" });
  });

  test("order summaries expose invoice linkage only to a trusted finance permission", async () => {
    const tools = createOrderProductOperationalTools({ repository: repo(), now: fixedNow });
    const result = await tools.ordersGetSummary.execute({ ...invocation, permissions: ["finance:read"] }, { orderId: "order-1" });
    expect(result.data.invoices).toEqual([{ id: "invoice-1", number: "INV-1", status: "draft" }]);
  });

  test("cross-tenant and normal misses have the same not-found envelope", async () => {
    const tools = createOrderProductOperationalTools({ repository: repo(), now: fixedNow });
    const result = await tools.ordersGetSummary.execute({ ...invocation, organizationId: "org-b" }, { orderId: "order-1" });
    expect(result).toMatchObject({ status: "not_found", sourceLinks: [], data: { order: null } });
  });

  test("product summary contains safe PBV2 status and fixed internal link", async () => {
    const tools = createOrderProductOperationalTools({ repository: repo(), now: fixedNow });
    const result = await tools.productsGetSummary.execute(invocation, { query: "Economy Yard Sign Stakes" });
    expect(result.data.product).toMatchObject({ name: "Economy Yard Sign Stakes", pricingMethod: "yard-sign" });
    expect(result.data.pbv2).toEqual([{ id: "tree-1", status: "ACTIVE", schemaVersion: 2, publishedAt: capturedAt }]);
    expect(result.sourceLinks[0]?.href).toBe("/products/product-1/edit");
  });

  test("operational summary preserves only canonical service metrics", async () => {
    const tools = createOrderProductOperationalTools({ repository: repo(), now: fixedNow, getOperationalSummary: async () => ({ inboundOrders: 2, overview: 4, design: 1, proofing: 3, prepress: 5, flatbed: 2, roll: 1, fulfillment: 7, invoices: { pendingSend: 8, unpaid: 9 } }) });
    const result = await tools.reportsOperationalSummary.execute(invocation, {});
    expect(result.data.metrics).toHaveLength(10);
    expect(result.data.metrics.find((metric) => metric.key === "proofing")).toMatchObject({ value: 3, href: "/production/proofing" });
  });

  test("navigation reads only validated structured context", async () => {
    const tools = createOrderProductOperationalTools({ repository: repo(), now: fixedNow });
    const result = await tools.navigationGetCurrentContext.execute(invocation, {});
    expect(result.data).toMatchObject({ route: "/orders/order-1", entityId: "order-1", selectedCount: 1 });
    expect(result.data.currentRecord).toMatchObject({
      entityType: "order",
      entityId: "order-1",
      orderNumber: "16309",
      customer: "OTB Graphics",
      status: "in_production",
      dueDate: "2026-07-22T00:00:00.000Z",
      sourceLink: { href: "/orders/order-1" },
    });
    expect(result.sourceLinks).toEqual([expect.objectContaining({ href: "/orders/order-1" })]);
    await expect(tools.navigationGetCurrentContext.execute({ ...invocation, context: { ...context, route: "https://unsafe.example" } as any }, {})).rejects.toThrow();
  });

  test("navigation context never discloses another tenant's nominated order", async () => {
    const tools = createOrderProductOperationalTools({ repository: repo(), now: fixedNow });
    const result = await tools.navigationGetCurrentContext.execute({ ...invocation, organizationId: "org-b" }, {});

    expect(result.data).toMatchObject({ pageTitle: "Order 16309", entityType: null, entityId: null, currentRecord: null });
    expect(result.sourceLinks).toEqual([]);
  });

  test("navigation context treats mismatched routes and invalid identifiers as page-only context", async () => {
    const tools = createOrderProductOperationalTools({ repository: repo(), now: fixedNow });
    const mismatchedRoute = await tools.navigationGetCurrentContext.execute({
      ...invocation,
      context: { ...context, route: "/quotes/order-1" },
    }, {});
    expect(mismatchedRoute.data).toMatchObject({ entityType: null, entityId: null, currentRecord: null });

    await expect(tools.navigationGetCurrentContext.execute({
      ...invocation,
      context: { ...context, entityId: "not a safe id" } as any,
    }, {})).rejects.toThrow();
  });

  test("navigation resolves customer, quote, and product context only through their validated detail routes", async () => {
    const tools = createOrderProductOperationalTools({
      repository: repo(),
      now: fixedNow,
      getCustomerContext: jest.fn(async (organizationId) => organizationId === "org-a" ? {
        id: "customer-1", companyName: "OTB Graphics", isActive: true, status: "active", route: "/customers/customer-1", freshness: capturedAt, contacts: [], recentActivity: [],
      } : null),
      getQuoteContext: jest.fn(async (organizationId) => organizationId === "org-a" ? {
        id: "quote-1", displayNumber: "Q-1042", quoteNumber: 1042, customerName: "OTB Graphics",
      } : null),
    });

    const customer = await tools.navigationGetCurrentContext.execute({ ...invocation, context: { ...context, route: "/customers/customer-1", entityType: "customer", entityId: "customer-1" } }, {});
    expect(customer.data.currentRecord).toMatchObject({ entityType: "customer", customerName: "OTB Graphics", sourceLink: { href: "/customers/customer-1" } });

    const quote = await tools.navigationGetCurrentContext.execute({ ...invocation, context: { ...context, route: "/quotes/quote-1", entityType: "quote", entityId: "quote-1" } }, {});
    expect(quote.data.currentRecord).toMatchObject({ entityType: "quote", quoteNumber: "Q-1042", sourceLink: { href: "/quotes/quote-1" } });

    const product = await tools.navigationGetCurrentContext.execute({ ...invocation, context: { ...context, route: "/products/product-1/edit", entityType: "product", entityId: "product-1" } }, {});
    expect(product.data.currentRecord).toMatchObject({ entityType: "product", productName: "Economy Yard Sign Stakes", active: true, sourceLink: { href: "/products/product-1/edit" } });

    const mismatchedProduct = await tools.navigationGetCurrentContext.execute({ ...invocation, context: { ...context, route: "/products/product-1", entityType: "product", entityId: "product-1" } }, {});
    expect(mismatchedProduct.data.currentRecord).toBeNull();
  });

  test("navigation context hides customer and quote IDs that do not resolve within the tenant", async () => {
    const tools = createOrderProductOperationalTools({
      repository: repo(),
      now: fixedNow,
      getCustomerContext: async () => null,
      getQuoteContext: async () => null,
    });
    const customer = await tools.navigationGetCurrentContext.execute({ ...invocation, context: { ...context, route: "/customers/customer-1", entityType: "customer", entityId: "customer-1" } }, {});
    const quote = await tools.navigationGetCurrentContext.execute({ ...invocation, context: { ...context, route: "/quotes/quote-1", entityType: "quote", entityId: "quote-1" } }, {});
    expect(customer.data).toMatchObject({ entityType: null, entityId: null, currentRecord: null });
    expect(quote.data).toMatchObject({ entityType: null, entityId: null, currentRecord: null });
  });

  test("navigation adapter uses the generic workspace link only without a resolved record", async () => {
    const adapters = createAssistantOrderProductToolAdapters({ repository: repo(), now: fixedNow });
    const result = await adapters["navigation.get_current_context"]!.execute({}, {
      scope: { organizationId: "org-a", userId: "user-a" },
      actor: { userId: "user-a", email: null },
      permissions: ["assistant.internal_staff"],
      context: { ...context, route: "/orders", entityType: "unknown", entityId: undefined },
      correlationId: "correlation-1",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("succeeded");
    expect(result.provenance?.sourceLinks).toEqual([
      expect.objectContaining({ label: "Current PrintersHero workspace", href: "/" }),
    ]);
    expect((result.data as any).currentRecord).toBeUndefined();
  });

  test("registry-compatible wrapper emits the shared envelope with server-derived links", async () => {
    const adapters = createAssistantOrderProductToolAdapters({ repository: repo(), now: fixedNow });
    const result = await adapters["orders.get_summary"]!.execute({ orderNumber: "16309" }, {
      scope: { organizationId: "org-a", userId: "user-a" },
      actor: { userId: "user-a", email: null },
      permissions: ["assistant.internal_staff"],
      context,
      correlationId: "correlation-1",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("succeeded");
    expect(result.provenance?.sourceLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "/orders/order-1" }),
    ]));
    expect((result.data as any).customer.sourceLink.href).toBe("/customers/customer-1");
  });

  test("adapter supplies only text-based, bounded follow-up prompts for an order", async () => {
    const adapters = createAssistantOrderProductToolAdapters({ repository: repo(), now: fixedNow });
    const result = await adapters["orders.get_summary"]!.execute({ orderNumber: "16309" }, {
      scope: { organizationId: "org-a", userId: "user-a" }, actor: { userId: "user-a", email: null }, permissions: ["assistant.internal_staff"], context, correlationId: "correlation-1", signal: new AbortController().signal,
    });
    const prompts = (result.data as any).suggestedPrompts;
    expect(prompts).toHaveLength(3);
    expect(prompts).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Show line-item details", prompt: expect.stringContaining("Order 16309") })]));
    expect(JSON.stringify(prompts)).not.toContain("confirmationToken");
  });

  test("navigation adapter exposes the canonical order source instead of the generic workspace", async () => {
    const adapters = createAssistantOrderProductToolAdapters({ repository: repo(), now: fixedNow });
    const result = await adapters["navigation.get_current_context"]!.execute({}, {
      scope: { organizationId: "org-a", userId: "user-a" },
      actor: { userId: "user-a", email: null },
      permissions: ["assistant.internal_staff"],
      context,
      correlationId: "correlation-1",
      signal: new AbortController().signal,
    });

    expect(result.provenance?.sourceLinks).toEqual([
      expect.objectContaining({ label: "Order 16309", href: "/orders/order-1" }),
    ]);
    expect((result.data as any).currentRecord).toMatchObject({ orderNumber: "16309", entityId: "order-1" });
  });
});
