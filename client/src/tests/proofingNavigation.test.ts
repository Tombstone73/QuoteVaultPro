import {
  buildProofingLineItemPath,
  isProofApprovalRoutingBlocked,
  isRequestedProofingLineItemMissing,
  PROOF_APPROVAL_REQUIRED_ROUTING_REASON,
  PROOFING_MISSING_LINE_ITEM_MESSAGE,
  resolveProofingActiveRow,
  shouldOfferProofingNavigation,
} from "../lib/proofingNavigation";

describe("proofingNavigation", () => {
  test("builds proofing URL with line item context", () => {
    expect(buildProofingLineItemPath("line-123")).toBe("/production/proofing?lineItemId=line-123&slice=all");
  });

  test("requested line item focus wins over queue selection", () => {
    const result = resolveProofingActiveRow({
      requestedLineItemId: "line-2",
      selectedLineItemId: "line-1",
      filteredQueueRows: [{ lineItemId: "line-1" }],
      allQueueRows: [{ lineItemId: "line-1" }, { lineItemId: "line-2" }],
    });

    expect(result.activeLineItemId).toBe("line-2");
    expect(result.activeRow?.lineItemId).toBe("line-2");
  });

  test("default proofing behavior stays on selected queue row when no line item query exists", () => {
    const result = resolveProofingActiveRow({
      requestedLineItemId: null,
      selectedLineItemId: "line-1",
      filteredQueueRows: [{ lineItemId: "line-1" }, { lineItemId: "line-2" }],
      allQueueRows: [{ lineItemId: "line-1" }, { lineItemId: "line-2" }],
    });

    expect(result.activeLineItemId).toBe("line-1");
    expect(result.activeRow?.lineItemId).toBe("line-1");
  });

  test("flags safe missing state for invalid proofing deep links", () => {
    expect(isRequestedProofingLineItemMissing({ requestedLineItemId: "missing-line", errorStatus: 404 })).toBe(true);
    expect(PROOFING_MISSING_LINE_ITEM_MESSAGE).toContain("not found in proofing");
  });

  test("offers Open Proofing only for blocked proof-required items", () => {
    expect(
      shouldOfferProofingNavigation({
        lineItemId: "line-123",
        requiresProofApproval: true,
        approvedProofVersionId: null,
      }),
    ).toBe(true);

    expect(
      shouldOfferProofingNavigation({
        lineItemId: "line-123",
        requiresProofApproval: true,
        approvedProofVersionId: "proof-version-1",
      }),
    ).toBe(false);
  });

  test("detects production proof-block routing reason", () => {
    expect(isProofApprovalRoutingBlocked(PROOF_APPROVAL_REQUIRED_ROUTING_REASON)).toBe(true);
    expect(isProofApprovalRoutingBlocked("different_reason")).toBe(false);
  });
});