import { isTerminalProductionStatus } from "@shared/operationalState";

export type ProductionBoardTab = "all" | "queued" | "in_progress" | "paused" | "done";
export type ProductionStationPage = "flatbed" | "roll";
export type ProductionQueueSortBy = "newest" | "oldest" | "due_date" | "customer" | "priority" | "status";
export type ProductionQueueSortDirection = "asc" | "desc";

export type ProductionBoardJob = {
  status: string;
  completedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
};

export const DEFAULT_PRODUCTION_TAB: ProductionBoardTab = "in_progress";
export const DEFAULT_PRODUCTION_QUEUE_SORT_BY: ProductionQueueSortBy = "due_date";
export const DEFAULT_PRODUCTION_QUEUE_SORT_DIRECTION: ProductionQueueSortDirection = "asc";
export const DONE_RETENTION_DAYS = 7;

export const PRODUCTION_TAB_STORAGE_KEYS: Record<ProductionStationPage, string> = {
  flatbed: "productionTab.flatbed",
  roll: "productionTab.roll",
};

export type ProductionQueueControls = {
  search: string;
  sortBy: ProductionQueueSortBy;
  sortDirection: ProductionQueueSortDirection;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isProductionBoardTab(value: string | null | undefined): value is ProductionBoardTab {
  return value === "all" || value === "queued" || value === "in_progress" || value === "paused" || value === "done";
}

function isProductionQueueSortBy(value: string | null | undefined): value is ProductionQueueSortBy {
  return value === "newest" || value === "oldest" || value === "due_date" || value === "customer" || value === "priority" || value === "status";
}

function isProductionQueueSortDirection(value: string | null | undefined): value is ProductionQueueSortDirection {
  return value === "asc" || value === "desc";
}

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function getCompletedReferenceTime(job: ProductionBoardJob): number | null {
  const candidates = [job.completedAt, job.updatedAt, job.createdAt];

  for (const value of candidates) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  return null;
}

export function getProductionTabStorageKey(station: ProductionStationPage): string {
  return PRODUCTION_TAB_STORAGE_KEYS[station];
}

export function getProductionQueueControlsStorageKey(station: ProductionStationPage): string {
  return `productionQueueControls.${station}`;
}

export function readPersistedProductionTab(
  station: ProductionStationPage,
  storage?: StorageLike | null,
): ProductionBoardTab | null {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return null;

  try {
    const value = resolvedStorage.getItem(getProductionTabStorageKey(station));
    return isProductionBoardTab(value) ? value : null;
  } catch (error) {
    console.error("Failed to read production tab preference:", error);
    return null;
  }
}

export function normalizeProductionQueueControls(value: Partial<ProductionQueueControls> | null | undefined): ProductionQueueControls {
  return {
    search: typeof value?.search === "string" ? value.search : "",
    sortBy: isProductionQueueSortBy(value?.sortBy) ? value.sortBy : DEFAULT_PRODUCTION_QUEUE_SORT_BY,
    sortDirection: isProductionQueueSortDirection(value?.sortDirection)
      ? value.sortDirection
      : DEFAULT_PRODUCTION_QUEUE_SORT_DIRECTION,
  };
}

export function readPersistedProductionQueueControls(
  station: ProductionStationPage,
  storage?: StorageLike | null,
): ProductionQueueControls {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return normalizeProductionQueueControls(null);

  try {
    const raw = resolvedStorage.getItem(getProductionQueueControlsStorageKey(station));
    if (!raw) return normalizeProductionQueueControls(null);
    return normalizeProductionQueueControls(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to read production queue controls:", error);
    return normalizeProductionQueueControls(null);
  }
}

export function persistProductionQueueControls(
  station: ProductionStationPage,
  controls: ProductionQueueControls,
  storage?: StorageLike | null,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;

  try {
    resolvedStorage.setItem(getProductionQueueControlsStorageKey(station), JSON.stringify(normalizeProductionQueueControls(controls)));
  } catch (error) {
    console.error("Failed to save production queue controls:", error);
  }
}

export function resolvePersistedProductionTab(
  station: ProductionStationPage,
  storage?: StorageLike | null,
): ProductionBoardTab {
  return readPersistedProductionTab(station, storage) ?? DEFAULT_PRODUCTION_TAB;
}

export function persistProductionTab(
  station: ProductionStationPage,
  tab: ProductionBoardTab,
  storage?: StorageLike | null,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;

  try {
    resolvedStorage.setItem(getProductionTabStorageKey(station), tab);
  } catch (error) {
    console.error("Failed to save production tab preference:", error);
  }
}

export function isJobInDoneRetentionWindow(
  job: ProductionBoardJob,
  nowMs = Date.now(),
  retentionDays = DONE_RETENTION_DAYS,
): boolean {
  if (job.status !== "done") return false;

  const completedReferenceTime = getCompletedReferenceTime(job);
  if (completedReferenceTime === null) return true;

  const retentionWindowMs = retentionDays * 24 * 60 * 60 * 1000;
  return nowMs - completedReferenceTime <= retentionWindowMs;
}

export function matchesProductionTab(
  job: ProductionBoardJob,
  tab: ProductionBoardTab,
  nowMs = Date.now(),
  retentionDays = DONE_RETENTION_DAYS,
): boolean {
  if (tab === "queued") return job.status === "queued";
  if (tab === "in_progress") return job.status === "in_progress";
  if (tab === "paused") return job.status === "paused";
  if (tab === "done") return isJobInDoneRetentionWindow(job, nowMs, retentionDays);

  return (
    !isTerminalProductionStatus(job.status) ||
    isJobInDoneRetentionWindow(job, nowMs, retentionDays)
  );
}

export function filterProductionJobsForTab<T extends ProductionBoardJob>(
  jobs: T[],
  tab: ProductionBoardTab,
  nowMs = Date.now(),
  retentionDays = DONE_RETENTION_DAYS,
): T[] {
  return jobs.filter((job) => matchesProductionTab(job, tab, nowMs, retentionDays));
}

export function getProductionTabCounts<T extends ProductionBoardJob>(
  jobs: T[],
  nowMs = Date.now(),
  retentionDays = DONE_RETENTION_DAYS,
): Record<ProductionBoardTab, number> {
  return {
    all: filterProductionJobsForTab(jobs, "all", nowMs, retentionDays).length,
    queued: filterProductionJobsForTab(jobs, "queued", nowMs, retentionDays).length,
    in_progress: filterProductionJobsForTab(jobs, "in_progress", nowMs, retentionDays).length,
    paused: filterProductionJobsForTab(jobs, "paused", nowMs, retentionDays).length,
    done: filterProductionJobsForTab(jobs, "done", nowMs, retentionDays).length,
  };
}

export function getProductionTabCountsWithRecentlyCompleted<T extends ProductionBoardJob>(
  jobs: T[],
  recentlyCompletedCount: number,
  nowMs = Date.now(),
  retentionDays = DONE_RETENTION_DAYS,
): Record<ProductionBoardTab, number> {
  return {
    ...getProductionTabCounts(jobs, nowMs, retentionDays),
    done: Math.max(0, recentlyCompletedCount),
  };
}
