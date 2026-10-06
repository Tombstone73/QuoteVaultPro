import { addBusinessCalendarDays, organizationBusinessToday } from "./orderDueDate";

export type WorkValueStatus = "active_production" | "new" | "in_production" | "complete_not_sent";
export type WorkValueDuePreset = "all" | "today" | "tomorrow" | "this_week" | "overdue" | "custom";
export type WorkValueFilters = {
  status: WorkValueStatus;
  customerId?: string;
  duePreset: WorkValueDuePreset;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page: number;
};
export type WorkValueRow = {
  id: string;
  kind: "order" | "invoice";
  status: "New" | "In Production" | "Complete, Not Sent";
  orderId: string | null;
  orderNumber: string | null;
  lineDescription: string | null;
  customerId: string | null;
  customerName: string | null;
  poNumber: string | null;
  jobLabel: string | null;
  dueDate: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  valueCents: number;
};
export type WorkValueSummary = { count: number; valueCents: number };
export type WorkValuePage = {
  summary: Record<WorkValueStatus, WorkValueSummary>;
  rows: WorkValueRow[];
  filtered: WorkValueSummary;
  pagination: { page: number; pageSize: number; totalPages: number };
};

export function workValueDueWindow(filters: WorkValueFilters, now: Date, timezone: string) {
  const today = organizationBusinessToday(now, timezone);
  const tomorrow = addBusinessCalendarDays(today, 1);
  if (filters.duePreset === "today") return { from: today, toExclusive: tomorrow };
  if (filters.duePreset === "tomorrow") return { from: tomorrow, toExclusive: addBusinessCalendarDays(today, 2) };
  if (filters.duePreset === "overdue") return { from: undefined, toExclusive: today };
  if (filters.duePreset === "this_week") {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const monday = addBusinessCalendarDays(today, -((weekday + 6) % 7));
    return { from: monday, toExclusive: addBusinessCalendarDays(monday, 7) };
  }
  if (filters.duePreset === "custom") return {
    from: filters.dateFrom,
    toExclusive: filters.dateTo ? addBusinessCalendarDays(filters.dateTo, 1) : undefined,
  };
  return { from: undefined, toExclusive: undefined };
}

export function centsSummary(rows: readonly WorkValueRow[]): WorkValueSummary {
  const valueCents = rows.reduce((sum, row) => sum + row.valueCents, 0);
  if (!Number.isSafeInteger(valueCents)) throw new Error("Work Value exceeds safe integer cents");
  return { count: rows.length, valueCents };
}

/** Roll billable line values up to the Order that owns the visible status pill. */
export function groupActiveOrderRows(lineRows: readonly WorkValueRow[]): WorkValueRow[] {
  const byOrder = new Map<string, WorkValueRow>();
  for (const row of lineRows) {
    if (row.kind !== "order" || !row.orderId) throw new Error("Active Work Value requires an Order");
    const current = byOrder.get(row.orderId);
    if (!current) {
      byOrder.set(row.orderId, { ...row, id: row.orderId });
      continue;
    }
    if (current.status !== row.status) throw new Error("Conflicting status pills on one Order");
    current.valueCents += row.valueCents;
    if (!Number.isSafeInteger(current.valueCents)) throw new Error("Work Value exceeds safe integer cents");
    current.lineDescription = "Multiple billable lines";
  }
  return Array.from(byOrder.values());
}

export function buildWorkValueSummary(activeRows: readonly WorkValueRow[], completeNotSent: WorkValueSummary): WorkValuePage["summary"] {
  const newSummary = centsSummary(activeRows.filter((row) => row.status === "New"));
  const inProductionSummary = centsSummary(activeRows.filter((row) => row.status === "In Production"));
  const activeValueCents = newSummary.valueCents + inProductionSummary.valueCents;
  if (!Number.isSafeInteger(activeValueCents)) throw new Error("Active Production exceeds safe integer cents");
  return {
    active_production: { count: newSummary.count + inProductionSummary.count, valueCents: activeValueCents },
    new: newSummary,
    in_production: inProductionSummary,
    complete_not_sent: completeNotSent,
  };
}

function dueDay(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

export function filterActiveWorkValueRows(rows: readonly WorkValueRow[], filters: WorkValueFilters, now: Date, timezone: string): WorkValueRow[] {
  const { from, toExclusive } = workValueDueWindow(filters, now, timezone);
  const search = filters.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status === "new" && row.status !== "New") return false;
    if (filters.status === "in_production" && row.status !== "In Production") return false;
    if (filters.customerId && row.customerId !== filters.customerId) return false;
    if (from || toExclusive) {
      const date = dueDay(row.dueDate);
      if (!date || (from && date < from) || (toExclusive && date >= toExclusive)) return false;
    }
    if (search && ![row.orderNumber, row.customerName, row.poNumber, row.jobLabel, row.lineDescription]
      .some((value) => value?.toLowerCase().includes(search))) return false;
    return true;
  }).sort((a, b) => (dueDay(a.dueDate) ?? "9999-12-31").localeCompare(dueDay(b.dueDate) ?? "9999-12-31")
    || (a.orderNumber ?? "").localeCompare(b.orderNumber ?? "", undefined, { numeric: true })
    || a.id.localeCompare(b.id));
}
