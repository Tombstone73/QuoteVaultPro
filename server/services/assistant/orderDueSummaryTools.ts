import {
  assistantOrderDueSummaryInputSchema,
  assistantOrderDueSummaryResultSchema,
  type AssistantToolResultEnvelope,
} from "@shared/assistantContracts";
import {
  AssistantOrderDueSummaryRepository,
  type AssistantOrderDueDateWindow,
  type AssistantOrderDueFilters,
} from "../../storage/assistantOrderDueSummary.repo";
import { AssistantToolExecutionError } from "./orchestration";
import type { AssistantToolAdapters, AssistantTrustedToolContext } from "./toolRegistry";

const FALLBACK_TIMEZONE = "UTC";

export interface AssistantOrderDueSummaryToolDependencies {
  repository?: Pick<AssistantOrderDueSummaryRepository, "getOrganizationTimezone" | "countDueOrders" | "listDueOrders"> & Partial<Pick<AssistantOrderDueSummaryRepository, "getDueOrderOperationalSummaries">>;
  now?: () => Date;
  timezone?: string;
}

function validTimezone(value: string | undefined): string {
  try {
    if (value) new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function zonedDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name: string) => Number(parts.find((value) => value.type === name)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function localMidnight(year: number, month: number, day: number, timezone: string): Date {
  const candidate = Date.UTC(year, month - 1, day);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(candidate));
  const part = (name: string) => Number(parts.find((value) => value.type === name)?.value ?? 0);
  const observed = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  const adjusted = candidate - (observed - candidate);
  const final = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(adjusted));
  const finalPart = (name: string) => Number(final.find((value) => value.type === name)?.value ?? 0);
  const finalObserved = Date.UTC(finalPart("year"), finalPart("month") - 1, finalPart("day"), finalPart("hour"), finalPart("minute"), finalPart("second"));
  return new Date(adjusted - (finalObserved - candidate));
}

function calendarMidnight(value: string, timezone: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return localMidnight(year!, month!, day!, timezone);
}

function addCalendarDays(start: Date, days: number, timezone: string): Date {
  const local = zonedDate(start, timezone);
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timezone);
}

function startOfWeekMonday(startOfToday: Date, timezone: string): Date {
  const local = zonedDate(startOfToday, timezone);
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  return addCalendarDays(startOfToday, -(weekday === 0 ? 6 : weekday - 1), timezone);
}

function dateWindow(now: Date, timezone: string, input: ReturnType<typeof assistantOrderDueSummaryInputSchema.parse>): AssistantOrderDueDateWindow {
  const local = zonedDate(now, timezone);
  const startOfToday = localMidnight(local.year, local.month, local.day, timezone);
  const startOfTomorrow = addCalendarDays(startOfToday, 1, timezone);
  const startOfDayAfterTomorrow = addCalendarDays(startOfToday, 2, timezone);
  const dueWithinDays = input.due === "due_within_days" ? input.dueWithinDays! : 1;
  const explicitRange = input.dateRange
    ? { rangeStart: calendarMidnight(input.dateRange.start, timezone), rangeEnd: addCalendarDays(calendarMidnight(input.dateRange.end, timezone), 1, timezone) }
    : input.due === "last_week_through_current_week"
      ? (() => {
        const currentWeekStart = startOfWeekMonday(startOfToday, timezone);
        return { rangeStart: addCalendarDays(currentWeekStart, -7, timezone), rangeEnd: addCalendarDays(currentWeekStart, 7, timezone) };
      })()
      : {};
  return {
    startOfToday,
    startOfTomorrow,
    startOfDayAfterTomorrow,
    startOfDayAfterWindow: addCalendarDays(startOfToday, dueWithinDays + 1, timezone),
    ...explicitRange,
  };
}

function dueState(dueDate: string, dates: AssistantOrderDueDateWindow): "overdue" | "due_today" | "due_tomorrow" | "future" {
  const due = new Date(dueDate).getTime();
  if (due < dates.startOfToday.getTime()) return "overdue";
  if (due < dates.startOfTomorrow.getTime()) return "due_today";
  if (due < dates.startOfDayAfterTomorrow.getTime()) return "due_tomorrow";
  return "future";
}

function calendarOrdinal(value: Date, timezone: string): number {
  const local = zonedDate(value, timezone);
  return Math.floor(Date.UTC(local.year, local.month - 1, local.day) / 86_400_000);
}

function canViewFinance(permissions: readonly string[]): boolean {
  return permissions.some((permission) => ["finance.read", "finance:read", "finance", "admin"].includes(permission.trim().toLowerCase()));
}

/** Read-only order-level due summary adapter. The optional operational batch is
 * intentionally best-effort: it cannot hide a valid list of matching orders. */
export function createAssistantOrderDueSummaryToolAdapters(deps: AssistantOrderDueSummaryToolDependencies = {}): AssistantToolAdapters {
  const repository = deps.repository ?? new AssistantOrderDueSummaryRepository();
  const now = deps.now ?? (() => new Date());
  return {
    "orders.get_due_summary": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        const input = assistantOrderDueSummaryInputSchema.parse(rawInput);
        // A human-readable customer reference is resolved and replaced with a
        // tenant-scoped id by the report-resolution boundary before a query.
        // Never silently drop it and broaden the report if that boundary is
        // unavailable or did not complete.
        if (input.customer && !input.customer.id) {
          throw new AssistantToolExecutionError("adapter_failed", "adapter_failed", "resolve_customer");
        }
        const timezone = validTimezone(await repository.getOrganizationTimezone(context.scope.organizationId) ?? deps.timezone);
        const capturedAt = now();
        const dates = dateWindow(capturedAt, timezone, input);
        const filters: AssistantOrderDueFilters = { due: input.due, customerId: input.customer?.id, status: input.status, limit: input.limit ?? 10 };
        let totalMatchingOrders: number;
        let rows: Awaited<ReturnType<AssistantOrderDueSummaryRepository["listDueOrders"]>>;
        try {
          [totalMatchingOrders, rows] = await Promise.all([
            repository.countDueOrders(context.scope.organizationId, dates, filters),
            repository.listDueOrders(context.scope.organizationId, dates, filters),
          ]);
        } catch {
          throw new AssistantToolExecutionError("core_query_failed", "core_query_failed", "lookup_due_orders");
        }

        const warnings: string[] = [];
        let operational = new Map<string, Awaited<ReturnType<AssistantOrderDueSummaryRepository["getDueOrderOperationalSummaries"]>>[number]>();
        if (input.includeOperationalSummary !== false && rows.length && repository.getDueOrderOperationalSummaries) {
          try {
            const summaries = await repository.getDueOrderOperationalSummaries(context.scope.organizationId, rows.map((row) => row.orderId));
            operational = new Map(summaries.map((summary) => [summary.orderId, summary]));
          } catch {
            warnings.push("Optional operational counts are unavailable for these orders.");
          }
        }
        if (totalMatchingOrders > rows.length) warnings.push(`Showing the first ${rows.length} of ${totalMatchingOrders} matching orders.`);
        const financeAllowed = canViewFinance(context.permissions);
        const data = assistantOrderDueSummaryResultSchema.parse({
          totalMatchingOrders,
          orders: rows.map((row) => {
            const summary = operational.get(row.orderId);
            const state = dueState(row.dueDate, dates);
            const dueDay = calendarOrdinal(new Date(row.dueDate), timezone);
            return {
              orderId: row.orderId,
              orderNumber: row.orderNumber,
              customerName: row.customerName,
              status: row.status,
              dueDate: new Date(row.dueDate).toISOString(),
              dueState: state,
              daysFromDue: dueDay - calendarOrdinal(capturedAt, timezone),
              lineItemCount: summary?.lineItemCount ?? null,
              incompleteLineItemCount: summary?.incompleteLineItemCount ?? null,
              productionJobCount: summary?.productionJobCount ?? null,
              activeProductionJobCount: summary?.activeProductionJobCount ?? null,
              fulfillmentState: row.fulfillmentStatus,
              invoiceState: summary?.invoiceState ?? null,
              billingReadiness: row.billingStatus,
              ...(financeAllowed ? { orderTotal: Number(row.total ?? 0) } : {}),
              sourceLink: { label: `Order ${row.orderNumber}`, href: `/orders/${row.orderId}`, entityType: "order" as const, entityId: row.orderId, capturedAt: new Date(row.updatedAt).toISOString() },
            };
          }),
          timezone,
          warnings,
        });
        return {
          status: "succeeded",
          data,
          provenance: {
            sourceLinks: data.orders.map((order) => order.sourceLink),
            freshness: { capturedAt: capturedAt.toISOString() },
          },
          ...(warnings.length ? { warning: warnings.join(" ") } : {}),
        };
      },
    },
  };
}
