import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

export type ProductionOverviewDueDateJob = {
  id: string;
  lineItemDueDate?: string | null;
  dueDate?: string | null;
  order: { dueDate?: string | null };
};

export type ProductionDueUrgency = "overdue" | "today" | "upcoming" | "none";

function validIsoDate(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  const parsed = parseISO(normalized);
  return Number.isNaN(parsed.getTime()) ? null : normalized;
}

export function resolveProductionOverviewDueDate(job: ProductionOverviewDueDateJob): string | null {
  return validIsoDate(job.lineItemDueDate)
    ?? validIsoDate(job.dueDate)
    ?? validIsoDate(job.order.dueDate);
}

export function productionOverviewDueDateKey(job: ProductionOverviewDueDateJob): string | null {
  const dueDate = resolveProductionOverviewDueDate(job);
  return dueDate ? format(parseISO(dueDate), "yyyy-MM-dd") : null;
}

export function productionDueUrgency(dueDate: string | null, now = new Date()): ProductionDueUrgency {
  if (!dueDate) return "none";
  const parsed = parseISO(dueDate);
  if (Number.isNaN(parsed.getTime())) return "none";
  if (isSameDay(parsed, now)) return "today";
  return isBefore(startOfDay(parsed), startOfDay(now)) ? "overdue" : "upcoming";
}

export function buildProductionCalendarDays(month: Date): Date[] {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 0 }),
  });
}

export function groupProductionJobsByDueDate<T extends ProductionOverviewDueDateJob>(jobs: readonly T[]): {
  byDate: Map<string, T[]>;
  noDueDate: T[];
} {
  const byDate = new Map<string, T[]>();
  const noDueDate: T[] = [];
  for (const job of jobs) {
    const key = productionOverviewDueDateKey(job);
    if (!key) {
      noDueDate.push(job);
      continue;
    }
    const existing = byDate.get(key) ?? [];
    existing.push(job);
    byDate.set(key, existing);
  }
  return { byDate, noDueDate };
}
