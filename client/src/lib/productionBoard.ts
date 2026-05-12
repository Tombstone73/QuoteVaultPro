export type ProductionBoardTab = "all" | "queued" | "in_progress" | "done";
export type ProductionStationPage = "flatbed" | "roll";

export type ProductionBoardJob = {
  status: string;
  completedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
};

export const DEFAULT_PRODUCTION_TAB: ProductionBoardTab = "in_progress";
export const DONE_RETENTION_DAYS = 7;

export const PRODUCTION_TAB_STORAGE_KEYS: Record<ProductionStationPage, string> = {
  flatbed: "productionTab.flatbed",
  roll: "productionTab.roll",
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isProductionBoardTab(value: string | null | undefined): value is ProductionBoardTab {
  return value === "all" || value === "queued" || value === "in_progress" || value === "done";
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
  if (tab === "done") return isJobInDoneRetentionWindow(job, nowMs, retentionDays);

  return (
    job.status === "queued" ||
    job.status === "in_progress" ||
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
    done: filterProductionJobsForTab(jobs, "done", nowMs, retentionDays).length,
  };
}