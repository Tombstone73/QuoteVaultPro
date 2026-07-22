import { and, asc, desc, eq, gte, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import { customers, invoices, orderLineItems, orders, organizations, productionJobs } from "@shared/schema";
import { TERMINAL_PRODUCTION_STATUSES } from "@shared/operationalState";

export type AssistantOrderDueDateWindow = {
  startOfToday: Date;
  startOfTomorrow: Date;
  startOfDayAfterTomorrow: Date;
  startOfDayAfterWindow?: Date;
  rangeStart?: Date;
  rangeEnd?: Date;
};

export type AssistantOrderDueFilters = {
  due?: "overdue" | "due_today" | "due_tomorrow" | "due_within_days" | "date_range";
  status?: string;
  limit: number;
};

export type AssistantOrderDueRecord = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: string;
  dueDate: string;
  fulfillmentStatus: string | null;
  billingStatus: string | null;
  total: string | number | null;
  updatedAt: Date | string;
};

export type AssistantOrderDueOperationalSummary = {
  orderId: string;
  lineItemCount: number;
  incompleteLineItemCount: number;
  productionJobCount: number;
  activeProductionJobCount: number;
  invoiceState: string;
};

function effectiveDueDate() {
  // Production due date is the existing operational precedence used by the
  // Stage 7 production reporting surface. Keeping it here prevents an order
  // due result and a production board from disagreeing about the same order.
  return sql<string | null>`coalesce(${orders.productionDueDate}, ${orders.dueDate}, ${orders.promisedDate})`;
}

function dueCondition(due: ReturnType<typeof effectiveDueDate>, dates: AssistantOrderDueDateWindow, filter?: AssistantOrderDueFilters["due"]) {
  if (filter === "overdue") return and(isNotNull(due), lt(due, dates.startOfToday));
  if (filter === "due_today") return and(gte(due, dates.startOfToday), lt(due, dates.startOfTomorrow));
  if (filter === "due_tomorrow") return and(gte(due, dates.startOfTomorrow), lt(due, dates.startOfDayAfterTomorrow));
  if (filter === "due_within_days") return and(isNotNull(due), gte(due, dates.startOfToday), lt(due, dates.startOfDayAfterWindow ?? dates.startOfTomorrow));
  if (filter === "date_range") return and(isNotNull(due), gte(due, dates.rangeStart ?? dates.startOfToday), lt(due, dates.rangeEnd ?? dates.startOfTomorrow));
  return isNotNull(due);
}

function baseConditions(organizationId: string, due: ReturnType<typeof effectiveDueDate>, dates: AssistantOrderDueDateWindow, filters: AssistantOrderDueFilters) {
  return [
    eq(orders.organizationId, organizationId),
    dueCondition(due, dates, filters.due),
    ...(filters.status ? [eq(orders.status, filters.status)] : []),
  ];
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Tenant-bound order-level due reporting. This deliberately never starts from
 * production_jobs: each selected record is one persisted order. */
export class AssistantOrderDueSummaryRepository {
  async getOrganizationTimezone(organizationId: string): Promise<string | null> {
    const [organization] = await db.select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const settings = organization?.settings as Record<string, unknown> | null | undefined;
    const preferences = settings?.preferences as Record<string, unknown> | undefined;
    const timezone = settings?.timezone ?? preferences?.timezone;
    return typeof timezone === "string" && timezone.trim() ? timezone.trim() : null;
  }

  async countDueOrders(organizationId: string, dates: AssistantOrderDueDateWindow, filters: AssistantOrderDueFilters): Promise<number> {
    const due = effectiveDueDate();
    const [row] = await db.select({ total: sql<number>`count(*)` })
      .from(orders)
      .where(and(...baseConditions(organizationId, due, dates, filters)));
    return asNumber(row?.total);
  }

  async listDueOrders(organizationId: string, dates: AssistantOrderDueDateWindow, filters: AssistantOrderDueFilters): Promise<AssistantOrderDueRecord[]> {
    const due = effectiveDueDate();
    const overdueFirst = sql<number>`case when ${due} < ${dates.startOfToday} then 0 else 1 end`;
    const rows = await db.select({
      orderId: orders.id,
      orderNumber: sql<string>`coalesce(${orders.displayNumber}, ${orders.orderNumber})`,
      customerName: customers.companyName,
      status: orders.status,
      dueDate: due,
      fulfillmentStatus: orders.fulfillmentStatus,
      billingStatus: orders.billingStatus,
      total: orders.total,
      updatedAt: orders.updatedAt,
    }).from(orders)
      .innerJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
      .where(and(...baseConditions(organizationId, due, dates, filters)))
      // Stable ordered output: overdue work oldest first; all other date
      // buckets earliest first; order number and ID resolve timestamp ties.
      .orderBy(asc(overdueFirst), asc(due), asc(orders.orderNumber), asc(orders.id))
      .limit(filters.limit);
    return rows.flatMap((row) => row.dueDate ? [{ ...row, dueDate: row.dueDate }] : []);
  }

  async getDueOrderOperationalSummaries(organizationId: string, orderIds: string[]): Promise<AssistantOrderDueOperationalSummary[]> {
    if (!orderIds.length) return [];
    const activeJobCondition = notInArray(productionJobs.status, [...TERMINAL_PRODUCTION_STATUSES]);
    const rows = await db.select({
      orderId: orders.id,
      lineItemCount: sql<number>`(select count(*) from ${orderLineItems} where ${orderLineItems.orderId} = ${orders.id})`,
      incompleteLineItemCount: sql<number>`(select count(*) from ${orderLineItems} where ${orderLineItems.orderId} = ${orders.id} and lower(${orderLineItems.status}) not in ('completed', 'canceled', 'cancelled'))`,
      productionJobCount: sql<number>`(select count(*) from ${productionJobs} where ${productionJobs.organizationId} = ${organizationId} and ${productionJobs.orderId} = ${orders.id})`,
      activeProductionJobCount: sql<number>`(select count(*) from ${productionJobs} where ${productionJobs.organizationId} = ${organizationId} and ${productionJobs.orderId} = ${orders.id} and ${activeJobCondition})`,
      invoiceState: sql<string>`case when exists (select 1 from ${invoices} where ${invoices.organizationId} = ${organizationId} and ${invoices.orderId} = ${orders.id} and ${invoices.status} <> 'void') then 'invoiced' else 'not_invoiced' end`,
    }).from(orders)
      .where(and(eq(orders.organizationId, organizationId), inArray(orders.id, orderIds)));
    return rows.map((row) => ({
      orderId: row.orderId,
      lineItemCount: asNumber(row.lineItemCount),
      incompleteLineItemCount: asNumber(row.incompleteLineItemCount),
      productionJobCount: asNumber(row.productionJobCount),
      activeProductionJobCount: asNumber(row.activeProductionJobCount),
      invoiceState: row.invoiceState,
    }));
  }
}
