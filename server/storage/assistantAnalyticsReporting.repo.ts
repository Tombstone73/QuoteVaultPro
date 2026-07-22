import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { customers, invoiceLineItems, invoices, organizations, products } from "@shared/schema";
import { analyticsGroupingValues, analyticsRankingMetricValues } from "@shared/aiReportingContracts";

export type AnalyticsGrouping = (typeof analyticsGroupingValues)[number];
export type AnalyticsRankingMetric = (typeof analyticsRankingMetricValues)[number];

/**
 * Financial reporting policy: customer sales analytics is calculated only
 * from native, posted invoice_line_items.  Their quantity and monetary fields
 * are invoice-time snapshots, so current product prices never rewrite history.
 * Imported QuickBooks rows remain excluded because their line snapshot has a
 * different JSON shape and is not an invoice_line_items financial snapshot.
 */
export const NATIVE_POSTED_INVOICE_STATUSES = [
  "finalized",
  "billed",
  "sent",
  "partially_paid",
  "overdue",
  "paid",
] as const;

export type AssistantAnalyticsCustomerRecord = {
  id: string;
  displayName: string;
  updatedAt: Date | string;
};

export type AssistantAnalyticsCustomerResolution = {
  customer: AssistantAnalyticsCustomerRecord | null;
  alternatives: AssistantAnalyticsCustomerRecord[];
  confidence: "exact" | "ambiguous" | "none";
};

export type AssistantAnalyticsProductSalesRecord = {
  label: string;
  productId: string | null;
  revenueCents: number;
  quantity: number;
  invoiceCount: number;
  orderCount: number;
  averageUnitPriceCents: number | null;
  firstPurchaseAt: Date | string | null;
  latestPurchaseAt: Date | string | null;
  sourceRecordCount: number;
  totalRevenueCents: number;
  groupingRationale: string;
};

export type AssistantAnalyticsDateWindow = { start: Date; endExclusive: Date };

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** The issue timestamp is the established invoice date when an invoice has
 * not retained a separate finalization timestamp. */
function postedAt() {
  return sql<Date>`coalesce(${invoices.issuedAt}, ${invoices.issueDate})`;
}

function snapshotRevenueCents() {
  // Early native rows may predate the cents projection.  A non-zero cents
  // snapshot wins; zero-price lines intentionally remain zero when both
  // representations are zero.
  return sql<number>`case when ${invoiceLineItems.lineTotalCents} <> 0 then ${invoiceLineItems.lineTotalCents} else round(${invoiceLineItems.totalPrice} * 100)::integer end`;
}

function snapshotLabel() {
  return sql<string>`coalesce(nullif(trim(${invoiceLineItems.name}), ''), nullif(trim(${invoiceLineItems.description}), ''), 'Unnamed product')`;
}

function groupingExpressions(grouping: AnalyticsGrouping) {
  const label = snapshotLabel();
  if (grouping === "category") {
    const category = sql<string>`coalesce(nullif(trim(${products.category}), ''), 'Uncategorized')`;
    return { key: category, label: category, productId: sql<string | null>`null`, rationale: "Current product category is descriptive enrichment; revenue remains invoice-snapshotted." };
  }
  if (grouping === "normalized_product_label") {
    const normalized = sql<string>`lower(regexp_replace(${label}, '\\s+', ' ', 'g'))`;
    return { key: normalized, label: sql<string>`min(${label})`, productId: sql<string | null>`null`, rationale: "Historical invoice labels are normalized only for grouping." };
  }
  if (grouping === "historical_product_id") {
    return { key: invoiceLineItems.productId, label: sql<string>`min(${label})`, productId: invoiceLineItems.productId, rationale: "Rows are grouped by the invoice-time product identifier." };
  }
  // Exact product preserves both the historical identifier and its invoice-time
  // label so renamed labels do not silently merge distinct historical records.
  return { key: sql<string>`concat(${invoiceLineItems.productId}, ':', ${label})`, label, productId: invoiceLineItems.productId, rationale: "Rows are grouped by historical product identifier and invoice-time label." };
}

function groupingColumns(grouping: AnalyticsGrouping, key: ReturnType<typeof groupingExpressions>["key"], label: ReturnType<typeof groupingExpressions>["label"]) {
  if (grouping === "exact_product") return [invoiceLineItems.productId, label];
  if (grouping === "historical_product_id") return [invoiceLineItems.productId];
  return [key];
}

export class AssistantAnalyticsReportingRepository {
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

  /** Exact customer IDs and names resolve automatically. Partial names only
   * produce bounded alternatives, avoiding a silent financial-data mismatch. */
  async resolveCustomer(organizationId: string, query: string): Promise<AssistantAnalyticsCustomerResolution> {
    const normalized = query.trim();
    const rowShape = { id: customers.id, displayName: customers.companyName, updatedAt: customers.updatedAt };
    const [idMatch, exactNameMatches] = await Promise.all([
      db.select(rowShape).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, normalized))).limit(1),
      db.select(rowShape).from(customers).where(and(
        eq(customers.organizationId, organizationId),
        sql`lower(${customers.companyName}) = lower(${normalized})`,
      )).orderBy(asc(customers.companyName), asc(customers.id)).limit(10),
    ]);
    if (idMatch[0]) return { customer: idMatch[0], alternatives: [], confidence: "exact" };
    if (exactNameMatches.length === 1) return { customer: exactNameMatches[0], alternatives: [], confidence: "exact" };
    if (exactNameMatches.length > 1) return { customer: null, alternatives: exactNameMatches, confidence: "ambiguous" };

    const pattern = `%${escapeLike(normalized)}%`;
    const alternatives = await db.select(rowShape).from(customers).where(and(
      eq(customers.organizationId, organizationId),
      or(ilike(customers.companyName, pattern), ilike(customers.email, pattern), ilike(customers.phone, pattern)),
    )).orderBy(asc(customers.companyName), asc(customers.id)).limit(10);
    return { customer: null, alternatives, confidence: alternatives.length ? "ambiguous" : "none" };
  }

  async customerProductSales(
    organizationId: string,
    customerId: string,
    dateWindow: AssistantAnalyticsDateWindow,
    grouping: AnalyticsGrouping,
    rankingMetric: AnalyticsRankingMetric,
    limit: number,
  ): Promise<AssistantAnalyticsProductSalesRecord[]> {
    const groupingExpression = groupingExpressions(grouping);
    const revenue = snapshotRevenueCents();
    const revenueTotal = sql<number>`sum(${revenue})`;
    const quantityTotal = sql<number>`sum(${invoiceLineItems.quantity})`;
    const averageUnitPrice = sql<number | null>`case when sum(${invoiceLineItems.quantity}) > 0 then round(sum(${revenue})::numeric / sum(${invoiceLineItems.quantity}))::integer else null end`;
    const totalRevenue = sql<number>`sum(sum(${revenue})) over ()`;
    const metric = rankingMetric === "quantity" ? quantityTotal
      : rankingMetric === "invoice_count" ? sql<number>`count(distinct ${invoices.id})`
        : rankingMetric === "order_count" ? sql<number>`count(distinct ${invoices.orderId})`
          : rankingMetric === "average_unit_price" ? averageUnitPrice
            : revenueTotal;
    const saleDate = postedAt();
    const rows = await db.select({
      label: groupingExpression.label,
      productId: groupingExpression.productId,
      revenueCents: revenueTotal,
      quantity: quantityTotal,
      invoiceCount: sql<number>`count(distinct ${invoices.id})`,
      orderCount: sql<number>`count(distinct ${invoices.orderId})`,
      averageUnitPriceCents: averageUnitPrice,
      firstPurchaseAt: sql<Date | null>`min(${saleDate})`,
      latestPurchaseAt: sql<Date | null>`max(${saleDate})`,
      sourceRecordCount: sql<number>`count(${invoiceLineItems.id})`,
      totalRevenueCents: totalRevenue,
    })
      .from(invoices)
      .innerJoin(invoiceLineItems, eq(invoiceLineItems.invoiceId, invoices.id))
      .innerJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.organizationId, organizationId)))
      .leftJoin(products, and(eq(products.id, invoiceLineItems.productId), eq(products.organizationId, organizationId)))
      .where(and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.customerId, customerId),
        eq(invoices.isHistorical, false),
        inArray(invoices.status, [...NATIVE_POSTED_INVOICE_STATUSES]),
        gte(saleDate, dateWindow.start),
        lt(saleDate, dateWindow.endExclusive),
      ))
      .groupBy(...groupingColumns(grouping, groupingExpression.key, groupingExpression.label))
      .orderBy(desc(metric), asc(groupingExpression.label))
      .limit(Math.min(Math.max(1, limit), 25));

    return rows.map((row) => ({
      label: String(row.label || "Unnamed product").slice(0, 300),
      productId: row.productId ?? null,
      revenueCents: Math.max(0, asNumber(row.revenueCents)),
      quantity: Math.max(0, asNumber(row.quantity)),
      invoiceCount: Math.max(0, asNumber(row.invoiceCount)),
      orderCount: Math.max(0, asNumber(row.orderCount)),
      averageUnitPriceCents: row.averageUnitPriceCents === null ? null : Math.max(0, asNumber(row.averageUnitPriceCents)),
      firstPurchaseAt: row.firstPurchaseAt ?? null,
      latestPurchaseAt: row.latestPurchaseAt ?? null,
      sourceRecordCount: Math.max(0, asNumber(row.sourceRecordCount)),
      totalRevenueCents: Math.max(0, asNumber(row.totalRevenueCents)),
      groupingRationale: groupingExpression.rationale,
    }));
  }
}
