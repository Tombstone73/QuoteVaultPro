/**
 * productionOwnership.unit.test.ts
 *
 * Unit tests for production routing ownership helpers and the
 * board-visibility classification logic.
 *
 * These tests exercise pure functions / logic without requiring a database.
 * They cover the critical ownership rules stabilised in the routing refactor.
 */

import { describe, expect, test } from "@jest/globals";
import {
  isTerminalStatus,
  isActiveJobStatus,
  isPrepressOwnershipJob,
  TERMINAL_JOB_STATUSES,
  LINE_ITEM_LIFECYCLE_STATUSES,
  LEGACY_STATION_STATUSES,
} from "../services/productionOwnership";

// ──────────────────────────────────────────────────────────────────
// 1. isTerminalStatus and isActiveJobStatus
// ──────────────────────────────────────────────────────────────────

describe("isTerminalStatus", () => {
  test.each(["done", "void", "canceled", "cancelled"])(
    "returns true for terminal status '%s'",
    (status) => {
      expect(isTerminalStatus(status)).toBe(true);
    }
  );

  test.each(["queued", "in_progress", "printing", "active", "blocked"])(
    "returns false for non-terminal status '%s'",
    (status) => {
      expect(isTerminalStatus(status)).toBe(false);
    }
  );

  test("returns false for null", () => {
    expect(isTerminalStatus(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isTerminalStatus(undefined)).toBe(false);
  });

  test("is case-insensitive (DONE, VOID)", () => {
    expect(isTerminalStatus("DONE")).toBe(true);
    expect(isTerminalStatus("VOID")).toBe(true);
    expect(isTerminalStatus("CANCELED")).toBe(true);
  });
});

describe("isActiveJobStatus", () => {
  test("returns true for queued", () => expect(isActiveJobStatus("queued")).toBe(true));
  test("returns true for in_progress", () => expect(isActiveJobStatus("in_progress")).toBe(true));
  test("returns false for done", () => expect(isActiveJobStatus("done")).toBe(false));
  test("returns false for null", () => expect(isActiveJobStatus(null)).toBe(false));
});

// ──────────────────────────────────────────────────────────────────
// 2. TERMINAL_JOB_STATUSES constant correctness
// ──────────────────────────────────────────────────────────────────

describe("TERMINAL_JOB_STATUSES", () => {
  test("contains exactly done, void, canceled, cancelled", () => {
    expect([...TERMINAL_JOB_STATUSES].sort()).toEqual(
      ["canceled", "cancelled", "done", "void"]
    );
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. LINE_ITEM_LIFECYCLE_STATUSES constant correctness
// ──────────────────────────────────────────────────────────────────

describe("LINE_ITEM_LIFECYCLE_STATUSES", () => {
  test("contains only the allowed lifecycle values", () => {
    expect([...LINE_ITEM_LIFECYCLE_STATUSES].sort()).toEqual(
      ["canceled", "complete", "in_production", "new"]
    );
  });

  test("does not contain any legacy station status", () => {
    for (const legacy of LEGACY_STATION_STATUSES) {
      expect(LINE_ITEM_LIFECYCLE_STATUSES).not.toContain(legacy);
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// 4. Board ownership classification logic (mirrors prepress queue + gate)
//
//  The prepress queue classifies each production_job as:
//    - prepress   → stationKey='prepress' OR stepKey='prepress'
//    - downstream → any non-prepress, non-terminal job
//
//  This test validates that classification with representative fixtures.
// ──────────────────────────────────────────────────────────────────

type FakeJob = { lineItemId: string; stationKey: string; stepKey: string; status: string };

function classifyJobs(jobs: FakeJob[]) {
  const TERMINAL = new Set(["done", "void", "canceled", "cancelled"]);
  const prepressActiveLineItems = new Set<string>();
  const prepressAnyLineItems = new Set<string>();
  const downstreamActiveLineItems = new Set<string>();
  const anyProductionLineItems = new Set<string>();

  for (const job of jobs) {
    if (!job.lineItemId) continue;
    anyProductionLineItems.add(job.lineItemId);
    const stKey = String(job.stationKey || "").toLowerCase();
    const stpKey = String(job.stepKey || "").toLowerCase();
    const isTerminal = TERMINAL.has(stKey === "done" ? stKey : String(job.status || "").toLowerCase());

    const isPrepress = stKey === "prepress" || stpKey === "prepress";
    if (isPrepress) {
      prepressAnyLineItems.add(job.lineItemId);
      if (!isTerminal) prepressActiveLineItems.add(job.lineItemId);
      continue;
    }
    if (!isTerminal) downstreamActiveLineItems.add(job.lineItemId);
  }

  return { prepressActiveLineItems, prepressAnyLineItems, downstreamActiveLineItems, anyProductionLineItems };
}

describe("Board ownership classification (prepress queue logic)", () => {
  test("active flatbed/prepress step job belongs to prepress board, not downstream", () => {
    const jobs: FakeJob[] = [
      { lineItemId: "li-1", stationKey: "flatbed", stepKey: "prepress", status: "queued" },
    ];
    const { prepressActiveLineItems, downstreamActiveLineItems } = classifyJobs(jobs);
    expect(prepressActiveLineItems.has("li-1")).toBe(true);
    expect(downstreamActiveLineItems.has("li-1")).toBe(false);
  });

  test("active standalone prepress station job belongs to prepress board", () => {
    const jobs: FakeJob[] = [
      { lineItemId: "li-2", stationKey: "prepress", stepKey: "queued", status: "queued" },
    ];
    const { prepressActiveLineItems, downstreamActiveLineItems } = classifyJobs(jobs);
    expect(prepressActiveLineItems.has("li-2")).toBe(true);
    expect(downstreamActiveLineItems.has("li-2")).toBe(false);
  });

  test("active flatbed/print step job does NOT belong to prepress board", () => {
    const jobs: FakeJob[] = [
      { lineItemId: "li-3", stationKey: "flatbed", stepKey: "print", status: "queued" },
    ];
    const { prepressActiveLineItems, downstreamActiveLineItems } = classifyJobs(jobs);
    expect(prepressActiveLineItems.has("li-3")).toBe(false);
    expect(downstreamActiveLineItems.has("li-3")).toBe(true);
  });

  test("terminal prepress job → prepressAnyLineItems but NOT prepressActiveLineItems", () => {
    const jobs: FakeJob[] = [
      { lineItemId: "li-4", stationKey: "flatbed", stepKey: "prepress", status: "done" },
    ];
    const { prepressActiveLineItems, prepressAnyLineItems } = classifyJobs(jobs);
    expect(prepressAnyLineItems.has("li-4")).toBe(true);
    expect(prepressActiveLineItems.has("li-4")).toBe(false);
  });

  test("item with terminal prepress AND active downstream → only in downstreamActiveLineItems", () => {
    // This is the state after a successful send-to-print:
    //   old prepress job: done
    //   new flatbed/print job: queued
    const jobs: FakeJob[] = [
      { lineItemId: "li-5", stationKey: "flatbed", stepKey: "prepress", status: "done" },
      { lineItemId: "li-5", stationKey: "flatbed", stepKey: "print", status: "queued" },
    ];
    const { prepressActiveLineItems, downstreamActiveLineItems } = classifyJobs(jobs);
    expect(prepressActiveLineItems.has("li-5")).toBe(false);
    expect(downstreamActiveLineItems.has("li-5")).toBe(true);
  });

  test("item with active prepress AND active downstream → prepress detected, downstream detected (data integrity issue)", () => {
    // Should never happen in production, but the classifier must not crash.
    const jobs: FakeJob[] = [
      { lineItemId: "li-6", stationKey: "flatbed", stepKey: "prepress", status: "queued" },
      { lineItemId: "li-6", stationKey: "flatbed", stepKey: "print", status: "queued" },
    ];
    const { prepressActiveLineItems, downstreamActiveLineItems } = classifyJobs(jobs);
    // With the loop as written, prepress `continue` skips the downstream set for the first job.
    // The second job adds to downstream set. Both are populated — scheduler can log this anomaly.
    expect(prepressActiveLineItems.has("li-6")).toBe(true);
    expect(downstreamActiveLineItems.has("li-6")).toBe(true);
  });

  test("item at roll station (non-prepress) → downstream only", () => {
    const jobs: FakeJob[] = [
      { lineItemId: "li-7", stationKey: "roll", stepKey: "queued", status: "queued" },
    ];
    const { prepressActiveLineItems, downstreamActiveLineItems } = classifyJobs(jobs);
    expect(prepressActiveLineItems.has("li-7")).toBe(false);
    expect(downstreamActiveLineItems.has("li-7")).toBe(true);
  });

  test("item at finishing station → downstream only", () => {
    const jobs: FakeJob[] = [
      { lineItemId: "li-8", stationKey: "finishing", stepKey: "queued", status: "in_progress" },
    ];
    const { prepressActiveLineItems, downstreamActiveLineItems } = classifyJobs(jobs);
    expect(prepressActiveLineItems.has("li-8")).toBe(false);
    expect(downstreamActiveLineItems.has("li-8")).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
// 6. Downstream mode prepress detection (ensureProductionJobForLineItem)
//    Same isPrepress check used in the downstream idempotency guard.
// ──────────────────────────────────────────────────────────────────

function activeJobAtPrepress(job: { stationKey: string; stepKey: string } | null): boolean {
  if (!job) return false;
  return job.stationKey.toLowerCase() === "prepress" || job.stepKey.toLowerCase() === "prepress";
}

describe("downstream mode activeJobAtPrepress detection", () => {
  test("flatbed/prepress job detected as prepress", () => {
    expect(activeJobAtPrepress({ stationKey: "flatbed", stepKey: "prepress" })).toBe(true);
  });

  test("standalone prepress station detected as prepress", () => {
    expect(activeJobAtPrepress({ stationKey: "prepress", stepKey: "queued" })).toBe(true);
  });

  test("flatbed/print job NOT detected as prepress (is downstream)", () => {
    expect(activeJobAtPrepress({ stationKey: "flatbed", stepKey: "print" })).toBe(false);
  });

  test("roll/queued job NOT detected as prepress", () => {
    expect(activeJobAtPrepress({ stationKey: "roll", stepKey: "queued" })).toBe(false);
  });

  test("null job returns false", () => {
    expect(activeJobAtPrepress(null)).toBe(false);
  });
});

describe("isPrepressOwnershipJob", () => {
  test("returns true for standalone prepress station", () => {
    expect(isPrepressOwnershipJob({ stationKey: "prepress", stepKey: "queued" })).toBe(true);
  });

  test("returns true for prepress step on another station", () => {
    expect(isPrepressOwnershipJob({ stationKey: "flatbed", stepKey: "prepress" })).toBe(true);
  });

  test("returns false for downstream jobs", () => {
    expect(isPrepressOwnershipJob({ stationKey: "roll", stepKey: "queued" })).toBe(false);
  });
});

function shouldShowOnDownstreamBoard(
  row: { lineItemId: string | null },
  hasActivePrepressJobSet: Set<string>
): boolean {
  if (!row.lineItemId) return true; // unlinked job – allow
  if (hasActivePrepressJobSet.has(row.lineItemId)) return false; // gated
  return true;
}

describe("Prepress gate for flatbed/roll boards", () => {
  test("hides item with active prepress-step job from flatbed board", () => {
    const gateSet = new Set(["li-A"]);
    expect(shouldShowOnDownstreamBoard({ lineItemId: "li-A" }, gateSet)).toBe(false);
  });

  test("shows item with no active prepress job on flatbed board", () => {
    const gateSet = new Set<string>();
    expect(shouldShowOnDownstreamBoard({ lineItemId: "li-B" }, gateSet)).toBe(true);
  });

  test("shows unlinked job (null lineItemId) regardless", () => {
    const gateSet = new Set(["anything"]);
    expect(shouldShowOnDownstreamBoard({ lineItemId: null }, gateSet)).toBe(true);
  });
});
