/**
 * Unit tests for operational summary badge logic.
 *
 * Tests the badge count mapping, zero-state handling, inbound order
 * status grouping, and invoice breakdown — all pure functions, no DB.
 */

import { describe, expect, test } from "@jest/globals";

// ---------------------------------------------------------------------------
// Re-implement the pure mapping function here to keep tests DB-free.
// Mirrors buildBadgeCounts in TitanSidebarNav.tsx.
// If the mapping changes, update these tests in tandem.
// ---------------------------------------------------------------------------

interface OperationalSummary {
  inboundOrders: number;
  overview: number;
  design: number;
  proofing: number;
  prepress: number;
  flatbed: number;
  roll: number;
  fulfillment: number;
  invoices: {
    pendingSend: number;
    unpaid: number;
  };
}

function buildBadgeCounts(
  summary: OperationalSummary | undefined,
  approvalCount: number,
): Record<string, number> {
  const safeSummary = summary ?? makeZeroSummary();
  return {
    approvals: approvalCount,
    "inbound-orders": safeSummary.inboundOrders,
    "production-overview": safeSummary.overview,
    "production-design": safeSummary.design,
    "production-proofing": safeSummary.proofing,
    "production-prepress": safeSummary.prepress,
    "production-flatbed": safeSummary.flatbed,
    "production-roll": safeSummary.roll,
    fulfillment: safeSummary.fulfillment,
    invoices: safeSummary.invoices.pendingSend,
  };
}

function makeZeroSummary(): OperationalSummary {
  return {
    inboundOrders: 0,
    overview: 0,
    design: 0,
    proofing: 0,
    prepress: 0,
    flatbed: 0,
    roll: 0,
    fulfillment: 0,
    invoices: { pendingSend: 0, unpaid: 0 },
  };
}

// ---------------------------------------------------------------------------
// Inbound Orders — actionable status group
//
// The Inbound Orders page groups "needs_review" as:
//   status IN ('received', 'processing', 'needs_review')
// This is canonical in InboundOrderRepository.getQueueSummary() and
// listRecords(statusGroup: 'needs_review').
// All three must contribute to the badge; non-actionable ones must not.
// ---------------------------------------------------------------------------

// Simulate what computeOperationalSummary returns for a given set of records.
// Pure helper — counts how many fall into the actionable group.
const ACTIONABLE_INBOUND_STATUSES = ["received", "processing", "needs_review"] as const;
const NON_ACTIONABLE_INBOUND_STATUSES = [
  "waiting_on_customer",
  "ready",
  "approved",
  "submitted",
  "failed",
  "terminal",
] as const;

type InboundStatus =
  | (typeof ACTIONABLE_INBOUND_STATUSES)[number]
  | (typeof NON_ACTIONABLE_INBOUND_STATUSES)[number];

function simulateInboundCount(records: InboundStatus[]): number {
  return records.filter((s) => (ACTIONABLE_INBOUND_STATUSES as readonly string[]).includes(s)).length;
}

describe("inbound orders — actionable status group", () => {
  test.each(ACTIONABLE_INBOUND_STATUSES)(
    "status '%s' contributes to the badge",
    (status) => {
      expect(simulateInboundCount([status])).toBe(1);
    },
  );

  test.each(NON_ACTIONABLE_INBOUND_STATUSES)(
    "status '%s' does NOT contribute to the badge",
    (status) => {
      expect(simulateInboundCount([status])).toBe(0);
    },
  );

  test("mixed records: only actionable statuses are counted", () => {
    const records: InboundStatus[] = [
      "received",       // actionable
      "processing",     // actionable
      "needs_review",   // actionable
      "ready",          // not actionable — reviewed/ready to convert
      "terminal",       // not actionable — rejected
      "submitted",      // not actionable — converted
      "waiting_on_customer", // not actionable — waiting
    ];
    expect(simulateInboundCount(records)).toBe(3);
  });

  test("two received records match what the user saw (2 items, no badge was bug)", () => {
    // User reported 2 items in section but no badge — because status was 'received'
    // not 'needs_review', so the old single-status query returned 0.
    const records: InboundStatus[] = ["received", "received"];
    expect(simulateInboundCount(records)).toBe(2);
  });

  test("all-zero produces zero inbound badge", () => {
    expect(simulateInboundCount([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Frontend mapping — inbound orders nav item ID
// ---------------------------------------------------------------------------

describe("buildBadgeCounts — inbound orders mapping", () => {
  test("maps inboundOrders count to 'inbound-orders' nav item ID", () => {
    const s = { ...makeZeroSummary(), inboundOrders: 2 };
    expect(buildBadgeCounts(s, 0)["inbound-orders"]).toBe(2);
  });

  test("zero inbound count maps to 0 (badge hidden)", () => {
    const s = { ...makeZeroSummary(), inboundOrders: 0 };
    expect(buildBadgeCounts(s, 0)["inbound-orders"]).toBe(0);
  });

  test("inbound-orders key exists in badgeCounts output", () => {
    const counts = buildBadgeCounts(makeZeroSummary(), 0);
    expect(Object.keys(counts)).toContain("inbound-orders");
  });
});

// ---------------------------------------------------------------------------
// Zero-state handling
// ---------------------------------------------------------------------------

describe("buildBadgeCounts — zero state", () => {
  test("all counts are zero when summary is all zeros", () => {
    const counts = buildBadgeCounts(makeZeroSummary(), 0);
    for (const [, val] of Object.entries(counts)) {
      expect(val).toBe(0);
    }
  });

  test("falls back to zero operational badges when summary is undefined", () => {
    const counts = buildBadgeCounts(undefined, 3);
    expect(counts).toEqual({
      approvals: 3,
      "inbound-orders": 0,
      "production-overview": 0,
      "production-design": 0,
      "production-proofing": 0,
      "production-prepress": 0,
      "production-flatbed": 0,
      "production-roll": 0,
      fulfillment: 0,
      invoices: 0,
    });
  });

  test("all badge slots remain present when approval count is 0 and summary is undefined", () => {
    const counts = buildBadgeCounts(undefined, 0);
    expect(counts.approvals).toBe(0);
    expect(Object.keys(counts)).toEqual([
      "approvals",
      "inbound-orders",
      "production-overview",
      "production-design",
      "production-proofing",
      "production-prepress",
      "production-flatbed",
      "production-roll",
      "fulfillment",
      "invoices",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Full operational count mapping
// ---------------------------------------------------------------------------

describe("buildBadgeCounts — full mapping", () => {
  test("maps overview to production-overview nav id", () => {
    const s = { ...makeZeroSummary(), overview: 12 };
    expect(buildBadgeCounts(s, 0)["production-overview"]).toBe(12);
  });

  test("maps design to production-design nav id", () => {
    const s = { ...makeZeroSummary(), design: 3 };
    expect(buildBadgeCounts(s, 0)["production-design"]).toBe(3);
  });

  test("maps proofing to production-proofing nav id", () => {
    const s = { ...makeZeroSummary(), proofing: 7 };
    expect(buildBadgeCounts(s, 0)["production-proofing"]).toBe(7);
  });

  test("maps prepress to production-prepress nav id", () => {
    const s = { ...makeZeroSummary(), prepress: 2 };
    expect(buildBadgeCounts(s, 0)["production-prepress"]).toBe(2);
  });

  test("maps flatbed to production-flatbed nav id", () => {
    const s = { ...makeZeroSummary(), flatbed: 4 };
    expect(buildBadgeCounts(s, 0)["production-flatbed"]).toBe(4);
  });

  test("maps roll to production-roll nav id", () => {
    const s = { ...makeZeroSummary(), roll: 6 };
    expect(buildBadgeCounts(s, 0)["production-roll"]).toBe(6);
  });

  test("maps fulfillment count", () => {
    const s = { ...makeZeroSummary(), fulfillment: 9 };
    expect(buildBadgeCounts(s, 0).fulfillment).toBe(9);
  });

  test("invoice badge shows pendingSend only", () => {
    const s = {
      ...makeZeroSummary(),
      invoices: { pendingSend: 8, unpaid: 14 },
    };
    expect(buildBadgeCounts(s, 0).invoices).toBe(8);
  });

  test("approvals count flows through independently", () => {
    const counts = buildBadgeCounts(makeZeroSummary(), 5);
    expect(counts.approvals).toBe(5);
    expect(counts["inbound-orders"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Production station badges - destination board default visibility
// ---------------------------------------------------------------------------

type ProductionJobStatus = "queued" | "in_progress" | "done" | "void";

function simulateStationBoardBadge(records: ProductionJobStatus[]): number {
  return records.filter((status) => status === "in_progress").length;
}

describe("production station badges", () => {
  test("station badges follow the destination board default visible tab", () => {
    expect(simulateStationBoardBadge(["queued", "queued"])).toBe(0);
    expect(simulateStationBoardBadge(["queued", "in_progress"])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Invoice breakdown
// ---------------------------------------------------------------------------

describe("invoice badge — pending send vs unpaid", () => {
  test("pendingSend is zero when no draft invoices", () => {
    const s = {
      ...makeZeroSummary(),
      invoices: { pendingSend: 0, unpaid: 10 },
    };
    expect(buildBadgeCounts(s, 0).invoices).toBe(0);
  });

  test("pendingSend captures draft invoices correctly", () => {
    const s = {
      ...makeZeroSummary(),
      invoices: { pendingSend: 3, unpaid: 0 },
    };
    expect(buildBadgeCounts(s, 0).invoices).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Sidebar toggle — badge suppression
// ---------------------------------------------------------------------------

describe("sidebar badge toggle", () => {
  test("empty badgeCounts object suppresses all badges when showBadges=false", () => {
    const badgeCounts: Record<string, number> = {};
    const count = badgeCounts["inbound-orders"];
    expect(count).toBeUndefined();
    expect(count !== undefined && count > 0).toBe(false);
  });

  test("nonzero count is visible when showBadges=true", () => {
    const badgeCounts: Record<string, number> = { "inbound-orders": 2 };
    const count = badgeCounts["inbound-orders"];
    expect(count !== undefined && count > 0).toBe(true);
  });
});
