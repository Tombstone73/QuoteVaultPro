import { describe, expect, test } from "@jest/globals";
import {
  calculateSheetProductionLayout,
  describeProductionPrintPasses,
  resolveProductionArtworkSideReadiness,
  resolveProductionArtworkSides,
  resolveProductionPreviewUrl,
  resolveProductionSides,
} from "../productionHydration";

describe("production print passes", () => {
  test("derives one impression per sheet for single-sided work", () => {
    const layout = calculateSheetProductionLayout({
      stationKey: "flatbed",
      materialType: "sheet",
      widthIn: 24,
      heightIn: 18,
      quantity: 50,
      sheetWidthIn: 48,
      sheetHeightIn: 96,
      allowRotation: true,
      sides: "Single-sided",
    });

    expect(layout).toMatchObject({ sheetsToPrint: 5, printPasses: 5 });
    expect(describeProductionPrintPasses({ ...layout!, sides: "Single-sided" }))
      .toBe("Single-sided job: 5 sheets");
  });

  test("derives front and back impressions for double-sided work", () => {
    const layout = calculateSheetProductionLayout({
      stationKey: "flatbed",
      materialType: "sheet",
      widthIn: 24,
      heightIn: 18,
      quantity: 50,
      sheetWidthIn: 48,
      sheetHeightIn: 96,
      allowRotation: true,
      sides: "Double-sided",
    });

    expect(layout).toMatchObject({ sheetsToPrint: 5, printPasses: 10 });
    expect(describeProductionPrintPasses({ ...layout!, sides: "Double-sided" }))
      .toBe("Double-sided job: 5 sheets \u00d7 2 sides (front + back)");
  });
});

describe("production artwork hydration", () => {
  test("prefers an explicit thumbnail URL over every other preview candidate", () => {
    expect(resolveProductionPreviewUrl({
      thumbnailUrl: "/objects/thumbs/front.jpg",
      thumbKey: "thumbs/fallback.jpg",
      previewUrl: "/objects/previews/front.jpg",
      fileUrl: "/objects/uploads/front.png",
      mimeType: "image/png",
    })).toBe("/objects/thumbs/front.jpg");
  });

  test("converts a thumbnail storage key into an object URL", () => {
    expect(resolveProductionPreviewUrl({ thumbKey: "thumbs/front.jpg" })).toBe("/objects/thumbs/front.jpg");
  });

  test("uses a preview derivative for a PDF when no thumbnail is available", () => {
    expect(resolveProductionPreviewUrl({
      fileName: "front.pdf",
      mimeType: "application/pdf",
      previewUrl: "/objects/previews/front-page-1.jpg",
    })).toBe("/objects/previews/front-page-1.jpg");
  });

  test("uses an original only when it is an image", () => {
    expect(resolveProductionPreviewUrl({
      fileName: "front.png",
      mimeType: "image/png",
      fileUrl: "/objects/uploads/front.png",
    })).toBe("/objects/uploads/front.png");
    expect(resolveProductionPreviewUrl({
      fileName: "front.pdf",
      mimeType: "application/pdf",
      fileUrl: "/objects/uploads/front.pdf",
    })).toBeUndefined();
  });

  test("reads nested PBV2 print-side selections for explicit side hydration", () => {
    expect(resolveProductionSides({
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: { sides: { value: "double" } },
      },
    })).toBe("Double-sided");
  });

  test("current saved Print Sides wins over a stale evaluated option after refetch", () => {
    expect(resolveProductionSides({
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: { printSides: { value: "double", label: "Double-Sided" } },
      },
      selectedOptions: [{ optionId: "printSides", optionName: "Print Sides", value: "single" }],
    })).toBe("Double-sided");
  });

  test("uses the saved tree to resolve opaque Print Sides selection identifiers", () => {
    expect(resolveProductionSides({
      optionSelectionsJson: { schemaVersion: 2, selected: { option_123: { value: "choice_2" } } },
      pbv2SnapshotJson: {
        treeJson: {
          nodes: {
            node_1: {
              id: "node_1",
              label: "Print Sides",
              input: { selectionKey: "option_123" },
              choices: [
                { value: "choice_1", label: "Single-Sided" },
                { value: "choice_2", label: "Double-Sided" },
              ],
            },
          },
        },
      },
    })).toBe("Double-sided");
  });

  test("hydrates explicit front/back assignments and recognizes a shared source file", () => {
    const separate = resolveProductionArtworkSides([
      { id: "front", fileRecordId: "file-front", side: "front" },
      { id: "back", fileRecordId: "file-back", side: "back" },
    ]);
    expect(separate.front?.id).toBe("front");
    expect(separate.back?.id).toBe("back");
    expect(separate.isSameArtwork).toBe(false);

    const same = resolveProductionArtworkSides([
      { id: "front", fileRecordId: "shared-file", side: "front" },
      { id: "back", fileRecordId: "shared-file", side: "back" },
    ]);
    expect(same.front?.id).toBe("front");
    expect(same.back?.id).toBe("back");
    expect(same.isSameArtwork).toBe(true);

    const both = resolveProductionArtworkSides([
      { id: "both", fileRecordId: "shared-file", side: "both" },
    ]);
    expect(both.front?.id).toBe("both");
    expect(both.back?.id).toBe("both");
    expect(both.isSameArtwork).toBe(true);
  });

  test("does not infer a side from an unassigned file", () => {
    const resolved = resolveProductionArtworkSides([{ id: "unassigned", fileRecordId: "file-1", side: "na" }]);
    expect(resolved.front).toBeNull();
    expect(resolved.back).toBeNull();
    expect(resolved.unassigned).toHaveLength(1);
  });

  test("fails closed only for incomplete double-sided artwork assignments", () => {
    expect(resolveProductionArtworkSideReadiness({
      sides: "Double-sided",
      artwork: [{ id: "front", side: "front" }],
      useSameArtworkBothSides: false,
    })).toMatchObject({ complete: false, warning: "Back artwork not assigned." });

    const sameArtwork = resolveProductionArtworkSideReadiness({
      sides: "Double-sided",
      artwork: [{ id: "front", side: "front" }],
      useSameArtworkBothSides: true,
    });
    expect(sameArtwork).toMatchObject({ complete: true, warning: null });
    expect(sameArtwork.front?.id).toBe("front");
    expect(sameArtwork.back?.id).toBe("front");

    expect(resolveProductionArtworkSideReadiness({
      sides: "Double-sided",
      artwork: [{ id: "saved-file", side: "na" }],
      useSameArtworkBothSides: true,
      sameArtworkFileId: "saved-file",
    })).toMatchObject({ complete: true, warning: null });

    const autoShared = resolveProductionArtworkSideReadiness({
      sides: "Double-sided",
      artwork: [{ id: "only-file", side: "na" }],
      useSameArtworkBothSides: true,
    });
    expect(autoShared).toMatchObject({ complete: true, warning: null });
    expect(autoShared.front?.id).toBe("only-file");
    expect(autoShared.back?.id).toBe("only-file");

    expect(resolveProductionArtworkSideReadiness({
      sides: "Double-sided",
      artwork: [{ id: "one", side: "na" }, { id: "two", side: "na" }],
      useSameArtworkBothSides: true,
    })).toMatchObject({
      complete: false,
      warning: "Choose which artwork file should be used on both sides.",
    });

    expect(resolveProductionArtworkSideReadiness({
      sides: "Single-sided",
      artwork: [{ id: "unassigned", side: "na" }],
      useSameArtworkBothSides: false,
    })).toMatchObject({ complete: true, warning: null });
  });
});
