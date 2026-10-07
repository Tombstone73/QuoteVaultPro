import { describe, expect, test } from "@jest/globals";
import { projectProductionExecutionConflicts } from "../services/productionBypassConflictService";

const line = { id: "line-1", description: "Posters" };
const job = { id: "job-1", lineItemId: line.id, stationKey: "roll", status: "in_progress" };

describe("production bypass execution conflicts", () => {
  test("allows bypass when no production execution exists", () => {
    expect(projectProductionExecutionConflicts({ lines: [line], jobs: [], runs: [], lastTimerByJob: new Map() })).toEqual([]);
  });

  test("blocks an active physical job and identifies its line", () => {
    expect(projectProductionExecutionConflicts({ lines: [line], jobs: [job], runs: [], lastTimerByJob: new Map() }))
      .toEqual([{ lineItemId: line.id, lineDescription: "Posters", jobId: job.id, stationKey: "roll", jobStatus: "in_progress", runningTimer: false, runId: null }]);
  });

  test("blocks a running timer even when the job status is terminal", () => {
    expect(projectProductionExecutionConflicts({ lines: [line], jobs: [{ ...job, status: "done" }], runs: [], lastTimerByJob: new Map([[job.id, "timer_started"]]) }))
      .toMatchObject([{ jobId: job.id, runningTimer: true }]);
    expect(projectProductionExecutionConflicts({ lines: [line], jobs: [{ ...job, status: "done" }], runs: [], lastTimerByJob: new Map([[job.id, "timer_stopped"]]) })).toEqual([]);
  });

  test("blocks active Combined Run ownership without treating fulfillment as production", () => {
    expect(projectProductionExecutionConflicts({
      lines: [line], jobs: [{ ...job, stationKey: "fulfillment" }],
      runs: [{ lineItemId: line.id, runId: "run-1", stationKey: "roll", status: "in_production" }],
      lastTimerByJob: new Map(),
    })).toMatchObject([{ lineItemId: line.id, runId: "run-1", jobId: null }]);
  });
});
