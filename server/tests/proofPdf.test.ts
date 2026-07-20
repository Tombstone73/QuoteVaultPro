import { describe, expect, test } from "@jest/globals";

import { PDFDocument } from "pdf-lib";
import { buildProofPdfFacts, generateBasicProofPdfBytes, generateCombinedProofPdfBytes } from "../lib/proofPdf";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6v0sAAAAASUVORK5CYII=",
  "base64",
);

describe("generateBasicProofPdfBytes", () => {
  test("marks the rendered proof as ready when preview bytes are embeddable", async () => {
    const result = await generateBasicProofPdfBytes({
      orderNumber: "SO-123",
      lineItemLabel: "Test Line Item",
      displaySizeLabel: "24 x 36 in",
      quantity: 10,
      finishingSummary: ["Trim"],
      printSides: "Single-sided",
      useSameArtworkBothSides: false,
      preflightStatus: "ready",
      generatedAt: new Date("2025-01-01T00:00:00.000Z"),
      artworkPreviews: [{
        label: "Artwork",
        sourceFileName: "artwork.png",
        preview: { bytes: ONE_PIXEL_PNG, mimeType: "image/png", fileName: "artwork.png" },
      }],
    });

    expect(result.renderStatus).toBe("ready");
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(result.bytes).toString("latin1")).not.toContain("Preview unavailable in this runtime");
  });

  test("marks the rendered proof as metadata_only when no preview can be embedded", async () => {
    const result = await generateBasicProofPdfBytes({
      orderNumber: "SO-124",
      lineItemLabel: "Test Line Item",
      displaySizeLabel: "24 x 36 in",
      quantity: 10,
      finishingSummary: ["Trim"],
      printSides: "Single-sided",
      useSameArtworkBothSides: false,
      preflightStatus: "ready",
      generatedAt: new Date("2025-01-01T00:00:00.000Z"),
      artworkPreviews: [{ label: "Artwork", sourceFileName: "artwork.ai", preview: null }],
    });

    expect(result.renderStatus).toBe("metadata_only");
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });
});

describe("generateCombinedProofPdfBytes", () => {
  test("creates one labeled page per selected line item", async () => {
    const base = {
      orderNumber: "SO-200",
      displaySizeLabel: "24 x 36 in",
      quantity: 2,
      finishingSummary: ["Trim"],
      printSides: "Single-sided" as const,
      useSameArtworkBothSides: false,
      preflightStatus: "ready",
      generatedAt: new Date("2025-01-01T00:00:00.000Z"),
      artworkPreviews: [{
        label: "Artwork" as const,
        sourceFileName: "artwork.png",
        preview: { bytes: ONE_PIXEL_PNG, mimeType: "image/png", fileName: "artwork.png" },
      }],
    };
    const result = await generateCombinedProofPdfBytes([
      { ...base, lineItemLabel: "Banner" },
      { ...base, lineItemLabel: "Yard Sign" },
    ]);
    const document = await PDFDocument.load(result.bytes);
    expect(result.renderStatus).toBe("ready");
    expect(document.getPageCount()).toBe(2);
  });

  test("renders mixed single- and double-sided line items with both double-sided previews", async () => {
    const base = {
      orderNumber: "SO-201",
      displaySizeLabel: "24 x 36 in",
      quantity: 2,
      finishingSummary: ["Trim"],
      preflightStatus: "ready",
      generatedAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    const preview = { bytes: ONE_PIXEL_PNG, mimeType: "image/png", fileName: "artwork.png" };
    const result = await generateCombinedProofPdfBytes([
      {
        ...base,
        lineItemLabel: "Banner",
        printSides: "Single-sided",
        useSameArtworkBothSides: false,
        artworkPreviews: [{ label: "Artwork", sourceFileName: "banner.png", preview }],
      },
      {
        ...base,
        lineItemLabel: "Yard Sign",
        printSides: "Double-sided",
        useSameArtworkBothSides: false,
        artworkPreviews: [
          { label: "Front", sourceFileName: "front.png", preview },
          { label: "Back", sourceFileName: "back.png", preview },
        ],
      },
    ]);
    const document = await PDFDocument.load(result.bytes);
    expect(result.renderStatus).toBe("ready");
    expect(document.getPageCount()).toBe(3);
  });
});

describe("proof PDF facts", () => {
  test("identifies print sides and shared Front/Back artwork explicitly", () => {
    const facts = buildProofPdfFacts({
      orderNumber: "SO-300",
      lineItemLabel: "Coroplast",
      displaySizeLabel: "24 x 18 in",
      quantity: 10,
      finishingSummary: [],
      printSides: "Double-sided",
      useSameArtworkBothSides: true,
      preflightStatus: "ready",
      generatedAt: new Date("2025-01-01T00:00:00.000Z"),
      label: "Artwork",
      sourceFileName: "customer-art.pdf",
      preview: null,
    });
    expect(facts).toContainEqual({ label: "Print Sides", value: "Double-sided" });
    expect(facts).toContainEqual({ label: "Artwork Sides", value: "Same artwork used on front and back." });
  });
});
