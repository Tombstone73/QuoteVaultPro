import type { ProductionJobListItem } from "@/hooks/useProduction";
import { getProductionOrderNumber } from "@/lib/productionDocumentNumbers";
import type { ProductionStationPage } from "@/lib/productionBoard";

export const PRODUCTION_STATION_SORT_FIELDS = ["customer", "order", "poJob", "media", "due", "qty", "sides", "machine", "status"] as const;
export type ProductionStationSortField = (typeof PRODUCTION_STATION_SORT_FIELDS)[number];
export type ProductionStationSort = { field: ProductionStationSortField; direction: "asc" | "desc" };
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function productionStationSortStorageKey(station: ProductionStationPage, userId: string): string {
  return `titanos:production:${station}:sort:v1:${userId}`;
}

export function readProductionStationSort(station: ProductionStationPage, userId: string, storage?: StorageLike): ProductionStationSort | null {
  try {
    const store = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    const raw = store?.getItem(productionStationSortStorageKey(station, userId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if ((PRODUCTION_STATION_SORT_FIELDS as readonly unknown[]).includes(candidate.field)
      && (candidate.direction === "asc" || candidate.direction === "desc")) {
      return { field: candidate.field as ProductionStationSortField, direction: candidate.direction };
    }
  } catch { /* Corrupt or inaccessible optional browser preference. */ }
  return null;
}

export function persistProductionStationSort(station: ProductionStationPage, userId: string, sort: ProductionStationSort, storage?: StorageLike): void {
  try {
    const store = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    store?.setItem(productionStationSortStorageKey(station, userId), JSON.stringify(sort));
  } catch { /* Sorting remains usable when localStorage is unavailable. */ }
}

export function nextProductionStationSort(current: ProductionStationSort | null, field: ProductionStationSortField): ProductionStationSort {
  return { field, direction: current?.field === field && current.direction === "asc" ? "desc" : "asc" };
}

function textValue(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text !== "—" ? text : null;
}

export function productionStationPoJob(job: ProductionJobListItem): { po: string | null; job: string | null; sortValue: string | null } {
  const po = textValue(job.poNumber) ?? textValue(job.order?.poNumber);
  const description = textValue(job.jobDescription) ?? textValue(job.order?.lineItems?.primary?.description);
  return { po, job: description, sortValue: po ?? description };
}

function orderNumber(job: ProductionJobListItem): number | null {
  const core = job.order?.numberCore ?? job.numberCore;
  if (typeof core === "number" && Number.isFinite(core)) return core;
  const displayed = getProductionOrderNumber(job);
  const match = displayed.match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : null;
}

function quantity(job: ProductionJobListItem): number | null {
  const raw = job.order?.lineItems?.primary?.quantity ?? job.order?.lineItems?.totalQuantity;
  return raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
}

function dueTime(job: ProductionJobListItem): number | null {
  const raw = job.order?.dueDate;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function fieldValue(job: ProductionJobListItem, field: ProductionStationSortField): string | number | null {
  switch (field) {
    case "customer": return textValue(job.order?.customerName);
    case "order": return orderNumber(job);
    case "poJob": return productionStationPoJob(job).sortValue;
    case "media": return textValue(job.media);
    case "due": return dueTime(job);
    case "qty": return quantity(job);
    case "sides": return textValue(job.sides);
    case "machine": return textValue(job.assignedPrinterName) ?? "Unassigned";
    case "status": return textValue(job.kind === "production_run" ? (job as { runStatus?: string }).runStatus?.replace(/_/g, " ") : job.status);
  }
}

function compareValues(a: string | number | null, b: string | number | null, direction: "asc" | "desc"): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const compared = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return direction === "asc" ? compared : -compared;
}

export function sortProductionStationJobs<T extends ProductionJobListItem>(jobs: readonly T[], sort: ProductionStationSort | null): T[] {
  if (!sort) return [...jobs]; // Preserve the station's incoming run-then-job order as its default.
  return [...jobs].sort((a, b) =>
    compareValues(fieldValue(a, sort.field), fieldValue(b, sort.field), sort.direction)
    || compareValues(orderNumber(a), orderNumber(b), "asc")
    || collator.compare(a.id, b.id));
}
