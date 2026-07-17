import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

import { ProductionFilePreviewPanel } from "./ProductionFilePreviewPanel";
import type { ProductionFileSummary } from "@/hooks/useProduction";

jest.mock("@/lib/apiConfig", () => ({
  resolveObjectsPublicUrl: (value: string) => value,
}));

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

const finalFile = (overrides: Partial<ProductionFileSummary> = {}): ProductionFileSummary => ({
  id: "final-1",
  lineItemId: "line-1",
  fileRecordId: "record-1",
  fileName: "20000-coroplast-imposed.pdf",
  role: "final",
  tag: "final_print",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  thumbnailUrl: "/objects/20000-coroplast-imposed-page-1.png",
  previewUrl: "/objects/20000-coroplast-imposed-preview.png",
  downloadUrl: "/api/prepress/files/final-1/download",
  openUrl: "/api/prepress/files/final-1/download?inline=1",
  createdAt: "2026-07-17T12:00:00.000Z",
  ...overrides,
});

describe("ProductionFilePreviewPanel", () => {
  test("renders the final production thumbnail separately with correct file links", () => {
    const html = renderToStaticMarkup(<ProductionFilePreviewPanel files={[finalFile()]} onPreview={() => undefined} />);

    expect(html).toContain("Production file / sheet layout");
    expect(html).toContain("20000-coroplast-imposed-page-1.png");
    expect(html).toContain("/api/prepress/files/final-1/download?inline=1");
    expect(html).toContain("/api/prepress/files/final-1/download");
    expect(html).not.toContain("Proof");
  });

  test("shows a clear placeholder while retaining open and download actions", () => {
    const html = renderToStaticMarkup(
      <ProductionFilePreviewPanel
        files={[finalFile({ thumbnailUrl: null, previewUrl: null })]}
        onPreview={() => undefined}
      />,
    );

    expect(html).toContain("Production file preview unavailable");
    expect(html).toContain("The final file is available to open or download.");
    expect(html).toContain("Open");
    expect(html).toContain("Download");
  });

  test("does not break jobs without a production file", () => {
    const html = renderToStaticMarkup(<ProductionFilePreviewPanel files={[]} onPreview={() => undefined} />);
    expect(html).toContain("No final production file");
  });
});
