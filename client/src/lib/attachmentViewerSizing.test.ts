import { describe, expect, test } from "@jest/globals";
import { resolvePdfViewportScale } from "./attachmentViewerSizing";

describe("attachment viewer PDF sizing", () => {
  test("fit page preserves the source aspect ratio inside the available stage", () => {
    const scale = resolvePdfViewportScale({
      pageWidth: 1200,
      pageHeight: 600,
      stageWidth: 800,
      stageHeight: 500,
      fitMode: "page",
      customScale: 1,
    });

    expect(scale).toBeCloseTo(0.64, 5);
    expect((1200 * scale) / (600 * scale)).toBe(2);
    expect(1200 * scale).toBeLessThanOrEqual(768);
    expect(600 * scale).toBeLessThanOrEqual(468);
  });

  test("fit width uses the available width without stretching page height independently", () => {
    const scale = resolvePdfViewportScale({
      pageWidth: 612,
      pageHeight: 792,
      stageWidth: 644,
      stageHeight: 400,
      fitMode: "width",
      customScale: 1,
    });

    expect(scale).toBe(1);
    expect((612 * scale) / (792 * scale)).toBeCloseTo(612 / 792, 8);
  });

  test("fit page can zoom below forty percent for large-format artwork", () => {
    const scale = resolvePdfViewportScale({
      pageWidth: 4000,
      pageHeight: 1000,
      stageWidth: 800,
      stageHeight: 500,
      fitMode: "page",
      customScale: 1,
    });

    expect(scale).toBeCloseTo(0.192, 5);
    expect(4000 * scale).toBeLessThanOrEqual(768);
    expect(1000 * scale).toBeLessThanOrEqual(468);
  });
});
