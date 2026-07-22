import { describe, expect, jest, test } from "@jest/globals";
import {
  analyticsDateWindow,
  createAssistantAnalyticsReportingToolAdapters,
} from "../services/assistant/analyticsReportingTools";
import { normalizeCustomerResolutionCandidates } from "../storage/assistantAnalyticsReporting.repo";

const capturedAt = "2026-07-21T12:00:00.000Z";
const context = {
  scope: { organizationId: "org-a", userId: "user-a" },
  actor: { userId: "user-a", email: null },
  permissions: ["assistant.internal_staff", "finance.read"],
  context: { contextVersion: "v1" as const, route: "/customers/customer-a", pageTitle: "Brainstorm Print", selectedRecordIds: [], activeFilters: [], capturedAt, unsavedChanges: false },
  correlationId: "correlation-analytics-1",
  signal: new AbortController().signal,
};

function repository(overrides: Record<string, unknown> = {}) {
  const company = { id: "customer-a", displayName: "Brainstorm Print", updatedAt: capturedAt, resolutionType: "company" as const, contactId: null, contactName: null, explanation: "Resolved company account Brainstorm Print." };
  return {
    getOrganizationTimezone: jest.fn(async () => "America/New_York"),
    resolveCustomer: jest.fn(async (_organizationId: string, query: string) => query === "unknown"
      ? { customer: null, alternatives: [], confidence: "none" as const }
      : query === "Brainstorm"
        ? { customer: null, alternatives: [company, { id: "customer-b", displayName: "Brainstorm Graphics", updatedAt: capturedAt, resolutionType: "company" as const, contactId: null, contactName: null, explanation: "Resolved company account Brainstorm Graphics." }], confidence: "ambiguous" as const }
        : { customer: company, alternatives: [], confidence: "exact" as const }),
    customerProductSales: jest.fn(async () => [{
      label: "PVC Banner", productId: "product-pvc", revenueCents: 42500, quantity: 25, invoiceCount: 2, orderCount: 2,
      averageUnitPriceCents: 1700, firstPurchaseAt: "2026-07-01T04:00:00.000Z", latestPurchaseAt: "2026-07-20T04:00:00.000Z",
      sourceRecordCount: 2, totalRevenueCents: 50000, groupingRationale: "Rows are grouped by historical product identifier and invoice-time label.",
    }]),
    customerUninvoicedOrders: jest.fn(async () => [{
      orderId: "order-a", orderNumber: "ORD-20002", orderDate: "2026-07-20T04:00:00.000Z", orderStatus: "in_production",
      fulfillmentState: "pending", invoiceState: "no_invoice" as const, billingReadiness: "not_ready",
      billingBlockers: ["Order is not marked billing ready.", "Fulfillment is pending."], orderTotalCents: 124000, lineCount: 2,
    }]),
    ...overrides,
  };
}

describe("assistant analytics reporting tools", () => {
  test("normalizes a company and several matching contacts into one purchasing entity", () => {
    const candidates = normalizeCustomerResolutionCandidates([
      { id: "customer-bright", displayName: "Bright Signs Marketing", updatedAt: capturedAt, resolutionType: "company", contactId: null, contactName: null, explanation: "company" },
      { id: "customer-bright", displayName: "Bright Signs Marketing", updatedAt: capturedAt, resolutionType: "contact", contactId: "contact-john", contactName: "John Smith", explanation: "contact" },
      { id: "customer-bright", displayName: "Bright Signs Marketing", updatedAt: capturedAt, resolutionType: "contact", contactId: "contact-jane", contactName: "Jane Doe", explanation: "contact" },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: "customer-bright",
      resolutionType: "company",
      explanation: expect.stringContaining("2 related contacts"),
    });
  });

  test("keeps same-name contacts at different companies ambiguous", () => {
    const candidates = normalizeCustomerResolutionCandidates([
      { id: "customer-graphic", displayName: "Graphic Solutions", updatedAt: capturedAt, resolutionType: "contact", contactId: "contact-rick-1", contactName: "Rick Clark", explanation: "contact" },
      { id: "customer-bright", displayName: "Bright Signs Marketing", updatedAt: capturedAt, resolutionType: "contact", contactId: "contact-rick-2", contactName: "Rick Clark", explanation: "contact" },
    ]);

    expect(candidates.map((candidate) => candidate.id)).toEqual(["customer-bright", "customer-graphic"]);
  });

  test("resolves an exact tenant customer with an internal source link", async () => {
    const repo = repository();
    const tools = createAssistantAnalyticsReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["analytics.resolve_customer"]!.execute({ query: "Brainstorm Print" }, context);

    expect(result).toMatchObject({
      status: "succeeded",
      data: { confidence: "exact", customer: { id: "customer-a", resolutionType: "company", sourceLink: { href: "/customers/customer-a" } } },
      provenance: { sourceLinks: [expect.objectContaining({ href: "/customers/customer-a" })] },
    });
    expect(repo.resolveCustomer).toHaveBeenCalledWith("org-a", "Brainstorm Print");
  });

  test("fails softly with alternatives instead of guessing a partial customer name", async () => {
    const repo = repository();
    const tools = createAssistantAnalyticsReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["analytics.resolve_customer"]!.execute({ query: "Brainstorm" }, context);

    expect(result).toMatchObject({
      status: "partial",
      data: { confidence: "ambiguous", customer: null, alternatives: [{ id: "customer-a", resolutionType: "company" }, { id: "customer-b", resolutionType: "company" }] },
      warning: expect.stringContaining("Choose one of"),
    });
  });

  test("uses a server-derived tenant timezone and native posted-sales result provenance", async () => {
    const repo = repository();
    const tools = createAssistantAnalyticsReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["analytics.customer_product_sales"]!.execute({
      customer: { id: "customer-a" }, dateRange: { start: "2026-07-01", end: "2026-07-31" }, rankingMetric: "revenue", limit: 5, grouping: "exact_product",
    }, context);

    expect(result).toMatchObject({
      status: "succeeded",
      data: {
        customer: { id: "customer-a" }, totalRevenueCents: 50000, timezone: "America/New_York",
        rows: [expect.objectContaining({ label: "PVC Banner", rank: 1, shareOfCustomerRevenue: 0.85 })],
        warnings: [expect.stringContaining("posted native invoice-line snapshots")],
      },
      provenance: { sourceLinks: [expect.objectContaining({ href: "/customers/customer-a" })] },
    });
    expect(repo.customerProductSales).toHaveBeenCalledWith(
      "org-a", "customer-a", expect.objectContaining({ start: new Date("2026-07-01T04:00:00.000Z"), endExclusive: new Date("2026-08-01T04:00:00.000Z") }), "exact_product", "revenue", 5,
    );
  });

  test("does not run a sales aggregation when the supplied customer is unresolved", async () => {
    const repo = repository();
    const tools = createAssistantAnalyticsReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["analytics.customer_product_sales"]!.execute({
      customer: { name: "unknown" }, dateRange: { start: "2026-07-01", end: "2026-07-31" }, limit: 5,
    }, context);

    expect(result).toMatchObject({ status: "not_found", data: null });
    expect(repo.customerProductSales).not.toHaveBeenCalled();
  });

  test("preserves the contact-to-company explanation while sales uses the company account", async () => {
    const repo = repository({
      resolveCustomer: jest.fn(async () => ({
        customer: { id: "customer-graphic", displayName: "Graphic Solutions", updatedAt: capturedAt, resolutionType: "contact" as const, contactId: "contact-rick", contactName: "Rick Clark", explanation: "Found Rick Clark at Graphic Solutions; analytics use the company account." },
        alternatives: [], confidence: "exact" as const,
      })),
    });
    const tools = createAssistantAnalyticsReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const resolution = await tools["analytics.resolve_customer"]!.execute({ query: "Rick Clark" }, context);
    const sales = await tools["analytics.customer_product_sales"]!.execute({ customer: { name: "Rick Clark" }, dateRange: { start: "2026-07-01", end: "2026-07-31" }, limit: 5 }, context);

    expect(resolution).toMatchObject({ data: { customer: { displayName: "Graphic Solutions", resolutionType: "contact", contactName: "Rick Clark", explanation: expect.stringContaining("company account") } } });
    expect(sales).toMatchObject({ status: "succeeded", data: { customer: { id: "customer-graphic", displayName: "Graphic Solutions" } } });
    expect(repo.customerProductSales).toHaveBeenCalledWith("org-a", "customer-graphic", expect.anything(), "exact_product", "revenue", 5);
  });

  test("returns operational uninvoiced orders without treating their value as posted revenue", async () => {
    const repo = repository();
    const tools = createAssistantAnalyticsReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await (tools as any)["analytics.customer_uninvoiced_orders"].execute({
      customer: { id: "customer-a" }, dateRange: { start: "2026-07-01", end: "2026-07-31" }, limit: 10,
    }, context);

    expect(result).toMatchObject({ status: "succeeded", data: { totalOrderValueCents: 124000 } });
    const data = (result as any).data;
    expect(data.orders[0]).toMatchObject({ orderNumber: "ORD-20002", invoiceState: "no_invoice", orderTotalCents: 124000, sourceLink: { href: "/orders/order-a" } });
    expect(data.warnings).toEqual([expect.stringContaining("not included in posted revenue")]);
    expect(repo.customerUninvoicedOrders).toHaveBeenCalledWith("org-a", "customer-a", expect.objectContaining({ start: expect.any(Date), endExclusive: expect.any(Date) }), 10);
  });

  test("uses tenant calendar boundaries across DST", () => {
    const summer = analyticsDateWindow("2026-07-01", "2026-07-31", "America/New_York");
    const winter = analyticsDateWindow("2026-01-01", "2026-01-31", "America/New_York");
    expect(summer.start.toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(winter.start.toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });
});
