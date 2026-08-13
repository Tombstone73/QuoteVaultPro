import { describe, expect, jest, test } from "@jest/globals";
import { createAssistantOrderSearchToolAdapters } from "../services/assistant/orderSearchTools";

const context: any = { scope: { organizationId: "org-a", userId: "user-a" }, actor: { userId: "user-a", email: null }, permissions: ["internal_staff"], context: { contextVersion: "v1", route: "/orders", pageTitle: "Orders", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-12T12:00:00.000Z", unsavedChanges: false }, correlationId: "corr", signal: new AbortController().signal };

describe("orders.search", () => {
  test("delegates tenant, sort, and limit to the same Orders repository query", async () => {
    const getAllOrdersPaginated = jest.fn(async () => ({ items: [{ id: "order-1", orderNumber: "1001", status: "new", state: "open", total: "125.00", createdAt: new Date("2026-08-12T10:00:00.000Z"), dueDate: null, priority: "normal", customer: { id: "customer-1", companyName: "Acme" } }], totalCount: 1, page: 1, pageSize: 5, totalPages: 1, hasNext: false, hasPrev: false }));
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any)["orders.search"]!;
    const result = await adapter.execute({ sort: "newest", limit: 5 }, context);
    expect(getAllOrdersPaginated).toHaveBeenCalledWith("org-a", expect.objectContaining({ page: 1, pageSize: 5, includeThumbnails: false }));
    expect((result.data as any).orders[0]).toMatchObject({ orderNumber: "1001", customer: { name: "Acme" }, status: "new", total: 125 });
  });
  test("never accepts a model-supplied tenant", async () => {
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated: jest.fn() } as any)["orders.search"]!;
    await expect(adapter.execute({ organizationId: "org-b", sort: "newest", limit: 5 } as any, context)).rejects.toThrow();
  });

  test("uses the shared paginated repository search rather than client-side rows", async () => {
    const getAllOrdersPaginated = jest.fn(async () => ({ items: [], totalCount: 0, page: 1, pageSize: 5, totalPages: 1, hasNext: false, hasPrev: false }));
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any)["orders.search"]!;
    await adapter.execute({ query: "20032", limit: 5 }, context);
    expect(getAllOrdersPaginated).toHaveBeenCalledWith("org-a", expect.objectContaining({ search: "20032", page: 1, pageSize: 5 }));
  });
});
