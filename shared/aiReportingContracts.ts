import { z } from "zod";

export const reportAudienceValues = ["private", "organization", "shared_link", "customer_safe"] as const;
export const reportStatusValues = ["draft", "ready", "archived", "failed"] as const;
export const reportSectionKindValues = ["executive_summary", "narrative", "kpi_grid", "table", "bar_chart", "line_chart", "ranked_list", "callout", "source_notes", "methodology", "page_break"] as const;
export const analyticsGroupingValues = ["exact_product", "historical_product_id", "normalized_product_label", "category"] as const;
export const analyticsRankingMetricValues = ["revenue", "quantity", "invoice_count", "order_count", "average_unit_price"] as const;
/** Financial reporting is deliberately labelled at the point it is persisted.
 * Operational order value is never recognized revenue. */
export const analyticsFinancialSourceValues = ["posted_revenue", "order_value", "combined_pipeline_view"] as const;
export const analyticsInvoiceStatusValues = ["finalized", "billed", "sent", "partially_paid", "overdue", "paid"] as const;

export const analyticsDateRangeSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict().refine((value) => value.start <= value.end, "Start date must be on or before end date");

export const analyticsCustomerReferenceSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(240).optional(),
}).strict().refine((value) => Boolean(value.id || value.name), "Customer reference is required");

export const analyticsResolveCustomerInputSchema = z.object({ query: z.string().trim().min(1).max(240) }).strict();
const analyticsResolvedCustomerSchema = z.object({
  /** The customer/company account that downstream analytics will use. */
  id: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(240),
  resolutionType: z.enum(["company", "contact"]),
  contactId: z.string().trim().min(1).max(128).nullable(),
  contactName: z.string().trim().min(1).max(240).nullable(),
  explanation: z.string().trim().min(1).max(300),
  sourceLink: z.object({ label: z.string(), href: z.string().startsWith("/") }).strict(),
}).strict();
export const analyticsResolveCustomerResultSchema = z.object({
  customer: analyticsResolvedCustomerSchema.nullable(),
  alternatives: z.array(analyticsResolvedCustomerSchema).max(10),
  confidence: z.enum(["exact", "ambiguous", "none"]),
}).strict();

export const analyticsCustomerProductSalesInputSchema = z.object({
  customer: analyticsCustomerReferenceSchema,
  dateRange: analyticsDateRangeSchema,
  rankingMetric: z.enum(analyticsRankingMetricValues).default("revenue"),
  limit: z.number().int().min(1).max(25).default(5),
  grouping: z.enum(analyticsGroupingValues).default("exact_product"),
  includeQuantities: z.boolean().default(true),
  includeInvoiceCounts: z.boolean().default(true),
  includeOrderCounts: z.boolean().default(true),
  includeAverageUnitPrice: z.boolean().default(true),
}).strict();

export const analyticsProductSalesRowSchema = z.object({
  label: z.string().trim().min(1).max(300),
  productId: z.string().trim().min(1).max(128).nullable(),
  revenueCents: z.number().int().nonnegative(),
  quantity: z.number().int().nonnegative(),
  invoiceCount: z.number().int().nonnegative(),
  orderCount: z.number().int().nonnegative(),
  averageUnitPriceCents: z.number().int().nonnegative().nullable(),
  shareOfCustomerRevenue: z.number().min(0).max(1),
  rank: z.number().int().positive(),
  firstPurchaseAt: z.string().datetime({ offset: true }).nullable(),
  latestPurchaseAt: z.string().datetime({ offset: true }).nullable(),
  sourceRecordCount: z.number().int().nonnegative(),
  groupingRationale: z.string().trim().min(1).max(240),
}).strict();
export const analyticsCustomerProductSalesResultSchema = z.object({
  customer: z.object({ id: z.string().trim().min(1).max(128), displayName: z.string().trim().min(1).max(240), sourceLink: z.object({ label: z.string(), href: z.string().startsWith("/") }).strict() }).strict(),
  dateRange: analyticsDateRangeSchema,
  totalRevenueCents: z.number().int().nonnegative(),
  rows: z.array(analyticsProductSalesRowSchema).max(25),
  warnings: z.array(z.string().trim().min(1).max(300)).max(10),
  timezone: z.string().trim().min(1).max(80),
}).strict();

/** Read-only operational context for the gap between posted revenue and orders
 * that have not yet produced a posted native invoice. */
export const analyticsCustomerUninvoicedOrdersInputSchema = z.object({
  customer: analyticsCustomerReferenceSchema,
  dateRange: analyticsDateRangeSchema,
  limit: z.number().int().min(1).max(25).default(10),
}).strict();
export const analyticsCustomerUninvoicedOrderSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  orderNumber: z.string().trim().min(1).max(80),
  orderDate: z.string().datetime({ offset: true }),
  orderStatus: z.string().trim().min(1).max(80),
  fulfillmentState: z.string().trim().min(1).max(80),
  invoiceState: z.enum(["no_invoice", "draft", "unposted"]),
  billingReadiness: z.string().trim().min(1).max(80),
  billingBlockers: z.array(z.string().trim().min(1).max(300)).max(5),
  orderTotalCents: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  sourceLink: z.object({ label: z.string(), href: z.string().startsWith("/") }).strict(),
}).strict();
export const analyticsCustomerUninvoicedOrdersResultSchema = z.object({
  customer: analyticsResolvedCustomerSchema,
  dateRange: analyticsDateRangeSchema,
  totalOrderValueCents: z.number().int().nonnegative(),
  orders: z.array(analyticsCustomerUninvoicedOrderSchema).max(25),
  warnings: z.array(z.string().trim().min(1).max(300)).max(10),
  timezone: z.string().trim().min(1).max(80),
}).strict();

/** Generic released invoice facts for AI-authored analysis. This is not a
 * report: it contains no server-selected KPIs, rankings, or conclusions. */
export const analyticsInvoiceActivityInputSchema = z.object({
  dateRange: analyticsDateRangeSchema,
  statuses: z.array(z.enum(analyticsInvoiceStatusValues)).min(1).max(analyticsInvoiceStatusValues.length).optional(),
  customerId: z.string().trim().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(200).default(200),
}).strict();
export const analyticsInvoiceActivityRowSchema = z.object({
  invoiceId: z.string().trim().min(1).max(128),
  invoiceNumber: z.string().trim().min(1).max(80),
  customerId: z.string().trim().min(1).max(128),
  customerName: z.string().trim().min(1).max(240),
  postedAt: z.string().datetime({ offset: true }),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  status: z.enum(analyticsInvoiceStatusValues),
  totalCents: z.number().int().nonnegative(),
  amountPaidCents: z.number().int().nonnegative(),
  balanceDueCents: z.number().int().nonnegative(),
  currency: z.string().trim().min(1).max(8),
  sourceLink: z.object({ label: z.string(), href: z.string().startsWith("/") }).strict(),
}).strict();
export const analyticsInvoiceActivityResultSchema = z.object({
  dateRange: analyticsDateRangeSchema,
  invoices: z.array(analyticsInvoiceActivityRowSchema).max(200),
  truncated: z.boolean(),
  warnings: z.array(z.string().trim().min(1).max(300)).max(10),
  timezone: z.string().trim().min(1).max(80),
}).strict();

const reportSourceSchema = z.object({ label: z.string().trim().min(1).max(240), count: z.number().int().nonnegative(), freshness: z.string().datetime({ offset: true }) }).strict();
const reportKpiSchema = z.object({ label: z.string().trim().min(1).max(100), value: z.string().trim().min(1).max(120), detail: z.string().trim().max(240).optional(), sensitive: z.boolean().default(false) }).strict();
const reportTableColumnSchema = z.object({ key: z.string().trim().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), label: z.string().trim().min(1).max(100), sensitive: z.boolean().default(false) }).strict();
const reportTableRowSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));
export const reportDefinitionSchema = z.object({
  version: z.literal("v1"),
  title: z.string().trim().min(1).max(240),
  subtitle: z.string().trim().max(300).optional(),
  description: z.string().trim().max(2_000).optional(),
  audience: z.enum(reportAudienceValues).default("private"),
  /** Optional because non-financial reports are also stored in Report Studio.
   * When present, this preserves the distinction on refresh, sharing, and reopen. */
  financialSource: z.enum(analyticsFinancialSourceValues).optional(),
  timezone: z.string().trim().min(1).max(80),
  dataSnapshotAt: z.string().datetime({ offset: true }),
  filters: z.record(z.unknown()).default({}),
  sources: z.array(reportSourceSchema).max(20),
  sections: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("executive_summary"), text: z.string().trim().min(1).max(2_000) }).strict(),
    z.object({ kind: z.literal("narrative"), title: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(4_000) }).strict(),
    z.object({ kind: z.literal("kpi_grid"), title: z.string().trim().min(1).max(160), items: z.array(reportKpiSchema).min(1).max(12) }).strict(),
    z.object({ kind: z.literal("table"), title: z.string().trim().min(1).max(160), columns: z.array(reportTableColumnSchema).min(1).max(12), rows: z.array(reportTableRowSchema).max(100) }).strict(),
    z.object({ kind: z.literal("bar_chart"), title: z.string().trim().min(1).max(160), labelKey: z.string().trim().min(1).max(80), valueKey: z.string().trim().min(1).max(80), rows: z.array(reportTableRowSchema).max(50) }).strict(),
    z.object({ kind: z.literal("line_chart"), title: z.string().trim().min(1).max(160), labelKey: z.string().trim().min(1).max(80), valueKey: z.string().trim().min(1).max(80), rows: z.array(reportTableRowSchema).max(100) }).strict(),
    z.object({ kind: z.literal("ranked_list"), title: z.string().trim().min(1).max(160), items: z.array(z.object({ label: z.string().trim().min(1).max(300), value: z.string().trim().min(1).max(120), detail: z.string().trim().max(240).optional() }).strict()).max(25) }).strict(),
    z.object({ kind: z.literal("callout"), tone: z.enum(["info", "warning", "success"]), text: z.string().trim().min(1).max(1_000) }).strict(),
    z.object({ kind: z.literal("source_notes"), text: z.string().trim().min(1).max(2_000) }).strict(),
    z.object({ kind: z.literal("methodology"), text: z.string().trim().min(1).max(4_000) }).strict(),
    z.object({ kind: z.literal("page_break") }).strict(),
  ])).min(1).max(30),
}).strict();
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export function customerSafeReportDefinition(definition: ReportDefinition): ReportDefinition {
  const safeSections = definition.sections.map((section) => {
    if (section.kind === "kpi_grid") return { ...section, items: section.items.filter((item) => !item.sensitive) };
    if (section.kind === "table") {
      const columns = section.columns.filter((column) => !column.sensitive);
      return { ...section, columns, rows: section.rows.map((row) => Object.fromEntries(columns.map((column) => [column.key, row[column.key] ?? null]))) };
    }
    return section;
  }).filter((section) => section.kind !== "kpi_grid" || section.items.length > 0)
    // Public reports do not expose internal source names, query methodology,
    // or diagnostic caveats that may reveal system topology.
    .filter((section) => section.kind !== "source_notes" && section.kind !== "methodology");
  return { ...definition, audience: "customer_safe", sources: [], sections: safeSections };
}
