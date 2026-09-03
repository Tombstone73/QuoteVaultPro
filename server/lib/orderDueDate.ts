import { eq, not, sql, type SQL } from "drizzle-orm";
import { orders } from "@shared/schema";

export const ORDER_DUE_FILTERS = ["today", "tomorrow", "overdue"] as const;
export type OrderDueFilter = typeof ORDER_DUE_FILTERS[number];

const FALLBACK_TIMEZONE = "UTC";

export function isOrderDueFilter(value: unknown): value is OrderDueFilter {
  return typeof value === "string" && (ORDER_DUE_FILTERS as readonly string[]).includes(value);
}

export function validOrganizationTimezone(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  try {
    if (candidate) new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function zonedCalendarParts(now: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validOrganizationTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => Number(parts.find((entry) => entry.type === name)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function calendarDateFromParts(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function organizationBusinessToday(now: Date, timezone: string): string {
  const local = zonedCalendarParts(now, timezone);
  return calendarDateFromParts(local.year, local.month, local.day);
}

export function addBusinessCalendarDays(datePart: string, days: number): string {
  const [year, month, day] = datePart.split("-").map(Number);
  return calendarDateFromParts(year, month, day + days);
}

export function businessDateForOrderDueFilter(filter: OrderDueFilter, now: Date, timezone: string): string {
  const today = organizationBusinessToday(now, timezone);
  return filter === "tomorrow" ? addBusinessCalendarDays(today, 1) : today;
}

/** Legacy timestamptz Order dates are compared by their persisted UTC calendar
 * portion, never against host-local timestamp boundaries. */
export function orderDueDatePredicate(filter: OrderDueFilter, datePart: string): SQL {
  const dateExpression = sql`(${orders.dueDate} AT TIME ZONE 'UTC')::date`;
  return filter === "overdue"
    ? sql`${dateExpression} < ${datePart}::date`
    : sql`${dateExpression} = ${datePart}::date`;
}

/** Production-complete Orders remain operational until closed/canceled. */
export function activeOrderDuePredicates(filter: OrderDueFilter, datePart: string): SQL[] {
  return [
    orderDueDatePredicate(filter, datePart),
    not(eq(orders.state, "closed")),
    not(eq(orders.state, "canceled")),
  ];
}
