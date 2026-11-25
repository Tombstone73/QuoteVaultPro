import { describe, expect, jest, test } from "@jest/globals";
import { createAssistantOrderSearchToolAdapters } from "../services/assistant/orderSearchTools";
import { assistantOrderSearchInputSchema } from "@shared/assistantContracts";
import { createAssistantToolRegistry } from "../services/assistant/toolRegistry";
import { AssistantOrchestrationService } from "../services/assistant/orchestration";

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

  test("forwards qualifications for native population ranking and paging, not local page filtering", async () => {
    // Repository ordering is authoritative: do not locally sort or qualify this
    // page, or confuse its size with the matching tenant-wide population.
    const items = [order("oldest", "2026-08-01"), order("next", "2026-08-02")];
    const getAllOrdersPaginated = jest.fn(async () => ({ items, totalCount: 23, page: 2, pageSize: 2, totalPages: 12, hasNext: true, hasPrev: true }));
    const getOrganizationTimezone = jest.fn(async (_organizationId: string) => "America/Los_Angeles");
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any, {
      getOrganizationTimezone, now: () => new Date("2026-08-13T01:00:00.000Z"),
    })["orders.search"]!;
    const filters = { state: "open", due: "overdue", sort: "due_date_asc", page: 2, limit: 2 };
    const result = await adapter.execute(filters, context);
    expect(getOrganizationTimezone).toHaveBeenCalledWith("org-a");
    expect(getAllOrdersPaginated).toHaveBeenCalledTimes(1);
    expect(getAllOrdersPaginated).toHaveBeenCalledWith("org-a", {
      state: "open", dueFilter: "overdue", dueDatePart: "2026-08-12", sortBy: "dueDate", sortDir: "asc", page: 2, pageSize: 2, includeThumbnails: false,
    });
    expect(result.data).toMatchObject({ totalMatchingOrders: 23, orders: [{ orderId: "oldest" }, { orderId: "next" }], appliedFilters: filters, pagination: { page: 2, pageSize: 2, totalPages: 12, hasNext: true, hasPrev: true } });
    expect(result.warning).toContain("23 matching orders");
  });

  test.each([
    { state: "production_complete", statusPillIds: ["pill-complete"] },
    { state: "closed", customerId: "customer-1", priority: "rush", sort: "total_desc" },
    { query: "Acme", status: "new", statusPillId: "pill-new", createdAtRange: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-12T23:59:59.000Z" } },
    { statusPillIds: [] },
  ])("preserves independent native qualifications: %j", async (filters) => {
    const getAllOrdersPaginated = jest.fn(async () => ({ items: [], totalCount: 0, page: 1, pageSize: 5, totalPages: 0, hasNext: false, hasPrev: false }));
    const getOrganizationTimezone = jest.fn(async () => "UTC");
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any, { getOrganizationTimezone })["orders.search"]!;
    const result = await adapter.execute(filters, context);
    const { query, createdAtRange, sort, ...nativeFilters } = filters as any;
    expect(getAllOrdersPaginated).toHaveBeenCalledWith("org-a", expect.objectContaining({
      ...nativeFilters,
      ...(query ? { search: query } : {}),
      ...(createdAtRange ? { startDate: createdAtRange.start, endDate: createdAtRange.end } : {}),
      ...(sort === "total_desc" ? { sortBy: "total", sortDir: "desc" } : {}),
      page: 1, pageSize: 5,
    }));
    expect((result.data as any).appliedFilters).toMatchObject(filters);
    expect(getOrganizationTimezone).not.toHaveBeenCalled();
    expect(result.warning).toBeUndefined();
  });

  test.each(["today", "tomorrow", "overdue"])("uses native tenant calendar semantics for %s", async (due) => {
    const getAllOrdersPaginated = jest.fn(async () => ({ items: [], totalCount: 0, page: 1, pageSize: 5, totalPages: 0, hasNext: false, hasPrev: false }));
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any, {
      getOrganizationTimezone: async () => "Pacific/Kiritimati", now: () => new Date("2026-12-31T12:00:00.000Z"),
    })["orders.search"]!;
    await adapter.execute({ due }, context);
    expect(getAllOrdersPaginated).toHaveBeenCalledWith("org-a", expect.objectContaining({ dueFilter: due, dueDatePart: due === "tomorrow" ? "2027-01-02" : "2027-01-01" }));
  });

  test("uses another trusted tenant's scope, never the previous tenant's results", async () => {
    const getAllOrdersPaginated = jest.fn(async (organizationId: string) => ({ items: [order(organizationId, null)], totalCount: 1, page: 1, pageSize: 5, totalPages: 1, hasNext: false, hasPrev: false }));
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any)["orders.search"]!;
    await adapter.execute({}, context);
    const result = await adapter.execute({}, { ...context, scope: { organizationId: "org-b", userId: "user-b" } });
    expect(getAllOrdersPaginated.mock.calls.map(([tenant]) => tenant)).toEqual(["org-a", "org-b"]);
    expect((result.data as any).orders.map((row: any) => row.orderId)).toEqual(["org-b"]);
  });

  test.each([
    { organizationId: "org-b" }, { tenantId: "org-b" }, { userId: "user-b" }, { dueDatePart: "2020-01-01" }, { timezone: "UTC" },
    { productionStatus: "in_progress" }, { page: 0 }, { page: 1.5 }, { due: "last_week" }, { state: "in_production" },
    { createdAtRange: { start: "2026-08-13T00:00:00.000Z", end: "2026-08-12T00:00:00.000Z" } },
  ])("rejects unsupported/injected qualifications before any read: %j", async (filters) => {
    const getAllOrdersPaginated = jest.fn();
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any)["orders.search"]!;
    await expect(adapter.execute(filters, context)).rejects.toThrow();
    expect(getAllOrdersPaginated).not.toHaveBeenCalled();
  });

  test("does not silently broaden a due request when timezone lookup fails", async () => {
    const getAllOrdersPaginated = jest.fn();
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any, { getOrganizationTimezone: async () => { throw new Error("timezone unavailable"); } })["orders.search"]!;
    await expect(adapter.execute({ due: "overdue" }, context)).rejects.toThrow("timezone unavailable");
    expect(getAllOrdersPaginated).not.toHaveBeenCalled();
  });

  test("reports native later-page exhaustion without treating an empty page as zero matches", async () => {
    const getAllOrdersPaginated = jest.fn(async () => ({ items: [], totalCount: 23, page: 14, pageSize: 2, totalPages: 12, hasNext: false, hasPrev: true }));
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any)["orders.search"]!;
    const result = await adapter.execute({ page: 14, limit: 2 }, context);
    expect(result.data).toMatchObject({ totalMatchingOrders: 23, orders: [], pagination: { page: 14, totalPages: 12, hasNext: false, hasPrev: true } });
    expect(result.warning).toContain("23 matching orders");
  });

  test("retains the legacy status separately from the displayed pill", async () => {
    const getAllOrdersPaginated = jest.fn(async () => ({ items: [{ ...order("custom-pill", null), statusPillValue: "Print pending" }], totalCount: 1, page: 1, pageSize: 5, totalPages: 1, hasNext: false, hasPrev: false }));
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any)["orders.search"]!;
    const result = await adapter.execute({ status: "new" }, context);
    expect((result.data as any).orders[0]).toMatchObject({ status: "Print pending", legacyStatus: "new", state: "open" });
    expect(assistantOrderSearchInputSchema.parse({})).toMatchObject({ page: 1, limit: 5, sort: "newest" });
  });

  test.each<[string, Record<string, string>]>([
    ["newest", {}],
    ...["order_number", "customer", "total", "due_date", "status", "priority"].flatMap((sort) => ["asc", "desc"].map((dir): [string, Record<string, string>] => [
      `${sort}_${dir}`, { sortBy: sort === "order_number" ? "orderNumber" : sort === "due_date" ? "dueDate" : sort, sortDir: dir },
    ])),
  ])("preserves native %s ranking rather than sorting a bounded page", async (sort, expected) => {
    const getAllOrdersPaginated = jest.fn(async () => ({ items: [], totalCount: 0, page: 1, pageSize: 5, totalPages: 0, hasNext: false, hasPrev: false }));
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any)["orders.search"]!;
    await adapter.execute({ sort }, context);
    expect(getAllOrdersPaginated).toHaveBeenCalledWith("org-a", { ...expected as object, page: 1, pageSize: 5, includeThumbnails: false });
  });

  test("advertises every supported search qualification in the existing registry contract", () => {
    const definition = createAssistantToolRegistry().get("orders.search")!;
    expect(Object.keys((definition.providerInputSchema as any).properties).sort()).toEqual(Object.keys(assistantOrderSearchInputSchema.innerType().shape).sort());
    expect(definition.requiredPermission).toBe("internal_staff");
    expect(definition.description).toContain("not active production-job qualification");
  });

  test("retains the current orchestration authority check and audit for each search", async () => {
    const getAllOrdersPaginated = jest.fn(async () => ({ items: [order("authorized", null)], totalCount: 1, page: 1, pageSize: 5, totalPages: 1, hasNext: false, hasPrev: false }));
    const audit = jest.fn(async () => undefined);
    const service = new AssistantOrchestrationService(createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any), audit);
    const plan = { intent: "lookup" as const, selectedSkill: "order" as const, clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard" as const, toolCalls: [{ toolName: "orders.search" as const, arguments: { state: "open", sort: "newest" } }] };
    const trusted = { ...context, permissions: ["assistant.internal_staff"] };
    const allowed = await service.executePlan(plan, trusted);
    expect(allowed.executions[0]).toMatchObject({ status: "succeeded", result: { data: { orders: [{ orderId: "authorized" }], pagination: { page: 1 } } } });
    const denied = await service.executePlan(plan, { ...trusted, permissions: [] });
    expect(denied.executions[0]).toMatchObject({ status: "permission_denied" });
    expect(getAllOrdersPaginated).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ toolName: "orders.search", auditCategory: "assistant_order_search", status: "succeeded" }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ toolName: "orders.search", status: "permission_denied" }));
  });

  test("reads every requested native page without a hidden first-page cap or cached retry", async () => {
    const getAllOrdersPaginated = jest.fn(async (_organizationId: string, opts: any) => ({ items: [order(`page-${opts.page}`, null)], totalCount: 25, page: opts.page, pageSize: 1, totalPages: 25, hasNext: opts.page < 25, hasPrev: opts.page > 1 }));
    const adapter = createAssistantOrderSearchToolAdapters({ getAllOrdersPaginated } as any)["orders.search"]!;
    const pages = [1, 2, 21, 25];
    const results = [];
    for (const page of pages) results.push(await adapter.execute({ customerId: "customer-1", page, limit: 1 }, context));
    expect(getAllOrdersPaginated.mock.calls.map(([, opts]) => opts.page)).toEqual(pages);
    expect(results.map((result) => (result.data as any).orders[0].orderId)).toEqual(pages.map((page) => `page-${page}`));
    expect((results[3].data as any).pagination).toMatchObject({ hasNext: false, hasPrev: true, totalPages: 25 });
  });
});

function order(id: string, dueDate: string | null) {
  return { id, orderNumber: id, status: "new", state: "open", total: "125.00", createdAt: new Date("2026-08-12T10:00:00.000Z"), dueDate, priority: "normal", customer: { id: "customer-1", companyName: "Acme" } };
}
