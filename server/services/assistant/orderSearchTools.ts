import { assistantOrderSearchInputSchema, assistantOrderSearchResultSchema, type AssistantToolResultEnvelope } from "@shared/assistantContracts";
import type { OrdersRepository } from "../../storage/orders.repo";
import type { AssistantToolAdapters } from "./toolRegistry";
import { businessDateForOrderDueFilter } from "../../lib/orderDueDate";
type OrderSearchRepository = Pick<OrdersRepository, "getAllOrdersPaginated">;
interface OrderSearchDependencies {
  now?: () => Date;
  getOrganizationTimezone?: (organizationId: string) => Promise<string>;
}
const sorts: Record<string, { sortBy?: string; sortDir?: "asc" | "desc" }> = {
  newest: {}, order_number_asc: { sortBy: "orderNumber", sortDir: "asc" }, order_number_desc: { sortBy: "orderNumber", sortDir: "desc" }, customer_asc: { sortBy: "customer", sortDir: "asc" }, customer_desc: { sortBy: "customer", sortDir: "desc" }, total_asc: { sortBy: "total", sortDir: "asc" }, total_desc: { sortBy: "total", sortDir: "desc" }, due_date_asc: { sortBy: "dueDate", sortDir: "asc" }, due_date_desc: { sortBy: "dueDate", sortDir: "desc" }, status_asc: { sortBy: "status", sortDir: "asc" }, status_desc: { sortBy: "status", sortDir: "desc" }, priority_asc: { sortBy: "priority", sortDir: "asc" }, priority_desc: { sortBy: "priority", sortDir: "desc" },
};
const iso = (value: Date | string | null | undefined) => value ? (value instanceof Date ? value : new Date(value)).toISOString() : undefined;
export function createAssistantOrderSearchToolAdapters(repository?: OrderSearchRepository, dependencies: OrderSearchDependencies = {}): AssistantToolAdapters {
  return { "orders.search": { async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
    const input = assistantOrderSearchInputSchema.parse(rawInput);
    const activeRepository = repository ?? new (await import("../../storage/orders.repo")).OrdersRepository();
    const now = (dependencies.now ?? (() => new Date()))();
    // Exactly the native paginated Orders route's tenant-calendar resolution.
    // Never substitute production due dates, infer active jobs from a pill, or
    // filter a bounded page locally before claiming a ranked population.
    const dueDatePart = input.due
      ? businessDateForOrderDueFilter(input.due, now, await (dependencies.getOrganizationTimezone
        ?? (await import("../orderDueDateService")).getOrganizationTimezone)(context.scope.organizationId))
      : undefined;
    const result = await activeRepository.getAllOrdersPaginated(context.scope.organizationId, {
      ...(input.query ? { search: input.query } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.state ? { state: input.state } : {}),
      ...(input.statusPillId ? { statusPillId: input.statusPillId } : {}),
      ...(input.statusPillIds !== undefined ? { statusPillIds: input.statusPillIds } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.createdAtRange ? { startDate: input.createdAtRange.start, endDate: input.createdAtRange.end } : {}),
      ...(input.due ? { dueFilter: input.due, dueDatePart } : {}),
      ...sorts[input.sort], page: input.page, pageSize: input.limit, includeThumbnails: false,
    });
    const capturedAt = now.toISOString();
    const rows = result.items.map((item: any) => { const order = item.order ?? item; const name = item.customer?.companyName || "Unassigned customer"; const sourceLink = { label: order.displayNumber || order.orderNumber, href: `/orders/${order.id}`, entityType: "order" as const, entityId: order.id, capturedAt }; return { orderId: order.id, orderNumber: order.displayNumber || order.orderNumber, customer: { ...(item.customer?.id ? { id: item.customer.id, sourceLink: { label: name, href: `/customers/${item.customer.id}`, entityType: "customer" as const, entityId: item.customer.id, capturedAt } } : {}), name }, status: order.statusPillValue || order.status, legacyStatus: order.status, state: order.state || order.status, total: Number(order.total || 0), createdAt: iso(order.createdAt)!, ...(iso(order.dueDate) ? { dueDate: iso(order.dueDate) } : {}), priority: order.priority || "normal", sourceLink }; });
    const { page, pageSize, totalPages, hasNext, hasPrev } = result;
    return {
      status: "succeeded",
      data: assistantOrderSearchResultSchema.parse({ totalMatchingOrders: result.totalCount, orders: rows, appliedFilters: input, pagination: { page, pageSize, totalPages, hasNext, hasPrev } }),
      ...(result.totalCount > rows.length ? { warning: `Showing page ${page} with ${rows.length} of ${result.totalCount} matching orders. Use page to read other results; this page is not the complete matching population.` } : {}),
      provenance: { sourceLinks: rows.slice(0, 10).map((row) => row.sourceLink), freshness: { capturedAt } },
    };
  } } };
}
