import { describe, expect, test } from "@jest/globals";

import { generateBasicProofPdfBytes } from "../lib/proofPdf";

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
      preflightStatus: "ready",
      sourceFileName: "artwork.png",
      generatedAt: new Date("2025-01-01T00:00:00.000Z"),
      preview: {
        bytes: ONE_PIXEL_PNG,
        mimeType: "image/png",
        fileName: "artwork.png",
      },
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
      preflightStatus: "ready",
      sourceFileName: "artwork.ai",
      generatedAt: new Date("2025-01-01T00:00:00.000Z"),
      preview: null,
    });

    expect(result.renderStatus).toBe("metadata_only");
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });
});