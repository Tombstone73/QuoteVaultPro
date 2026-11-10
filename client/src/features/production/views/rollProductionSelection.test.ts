import { rollProductionSelectionBlocker, rollProductionTransitionBlocker } from "./rollProductionSelection";
import { groupRollProductionJobs, visibleRollQueueItems } from "./rollProductionGrouping";

const queued = { id: "job-1", lineItemId: "line-1", stationKey: "roll", status: "queued", assignedPrinterName: null, order: { id: "order-1", orderNumber: "20788", customerName: "Synthetic Pizzeria" } } as any;

test("queued jobs without a machine remain selectable in grouped and ungrouped All views", () => {
  const jobs = [queued, { ...queued, id: "job-2", lineItemId: "line-2", stationKey: "wide_roll" }];
  expect(jobs.filter((job) => !rollProductionSelectionBlocker(job)).map((job) => job.id)).toEqual(["job-1", "job-2"]);
  const groups = groupRollProductionJobs(jobs);
  expect(visibleRollQueueItems(groups, new Set())).toHaveLength(1);
  expect(visibleRollQueueItems(groups, new Set(["order-1"]))).toHaveLength(3);
  for (const job of jobs) {
    expect(rollProductionTransitionBlocker(job, "start")).toBeNull();
    expect(rollProductionTransitionBlocker(job, "done")).toContain("start production before completing");
  }
});

test("active jobs can complete but cannot use queued-only Start", () => {
  for (const status of ["in_progress", "paused"]) {
    const job = { ...queued, status };
    expect(rollProductionTransitionBlocker(job, "done")).toBeNull();
    expect(rollProductionTransitionBlocker(job, "start")).toContain("Start requires a queued job");
  }
});

test("reports specific missing routing, ownership, and terminal blockers", () => {
  expect(rollProductionSelectionBlocker({ ...queued, stationKey: null })).toContain("station is missing");
  expect(rollProductionSelectionBlocker({ ...queued, stationKey: "prepress" })).toContain("Owned by station prepress");
  expect(rollProductionSelectionBlocker({ ...queued, kind: "production_run" })).toContain("Combined Run");
  expect(rollProductionSelectionBlocker({ ...queued, lineItemId: null })).toContain("missing its Order or line item");
  expect(rollProductionSelectionBlocker({ ...queued, status: "done" })).toContain("reopen or restore");
});
