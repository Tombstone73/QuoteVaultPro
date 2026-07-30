import { buildPrepressSheetPlanDisplay, formatPrepressSheetPlanUnavailableReason } from "./prepressSheetPlan";

describe("prepress sheet plan display", () => {
  test("formats sheet count, layout yield, full and partial sheets", () => {
    const display = buildPrepressSheetPlanDisplay({
      quantity: 52,
      layout: {
        sheetWidthIn: 48,
        sheetHeightIn: 96,
        allowRotation: true,
        sideCount: 1,
        normalPiecesPerSheet: 10,
        rotatedPiecesPerSheet: 8,
        mixedPiecesPerSheet: 10,
        piecesPerSheet: 10,
        fullSheets: 5,
        partialSheetPieces: 2,
        sheetsToPrint: 6,
        totalSheetCount: 6,
        printPasses: 6,
        orientation: "normal",
        mixedLayoutDescription: null,
      },
    });

    expect(display).toMatchObject({
      primary: "6 sheets - 10-up - 52 pieces",
      secondary: "5 full sheets + 1 partial (2 pieces) - Normal orientation - Rotation allowed",
      impressions: "6 sheet impressions / single-sided",
      sheetSize: "48 x 96",
    });
    expect(display?.layoutDetails).toContain("10 normal pieces per sheet");
  });

  test("formats mixed orientation and double-sided impressions", () => {
    const display = buildPrepressSheetPlanDisplay({
      quantity: 7,
      layout: {
        sheetWidthIn: 10,
        sheetHeightIn: 10,
        allowRotation: true,
        sideCount: 2,
        normalPiecesPerSheet: 2,
        rotatedPiecesPerSheet: 2,
        mixedPiecesPerSheet: 3,
        piecesPerSheet: 3,
        fullSheets: 2,
        partialSheetPieces: 1,
        sheetsToPrint: 3,
        totalSheetCount: 3,
        printPasses: 6,
        orientation: "mixed",
        mixedLayoutDescription: "1 normal row(s) x 1; 1 rotated row(s) x 2",
      },
    });

    expect(display?.primary).toBe("3 sheets - 3-up - 7 pieces");
    expect(display?.secondary).toBe("2 full sheets + 1 partial (1 piece) - Mixed orientation - Rotation allowed");
    expect(display?.impressions).toBe("6 sheet impressions / 2 sides");
    expect(display?.layoutDetails).toContain("3 mixed-layout pieces per sheet");
    expect(display?.layoutDetails).toContain("1 normal row(s) x 1; 1 rotated row(s) x 2");
  });

  test("formats rotation-disabled layouts without relying on color", () => {
    const display = buildPrepressSheetPlanDisplay({
      quantity: 50,
      layout: {
        sheetWidthIn: 48,
        sheetHeightIn: 96,
        allowRotation: false,
        sideCount: 1,
        normalPiecesPerSheet: 10,
        rotatedPiecesPerSheet: 8,
        mixedPiecesPerSheet: 10,
        piecesPerSheet: 10,
        fullSheets: 5,
        partialSheetPieces: 0,
        sheetsToPrint: 5,
        totalSheetCount: 5,
        printPasses: 5,
        orientation: "normal",
        mixedLayoutDescription: null,
      },
    });

    expect(display?.secondary).toBe("5 full sheets + no partial - Normal orientation - Rotation disabled");
  });

  test("returns null when the backend did not provide a usable sheet layout", () => {
    expect(buildPrepressSheetPlanDisplay({ layout: null, quantity: 50 })).toBeNull();
    expect(buildPrepressSheetPlanDisplay({
      quantity: 50,
      layout: { sheetWidthIn: 48, sheetHeightIn: 96, piecesPerSheet: null, sheetsToPrint: 5, printPasses: 5 },
    })).toBeNull();
  });

  test("explains known unavailable reasons and suppresses non-sheet jobs", () => {
    expect(formatPrepressSheetPlanUnavailableReason("missing_dimensions")).toBe("Missing finished size or quantity.");
    expect(formatPrepressSheetPlanUnavailableReason("missing_sheet_configuration")).toBe("Missing sheet size configuration.");
    expect(formatPrepressSheetPlanUnavailableReason("layout_error")).toBe("The finished size does not fit the configured sheet.");
    expect(formatPrepressSheetPlanUnavailableReason("not_sheet_job")).toBeNull();
  });
});
