import { describe, expect, jest, test } from "@jest/globals";
import { createAssistantOrderDueSummaryToolAdapters } from "../services/assistant/orderDueSummaryTools";

const capturedAt = "2026-07-21T12:00:00.000Z";
const context = {
  scope: { organizationId: "org-a", userId: "user-a" },
  actor: { userId: "user-a", email: null },
  permissions: ["assistant.internal_staff", "finance.read"],
  context: { contextVersion: "v1" as const, route: "/orders", pageTitle: "Orders", selectedRecordIds: [], activeFilters: [], capturedAt, unsavedChanges: false },
  correlationId: "correlation-1",
  signal: new AbortController().signal,
};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    getOrganizationTimezone: jest.fn(async () => "America/New_York"),
    countDueOrders: jest.fn(async () => 2),
    listDueOrders: jest.fn(async () => [
      { orderId: "order-20002", orderNumber: "ORD-20002", customerName: "T3 Signs", status: "in_production", dueDate: "2026-07-19T16:00:00.000Z", fulfillmentStatus: "pending", billingStatus: "not_ready", total: "1240.00", updatedAt: capturedAt },
      { orderId: "order-20004", orderNumber: "ORD-20004", customerName: "Graphic Solutions", status: "new", dueDate: "2026-07-20T16:00:00.000Z", fulfillmentStatus: "pending", billingStatus: "not_ready", total: "40.00", updatedAt: capturedAt },
    ]),
    getDueOrderOperationalSummaries: jest.fn(async () => [
      { orderId: "order-20002", lineItemCount: 3, incompleteLineItemCount: 2, productionJobCount: 5, activeProductionJobCount: 3, invoiceState: "not_invoiced" },
      { orderId: "order-20004", lineItemCount: 1, incompleteLineItemCount: 1, productionJobCount: 0, activeProductionJobCount: 0, invoiceState: "not_invoiced" },
    ]),
    ...overrides,
  };
}

describe("assistant order due summary", () => {
  test("returns unique tenant-scoped overdue orders with safe links and order-level counts", async () => {
    const repo = repository();
    const tool = createAssistantOrderDueSummaryToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) })["orders.get_due_summary"]!;

    const result = await tool.execute({ due: "overdue", limit: 10, includeOperationalSummary: true }, context);

    expect(result).toMatchObject({
      status: "succeeded",
      data: {
        totalMatchingOrders: 2,
        timezone: "America/New_York",
        orders: [
          { orderNumber: "ORD-20002", dueState: "overdue", daysFromDue: -2, lineItemCount: 3, activeProductionJobCount: 3, orderTotal: 1240, sourceLink: { href: "/orders/order-20002" } },
          { orderNumber: "ORD-20004", dueState: "overdue", daysFromDue: -1, lineItemCount: 1 },
        ],
      },
      provenance: { sourceLinks: [{ href: "/orders/order-20002" }, { href: "/orders/order-20004" }] },
    });
    expect(repo.countDueOrders).toHaveBeenCalledWith("org-a", expect.any(Object), expect.objectContaining({ due: "overdue", limit: 10 }));
    expect(repo.listDueOrders).toHaveBeenCalledWith("org-a", expect.any(Object), expect.objectContaining({ due: "overdue", limit: 10 }));
    expect(repo.getDueOrderOperationalSummaries).toHaveBeenCalledWith("org-a", ["order-20002", "order-20004"]);
  });

  test("uses the requested due-today window rather than substituting a production-job filter", async () => {
    const repo = repository({ countDueOrders: jest.fn(async () => 1), listDueOrders: jest.fn(async () => [{ orderId: "order-today", orderNumber: "ORD-20005", customerName: "T3 Signs", status: "in_production", dueDate: "2026-07-21T16:00:00.000Z", fulfillmentStatus: "pending", billingStatus: "ready", total: "50", updatedAt: capturedAt }]) });
    const tool = createAssistantOrderDueSummaryToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) })["orders.get_due_summary"]!;
    const result = await tool.execute({ due: "due_today", includeOperationalSummary: false }, context);
    expect(result).toMatchObject({ status: "succeeded", data: { totalMatchingOrders: 1, orders: [{ orderNumber: "ORD-20005", dueState: "due_today", lineItemCount: null }] } });
    expect(repo.getDueOrderOperationalSummaries).not.toHaveBeenCalled();
  });

  test("keeps the core order list successful when optional operational enrichment fails", async () => {
    const repo = repository({ getDueOrderOperationalSummaries: jest.fn(async () => { throw new Error("optional lookup unavailable"); }) });
    const tool = createAssistantOrderDueSummaryToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) })["orders.get_due_summary"]!;
    const result = await tool.execute({ due: "overdue" }, context);
    expect(result).toMatchObject({ status: "succeeded", data: { warnings: [expect.stringContaining("Optional operational counts")] } });
    expect((result.data as any).orders[0]).toMatchObject({ lineItemCount: null });
  });

  test("bounds output and omits financial totals without finance permission", async () => {
    const repo = repository({ countDueOrders: jest.fn(async () => 21), listDueOrders: jest.fn(async () => []) });
    const tool = createAssistantOrderDueSummaryToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) })["orders.get_due_summary"]!;
    const result = await tool.execute({ due: "overdue", limit: 20 }, { ...context, permissions: ["assistant.internal_staff"] });
    expect(result).toMatchObject({ status: "succeeded", data: { totalMatchingOrders: 21, orders: [], warnings: [expect.stringContaining("first 0 of 21")] } });
    expect(repo.listDueOrders).toHaveBeenCalledWith("org-a", expect.any(Object), expect.objectContaining({ limit: 20 }));
  });
});
