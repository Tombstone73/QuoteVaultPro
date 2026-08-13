import { assistantOrderSearchInputSchema, assistantOrderSearchResultSchema, type AssistantToolResultEnvelope } from "@shared/assistantContracts";
import type { OrdersRepository } from "../../storage/orders.repo";
import type { AssistantToolAdapters } from "./toolRegistry";
type OrderSearchRepository = Pick<OrdersRepository, "getAllOrdersPaginated">;
const sorts: Record<string, { sortBy?: string; sortDir?: "asc" | "desc" }> = {
  newest: {}, order_number_asc: { sortBy: "orderNumber", sortDir: "asc" }, order_number_desc: { sortBy: "orderNumber", sortDir: "desc" }, customer_asc: { sortBy: "customer", sortDir: "asc" }, customer_desc: { sortBy: "customer", sortDir: "desc" }, total_asc: { sortBy: "total", sortDir: "asc" }, total_desc: { sortBy: "total", sortDir: "desc" }, due_date_asc: { sortBy: "dueDate", sortDir: "asc" }, due_date_desc: { sortBy: "dueDate", sortDir: "desc" }, status_asc: { sortBy: "status", sortDir: "asc" }, status_desc: { sortBy: "status", sortDir: "desc" }, priority_asc: { sortBy: "priority", sortDir: "asc" }, priority_desc: { sortBy: "priority", sortDir: "desc" },
};
const iso = (value: Date | string | null | undefined) => value ? (value instanceof Date ? value : new Date(value)).toISOString() : undefined;
export function createAssistantOrderSearchToolAdapters(repository?: OrderSearchRepository): AssistantToolAdapters {
  return { "orders.search": { async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
    const input = assistantOrderSearchInputSchema.parse(rawInput);
    const activeRepository = repository ?? new (await import("../../storage/orders.repo")).OrdersRepository();
    const result = await activeRepository.getAllOrdersPaginated(context.scope.organizationId, { ...(input.query ? { search: input.query } : {}), ...(input.status ? { status: input.status } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.customerId ? { customerId: input.customerId } : {}), ...(input.createdAtRange ? { startDate: input.createdAtRange.start, endDate: input.createdAtRange.end } : {}), ...sorts[input.sort], page: 1, pageSize: input.limit, includeThumbnails: false });
    const capturedAt = new Date().toISOString();
    const rows = result.items.map((item: any) => { const order = item.order ?? item; const name = item.customer?.companyName || "Unassigned customer"; const sourceLink = { label: order.displayNumber || order.orderNumber, href: `/orders/${order.id}`, entityType: "order" as const, entityId: order.id, capturedAt }; return { orderId: order.id, orderNumber: order.displayNumber || order.orderNumber, customer: { ...(item.customer?.id ? { id: item.customer.id, sourceLink: { label: name, href: `/customers/${item.customer.id}`, entityType: "customer" as const, entityId: item.customer.id, capturedAt } } : {}), name }, status: order.statusPillValue || order.status, state: order.state || order.status, total: Number(order.total || 0), createdAt: iso(order.createdAt)!, ...(iso(order.dueDate) ? { dueDate: iso(order.dueDate) } : {}), priority: order.priority || "normal", sourceLink }; });
    return { status: "succeeded", data: assistantOrderSearchResultSchema.parse({ totalMatchingOrders: result.totalCount, orders: rows, appliedFilters: { sort: input.sort, limit: input.limit } }), provenance: { sourceLinks: rows.slice(0, 10).map((row) => row.sourceLink), freshness: { capturedAt } } };
  } } };
}
