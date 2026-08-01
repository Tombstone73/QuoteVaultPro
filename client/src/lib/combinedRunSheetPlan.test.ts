import { buildCombinedRunSheetPlanRecommendation } from "./combinedRunSheetPlan";

describe("combined run sheet plan", () => {
  const layout = {
    sheetWidthIn: 48,
    sheetHeightIn: 96,
    allowRotation: false,
    sideCount: 1,
    piecesPerSheet: 8,
    orientation: "normal",
  };

  test("uses canonical layout yield for same-size selected designs", () => {
    const result = buildCombinedRunSheetPlanRecommendation([
      { lineItemId: "line-a", quantity: 9, width: 24, height: 24, productionLayout: layout },
      { lineItemId: "line-b", quantity: 7, width: 24, height: 24, productionLayout: layout },
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
      { lineItemId: "line-a", quantity: 4, width: 24, height: 24, productionLayout: layout },
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

  test("recalculates when sheet width changes", () => {
    const initial = buildCombinedRunSheetPlanRecommendation([
      { lineItemId: "line-a", quantity: 16, width: 24, height: 24, productionLayout: layout },
    ], { sheetWidth: 48, sheetHeight: 96, allowRotation: false, bleed: 0, spacing: 0, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 });

    const changed = buildCombinedRunSheetPlanRecommendation([
      { lineItemId: "line-a", quantity: 16, width: 24, height: 24, productionLayout: layout },
    ], { sheetWidth: 30, sheetHeight: 96, allowRotation: false, bleed: 0, spacing: 0, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 });

    expect(initial.nominalPiecesPerSheet).toBe(8);
    expect(initial.plannedSheetCount).toBe(2);
    expect(changed.nominalPiecesPerSheet).toBe(4);
    expect(changed.plannedSheetCount).toBe(4);
    expect(changed.inputKey).not.toBe(initial.inputKey);
  });

  test("reports item too large for impossible sheet inputs", () => {
    const result = buildCombinedRunSheetPlanRecommendation([
      { lineItemId: "line-a", quantity: 1, width: 24, height: 24, productionLayout: layout },
    ], { sheetWidth: 20, sheetHeight: 20, allowRotation: false, bleed: 0, spacing: 0, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 });

    expect(result.canAutoPlan).toBe(false);
    expect(result.reasonCode).toBe("item_too_large");
  });

  test("normalizes member ordering, numeric formatting, and omitted zero layout defaults", () => {
    const first = buildCombinedRunSheetPlanRecommendation([
      { lineItemId: "line-b", quantity: "7" as any, width: "24.0" as any, height: 24, productionLayout: layout },
      { lineItemId: "line-a", quantity: 9, width: 24, height: "24" as any, productionLayout: layout },
    ], {
      sheetWidth: "48" as any,
      sheetHeight: 96,
      allowRotation: false,
      bleed: "0" as any,
      spacing: undefined as any,
      marginTop: null as any,
      marginRight: 0,
      marginBottom: "0.0" as any,
      marginLeft: 0,
    });
    const reordered = buildCombinedRunSheetPlanRecommendation([
      { lineItemId: "line-a", quantity: "9.0" as any, width: 24, height: 24, productionLayout: layout },
      { lineItemId: "line-b", quantity: 7, width: 24, height: 24, productionLayout: layout },
    ], {
      sheetWidth: 48,
      sheetHeight: "96.0" as any,
      allowRotation: false,
      bleed: 0,
      spacing: 0,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
    });

    expect(first.inputKey).toBe(reordered.inputKey);
    expect(first.memberQuantities).toEqual([
      { lineItemId: "line-a", quantity: 9 },
      { lineItemId: "line-b", quantity: 7 },
    ]);
  });
});
