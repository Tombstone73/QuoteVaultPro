import { buildCombinedRunSheetPlanRecommendation } from "./combinedRunSheetPlan";

describe("combined run sheet plan", () => {
  const layout = {
    sheetWidthIn: 48,
    sheetHeightIn: 96,
    sideCount: 1,
    piecesPerSheet: 8,
    orientation: "normal",
  };

  test("uses canonical layout yield for same-size selected designs", () => {
    const result = buildCombinedRunSheetPlanRecommendation([
      { lineItemId: "line-a", quantity: 9, width: 12, height: 18, productionLayout: layout },
      { lineItemId: "line-b", quantity: 7, width: 12, height: 18, productionLayout: layout },
    ]);

    expect(result).toMatchObject({
      canAutoPlan: true,
      totalQuantity: 16,
      plannedSheetCount: 2,
      nominalPiecesPerSheet: 8,
      sheetWidth: 48,
      sheetHeight: 96,
      printPasses: 2,
      fullSheets: 2,
      partialSheetPieces: 0,
    });
    expect(result.memberQuantities).toEqual([
      { lineItemId: "line-a", quantity: 9 },
      { lineItemId: "line-b", quantity: 7 },
    ]);
  });

  test("blocks automatic planning for mixed finished sizes", () => {
    const result = buildCombinedRunSheetPlanRecommendation([
      { lineItemId: "line-a", quantity: 4, width: 12, height: 18, productionLayout: layout },
      { lineItemId: "line-b", quantity: 4, width: 18, height: 24, productionLayout: layout },
    ]);

    expect(result.canAutoPlan).toBe(false);
    expect(result.reason).toContain("Mixed finished sizes");
  });

  test("reports missing canonical layout", () => {
    const result = buildCombinedRunSheetPlanRecommendation([
      { lineItemId: "line-a", quantity: 4, width: 12, height: 18, productionLayout: null },
    ]);

    expect(result.canAutoPlan).toBe(false);
    expect(result.reason).toContain("sheet-layout");
  });
});
