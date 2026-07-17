import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

import { ProductionFilePreviewPanel } from "./ProductionFilePreviewPanel";
import type { ProductionFileSummary } from "@/hooks/useProduction";
import { apiFetch } from "@/lib/queryClient";

jest.mock("@/lib/apiConfig", () => ({
  resolveObjectsPublicUrl: (value: string) => value,
}));
jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

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
  test("renders the final production thumbnail without naked protected file links", () => {
    const html = renderToStaticMarkup(<ProductionFilePreviewPanel files={[finalFile()]} onPreview={() => undefined} />);

    expect(html).toContain("Production file / sheet layout");
    expect(html).toContain("20000-coroplast-imposed-page-1.png");
    expect(html).not.toContain("href=\"/api/prepress/files/final-1/download");
    expect(html).toContain("Open");
    expect(html).toContain("Download");
    expect(html).not.toContain("Proof");
  });

  test("shows processing state while a final-file derivative is pending", () => {
    const html = renderToStaticMarkup(
      <ProductionFilePreviewPanel
        files={[finalFile({ thumbnailUrl: null, previewUrl: null, previewAvailabilityStatus: "pending" })]}
        onPreview={() => undefined}
      />,
    );

    expect(html).toContain("Production file preview processing");
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

  test("requests an authenticated preview repair for an existing final file without derivatives", async () => {
    const ReactClient = require("react-dom/client") as typeof import("react-dom/client");
    const { act } = require("react") as typeof import("react");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = ReactClient.createRoot(container);
    mockedApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          previewStatus: "ready",
          thumbnailUrl: "/objects/generated-thumb.jpg",
          previewUrl: "/objects/generated-preview.jpg",
        },
      }),
    } as Response);

    await act(async () => {
      root.render(
        <ProductionFilePreviewPanel
          files={[finalFile({ thumbnailUrl: null, previewUrl: null })]}
          onPreview={() => undefined}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/prepress/files/final-1/ensure-preview", {
      method: "POST",
      credentials: "include",
    });
    expect(container.innerHTML).toContain("generated-thumb.jpg");
    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
});
