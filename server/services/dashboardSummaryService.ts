import { and, eq, gte, inArray, lt, not, sql } from "drizzle-orm";
import { db } from "../db";
import { invoices, materials, orders, organizations, payments, productionJobs, quotes } from "@shared/schema";

export type DashboardSummary = {
  criticalAlerts: {
    dueToday: number | null;
    dueTomorrow: number | null;
    lowInventoryItems: number | null;
    quotesPending: number | null;
    overdueInvoices: number | null;
  };
  ordersPipeline: {
    newOrders: number | null;
    scheduled: number | null;
    inProduction: number | null;
    readyForPickup: number | null;
    onHold: number | null;
    slaRisk: number | null;
  };
  productionJobs: {
    artworkPending: number | null;
    printing: number | null;
    finishing: number | null;
    qaInspection: number | null;
  };
  fulfillmentFinance: {
    readyToShip: number | null;
    shippedToday: number | null;
    invoicesUnpaid: number | null;
    overdueAmountCents: number | null;
    collectedTodayCents: number | null;
    collectedWeekCents: number | null;
  };
};

const DEFAULT_SUMMARY: DashboardSummary = {
  criticalAlerts: {
    dueToday: null,
    dueTomorrow: null,
    lowInventoryItems: null,
    quotesPending: null,
    overdueInvoices: null,
  },
  ordersPipeline: {
    newOrders: null,
    scheduled: null,
    inProduction: null,
    readyForPickup: null,
    onHold: null,
    slaRisk: null,
  },
  productionJobs: {
    artworkPending: null,
    printing: null,
    finishing: null,
    qaInspection: null,
  },
  fulfillmentFinance: {
    readyToShip: null,
    shippedToday: null,
    invoicesUnpaid: null,
    overdueAmountCents: null,
    collectedTodayCents: null,
    collectedWeekCents: null,
  },
};

type DashboardKpiStatusMap = {
  ordersPipeline?: {
    scheduled?: string[];
    readyForPickup?: string[];
  };
  productionJobs?: {
    printing?: string[];
    finishing?: string[];
    qaInspection?: string[];
  };
};

function isDev() {
  return (process.env.NODE_ENV || "").toLowerCase() !== "production";
}

function devWarn(message: string, context?: Record<string, unknown>) {
  if (!isDev()) return;
  console.warn("[dashboard-summary]", message, context ?? "");
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfWeekMonday(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

async function countFrom(query: Promise<Array<{ count: number }>>): Promise<number> {
  const rows = await query;
  return Number(rows[0]?.count ?? 0);
}

function normalizeStringArray(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  return raw.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0);
}

async function loadDashboardKpiStatusMap(organizationId: string): Promise<DashboardKpiStatusMap | null> {
  try {
    const rows = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    const settings = (rows[0]?.settings as any) ?? {};
    const rawMap = settings?.preferences?.dashboardKpiStatusMap;
    if (!rawMap || typeof rawMap !== "object") return null;

    return {
      ordersPipeline: {
        scheduled: normalizeStringArray(rawMap?.ordersPipeline?.scheduled),
        readyForPickup: normalizeStringArray(rawMap?.ordersPipeline?.readyForPickup),
      },
      productionJobs: {
        printing: normalizeStringArray(rawMap?.productionJobs?.printing),
        finishing: normalizeStringArray(rawMap?.productionJobs?.finishing),
        qaInspection: normalizeStringArray(rawMap?.productionJobs?.qaInspection),
      },
    };
  } catch (error) {
    console.error("[dashboard-summary] loadDashboardKpiStatusMap failed:", error);
    return null;
  }
}

export async function getDashboardSummary(organizationId: string): Promise<DashboardSummary> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const dayAfterTomorrowStart = addDays(todayStart, 2);
  const weekStart = startOfWeekMonday(now);
  const todayStartIso = todayStart.toISOString();
  const tomorrowStartIso = tomorrowStart.toISOString();
  const dayAfterTomorrowStartIso = dayAfterTomorrowStart.toISOString();
  const kpiStatusMap = await loadDashboardKpiStatusMap(organizationId);

  const countOrdersByMappedStatuses = async (statuses: string[] | undefined): Promise<number | null> => {
    if (statuses === undefined) return null;
    if (statuses.length === 0) return 0;
    return countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.organizationId, organizationId), inArray(orders.status, statuses))),
    );
  };

  const countProductionByMappedStepKeys = async (stepKeys: string[] | undefined): Promise<number | null> => {
    if (stepKeys === undefined) return null;
    if (stepKeys.length === 0) return 0;
    return countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(productionJobs)
        .where(
          and(
            eq(productionJobs.organizationId, organizationId),
            not(eq(productionJobs.status, "done")),
            inArray(productionJobs.stepKey, stepKeys),
          ),
        ),
    );
  };

  const summary: DashboardSummary = {
    ...DEFAULT_SUMMARY,
    criticalAlerts: { ...DEFAULT_SUMMARY.criticalAlerts },
    ordersPipeline: { ...DEFAULT_SUMMARY.ordersPipeline },
    productionJobs: { ...DEFAULT_SUMMARY.productionJobs },
    fulfillmentFinance: { ...DEFAULT_SUMMARY.fulfillmentFinance },
  };

  // Critical Alerts
  try {
    summary.criticalAlerts.dueToday = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            gte(orders.dueDate, todayStartIso),
            lt(orders.dueDate, tomorrowStartIso),
            not(eq(orders.state, "closed")),
            not(eq(orders.state, "canceled")),
          ),
        ),
    );

    summary.criticalAlerts.dueTomorrow = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            gte(orders.dueDate, tomorrowStartIso),
            lt(orders.dueDate, dayAfterTomorrowStartIso),
            not(eq(orders.state, "closed")),
            not(eq(orders.state, "canceled")),
          ),
        ),
    );

    summary.criticalAlerts.lowInventoryItems = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(materials)
        .where(
          and(
            eq(materials.organizationId, organizationId),
            eq(materials.isActive, true),
            sql`${materials.stockQuantity} <= ${materials.minStockAlert}`,
          ),
        ),
    );

    summary.criticalAlerts.quotesPending = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(quotes)
        .where(
          and(
            eq(quotes.organizationId, organizationId),
            inArray(quotes.status, ["pending_approval", "pending"]),
          ),
        ),
    );

    summary.criticalAlerts.overdueInvoices = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            not(inArray(invoices.status, ["paid", "void"])),
            lt(invoices.dueDate, now),
          ),
        ),
    );
  } catch (error) {
    console.error("[dashboard-summary] criticalAlerts failed:", error);
  }

  // Orders Pipeline
  try {
    summary.ordersPipeline.newOrders = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.organizationId, organizationId), eq(orders.status, "new"))),
    );

    summary.ordersPipeline.inProduction = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.organizationId, organizationId), eq(orders.status, "in_production"))),
    );

    summary.ordersPipeline.onHold = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.organizationId, organizationId), eq(orders.status, "on_hold"))),
    );

    summary.ordersPipeline.scheduled = await countOrdersByMappedStatuses(kpiStatusMap?.ordersPipeline?.scheduled);
    summary.ordersPipeline.readyForPickup = await countOrdersByMappedStatuses(kpiStatusMap?.ordersPipeline?.readyForPickup);
    summary.ordersPipeline.slaRisk = null;
    if (summary.ordersPipeline.scheduled === null) {
      devWarn("ordersPipeline.scheduled is null (missing dashboardKpiStatusMap.ordersPipeline.scheduled)");
    }
    if (summary.ordersPipeline.readyForPickup === null) {
      devWarn("ordersPipeline.readyForPickup is null (missing dashboardKpiStatusMap.ordersPipeline.readyForPickup)");
    }
    devWarn("ordersPipeline.slaRisk is null (no SLA definition in schema)");
  } catch (error) {
    console.error("[dashboard-summary] ordersPipeline failed:", error);
  }

  // Production Jobs
  try {
    summary.productionJobs.artworkPending = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(productionJobs)
        .where(
          and(
            eq(productionJobs.organizationId, organizationId),
            eq(productionJobs.stepKey, "prepress"),
            not(eq(productionJobs.status, "done")),
          ),
        ),
    );

    // Directly definable from current production stepKey usage.
    const mappedPrinting = await countProductionByMappedStepKeys(kpiStatusMap?.productionJobs?.printing);
    const mappedFinishing = await countProductionByMappedStepKeys(kpiStatusMap?.productionJobs?.finishing);
    const mappedQaInspection = await countProductionByMappedStepKeys(kpiStatusMap?.productionJobs?.qaInspection);

    summary.productionJobs.printing =
      mappedPrinting ??
      (await countFrom(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(productionJobs)
          .where(
            and(
              eq(productionJobs.organizationId, organizationId),
              eq(productionJobs.stepKey, "printing"),
              not(eq(productionJobs.status, "done")),
            ),
          ),
      ));

    summary.productionJobs.finishing =
      mappedFinishing ??
      (await countFrom(
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(productionJobs)
          .where(
            and(
              eq(productionJobs.organizationId, organizationId),
              eq(productionJobs.stepKey, "finishing"),
              not(eq(productionJobs.status, "done")),
            ),
          ),
      ));

    summary.productionJobs.qaInspection = mappedQaInspection;
    if (summary.productionJobs.qaInspection === null) {
      devWarn("productionJobs.qaInspection is null (missing dashboardKpiStatusMap.productionJobs.qaInspection)");
    }
  } catch (error) {
    console.error("[dashboard-summary] productionJobs failed:", error);
  }

  // Fulfillment & Finance
  try {
    summary.fulfillmentFinance.readyToShip = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.organizationId, organizationId), eq(orders.status, "ready_for_shipment"))),
    );

    summary.fulfillmentFinance.shippedToday = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            gte(orders.shippedAt, todayStartIso),
            lt(orders.shippedAt, tomorrowStartIso),
          ),
        ),
    );

    summary.fulfillmentFinance.invoicesUnpaid = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .where(and(eq(invoices.organizationId, organizationId), not(inArray(invoices.status, ["paid", "void"])))),
    );

    const overdueAmountRows = await db
      .select({ cents: sql<number>`coalesce(sum(round(${invoices.balanceDue} * 100)), 0)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          not(inArray(invoices.status, ["paid", "void"])),
          lt(invoices.dueDate, now),
        ),
      );
    summary.fulfillmentFinance.overdueAmountCents = Number(overdueAmountRows[0]?.cents ?? 0);

    const collectedTodayRows = await db
      .select({ cents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int` })
      .from(payments)
      .where(
        and(
          eq(payments.organizationId, organizationId),
          eq(payments.status, "succeeded"),
          gte(payments.appliedAt, todayStart),
          lt(payments.appliedAt, tomorrowStart),
        ),
      );
    summary.fulfillmentFinance.collectedTodayCents = Number(collectedTodayRows[0]?.cents ?? 0);

    const collectedWeekRows = await db
      .select({ cents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int` })
      .from(payments)
      .where(
        and(
          eq(payments.organizationId, organizationId),
          eq(payments.status, "succeeded"),
          gte(payments.appliedAt, weekStart),
          lt(payments.appliedAt, tomorrowStart),
        ),
      );
    summary.fulfillmentFinance.collectedWeekCents = Number(collectedWeekRows[0]?.cents ?? 0);
  } catch (error) {
    console.error("[dashboard-summary] fulfillmentFinance failed:", error);
  }

  return summary;
}
