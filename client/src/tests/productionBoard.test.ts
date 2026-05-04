import {
  DEFAULT_PRODUCTION_TAB,
  DONE_RETENTION_DAYS,
  filterProductionJobsForTab,
  getProductionTabCounts,
  getProductionTabStorageKey,
  persistProductionTab,
  readPersistedProductionTab,
  resolvePersistedProductionTab,
} from "../lib/productionBoard";

function createStorage() {
  const store = new Map<string, string>();

  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("productionBoard helpers", () => {
  const now = Date.UTC(2026, 4, 4, 12, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;

  const jobs = [
    { id: "queued-1", status: "queued", createdAt: new Date(now).toISOString() },
    { id: "progress-1", status: "in_progress", createdAt: new Date(now).toISOString() },
    { id: "done-recent", status: "done", completedAt: new Date(now - dayMs).toISOString() },
    { id: "done-old", status: "done", completedAt: new Date(now - (DONE_RETENTION_DAYS + 1) * dayMs).toISOString() },
  ];

  test("falls back to in_progress when no saved preference exists", () => {
    const storage = createStorage();

    expect(resolvePersistedProductionTab("flatbed", storage)).toBe(DEFAULT_PRODUCTION_TAB);
  });

  test("persists tab selection with separate station keys", () => {
    const storage = createStorage();

    persistProductionTab("flatbed", "done", storage);
    persistProductionTab("roll", "queued", storage);

    expect(getProductionTabStorageKey("flatbed")).toBe("productionTab.flatbed");
    expect(getProductionTabStorageKey("roll")).toBe("productionTab.roll");
    expect(readPersistedProductionTab("flatbed", storage)).toBe("done");
    expect(readPersistedProductionTab("roll", storage)).toBe("queued");
  });

  test("computes count badges from current visible tab rules", () => {
    expect(getProductionTabCounts(jobs, now)).toEqual({
      all: 3,
      queued: 1,
      in_progress: 1,
      done: 1,
    });
  });

  test("done tab only includes jobs within the default 7 day window", () => {
    const visibleDoneJobIds = filterProductionJobsForTab(jobs, "done", now).map((job) => job.id);

    expect(visibleDoneJobIds).toEqual(["done-recent"]);
  });
});