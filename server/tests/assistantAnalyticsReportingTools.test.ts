import { describe, expect, jest, test } from "@jest/globals";
import {
  analyticsDateWindow,
  createAssistantAnalyticsReportingToolAdapters,
} from "../services/assistant/analyticsReportingTools";

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
  return {
    getOrganizationTimezone: jest.fn(async () => "America/New_York"),
    resolveCustomer: jest.fn(async (_organizationId: string, query: string) => query === "unknown"
      ? { customer: null, alternatives: [], confidence: "none" as const }
      : query === "Brainstorm"
        ? { customer: null, alternatives: [{ id: "customer-a", displayName: "Brainstorm Print", updatedAt: capturedAt }, { id: "customer-b", displayName: "Brainstorm Graphics", updatedAt: capturedAt }], confidence: "ambiguous" as const }
        : { customer: { id: "customer-a", displayName: "Brainstorm Print", updatedAt: capturedAt }, alternatives: [], confidence: "exact" as const }),
    customerProductSales: jest.fn(async () => [{
      label: "PVC Banner", productId: "product-pvc", revenueCents: 42500, quantity: 25, invoiceCount: 2, orderCount: 2,
      averageUnitPriceCents: 1700, firstPurchaseAt: "2026-07-01T04:00:00.000Z", latestPurchaseAt: "2026-07-20T04:00:00.000Z",
      sourceRecordCount: 2, totalRevenueCents: 50000, groupingRationale: "Rows are grouped by historical product identifier and invoice-time label.",
    }]),
    ...overrides,
  };
}

describe("assistant analytics reporting tools", () => {
  test("resolves an exact tenant customer with an internal source link", async () => {
    const repo = repository();
    const tools = createAssistantAnalyticsReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["analytics.resolve_customer"]!.execute({ query: "Brainstorm Print" }, context);

    expect(result).toMatchObject({
      status: "succeeded",
      data: { confidence: "exact", customer: { id: "customer-a", sourceLink: { href: "/customers/customer-a" } } },
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
      data: { confidence: "ambiguous", customer: null, alternatives: [{ id: "customer-a" }, { id: "customer-b" }] },
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

  test("uses tenant calendar boundaries across DST", () => {
    const summer = analyticsDateWindow("2026-07-01", "2026-07-31", "America/New_York");
    const winter = analyticsDateWindow("2026-01-01", "2026-01-31", "America/New_York");
    expect(summer.start.toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(winter.start.toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });
});
