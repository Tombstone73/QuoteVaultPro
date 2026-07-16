import { describe, expect, test } from "@jest/globals";
import { resolveProductionArtworkSides, resolveProductionPreviewUrl, resolveProductionSides } from "../productionHydration";

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
});
