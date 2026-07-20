import { combinedProofReviewIsReady, updateCombinedProofSelection } from "@/lib/combinedProofSelection";

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
});
