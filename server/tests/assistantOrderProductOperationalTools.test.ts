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
      order: { id: "order-1", orderNumber: "16309", displayNumber: null, status: "in_production", state: "open", canonicalState: null, statusPillValue: null, dueDate: null, fulfillmentStatus: "pending", updatedAt: capturedAt, customerId: "customer-1", customerName: "OTB Graphics" },
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
    expect(result.data.blockingIssues).toHaveLength(3);
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
    await expect(tools.navigationGetCurrentContext.execute({ ...invocation, context: { ...context, route: "https://unsafe.example" } as any }, {})).rejects.toThrow();
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
});
