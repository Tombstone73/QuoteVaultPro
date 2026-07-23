import {
  combinedProofReviewIsReady,
  getCombinedProofJobLabel,
  isCombinedProofLineSelectable,
  isProofingSelectionSelectable,
  selectAllCombinedProofLinesForOrder,
  updateCombinedProofSelection,
} from "@/lib/combinedProofSelection";

describe("combined proof selection", () => {
  test("selects multiple line items from the same order", () => {
    const first = { lineItemId: "line-1", orderId: "order-1" };
    const result = updateCombinedProofSelection({
      selectedIds: [first.lineItemId],
      selectedRows: [first],
      row: { lineItemId: "line-2", orderId: "order-1" },
      checked: true,
    });
    expect(result).toEqual({ selectedIds: ["line-1", "line-2"], error: null });
  });

  test("rejects a cross-order proof package without changing selection", () => {
    const first = { lineItemId: "line-1", orderId: "order-1" };
    const result = updateCombinedProofSelection({
      selectedIds: [first.lineItemId],
      selectedRows: [first],
      row: { lineItemId: "line-2", orderId: "order-2" },
      checked: true,
    });
    expect(result.selectedIds).toEqual(["line-1"]);
    expect(result.error).toMatch(/cannot span multiple orders/i);
  });

  test("requires artwork on every reviewed line", () => {
    expect(combinedProofReviewIsReady({ selectedCount: 2, reviewRows: [{ eligibleCount: 1 }, { eligibleCount: 0 }], loading: false })).toBe(false);
    expect(combinedProofReviewIsReady({ selectedCount: 2, reviewRows: [{ eligibleCount: 1 }, { eligibleCount: 2 }], loading: false })).toBe(true);
  });

  test("select all adds only proofing lines from the anchor job in candidate order", () => {
    const result = selectAllCombinedProofLinesForOrder({
      selectedIds: ["line-2"],
      anchorRow: { lineItemId: "line-2", orderId: "order-20004" },
      candidateRows: [
        { lineItemId: "line-1", orderId: "order-20004" },
        { lineItemId: "line-other", orderId: "order-20005" },
        { lineItemId: "line-2", orderId: "order-20004" },
        { lineItemId: "line-3", orderId: "order-20004" },
      ],
    });

    expect(result).toEqual(["line-2", "line-1", "line-3"]);
    expect(result).not.toContain("line-other");
  });

  test("formats the selected job number for the proofing toolbar", () => {
    expect(getCombinedProofJobLabel([{ lineItemId: "line-1", orderId: "order-id", orderNumber: "20004" }])).toBe("#20004");
  });

  test("excludes sent and approved lines from a new combined package", () => {
    expect(isCombinedProofLineSelectable({ requiresProofApproval: true, currentQueueStatus: "awaiting_send" })).toBe(true);
    expect(isCombinedProofLineSelectable({ requiresProofApproval: true, currentQueueStatus: "awaiting_approval" })).toBe(false);
    expect(isCombinedProofLineSelectable({ requiresProofApproval: true, currentQueueStatus: "approved" })).toBe(false);
  });

  test("keeps sent proof items selectable for a bulk override while excluding completed items", () => {
    expect(isProofingSelectionSelectable({ requiresProofApproval: true, currentQueueStatus: "awaiting_approval" })).toBe(true);
    expect(isProofingSelectionSelectable({ requiresProofApproval: true, currentQueueStatus: "approved" })).toBe(false);
    expect(isProofingSelectionSelectable({ requiresProofApproval: true, currentQueueStatus: "approved_by_override" })).toBe(false);
  });
});
