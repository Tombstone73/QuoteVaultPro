import { and, eq, gte, inArray, isNotNull, isNull, lt, not, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { invoiceEmailLogs, invoices, materials, orders, productionJobs, quotes, vendors } from "@shared/schema";
import { FulfillmentDashboardRepo } from "./fulfillment/repository";
import { getAccountsReceivableReport } from "./accountsReceivableReport";
import {
  activeOrderDuePredicates,
  businessDateForOrderDueFilter,
  getOrganizationTimezone,
} from "./orderDueDateService";
import { listPayments, paymentDateWindow } from "./paymentListService";

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
    unpaidAmountCents: number | null;
    collectedTodayCents: number | null;
    collectedMonthCents: number | null;
    invoicesSent: {
      today: { count: number; totalCents: number };
      thisWeek: { count: number; totalCents: number };
      thisMonth: { count: number; totalCents: number };
    };
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
    unpaidAmountCents: null,
    collectedTodayCents: null,
    collectedMonthCents: null,
    invoicesSent: { today: { count: 0, totalCents: 0 }, thisWeek: { count: 0, totalCents: 0 }, thisMonth: { count: 0, totalCents: 0 } },
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

async function countFrom(query: Promise<Array<{ count: number }>>): Promise<number> {
  const rows = await query;
  return Number(rows[0]?.count ?? 0);
}

export async function getInvoicesSentDashboardMetrics(input: { organizationId: string; timezone: string; now: Date }) {
  // The timestamp boundaries are calculated by PostgreSQL in the organization's
  // timezone, avoiding browser and server-host-local day/week/month semantics.
  const localNow = sql`${input.now}::timestamptz AT TIME ZONE ${input.timezone}`;
  const start = (unit: "day" | "week" | "month") =>
    sql`date_trunc(${unit}, ${localNow}) AT TIME ZONE ${input.timezone}`;
  const validSentInvoice = and(
    eq(invoices.organizationId, input.organizationId),
    not(inArray(invoices.status, ["void", "voided", "canceled", "cancelled"])),
  );
  const aggregate = (windowStart: SQL) =>
    db
      .select({
        count: sql<number>`count(*)::int`,
        totalCents: sql<number>`coalesce(sum(${invoices.totalCents}), 0)::bigint`,
      })
      .from(invoices)
      .where(and(validSentInvoice, sql`exists (
        select 1 from ${invoiceEmailLogs}
        where ${invoiceEmailLogs.organizationId} = ${input.organizationId}
          and ${invoiceEmailLogs.invoiceId} = ${invoices.id}
          and ${invoiceEmailLogs.type} = 'invoice_send'
          and ${invoiceEmailLogs.status} = 'sent'
          and ${invoiceEmailLogs.sentAt} >= ${windowStart}
          and ${invoiceEmailLogs.sentAt} < ${input.now}
      )`));

  const [today, thisWeek, thisMonth] = await Promise.all([
    aggregate(start("day")),
    aggregate(start("week")),
    aggregate(start("month")),
  ]);
  const normalize = (row: { count: number; totalCents: number } | undefined) => ({
    count: Number(row?.count ?? 0),
    totalCents: Number(row?.totalCents ?? 0),
  });
  return { today: normalize(today[0]), thisWeek: normalize(thisWeek[0]), thisMonth: normalize(thisMonth[0]) };
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
  const organizationTimezone = await getOrganizationTimezone(organizationId);
  const shipmentToday = paymentDateWindow("today", organizationTimezone, now);
  const dueToday = businessDateForOrderDueFilter("today", now, organizationTimezone);
  const dueTomorrow = businessDateForOrderDueFilter("tomorrow", now, organizationTimezone);
  // One authoritative A/R projection supplies both dashboard overdue metrics.
  // It owns approval, remaining-balance, historical, and tenant-business-date semantics.
  const accountsReceivableReport = getAccountsReceivableReport({ organizationId, now });

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

    summary.criticalAlerts.overdueInvoices = (await accountsReceivableReport).summary.overdueInvoiceCount;
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
    summary.fulfillmentFinance.readyToShip = await new FulfillmentDashboardRepo(db).countReadyForFulfillment(organizationId);

    summary.fulfillmentFinance.shippedToday = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            gte(orders.shippedAt, shipmentToday.start!),
            lt(orders.shippedAt, shipmentToday.endExclusive!),
          ),
        ),
    );

    // A/R owns approved/open eligibility, partial payments, credits, voids,
    // and the current remaining balance. Do not use stale invoice.balanceDue.
    const arSummary = (await accountsReceivableReport).summary;
    summary.fulfillmentFinance.invoicesUnpaid = arSummary.invoiceCount;
    summary.fulfillmentFinance.unpaidAmountCents = arSummary.totalOutstandingCents;

    // The dashboard and Payments page deliberately share the same succeeded-payment
    // predicate and organization-local date windows.
    const [todayCollections, monthCollections] = await Promise.all([
      listPayments({ organizationId, datePreset: "today", pageSize: 1, now }),
      listPayments({ organizationId, datePreset: "this-month", pageSize: 1, now }),
    ]);
    summary.fulfillmentFinance.collectedTodayCents = todayCollections.summary.totalCollectedCents;
    summary.fulfillmentFinance.collectedMonthCents = monthCollections.summary.totalCollectedCents;
    summary.fulfillmentFinance.invoicesSent = await getInvoicesSentDashboardMetrics({ organizationId, timezone: organizationTimezone, now });
  } catch (error) {
    console.error("[dashboard-summary] fulfillmentFinance failed:", error);
  }

  return summary;
}
