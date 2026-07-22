import { and, asc, eq, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { customers, orderLineItems, orders, organizations, productionJobs, stations } from "@shared/schema";
import { TERMINAL_PRODUCTION_STATUSES } from "@shared/operationalState";
import { fulfillmentQueueEligibleOrderCondition } from "../services/fulfillment/eligibility";

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
  /** A stable, server-derived ordinal within the order. Never a model value. */
  lineItemId: string | null;
  lineItemSequence: number | null;
  lineItemLabel: string | null;
  orderedQuantity: number | null;
  /**
   * There is no persisted production-required quantity on production_jobs or
   * production_events. Keeping this null prevents line quantity from being
   * mislabeled as sheets, prints, or another production unit.
   */
  productionRequiredQuantity: number | null;
  completedQuantity: number | null;
  remainingQuantity: number | null;
  quantityUnit: string | null;
  progressAvailable: boolean;
  progressSource: "unavailable";
  progressWarning: string;
  productionStep: string;
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
  activeLineItems: number;
  uniqueOrders: number;
  /** Quantity progress is deliberately not synthesized from job status. */
  progressAvailableJobs: number;
  confirmedRemainingQuantity: number | null;
  queuedJobs: number;
  inProductionJobs: number;
  overdueJobs: number;
  dueTodayJobs: number;
  dueTomorrowJobs: number;
};

/** Global counts are queried independently of station aggregates so an order
 * that has jobs at several stations is never counted twice in a headline. */
export type AssistantProductionScopeTotals = {
  activeJobs: number;
  activeLineItems: number;
  uniqueOrders: number;
  progressAvailableJobs: number;
  confirmedRemainingQuantity: number | null;
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
  /** Inclusive calendar window beginning at the organization's current day. */
  dueWithinDays?: number;
};

/** A fulfillment queue row is intentionally order-backed. Once an order is
 * production-complete there may no longer be an active production-job row to
 * present, so fabricating a job identifier would be misleading. */
export type AssistantFulfillmentReadyOrderRecord = {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  fulfillmentStatus: string | null;
  dueDate: string | null;
  readySince: Date | string | null;
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

/**
 * A queue slice may omit earlier or terminal jobs, so a window function over
 * the reporting result would produce a misleading Line 1. Count against the
 * full persisted order-line set instead, ordered by the canonical sortOrder
 * with line ID as the stable tie-breaker.
 */
function canonicalLineItemSequence() {
  return sql<number | null>`case when ${orderLineItems.id} is null then null else (
    select count(*)
    from order_line_items as assistant_line_sequence
    where assistant_line_sequence.order_id = ${orders.id}
      and (
        assistant_line_sequence.sort_order < ${orderLineItems.sortOrder}
        or (
          assistant_line_sequence.sort_order = ${orderLineItems.sortOrder}
          and assistant_line_sequence.id <= ${orderLineItems.id}
        )
      )
  ) end`;
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const PROGRESS_UNAVAILABLE_WARNING = "Completed and remaining production quantity are unavailable because the deployed production job and event records do not store authoritative quantity progress.";

type ProductionJobRow = {
  jobId: string;
  orderId: string;
  orderNumber: string | null;
  fallbackOrderNumber: string | null;
  customerName: string | null;
  lineItemId: string | null;
  lineItemSequence: number | string | null;
  lineItemDescription: string | null;
  orderedQuantity: number | string | null;
  stationKey: string;
  stepKey: string;
  status: string;
  dueDate: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

/**
 * Enrichment joins must never change the identity of the production queue.
 * The only safe deduplication key is the canonical production-job ID. This
 * intentionally does not merge jobs that share an order, line, label, or
 * station: those can all legitimately repeat.
 */
export function normalizeAssistantProductionJobRows(rows: ProductionJobRow[]): AssistantProductionJobRecord[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (!row.jobId || seen.has(row.jobId)) return [];
    seen.add(row.jobId);
    const orderedQuantity = row.orderedQuantity === null || row.orderedQuantity === undefined
      ? null
      : Number.isFinite(Number(row.orderedQuantity)) ? Number(row.orderedQuantity) : null;
    return [{
      jobId: row.jobId,
      orderId: row.orderId,
      orderNumber: row.orderNumber ?? row.fallbackOrderNumber ?? "Order",
      customerName: row.customerName ?? null,
      lineItemId: row.lineItemId ?? null,
      lineItemSequence: row.lineItemSequence === null || row.lineItemSequence === undefined ? null : numeric(row.lineItemSequence),
      // description is the persisted order-line snapshot. It must win over
      // current product metadata, which may have changed after the sale.
      lineItemLabel: row.lineItemDescription?.trim() || null,
      orderedQuantity,
      productionRequiredQuantity: null,
      completedQuantity: null,
      remainingQuantity: null,
      quantityUnit: null,
      progressAvailable: false,
      progressSource: "unavailable",
      progressWarning: PROGRESS_UNAVAILABLE_WARNING,
      productionStep: row.stepKey,
      label: row.lineItemDescription?.trim() || null,
      stationKey: row.stationKey,
      status: row.status,
      dueDate: row.dueDate ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }];
  });
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
    const dueCondition = this.dueCondition(due, dates, filters.due, filters.includeOverdue, filters.dueWithinDays);
    const rows = await db
      .select({
        stationKey: productionJobs.stationKey,
        activeJobs: sql<number>`count(*)`,
        activeLineItems: sql<number>`count(distinct ${productionJobs.lineItemId})`,
        uniqueOrders: sql<number>`count(distinct ${orders.id})`,
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
      activeLineItems: numeric(row.activeLineItems),
      uniqueOrders: numeric(row.uniqueOrders),
      progressAvailableJobs: 0,
      confirmedRemainingQuantity: null,
      queuedJobs: numeric(row.queuedJobs),
      inProductionJobs: numeric(row.inProductionJobs),
      overdueJobs: numeric(row.overdueJobs),
      dueTodayJobs: numeric(row.dueTodayJobs),
      dueTomorrowJobs: numeric(row.dueTomorrowJobs),
    }));
  }

  async getProductionScopeTotals(
    organizationId: string,
    dates: AssistantProductionDateWindow,
    filters: AssistantProductionQueueFilters = {},
  ): Promise<AssistantProductionScopeTotals> {
    const due = effectiveDueDate();
    const conditions = this.baseConditions(organizationId, filters);
    const dueCondition = this.dueCondition(due, dates, filters.due, filters.includeOverdue, filters.dueWithinDays);
    const [row] = await db.select({
      activeJobs: sql<number>`count(*)`,
      activeLineItems: sql<number>`count(distinct ${productionJobs.lineItemId})`,
      uniqueOrders: sql<number>`count(distinct ${orders.id})`,
    }).from(productionJobs)
      .innerJoin(orders, and(eq(orders.id, productionJobs.orderId), eq(orders.organizationId, organizationId)))
      .where(and(...conditions, dueCondition));
    return {
      activeJobs: numeric(row?.activeJobs), activeLineItems: numeric(row?.activeLineItems), uniqueOrders: numeric(row?.uniqueOrders),
      progressAvailableJobs: 0, confirmedRemainingQuantity: null,
    };
  }

  async listUrgentJobs(
    organizationId: string,
    dates: AssistantProductionDateWindow,
    filters: AssistantProductionQueueFilters & { limit: number },
  ): Promise<AssistantProductionJobRecord[]> {
    const due = effectiveDueDate();
    const conditions = this.baseConditions(organizationId, filters);
    const dueCondition = this.dueCondition(due, dates, filters.due, filters.includeOverdue, filters.dueWithinDays);
    const rows = await db
      .select({
        jobId: productionJobs.id,
        orderId: orders.id,
        orderNumber: orders.displayNumber,
        fallbackOrderNumber: orders.orderNumber,
        customerName: customers.companyName,
        lineItemId: orderLineItems.id,
        lineItemSequence: canonicalLineItemSequence(),
        lineItemDescription: orderLineItems.description,
        orderedQuantity: orderLineItems.quantity,
        stationKey: productionJobs.stationKey,
        stepKey: productionJobs.stepKey,
        status: productionJobs.status,
        dueDate: due,
        createdAt: productionJobs.createdAt,
        updatedAt: productionJobs.updatedAt,
      })
      .from(productionJobs)
      .innerJoin(orders, and(eq(orders.id, productionJobs.orderId), eq(orders.organizationId, organizationId)))
      .leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
      // The order equality makes a corrupt or cross-order line-item reference
      // non-enriching instead of allowing it to borrow another order's line.
      .leftJoin(orderLineItems, and(eq(orderLineItems.id, productionJobs.lineItemId), eq(orderLineItems.orderId, orders.id)))
      .where(and(...conditions, dueCondition))
      // A null due date is explicitly last. Within due jobs, overdue work is
      // first, then earliest deadline, then stable job ID.
      .orderBy(
        sql`case when ${due} is null then 1 else 0 end`,
        sql`case when ${due} < ${dates.startOfToday} then 0 else 1 end`,
        asc(due),
        // Priority is an existing canonical order field. It is only a tie
        // breaker after the documented deadline ordering, never a predictive
        // lateness score.
        sql`case when lower(coalesce(${orders.priority}, '')) in ('rush', 'urgent') then 0 else 1 end`,
        asc(productionJobs.id),
      )
      .limit(Math.min(Math.max(1, filters.limit), 20));

    return normalizeAssistantProductionJobRows(rows);
  }

  /**
   * Read a bounded slice of the canonical fulfillment queue. The predicate is
   * shared with the fulfillment service so this never substitutes a looser
   * status heuristic for fulfillment readiness.
   */
  async listReadyForFulfillmentOrders(
    organizationId: string,
    limit: number,
  ): Promise<AssistantFulfillmentReadyOrderRecord[]> {
    const due = effectiveDueDate();
    const rows = await db
      .select({
        orderId: orders.id,
        orderNumber: orders.displayNumber,
        fallbackOrderNumber: orders.orderNumber,
        customerName: customers.companyName,
        fulfillmentStatus: orders.fulfillmentStatus,
        dueDate: due,
        readySince: sql<Date | string | null>`coalesce(${orders.productionCompletedAt}, ${orders.updatedAt})`,
      })
      .from(orders)
      .leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
      .where(fulfillmentQueueEligibleOrderCondition(organizationId))
      // A ready order with a due date should be surfaced before an undated
      // order. This is deterministic and keeps the assistant's small result
      // window useful without inventing a fulfillment priority score.
      .orderBy(sql`case when ${due} is null then 1 else 0 end`, asc(due), asc(orders.id))
      .limit(Math.min(Math.max(1, limit), 20));

    return rows.map((row) => ({
      orderId: row.orderId,
      orderNumber: row.orderNumber ?? row.fallbackOrderNumber,
      customerName: row.customerName ?? null,
      fulfillmentStatus: row.fulfillmentStatus ?? null,
      dueDate: row.dueDate ?? null,
      readySince: row.readySince ?? null,
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
        lineItemId: orderLineItems.id,
        lineItemSequence: canonicalLineItemSequence(),
        lineItemDescription: orderLineItems.description,
        orderedQuantity: orderLineItems.quantity,
        stationKey: productionJobs.stationKey,
        stepKey: productionJobs.stepKey,
        status: productionJobs.status,
        dueDate: effectiveDueDate(),
        createdAt: productionJobs.createdAt,
        updatedAt: productionJobs.updatedAt,
      })
      .from(productionJobs)
      .innerJoin(orders, and(eq(orders.id, productionJobs.orderId), eq(orders.organizationId, organizationId)))
      .leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
      .leftJoin(orderLineItems, and(eq(orderLineItems.id, productionJobs.lineItemId), eq(orderLineItems.orderId, orders.id)))
      .where(and(...this.baseConditions(organizationId, filters)))
      .orderBy(asc(productionJobs.createdAt), asc(productionJobs.id))
      .limit(1);
    return normalizeAssistantProductionJobRows(rows);
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
    dueWithinDays: number | undefined,
  ) {
    if (filter === "overdue") return and(isNotNull(due), sql`${due} < ${dates.startOfToday}`);
    if (filter === "today") return and(isNotNull(due), sql`${due} >= ${dates.startOfToday}`, sql`${due} < ${dates.startOfTomorrow}`);
    if (filter === "tomorrow") return and(isNotNull(due), sql`${due} >= ${dates.startOfTomorrow}`, sql`${due} < ${dates.startOfDayAfterTomorrow}`);
    if (typeof dueWithinDays === "number") {
      const days = Math.min(Math.max(1, Math.floor(dueWithinDays)), 31);
      const end = new Date(dates.startOfToday.getTime() + days * 86_400_000);
      return and(isNotNull(due), sql`${due} >= ${dates.startOfToday}`, sql`${due} < ${end}`);
    }
    if (includeOverdue === false) return or(sql`${due} is null`, sql`${due} >= ${dates.startOfToday}`);
    return undefined;
  }
}
