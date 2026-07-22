import { z } from "zod";
import {
  analyticsCustomerProductSalesInputSchema,
  analyticsCustomerProductSalesResultSchema,
  analyticsResolveCustomerInputSchema,
  analyticsResolveCustomerResultSchema,
} from "@shared/aiReportingContracts";
import {
  AssistantAnalyticsReportingRepository,
  type AssistantAnalyticsCustomerRecord,
  type AssistantAnalyticsDateWindow,
  type AnalyticsGrouping,
  type AnalyticsRankingMetric,
} from "../../storage/assistantAnalyticsReporting.repo";
import type { AssistantToolAdapters, AssistantTrustedToolContext } from "./toolRegistry";

type ResolveInput = z.infer<typeof analyticsResolveCustomerInputSchema>;
type CustomerProductSalesInput = z.infer<typeof analyticsCustomerProductSalesInputSchema>;

const FALLBACK_TIMEZONE = "UTC";

export interface AssistantAnalyticsReportingToolDependencies {
  repository?: Pick<AssistantAnalyticsReportingRepository, "getOrganizationTimezone" | "resolveCustomer" | "customerProductSales">;
  now?: () => Date;
  /** Test-only fallback when organization settings have no valid IANA zone. */
  timezone?: string;
}

function validTimezone(value: string | null | undefined): string {
  try {
    if (value) new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: string) => Number(parts.find((item) => item.type === name)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

/** Convert a tenant-calendar midnight to UTC without relying on the server
 * process timezone. The second offset pass handles DST transitions. */
export function analyticsLocalMidnightToUtc(year: number, month: number, day: number, timezone: string): Date {
  const candidate = Date.UTC(year, month - 1, day);
  const initial = zonedParts(new Date(candidate), timezone);
  const observed = Date.UTC(initial.year, initial.month - 1, initial.day, initial.hour, initial.minute, initial.second);
  const adjusted = candidate - (observed - candidate);
  const final = zonedParts(new Date(adjusted), timezone);
  const finalObserved = Date.UTC(final.year, final.month - 1, final.day, final.hour, final.minute, final.second);
  return new Date(adjusted - (finalObserved - candidate));
}

export function analyticsDateWindow(start: string, end: string, timezone: string): AssistantAnalyticsDateWindow {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const dayAfterEnd = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1));
  return {
    start: analyticsLocalMidnightToUtc(startYear, startMonth, startDay, timezone),
    endExclusive: analyticsLocalMidnightToUtc(dayAfterEnd.getUTCFullYear(), dayAfterEnd.getUTCMonth() + 1, dayAfterEnd.getUTCDate(), timezone),
  };
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function customerSource(customer: AssistantAnalyticsCustomerRecord, capturedAt: string) {
  return {
    label: customer.displayName,
    href: `/customers/${customer.id}`,
    entityType: "customer" as const,
    entityId: customer.id,
    capturedAt,
  };
}

function customerResultSource(customer: AssistantAnalyticsCustomerRecord) {
  return { label: customer.displayName, href: `/customers/${customer.id}` };
}

function alternativesWarning(query: string, alternatives: AssistantAnalyticsCustomerRecord[]) {
  if (!alternatives.length) return `No customer matches ${query}.`;
  return `More than one customer may match ${query}. Choose one of: ${alternatives.map((item) => item.displayName).join(", ")}.`;
}

async function resolveExactCustomer(
  repository: Pick<AssistantAnalyticsReportingRepository, "resolveCustomer">,
  organizationId: string,
  query: string,
) {
  const result = await repository.resolveCustomer(organizationId, query);
  return result.confidence === "exact" && result.customer ? result.customer : null;
}

/** Read-only Stage 8 tools. Inputs deliberately omit tenant, actor, route,
 * SQL, and timezone: each is supplied or derived on the server. */
export function createAssistantAnalyticsReportingToolAdapters(
  deps: AssistantAnalyticsReportingToolDependencies = {},
): AssistantToolAdapters {
  const repository = deps.repository ?? new AssistantAnalyticsReportingRepository();
  const now = deps.now ?? (() => new Date());
  const timezoneFor = async (organizationId: string) => validTimezone(
    ("getOrganizationTimezone" in repository ? await repository.getOrganizationTimezone(organizationId) : null) ?? deps.timezone,
  );

  const resolve = async (rawInput: unknown, context: AssistantTrustedToolContext) => {
    const input = analyticsResolveCustomerInputSchema.parse(rawInput) as ResolveInput;
    const capturedAt = now().toISOString();
    const resolution = await repository.resolveCustomer(context.scope.organizationId, input.query);
    if (resolution.confidence === "none") return { status: "not_found" as const, data: null, warning: alternativesWarning(input.query, []) };
    const data = analyticsResolveCustomerResultSchema.parse({
      customer: resolution.customer ? {
        id: resolution.customer.id,
        displayName: resolution.customer.displayName,
        sourceLink: customerResultSource(resolution.customer),
      } : null,
      alternatives: resolution.alternatives.map((customer) => ({ id: customer.id, displayName: customer.displayName })),
      confidence: resolution.confidence,
    });
    const sourceLinks = [
      ...(resolution.customer ? [customerSource(resolution.customer, capturedAt)] : []),
      ...resolution.alternatives.map((customer) => customerSource(customer, capturedAt)),
    ].slice(0, 10);
    return {
      status: resolution.confidence === "exact" ? "succeeded" as const : "partial" as const,
      data,
      provenance: { sourceLinks, freshness: { capturedAt } },
      ...(resolution.confidence === "ambiguous" ? { warning: alternativesWarning(input.query, resolution.alternatives) } : {}),
    };
  };

  const customerProductSales = async (rawInput: unknown, context: AssistantTrustedToolContext) => {
    const input = analyticsCustomerProductSalesInputSchema.parse(rawInput) as CustomerProductSalesInput;
    const customerQuery = input.customer.id ?? input.customer.name!;
    const resolution = await repository.resolveCustomer(context.scope.organizationId, customerQuery);
    const customer = resolution.confidence === "exact" && resolution.customer ? resolution.customer : null;
    if (!customer) return {
      status: "not_found" as const,
      data: null,
      warning: alternativesWarning(customerQuery, resolution.alternatives),
    };

    const [capturedAt, timezone] = await Promise.all([
      Promise.resolve(now().toISOString()),
      timezoneFor(context.scope.organizationId),
    ]);
    const rows = await repository.customerProductSales(
      context.scope.organizationId,
      customer.id,
      analyticsDateWindow(input.dateRange.start, input.dateRange.end, timezone),
      input.grouping as AnalyticsGrouping,
      input.rankingMetric as AnalyticsRankingMetric,
      input.limit,
    );
    const totalRevenueCents = rows[0]?.totalRevenueCents ?? 0;
    const data = analyticsCustomerProductSalesResultSchema.parse({
      customer: { id: customer.id, displayName: customer.displayName, sourceLink: customerResultSource(customer) },
      dateRange: input.dateRange,
      totalRevenueCents,
      rows: rows.map((row, index) => ({
        label: row.label,
        productId: row.productId,
        revenueCents: row.revenueCents,
        quantity: row.quantity,
        invoiceCount: row.invoiceCount,
        orderCount: row.orderCount,
        averageUnitPriceCents: row.averageUnitPriceCents,
        shareOfCustomerRevenue: totalRevenueCents ? row.revenueCents / totalRevenueCents : 0,
        rank: index + 1,
        firstPurchaseAt: iso(row.firstPurchaseAt),
        latestPurchaseAt: iso(row.latestPurchaseAt),
        sourceRecordCount: row.sourceRecordCount,
        groupingRationale: row.groupingRationale,
      })),
      warnings: ["Revenue is calculated from posted native invoice-line snapshots. Draft, void, and imported QuickBooks snapshot invoices are excluded."],
      timezone,
    });
    return {
      status: "succeeded" as const,
      data,
      provenance: { sourceLinks: [customerSource(customer, capturedAt)], freshness: { capturedAt } },
    };
  };

  return {
    "analytics.resolve_customer": { execute: resolve },
    "analytics.customer_product_sales": { execute: customerProductSales },
  } as AssistantToolAdapters;
}

export { resolveExactCustomer };
