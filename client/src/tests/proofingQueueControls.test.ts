import {
  getInitialProofingFilter,
  getProofingFilterCount,
  matchesProofingFilter,
  matchesProofingSearch,
  sortProofingQueueRows,
} from "../lib/proofingQueueControls";

const rows = [
  {
    lineItemId: "line-1",
    orderId: "order-1",
    orderNumber: "1002",
    customerDisplayName: "Zeta Signs",
    lineItemLabel: "Window Perf",
    packageLabel: "Perf Package",
    workflowState: "awaiting_proof_approval",
    currentQueueStatus: "awaiting_send",
    currentQueueBadge: "Draft",
    currentDisplayedProofVersionId: null,
    currentDisplayedProofVersionLabel: null,
    currentDisplayedProofVersionStatus: null,
    approvedProofVersionId: null,
    approvedProofSource: null,
    approvedNormally: false,
    approvedByOverride: false,
    lastDecision: null,
    lastActivityAt: "2026-05-05T12:00:00.000Z",
    blockedPendingProofApproval: true,
    hasApprovedProof: false,
    requiresProofApproval: true,
    requiresPrepress: false,
    proofCount: 0,
  },
  {
    lineItemId: "line-2",
    orderId: "order-2",
    orderNumber: "1001",
    customerDisplayName: "Alpha Print",
    lineItemLabel: "Yard Sign",
    packageLabel: "Campaign Signs",
    workflowState: "awaiting_proof_approval",
    currentQueueStatus: "awaiting_approval",
    currentQueueBadge: "Sent",
    currentDisplayedProofVersionId: "proof-2",
    currentDisplayedProofVersionLabel: "Proof v2",
    currentDisplayedProofVersionStatus: "awaiting_response",
    approvedProofVersionId: null,
    approvedProofSource: null,
    approvedNormally: false,
    approvedByOverride: false,
    lastDecision: null,
    lastActivityAt: "2026-05-04T12:00:00.000Z",
    blockedPendingProofApproval: true,
    hasApprovedProof: false,
    requiresProofApproval: true,
    requiresPrepress: false,
    proofCount: 2,
  },
  {
    lineItemId: "line-3",
    orderId: "order-3",
    orderNumber: "1003",
    customerDisplayName: "Bravo Banners",
    lineItemLabel: "Step and Repeat",
    packageLabel: "Event Banner",
    workflowState: "ready_for_production",
    currentQueueStatus: "approved",
    currentQueueBadge: "Approved",
    currentDisplayedProofVersionId: "proof-3",
    currentDisplayedProofVersionLabel: "Proof v1",
    currentDisplayedProofVersionStatus: "approved",
    approvedProofVersionId: "proof-3",
    approvedProofSource: "normal",
    approvedNormally: true,
    approvedByOverride: false,
    lastDecision: "approved",
    lastActivityAt: "2026-05-03T12:00:00.000Z",
    blockedPendingProofApproval: false,
    hasApprovedProof: true,
    requiresProofApproval: true,
    requiresPrepress: false,
    proofCount: 1,
  },
  {
    lineItemId: "line-4",
    orderId: "order-4",
    orderNumber: "1004",
    customerDisplayName: "Delta Displays",
    lineItemLabel: "Trade Show Backdrop",
    packageLabel: "Backdrop",
    workflowState: "awaiting_proof_approval",
    currentQueueStatus: "rejected",
    currentQueueBadge: "Rejected",
    currentDisplayedProofVersionId: "proof-4",
    currentDisplayedProofVersionLabel: "Proof v3",
    currentDisplayedProofVersionStatus: "rejected",
    approvedProofVersionId: null,
    approvedProofSource: null,
    approvedNormally: false,
    approvedByOverride: false,
    lastDecision: "rejected",
    lastActivityAt: "2026-05-02T12:00:00.000Z",
    blockedPendingProofApproval: true,
    hasApprovedProof: false,
    requiresProofApproval: true,
    requiresPrepress: false,
    proofCount: 3,
  },
] as const;

describe("proofingQueueControls", () => {
  test("search matches order number, customer, and line item label case-insensitively", () => {
    expect(matchesProofingSearch(rows[0], "1002")).toBe(true);
    expect(matchesProofingSearch(rows[1], "alpha")).toBe(true);
    expect(matchesProofingSearch(rows[2], "step and repeat")).toBe(true);
    expect(matchesProofingSearch(rows[3], "missing term")).toBe(false);
  });

  test("default filter maps to awaiting proof and preserves legacy slice compatibility", () => {
    expect(getInitialProofingFilter(null)).toBe("awaiting_proof");
    expect(getInitialProofingFilter("awaiting_approval")).toBe("sent");
    expect(getInitialProofingFilter("approved")).toBe("approved");
  });

  test("filter counts and matching logic reflect queue status buckets", () => {
    expect(matchesProofingFilter(rows[0], "awaiting_proof")).toBe(true);
    expect(matchesProofingFilter(rows[1], "sent")).toBe(true);
    expect(matchesProofingFilter(rows[2], "approved")).toBe(true);
    expect(matchesProofingFilter(rows[3], "rejected")).toBe(true);
    expect(getProofingFilterCount(rows as any, "awaiting_proof")).toBe(1);
    expect(getProofingFilterCount(rows as any, "sent")).toBe(1);
  });

  test("sorting supports newest, oldest, and customer name ordering", () => {
    expect(sortProofingQueueRows(rows as any, "newest").map((row) => row.lineItemId)).toEqual([
      "line-1",
      "line-2",
      "line-3",
      "line-4",
    ]);

    expect(sortProofingQueueRows(rows as any, "oldest").map((row) => row.lineItemId)).toEqual([
      "line-4",
      "line-3",
      "line-2",
      "line-1",
    ]);

    expect(sortProofingQueueRows(rows as any, "customer").map((row) => row.lineItemId)).toEqual([
      "line-2",
      "line-3",
      "line-4",
      "line-1",
    ]);
  });
});