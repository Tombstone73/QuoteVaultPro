import { and, asc, eq, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { customers, orderLineItems, orders, organizations, productionJobs, products, stations } from "@shared/schema";
import { TERMINAL_PRODUCTION_STATUSES } from "@shared/operationalState";

/**
 * Narrow, tenant-bound projection for the operational assistant tools.  Due
 * dates belong to orders, rather than production jobs, so the effective due
 * date is consistently derived here with the documented precedence:
 * production due date, order due date, then promised date.
 */
export type AssistantProductionJobRecord = {
  jobId: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  label: string | null;
  stationKey: string;
  status: string;
  dueDate: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type AssistantProductionStationAggregate = {
  stationKey: string;
  activeJobs: number;
  queuedJobs: number;
  inProductionJobs: number;
  overdueJobs: number;
  dueTodayJobs: number;
  dueTomorrowJobs: number;
};

export type AssistantProductionDateWindow = {
  startOfToday: Date;
  startOfTomorrow: Date;
  startOfDayAfterTomorrow: Date;
};

export type AssistantProductionQueueFilters = {
  stationKey?: string;
  status?: "queued" | "in_progress" | "paused";
  due?: "overdue" | "today" | "tomorrow";
  includeOverdue?: boolean;
};

export type AssistantProductionStationRecord = {
  id: string;
  key: string;
  name: string;
  active: boolean;
};

const CLOSED_ORDER_STATES = ["closed", "canceled", "cancelled"];

function effectiveDueDate() {
  return sql<string | null>`coalesce(${orders.productionDueDate}, ${orders.dueDate}, ${orders.promisedDate})`;
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The aggregate is intentionally separate from the bounded urgent-job read:
 * a display limit must never change backlog counts.
 */
export class AssistantProductionReportingRepository {
  async getStations(organizationId: string): Promise<AssistantProductionStationRecord[]> {
    return db.select({ id: stations.id, key: stations.key, name: stations.name, active: stations.active })
      .from(stations)
      .where(eq(stations.organizationId, organizationId))
      .orderBy(asc(stations.sort), asc(stations.key));
  }

  async getOrganizationTimezone(organizationId: string): Promise<string | null> {
    const [organization] = await db.select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const settings = organization?.settings as Record<string, unknown> | null | undefined;
    const preferences = settings?.preferences as Record<string, unknown> | undefined;
    const value = settings?.timezone ?? preferences?.timezone;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  async getStationAggregates(
    organizationId: string,
    dates: AssistantProductionDateWindow,
    filters: AssistantProductionQueueFilters = {},
  ): Promise<AssistantProductionStationAggregate[]> {
    const due = effectiveDueDate();
    const conditions = this.baseConditions(organizationId, filters);
    const dueCondition = this.dueCondition(due, dates, filters.due, filters.includeOverdue);
    const rows = await db
      .select({
        stationKey: productionJobs.stationKey,
        activeJobs: sql<number>`count(*)`,
        queuedJobs: sql<number>`count(*) filter (where ${productionJobs.status} = 'queued')`,
        inProductionJobs: sql<number>`count(*) filter (where ${productionJobs.status} = 'in_progress')`,
        overdueJobs: sql<number>`count(*) filter (where ${due} is not null and ${due} < ${dates.startOfToday})`,
        dueTodayJobs: sql<number>`count(*) filter (where ${due} >= ${dates.startOfToday} and ${due} < ${dates.startOfTomorrow})`,
        dueTomorrowJobs: sql<number>`count(*) filter (where ${due} >= ${dates.startOfTomorrow} and ${due} < ${dates.startOfDayAfterTomorrow})`,
      })
      .from(productionJobs)
      .innerJoin(orders, and(eq(orders.id, productionJobs.orderId), eq(orders.organizationId, organizationId)))
      .where(and(...conditions, dueCondition))
      .groupBy(productionJobs.stationKey)
      .orderBy(asc(productionJobs.stationKey));

    return rows.map((row) => ({
      stationKey: row.stationKey,
      activeJobs: numeric(row.activeJobs),
      queuedJobs: numeric(row.queuedJobs),
      inProductionJobs: numeric(row.inProductionJobs),
      overdueJobs: numeric(row.overdueJobs),
      dueTodayJobs: numeric(row.dueTodayJobs),
      dueTomorrowJobs: numeric(row.dueTomorrowJobs),
    }));
  }

  async listUrgentJobs(
    organizationId: string,
    dates: AssistantProductionDateWindow,
    filters: AssistantProductionQueueFilters & { limit: number },
  ): Promise<AssistantProductionJobRecord[]> {
    const due = effectiveDueDate();
    const conditions = this.baseConditions(organizationId, filters);
    const dueCondition = this.dueCondition(due, dates, filters.due, filters.includeOverdue);
    const rows = await db
      .select({
        jobId: productionJobs.id,
        orderId: orders.id,
        orderNumber: orders.displayNumber,
        fallbackOrderNumber: orders.orderNumber,
        customerName: customers.companyName,
        lineItemDescription: orderLineItems.description,
        productName: products.name,
        stationKey: productionJobs.stationKey,
        status: productionJobs.status,
        dueDate: due,
        createdAt: productionJobs.createdAt,
        updatedAt: productionJobs.updatedAt,
      })
      .from(productionJobs)
      .innerJoin(orders, and(eq(orders.id, productionJobs.orderId), eq(orders.organizationId, organizationId)))
      .leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
      .leftJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId))
      .leftJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, organizationId)))
      .where(and(...conditions, dueCondition))
      // A null due date is explicitly last. Within due jobs, overdue work is
      // first, then earliest deadline, then stable job ID.
      .orderBy(
        sql`case when ${due} is null then 1 else 0 end`,
        sql`case when ${due} < ${dates.startOfToday} then 0 else 1 end`,
        asc(due),
        asc(productionJobs.id),
      )
      .limit(Math.min(Math.max(1, filters.limit), 20));

    return rows.map((row) => ({
      jobId: row.jobId,
      orderId: row.orderId,
      orderNumber: row.orderNumber ?? row.fallbackOrderNumber,
      customerName: row.customerName ?? null,
      label: row.lineItemDescription ?? row.productName ?? null,
      stationKey: row.stationKey,
      status: row.status,
      dueDate: row.dueDate ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async getOldestActiveJob(
    organizationId: string,
    filters: Pick<AssistantProductionQueueFilters, "stationKey" | "status"> = {},
  ): Promise<AssistantProductionJobRecord | null> {
    const rows = await this.listOldest(organizationId, filters);
    return rows[0] ?? null;
  }

  private async listOldest(organizationId: string, filters: Pick<AssistantProductionQueueFilters, "stationKey" | "status">) {
    const rows = await db
      .select({
        jobId: productionJobs.id,
        orderId: orders.id,
        orderNumber: orders.displayNumber,
        fallbackOrderNumber: orders.orderNumber,
        customerName: customers.companyName,
        lineItemDescription: orderLineItems.description,
        productName: products.name,
        stationKey: productionJobs.stationKey,
        status: productionJobs.status,
        dueDate: effectiveDueDate(),
        createdAt: productionJobs.createdAt,
        updatedAt: productionJobs.updatedAt,
      })
      .from(productionJobs)
      .innerJoin(orders, and(eq(orders.id, productionJobs.orderId), eq(orders.organizationId, organizationId)))
      .leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
      .leftJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId))
      .leftJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, organizationId)))
      .where(and(...this.baseConditions(organizationId, filters)))
      .orderBy(asc(productionJobs.createdAt), asc(productionJobs.id))
      .limit(1);
    return rows.map((row) => ({
      jobId: row.jobId, orderId: row.orderId, orderNumber: row.orderNumber ?? row.fallbackOrderNumber,
      customerName: row.customerName ?? null, label: row.lineItemDescription ?? row.productName ?? null,
      stationKey: row.stationKey, status: row.status, dueDate: row.dueDate ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    }));
  }

  private baseConditions(organizationId: string, filters: Pick<AssistantProductionQueueFilters, "stationKey" | "status">) {
    return [
      eq(productionJobs.organizationId, organizationId),
      notInArray(productionJobs.status, [...TERMINAL_PRODUCTION_STATUSES]),
      notInArray(orders.state, CLOSED_ORDER_STATES),
      filters.stationKey ? eq(productionJobs.stationKey, filters.stationKey) : undefined,
      filters.status ? eq(productionJobs.status, filters.status) : undefined,
    ].filter(Boolean) as any[];
  }

  private dueCondition(
    due: ReturnType<typeof effectiveDueDate>,
    dates: AssistantProductionDateWindow,
    filter: AssistantProductionQueueFilters["due"],
    includeOverdue: boolean | undefined,
  ) {
    if (filter === "overdue") return and(isNotNull(due), sql`${due} < ${dates.startOfToday}`);
    if (filter === "today") return and(isNotNull(due), sql`${due} >= ${dates.startOfToday}`, sql`${due} < ${dates.startOfTomorrow}`);
    if (filter === "tomorrow") return and(isNotNull(due), sql`${due} >= ${dates.startOfTomorrow}`, sql`${due} < ${dates.startOfDayAfterTomorrow}`);
    if (includeOverdue === false) return or(sql`${due} is null`, sql`${due} >= ${dates.startOfToday}`);
    return undefined;
  }
}
