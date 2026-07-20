export const PRODUCTION_COMPLETE_COLUMN_ID = "production_complete";
export const UNASSIGNED_PRODUCTION_COLUMN_ID = "unassigned";

export type ProductionOverviewStation = {
  key: string;
  name: string;
  sort: number;
};

export type ProductionOverviewBoardJob = {
  id: string;
  stationKey?: string | null;
  status: string;
};

export type ProductionOverviewBoardColumn = {
  id: string;
  label: string;
  stationKey: string | null;
  sort: number;
  fallback: boolean;
  terminal: boolean;
};

export function normalizeProductionOverviewStationKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function productionOverviewStationColumnId(stationKey: unknown): string {
  const normalized = normalizeProductionOverviewStationKey(stationKey);
  return normalized ? `station:${normalized}` : UNASSIGNED_PRODUCTION_COLUMN_ID;
}

function titleCaseStationKey(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function productionOverviewStationLabel(station: { key: string; name?: string | null }): string {
  const key = normalizeProductionOverviewStationKey(station.key);
  const configuredName = String(station.name ?? "").trim() || titleCaseStationKey(key);
  if (key === "flatbed") return /print/i.test(configuredName) ? configuredName : `${configuredName} Printing`;
  if (key === "roll" || key === "wide_roll") return /print/i.test(configuredName) ? configuredName : `${configuredName} Printing`;
  if (key === "done" || key === "completed") return "Production Complete";
  return configuredName || "Unassigned";
}

export function buildProductionOverviewColumns(
  stations: readonly ProductionOverviewStation[],
  jobs: readonly ProductionOverviewBoardJob[],
): ProductionOverviewBoardColumn[] {
  const active = new Map<string, ProductionOverviewStation>();
  for (const station of stations) {
    const key = normalizeProductionOverviewStationKey(station.key);
    if (!key || key === "done" || key === "completed") continue;
    active.set(key, { ...station, key });
  }

  const columns: ProductionOverviewBoardColumn[] = Array.from(active.values())
    .sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name))
    .map((station) => ({
      id: productionOverviewStationColumnId(station.key),
      label: productionOverviewStationLabel(station),
      stationKey: station.key,
      sort: station.sort,
      fallback: false,
      terminal: false,
    }));

  const activeKeys = new Set(active.keys());
  const fallbackKeys = Array.from(new Set(jobs
    .filter((job) => String(job.status).toLowerCase() !== "done")
    .map((job) => normalizeProductionOverviewStationKey(job.stationKey))
    .filter((key) => key && !activeKeys.has(key))))
    .sort();

  for (const key of fallbackKeys) {
    columns.push({
      id: productionOverviewStationColumnId(key),
      label: `${productionOverviewStationLabel({ key })} (Inactive)`,
      stationKey: key,
      sort: 10_000 + columns.length,
      fallback: true,
      terminal: false,
    });
  }

  if (jobs.some((job) => String(job.status).toLowerCase() !== "done" && !normalizeProductionOverviewStationKey(job.stationKey))) {
    columns.push({
      id: UNASSIGNED_PRODUCTION_COLUMN_ID,
      label: "Unassigned",
      stationKey: null,
      sort: 20_000,
      fallback: true,
      terminal: false,
    });
  }

  columns.push({
    id: PRODUCTION_COMPLETE_COLUMN_ID,
    label: "Production Complete",
    stationKey: null,
    sort: 30_000,
    fallback: false,
    terminal: true,
  });
  return columns;
}

export function resolveProductionOverviewJobColumn(job: ProductionOverviewBoardJob): string {
  if (String(job.status).toLowerCase() === "done") return PRODUCTION_COMPLETE_COLUMN_ID;
  return productionOverviewStationColumnId(job.stationKey);
}

export function groupProductionOverviewJobsByColumn<T extends ProductionOverviewBoardJob>(
  columns: readonly ProductionOverviewBoardColumn[],
  jobs: readonly T[],
): Map<string, T[]> {
  const grouped = new Map(columns.map((column) => [column.id, [] as T[]]));
  for (const job of jobs) {
    grouped.get(resolveProductionOverviewJobColumn(job))?.push(job);
  }
  return grouped;
}

export function defaultStepKeyForProductionStation(stationKey: string): string {
  const key = normalizeProductionOverviewStationKey(stationKey);
  if (key === "flatbed" || key === "roll" || key === "wide_roll" || key === "print") return "print";
  return key || "queued";
}
