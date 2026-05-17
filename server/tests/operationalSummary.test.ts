/**
 * Unit tests for operational summary badge logic.
 *
 * Tests the badge count mapping, zero-state handling, and invoice breakdown —
 * all pure functions with no DB connections.
 */

import { describe, expect, test } from "@jest/globals";

// ---------------------------------------------------------------------------
// Re-implement the pure mapping function here to keep tests DB-free.
// This mirrors the buildBadgeCounts logic in TitanSidebarNav.tsx.
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
  if (!summary) return { approvals: approvalCount };
  return {
    approvals: approvalCount,
    "inbound-orders": summary.inboundOrders,
    "production-overview": summary.overview,
    "production-design": summary.design,
    "production-proofing": summary.proofing,
    "production-prepress": summary.prepress,
    "production-flatbed": summary.flatbed,
    "production-roll": summary.roll,
    fulfillment: summary.fulfillment,
    invoices: summary.invoices.pendingSend,
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
// Zero-state handling
// ---------------------------------------------------------------------------

describe("buildBadgeCounts — zero state", () => {
  test("all counts are zero when summary is all zeros", () => {
    const counts = buildBadgeCounts(makeZeroSummary(), 0);
    for (const [key, val] of Object.entries(counts)) {
      expect(val).toBe(0);
    }
  });

  test("falls back to approvals-only when summary is undefined", () => {
    const counts = buildBadgeCounts(undefined, 3);
    expect(counts).toEqual({ approvals: 3 });
  });

  test("approvals is zero when approval count is 0 and summary is undefined", () => {
    const counts = buildBadgeCounts(undefined, 0);
    expect(counts.approvals).toBe(0);
    expect(Object.keys(counts)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Operational count mapping
// ---------------------------------------------------------------------------

describe("buildBadgeCounts — mapping", () => {
  test("maps inboundOrders to inbound-orders nav id", () => {
    const s = { ...makeZeroSummary(), inboundOrders: 5 };
    expect(buildBadgeCounts(s, 0)["inbound-orders"]).toBe(5);
  });

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
    const counts = buildBadgeCounts(s, 0);
    // Primary invoice badge uses pendingSend (not unpaid)
    expect(counts.invoices).toBe(8);
  });

  test("approvals count flows through independently", () => {
    const counts = buildBadgeCounts(makeZeroSummary(), 5);
    expect(counts.approvals).toBe(5);
    expect(counts["inbound-orders"]).toBe(0);
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
  test("zero badgeCounts object suppresses all badges when showBadges=false", () => {
    // When showBadges is false, sidebar passes {} to badgeCounts.
    // NavItem only shows badge when badgeCount > 0 and it's defined.
    // An empty object means every lookup returns undefined → no badge shown.
    const badgeCounts: Record<string, number> = {};
    const count = badgeCounts["production-design"];
    expect(count).toBeUndefined();
    expect(count !== undefined && count > 0).toBe(false);
  });

  test("nonzero count is visible when showBadges=true", () => {
    const badgeCounts: Record<string, number> = { "production-design": 4 };
    const count = badgeCounts["production-design"];
    expect(count !== undefined && count > 0).toBe(true);
  });
});
