import { z } from "zod";
import {
  analyticsInvoiceActivityInputSchema,
  analyticsInvoiceActivityResultSchema,
  type AssistantToolResultEnvelope,
} from "@shared/assistantContracts";
import { analyticsInvoiceStatusValues } from "@shared/aiReportingContracts";
import { listInvoicesForOrganization, type EnrichedInvoiceListItem } from "../../invoicesService";
import { AssistantAnalyticsReportingRepository } from "../../storage/assistantAnalyticsReporting.repo";
import { analyticsDateWindow } from "./analyticsReportingTools";
import type { AssistantToolAdapters, AssistantTrustedToolContext } from "./toolRegistry";

type InvoiceActivityInput = z.infer<typeof analyticsInvoiceActivityInputSchema>;
type InvoiceActivityRow = z.infer<typeof analyticsInvoiceActivityResultSchema>["invoices"][number];

const FALLBACK_TIMEZONE = "UTC";

export interface AssistantInvoiceActivityToolDependencies {
  listInvoices?: (input: Parameters<typeof listInvoicesForOrganization>[0]) => Promise<EnrichedInvoiceListItem[]>;
  getOrganizationTimezone?: (organizationId: string) => Promise<string | null>;
  now?: () => Date;
}

function validTimezone(value: string | null | undefined): string {
  try {
    if (value) new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decimalToCents(value: unknown): number {
  const decimal = Number(value ?? 0);
  return Number.isFinite(decimal) ? Math.max(0, Math.round(decimal * 100)) : 0;
}

function invoiceTotalCents(invoice: EnrichedInvoiceListItem): number {
  const cents = Number(invoice.totalCents);
  // Older invoices can predate the cents projection. A zero total remains a
  // legitimate value, so fall back only when the decimal total has a value.
  if (Number.isFinite(cents) && (cents !== 0 || decimalToCents(invoice.total) === 0)) return Math.max(0, Math.round(cents));
  return decimalToCents(invoice.total);
}

function invoiceRow(invoice: EnrichedInvoiceListItem): InvoiceActivityRow {
  const invoiceNumber = String(invoice.displayNumber || invoice.invoiceNumber);
  const postedAt = iso(invoice.issuedAt) ?? iso(invoice.issueDate);
  if (!postedAt) throw new Error("Invoice activity source returned an invoice without a valid issue date.");
  return {
    invoiceId: invoice.id,
    invoiceNumber,
    customerId: invoice.customerId,
    customerName: invoice.customerName?.trim() || "Unnamed customer",
    postedAt,
    dueAt: iso(invoice.dueDate),
    status: invoice.status as InvoiceActivityRow["status"],
    totalCents: invoiceTotalCents(invoice),
    amountPaidCents: decimalToCents(invoice.amountPaid),
    balanceDueCents: decimalToCents(invoice.balanceDue),
    currency: invoice.currency || "USD",
    sourceLink: { label: invoiceNumber, href: `/invoices/${invoice.id}` },
  };
}

/**
 * Releases invoice facts only after the normal finance-read authorization and
 * tenant binding. It deliberately contains no KPI, comparison, or risk logic;
 * the Operator chooses whether and how to analyze the released rows.
 */
export function createAssistantInvoiceActivityToolAdapters(
  deps: AssistantInvoiceActivityToolDependencies = {},
): AssistantToolAdapters {
  const listInvoices = deps.listInvoices ?? listInvoicesForOrganization;
  const timezoneRepository = new AssistantAnalyticsReportingRepository();
  const getOrganizationTimezone = deps.getOrganizationTimezone ?? ((organizationId: string) => timezoneRepository.getOrganizationTimezone(organizationId));
  const now = deps.now ?? (() => new Date());

  const execute = async (rawInput: unknown, context: AssistantTrustedToolContext): Promise<AssistantToolResultEnvelope> => {
    const input = analyticsInvoiceActivityInputSchema.parse(rawInput) as InvoiceActivityInput;
    const timezone = validTimezone(await getOrganizationTimezone(context.scope.organizationId));
    const window = analyticsDateWindow(input.dateRange.start, input.dateRange.end, timezone);
    // Fetch one additional row solely to report a truthful truncation flag;
    // the released observation itself never exceeds the registry's 200 rows.
    const sourceRows = await listInvoices({
      organizationId: context.scope.organizationId,
      statuses: input.statuses ?? analyticsInvoiceStatusValues,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      issuedAtStart: window.start,
      issuedAtEndExclusive: window.endExclusive,
      sortBy: "issueDate",
      sortDir: "desc",
      limit: input.limit + 1,
    });
    const truncated = sourceRows.length > input.limit;
    const invoices = sourceRows.slice(0, input.limit).map(invoiceRow);
    const data = analyticsInvoiceActivityResultSchema.parse({
      dateRange: input.dateRange,
      invoices,
      truncated,
      warnings: [
        "Invoice activity contains canonical invoice totals and current payment rollup fields; it is not a profitability measure.",
        ...(truncated ? [`Only the first ${input.limit} matching invoices were released; request a narrower range before drawing complete-period conclusions.`] : []),
      ],
      timezone,
    });
    const capturedAt = now().toISOString();
    return {
      status: "succeeded",
      data,
      provenance: {
        sourceLinks: invoices.slice(0, 10).map((invoice) => ({
          ...invoice.sourceLink,
          entityType: "invoice" as const,
          entityId: invoice.invoiceId,
          capturedAt,
        })),
        freshness: { capturedAt },
      },
    };
  };

  return { "analytics.invoice_activity": { execute } } as AssistantToolAdapters;
}
