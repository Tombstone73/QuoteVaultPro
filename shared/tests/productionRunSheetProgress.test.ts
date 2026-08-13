import {
  buildInitialProductionRunSheetProgressSnapshot,
  distributeProducedPiecesAcrossMembers,
  summarizeProductionRunSheetProgress,
} from "../productionRunSheetProgress";

describe("production run sheet progress", () => {
  test("represents one nested sheet with twenty required impressions", () => {
    const snapshot = buildInitialProductionRunSheetProgressSnapshot({
      files: [{ id: "file-1", fileName: "nested.pdf", productionQuantity: 20, status: "active" }],
    });

    expect(snapshot?.sheets).toHaveLength(1);
    expect(snapshot?.sheets[0]).toEqual(expect.objectContaining({ requiredImpressions: 20, goodImpressions: 0 }));
    expect(summarizeProductionRunSheetProgress(snapshot).requiredImpressions).toBe(20);
  });

  test("represents twenty nested sheets with one required impression each", () => {
    const snapshot = buildInitialProductionRunSheetProgressSnapshot({
      plannedSheetCount: 20,
    });

    expect(snapshot?.sheets).toHaveLength(20);
    expect(summarizeProductionRunSheetProgress(snapshot).requiredImpressions).toBe(20);
  });

  test("represents multiple nested sheets with different required quantities", () => {
    const snapshot = buildInitialProductionRunSheetProgressSnapshot({
      files: [
        { id: "file-1", fileName: "sheet-1.pdf", productionQuantity: 4, status: "active" },
        { id: "file-2", fileName: "sheet-2.pdf", productionQuantity: 1, status: "active" },
        { id: "file-3", fileName: "sheet-3.pdf", productionQuantity: 7, status: "active" },
      ],
    });

    expect(snapshot?.sheets.map((sheet) => sheet.requiredImpressions)).toEqual([4, 1, 7]);
    expect(summarizeProductionRunSheetProgress(snapshot).requiredImpressions).toBe(12);
  });

  test("keeps required layer impressions separate from finished-piece quantity for one multilayer output", () => {
    const snapshot = buildInitialProductionRunSheetProgressSnapshot({
      files: [
        { id: "color", fileName: "color.pdf", productionQuantity: 250, productionGroupId: "window-cling-a", status: "active" },
        { id: "white", fileName: "white.pdf", productionQuantity: 250, productionGroupId: "window-cling-a", status: "active" },
      ],
    });
    const summary = summarizeProductionRunSheetProgress(snapshot);
    expect(summary).toMatchObject({
      requiredImpressions: 500,
      requiredFinishedPieces: 250,
      outputGroupCount: 1,
      layeredOutputGroupCount: 1,
      complete: false,
    });
  });

  test("does not complete a multilayer output while one required layer is unfinished", () => {
    const snapshot = buildInitialProductionRunSheetProgressSnapshot({
      files: [
        { id: "color", fileName: "color.pdf", productionQuantity: 250, productionGroupId: "window-cling-a", status: "active" },
        { id: "white", fileName: "white.pdf", productionQuantity: 250, productionGroupId: "window-cling-a", status: "active" },
      ],
    });
    if (!snapshot) throw new Error("expected sheet snapshot");
    snapshot.sheets[0].goodImpressions = 250;
    const summary = summarizeProductionRunSheetProgress(snapshot);
    expect(summary).toMatchObject({ goodFinishedPieces: 0, remainingFinishedPieces: 250, complete: false });
  });

  test("damaged impressions do not satisfy child allocated quantity", () => {
    const rollup = distributeProducedPiecesAcrossMembers({
      memberAllocatedQuantities: [
        { memberId: "member-a", allocatedQuantity: 10 },
        { memberId: "member-b", allocatedQuantity: 5 },
      ],
      usablePieces: 12,
    });

    expect(rollup).toEqual([
      { memberId: "member-a", successfulQuantity: 10, remainingQuantity: 0 },
      { memberId: "member-b", successfulQuantity: 2, remainingQuantity: 3 },
    ]);
  });
});
