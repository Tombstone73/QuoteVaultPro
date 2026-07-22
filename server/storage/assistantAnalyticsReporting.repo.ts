import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { customerContactLinks, customerContacts, customers, invoiceLineItems, invoices, orders, organizations, products } from "@shared/schema";
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
  resolutionType: "company" | "contact";
  contactId: string | null;
  contactName: string | null;
  explanation: string;
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

export type AssistantAnalyticsUninvoicedOrderRecord = {
  orderId: string;
  orderNumber: string;
  orderDate: Date | string;
  orderStatus: string;
  fulfillmentState: string;
  invoiceState: "no_invoice" | "draft" | "unposted";
  billingReadiness: string;
  billingBlockers: string[];
  orderTotalCents: number;
  lineCount: number;
};

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function companyRecord(row: { id: string; displayName: string; updatedAt: Date | string }): AssistantAnalyticsCustomerRecord {
  return {
    ...row,
    resolutionType: "company",
    contactId: null,
    contactName: null,
    explanation: `Resolved company account ${row.displayName}.`,
  };
}

function contactRecord(row: { id: string; displayName: string; updatedAt: Date | string; contactId: string; contactName: string }): AssistantAnalyticsCustomerRecord {
  return {
    ...row,
    resolutionType: "contact",
    explanation: `Found ${row.contactName} at ${row.displayName}; analytics use the company account.`,
  };
}

function uniqueCandidates(rows: AssistantAnalyticsCustomerRecord[]): AssistantAnalyticsCustomerRecord[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.resolutionType}:${row.id}:${row.contactId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.displayName.localeCompare(right.displayName) || (left.contactName ?? "").localeCompare(right.contactName ?? ""));
}

function billingBlockers(row: { billingReadiness: string; billingReadyPolicy: string | null; fulfillmentState: string; invoiceState: "no_invoice" | "draft" | "unposted" }): string[] {
  const blockers: string[] = [];
  if (row.billingReadiness !== "ready" && row.billingReadiness !== "billed") {
    blockers.push(row.billingReadyPolicy?.trim() || "Order is not marked billing ready.");
  }
  if (row.fulfillmentState !== "shipped" && row.fulfillmentState !== "delivered") {
    blockers.push(`Fulfillment is ${row.fulfillmentState}.`);
  }
  if (row.invoiceState === "draft") blockers.push("A draft invoice exists but is not posted.");
  if (row.invoiceState === "no_invoice" && row.billingReadiness === "ready") blockers.push("No invoice has been created for this billing-ready order.");
  return Array.from(new Set(blockers)).slice(0, 5);
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

  /** A resolved contact is deliberately mapped to its tenant-scoped company
   * account. Financial history belongs to that customer, not to a contact row. */
  async resolveCustomer(organizationId: string, query: string): Promise<AssistantAnalyticsCustomerResolution> {
    const normalized = query.trim();
    const companyShape = { id: customers.id, displayName: customers.companyName, updatedAt: customers.updatedAt };
    const contactName = sql<string>`nullif(trim(coalesce(${customerContacts.firstName}, '') || ' ' || coalesce(${customerContacts.lastName}, '')), '')`;
    const contactShape = { ...companyShape, contactId: customerContacts.id, contactName };
    const contactRows = (condition: ReturnType<typeof and>) => db.select(contactShape)
      .from(customerContacts)
      .leftJoin(customerContactLinks, and(
        eq(customerContactLinks.organizationId, organizationId),
        eq(customerContactLinks.contactId, customerContacts.id),
        eq(customerContactLinks.status, "active"),
      ))
      .innerJoin(customers, and(
        eq(customers.organizationId, organizationId),
        sql`${customers.id} = coalesce(${customerContactLinks.customerId}, ${customerContacts.customerId})`,
      ))
      .where(and(eq(customerContacts.organizationId, organizationId), eq(customerContacts.status, "active"), condition))
      .orderBy(asc(customers.companyName), asc(customerContacts.lastName), asc(customerContacts.firstName), asc(customerContacts.id))
      .limit(10);
    const [idMatch, exactNameMatches] = await Promise.all([
      db.select(companyShape).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, normalized))).limit(1),
      db.select(companyShape).from(customers).where(and(
        eq(customers.organizationId, organizationId),
        sql`lower(${customers.companyName}) = lower(${normalized})`,
      )).orderBy(asc(customers.companyName), asc(customers.id)).limit(10),
    ]);
    if (idMatch[0]) return { customer: companyRecord(idMatch[0]), alternatives: [], confidence: "exact" };
    if (exactNameMatches.length === 1) return { customer: companyRecord(exactNameMatches[0]), alternatives: [], confidence: "exact" };
    if (exactNameMatches.length > 1) return { customer: null, alternatives: exactNameMatches.map(companyRecord), confidence: "ambiguous" };

    const exactContacts = uniqueCandidates((await contactRows(sql`lower(${contactName}) = lower(${normalized})`)).map(contactRecord));
    if (exactContacts.length === 1) return { customer: exactContacts[0], alternatives: [], confidence: "exact" };
    if (exactContacts.length > 1) return { customer: null, alternatives: exactContacts, confidence: "ambiguous" };

    const exactEmailContacts = uniqueCandidates((await contactRows(sql`lower(${customerContacts.email}) = lower(${normalized})`)).map(contactRecord));
    if (exactEmailContacts.length === 1) return { customer: exactEmailContacts[0], alternatives: [], confidence: "exact" };
    if (exactEmailContacts.length > 1) return { customer: null, alternatives: exactEmailContacts, confidence: "ambiguous" };

    const pattern = `%${escapeLike(normalized)}%`;
    const [companyAlternatives, contactAlternatives] = await Promise.all([
      db.select(companyShape).from(customers).where(and(
      eq(customers.organizationId, organizationId),
      or(ilike(customers.companyName, pattern), ilike(customers.email, pattern), ilike(customers.phone, pattern)),
      )).orderBy(asc(customers.companyName), asc(customers.id)).limit(10),
      contactRows(or(ilike(contactName, pattern), ilike(customerContacts.email, pattern))),
    ]);
    const alternatives = uniqueCandidates([
      ...companyAlternatives.map(companyRecord),
      ...contactAlternatives.map(contactRecord),
    ]).slice(0, 10);
    return { customer: null, alternatives, confidence: alternatives.length ? "ambiguous" : "none" };
  }

  /** Qualifying orders are operational context only. This method excludes any
   * order with a native posted invoice, so its total cannot enter revenue. */
  async customerUninvoicedOrders(
    organizationId: string,
    customerId: string,
    dateWindow: AssistantAnalyticsDateWindow,
    limit: number,
  ): Promise<AssistantAnalyticsUninvoicedOrderRecord[]> {
    const invoiceState = sql<"no_invoice" | "draft" | "unposted">`case when count(${invoices.id}) = 0 then 'no_invoice' when bool_or(${invoices.status} = 'draft') then 'draft' else 'unposted' end`;
    const lineCount = sql<number>`(select count(*) from order_line_items where order_line_items.order_id = ${orders.id})`;
    const postedInvoiceExists = sql<boolean>`exists (
      select 1 from invoices posted_invoice
      where posted_invoice.organization_id = ${organizationId}
        and posted_invoice.order_id = ${orders.id}
        and posted_invoice.is_historical = false
        and posted_invoice.status in ('finalized', 'billed', 'sent', 'partially_paid', 'overdue', 'paid')
    )`;
    const rows = await db.select({
      orderId: orders.id,
      orderNumber: sql<string>`coalesce(nullif(${orders.displayNumber}, ''), ${orders.orderNumber})`,
      orderDate: orders.createdAt,
      orderStatus: sql<string>`coalesce(nullif(${orders.canonicalState}, ''), nullif(${orders.status}, ''), ${orders.state})`,
      fulfillmentState: orders.fulfillmentStatus,
      invoiceState,
      billingReadiness: orders.billingStatus,
      billingReadyPolicy: orders.billingReadyPolicy,
      orderTotal: orders.total,
      lineCount,
    }).from(orders)
      .leftJoin(invoices, and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.orderId, orders.id),
        eq(invoices.isHistorical, false),
      ))
      .where(and(
        eq(orders.organizationId, organizationId),
        eq(orders.customerId, customerId),
        ne(orders.state, "canceled"),
        ne(orders.status, "canceled"),
        gte(orders.createdAt, dateWindow.start.toISOString()),
        lt(orders.createdAt, dateWindow.endExclusive.toISOString()),
        sql`not ${postedInvoiceExists}`,
      ))
      .groupBy(orders.id)
      .orderBy(desc(orders.createdAt), asc(orders.id))
      .limit(Math.min(Math.max(1, limit), 25));
    return rows.map((row) => {
      const normalizedInvoiceState = row.invoiceState === "draft" || row.invoiceState === "unposted" ? row.invoiceState : "no_invoice";
      const billingReadiness = row.billingReadiness || "not_ready";
      const fulfillmentState = row.fulfillmentState || "pending";
      return {
        orderId: row.orderId,
        orderNumber: String(row.orderNumber),
        orderDate: row.orderDate,
        orderStatus: String(row.orderStatus || "open"),
        fulfillmentState,
        invoiceState: normalizedInvoiceState,
        billingReadiness,
        billingBlockers: billingBlockers({ billingReadiness, billingReadyPolicy: row.billingReadyPolicy, fulfillmentState, invoiceState: normalizedInvoiceState }),
        orderTotalCents: Math.max(0, Math.round(Number(row.orderTotal ?? 0) * 100)),
        lineCount: Math.max(0, asNumber(row.lineCount)),
      };
    });
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
