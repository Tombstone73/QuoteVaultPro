import { readFileSync } from "node:fs";
import { buildBadgeCounts, type OperationalSummaryBadgeData } from "./navBadgeCounts";

const summary: OperationalSummaryBadgeData = {
  orders: 12, inboundOrders: 3, overview: 9, design: 2, proofing: 4,
  prepress: 5, flatbed: 6, roll: 7, fulfillment: 8,
  invoices: { readyToFinalizeNeverSent: 10, pendingSend: 11, unpaid: 13 },
};

describe("sidebar operational badges", () => {
  test("maps the authoritative response to every existing nav destination", () => {
    expect(buildBadgeCounts(summary)).toEqual({
      orders: 12, "inbound-orders": 3, "production-overview": 9,
      "production-design": 2, "production-proofing": 4,
      "production-prepress": 5, "production-flatbed": 6,
      "production-roll": 7, fulfillment: 8, invoices: 10,
    });
  });

  test("shows an authoritative zero but omits loading, missing, and errored values", () => {
    expect(buildBadgeCounts({ ...summary, orders: 0, flatbed: 0 }, 0)).toMatchObject({ orders: 0, "production-flatbed": 0, approvals: 0 });
    expect(buildBadgeCounts(undefined)).toEqual({});
    expect(buildBadgeCounts(undefined, 0)).toEqual({ approvals: 0 });
    expect(buildBadgeCounts({ ...summary, invoices: { pendingSend: 1, unpaid: 2 } })).not.toHaveProperty("invoices");
  });

  test("sidebar uses the canonical API origin and waits for active organization context", () => {
    const sidebar = readFileSync("client/src/components/layout/TitanSidebarNav.tsx", "utf8");
    expect(sidebar).toContain('apiFetch("/api/operational-summary")');
    expect(sidebar).toContain('queryKey: ["/api/operational-summary", activeOrgId]');
    expect(sidebar).toContain('enabled: showBadges && Boolean(activeOrgId)');
    expect(sidebar).toContain('if (!res.ok) throw new Error(`Operational counts request failed: ${res.status}`)');
    expect(sidebar).toContain('summaryQuery.isError ? undefined : summaryQuery.data');
    expect(sidebar).toContain('badgeCount !== undefined');
    expect(sidebar).toContain('badgeCounts[item.id]');
  });

  test("the server summary retains canonical production station eligibility sources", () => {
    const service = readFileSync("server/services/operationalSummary.ts", "utf8");
    expect(service).toContain('resolvePrepressQueueEligibility(db');
    expect(service).toContain('resolveProductionStationWork(organizationId, stationKey)');
    expect(service).toContain('countDistinctActiveProductionOverviewWork(active, true)');
    expect(service).toContain('listProofingQueue(db');
  });
});
