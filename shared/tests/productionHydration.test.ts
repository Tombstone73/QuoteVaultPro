import {
  calculateSheetProductionLayout,
  resolveProductionPreviewUrl,
  resolveProductionSides,
  resolveSheetConfiguration,
} from "../productionHydration";

describe("production hydration", () => {
  it("hydrates a double-sided print option from ordered line-item selections", () => {
    expect(resolveProductionSides({ selectedOptions: [{ optionName: "Print Sides", value: "Double-Sided" }] }))
      .toBe("Double-sided");
  });

  it("calculates 24x18 quantity 50 on a 48x96 flat sheet as 10-up, 5 sheets, and 10 passes", () => {
    expect(calculateSheetProductionLayout({
      stationKey: "flatbed",
      materialType: "sheet",
      widthIn: 24,
      heightIn: 18,
      quantity: 50,
      sheetWidthIn: 48,
      sheetHeightIn: 96,
      sides: "Double-sided",
    })).toEqual({
      sheetWidthIn: 48,
      sheetHeightIn: 96,
      piecesPerSheet: 10,
      sheetsToPrint: 5,
      printPasses: 10,
      orientation: "normal",
    });
  });

  it("does not fabricate flat-sheet work for roll jobs or missing sheet configuration", () => {
    expect(calculateSheetProductionLayout({ stationKey: "roll", widthIn: 24, heightIn: 18, quantity: 50, sheetWidthIn: 48, sheetHeightIn: 96 }))
      .toBeNull();
    expect(calculateSheetProductionLayout({ stationKey: "flatbed", widthIn: 24, heightIn: 18, quantity: 50 }))
      .toBeNull();
  });

  it("uses ordered PBV2 sheet configuration before current product configuration", () => {
    expect(resolveSheetConfiguration({
      pbv2SnapshotJson: { treeJson: { meta: { pricingProfileConfig: { sheetWidth: 48, sheetHeight: 96, materialType: "sheet" } } } },
      pricingProfileConfig: { sheetWidth: 60, sheetHeight: 120, materialType: "sheet" },
    })).toEqual({ sheetWidthIn: 48, sheetHeightIn: 96, materialType: "sheet", allowRotation: false });
  });

  it("uses generated artwork thumbnail keys before falling back to image originals", () => {
    expect(resolveProductionPreviewUrl({ thumbKey: "org/thumbs/front.png", fileUrl: "https://example.test/front.pdf" }))
      .toBe("/objects/org/thumbs/front.png");
    expect(resolveProductionPreviewUrl({ fileName: "front.png", fileUrl: "https://example.test/front.png" }))
      .toBe("https://example.test/front.png");
  });
});
