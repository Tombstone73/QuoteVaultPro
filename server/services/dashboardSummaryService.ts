import { and, eq, gte, inArray, isNull, lt, not, or, sql } from "drizzle-orm";
import { db } from "../db";
import { invoices, materials, orders, payments, productionJobs, quotes, vendors } from "@shared/schema";
import { FulfillmentDashboardRepo } from "./fulfillment/repository";
import {
  activeOrderDuePredicates,
  businessDateForOrderDueFilter,
  getOrganizationTimezone,
} from "./orderDueDateService";

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
    unassignedJobs: number | null;
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

export type LowInventoryDashboardItem = {
  id: string;
  name: string;
  currentQty: number;
  reorderThreshold: number;
  unit: string | null;
  supplier: string | null;
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
    unassignedJobs: null,
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

export async function getLowInventoryDashboardItems(
  organizationId: string,
  limit = 25,
): Promise<LowInventoryDashboardItem[]> {
  const cappedLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const rows = await db
    .select({
      id: materials.id,
      name: materials.name,
      stockQuantity: materials.stockQuantity,
      minStockAlert: materials.minStockAlert,
      inventoryUnit: materials.inventoryUnit,
      vendorName: vendors.name,
    })
    .from(materials)
    .leftJoin(vendors, eq(vendors.id, materials.preferredVendorId))
    .where(
      and(
        eq(materials.organizationId, organizationId),
        eq(materials.isActive, true),
        sql`${materials.stockQuantity} <= ${materials.minStockAlert}`,
      ),
    )
    .orderBy(sql`(${materials.stockQuantity} - ${materials.minStockAlert}) ASC`, materials.name)
    .limit(cappedLimit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    currentQty: Number(row.stockQuantity ?? 0),
    reorderThreshold: Number(row.minStockAlert ?? 0),
    unit: row.inventoryUnit || null,
    supplier: row.vendorName || null,
  }));
}

export async function getDashboardSummary(organizationId: string, now = new Date()): Promise<DashboardSummary> {
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const weekStart = startOfWeekMonday(now);
  const todayStartIso = todayStart.toISOString();
  const tomorrowStartIso = tomorrowStart.toISOString();
  const organizationTimezone = await getOrganizationTimezone(organizationId);
  const dueToday = businessDateForOrderDueFilter("today", now, organizationTimezone);
  const dueTomorrow = businessDateForOrderDueFilter("tomorrow", now, organizationTimezone);

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
            ...activeOrderDuePredicates("today", dueToday),
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
            ...activeOrderDuePredicates("tomorrow", dueTomorrow),
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
        .where(
          and(
            eq(orders.organizationId, organizationId),
            or(
              eq(orders.canonicalState, "new"),
              and(isNull(orders.canonicalState), eq(orders.status, "new")),
            ),
          ),
        ),
    );

    summary.ordersPipeline.inProduction = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            or(
              eq(orders.canonicalState, "active"),
              and(isNull(orders.canonicalState), eq(orders.status, "in_production")),
            ),
          ),
        ),
    );

    summary.ordersPipeline.onHold = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            or(
              eq(orders.canonicalState, "on_hold"),
              and(isNull(orders.canonicalState), eq(orders.status, "on_hold")),
            ),
          ),
        ),
    );

    summary.ordersPipeline.scheduled = null;
    summary.ordersPipeline.readyForPickup = null;
    summary.ordersPipeline.slaRisk = null;
    devWarn("ordersPipeline.scheduled is null (status not implemented)");
    devWarn("ordersPipeline.readyForPickup is null (status not implemented)");
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

    summary.productionJobs.printing = null;
    summary.productionJobs.finishing = null;
    summary.productionJobs.qaInspection = null;
    summary.productionJobs.unassignedJobs = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(productionJobs)
        .where(
          and(
            eq(productionJobs.organizationId, organizationId),
            not(eq(productionJobs.status, "done")),
            sql`COALESCE(NULLIF(TRIM(${productionJobs.assignedPrinterName}), ''), '') = ''`,
            sql`LOWER(COALESCE(${productionJobs.stationKey}, '')) NOT IN ('prepress', 'design', 'fulfillment')`,
          ),
        ),
    );
    devWarn("productionJobs.printing/finishing/qaInspection are null (step states not implemented)");
  } catch (error) {
    console.error("[dashboard-summary] productionJobs failed:", error);
  }

  // Fulfillment & Finance
  try {
    summary.fulfillmentFinance.readyToShip = await new FulfillmentDashboardRepo(db).countFulfillmentQueue(organizationId);

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
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            eq(invoices.isHistorical, false),
            sql`${invoices.balanceDue}::numeric > 0`,
            not(inArray(invoices.status, ["void"])),
          ),
        ),
    );

    const overdueAmountRows = await db
      .select({ cents: sql<number>`coalesce(sum(round(${invoices.balanceDue} * 100)), 0)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.isHistorical, false),
          sql`${invoices.balanceDue}::numeric > 0`,
          not(inArray(invoices.status, ["void"])),
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
