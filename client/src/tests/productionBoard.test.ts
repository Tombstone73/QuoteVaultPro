import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_PRODUCTION_TAB,
  DONE_RETENTION_DAYS,
  filterProductionJobsForTab,
  getProductionQueueControlsStorageKey,
  getProductionTabCounts,
  getProductionTabCountsWithRecentlyCompleted,
  getProductionTabStorageKey,
  normalizeProductionQueueControls,
  persistProductionQueueControls,
  persistProductionTab,
  readPersistedProductionQueueControls,
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
    { id: "paused-1", status: "paused", createdAt: new Date(now).toISOString() },
    { id: "done-recent", status: "done", completedAt: new Date(now - dayMs).toISOString() },
    { id: "done-old", status: "done", completedAt: new Date(now - (DONE_RETENTION_DAYS + 1) * dayMs).toISOString() },
    { id: "canceled-1", status: "canceled", createdAt: new Date(now).toISOString() },
    { id: "void-1", status: "void", createdAt: new Date(now).toISOString() },
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

  test("persists search and sort controls with separate station keys", () => {
    const storage = createStorage();

    persistProductionQueueControls("roll", { search: "Acme", sortBy: "customer", sortDirection: "desc" }, storage);

    expect(getProductionQueueControlsStorageKey("roll")).toBe("productionQueueControls.roll");
    expect(readPersistedProductionQueueControls("roll", storage)).toEqual({
      search: "Acme",
      sortBy: "customer",
      sortDirection: "desc",
    });
    expect(readPersistedProductionQueueControls("flatbed", storage)).toEqual({
      search: "",
      sortBy: "due_date",
      sortDirection: "asc",
    });
  });

  test("normalizes invalid queue controls back to safe defaults", () => {
    expect(normalizeProductionQueueControls({ search: "Banner", sortBy: "oops" as any, sortDirection: "sideways" as any })).toEqual({
      search: "Banner",
      sortBy: "due_date",
      sortDirection: "asc",
    });
  });

  test("computes count badges from current visible tab rules", () => {
    expect(getProductionTabCounts(jobs, now)).toEqual({
      all: 4,
      queued: 1,
      in_progress: 1,
      paused: 1,
      done: 1,
    });
  });

  test("completed tab count can be aligned to the recently completed queue", () => {
    expect(getProductionTabCountsWithRecentlyCompleted(jobs, 2, now)).toEqual({
      all: 4,
      queued: 1,
      in_progress: 1,
      paused: 1,
      done: 2,
    });
  });

  test("recently completed count override does not double count all tab work", () => {
    const countsBeforeCompletion = getProductionTabCountsWithRecentlyCompleted(jobs, 0, now);
    const countsAfterCompletion = getProductionTabCountsWithRecentlyCompleted(jobs, 1, now);
    const countsAfterUndo = getProductionTabCountsWithRecentlyCompleted(jobs, 0, now);

    expect(countsBeforeCompletion.done).toBe(0);
    expect(countsAfterCompletion.done).toBe(1);
    expect(countsAfterUndo.done).toBe(0);
    expect(countsAfterCompletion.all).toBe(countsBeforeCompletion.all);
  });

  test("done tab only includes jobs within the default 7 day window", () => {
    const visibleDoneJobIds = filterProductionJobsForTab(jobs, "done", now).map((job) => job.id);

    expect(visibleDoneJobIds).toEqual(["done-recent"]);
  });

  test("cancelled and void production jobs are not active board work", () => {
    const visibleAllJobIds = filterProductionJobsForTab(jobs, "all", now).map((job) => job.id);

    expect(visibleAllJobIds).toEqual(["queued-1", "progress-1", "paused-1", "done-recent"]);
    expect(visibleAllJobIds).not.toContain("canceled-1");
    expect(visibleAllJobIds).not.toContain("void-1");
  });
});
