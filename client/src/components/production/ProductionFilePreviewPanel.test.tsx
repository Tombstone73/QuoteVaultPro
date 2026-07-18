import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

import { ProductionFilePreviewPanel } from "./ProductionFilePreviewPanel";
import type { ProductionFileSummary } from "@/hooks/useProduction";
import { apiFetch } from "@/lib/queryClient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("@/lib/apiConfig", () => ({
  resolveObjectsPublicUrl: (value: string) => value,
}));
jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

beforeEach(() => {
  mockedApiFetch.mockReset();
});

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
  downloadUrl: "/api/production/jobs/job-1/files/final-1/download",
  openUrl: "/api/production/jobs/job-1/files/final-1/download?inline=1",
  createdAt: "2026-07-17T12:00:00.000Z",
  ...overrides,
});

function renderPanel(files: ProductionFileSummary[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProductionFilePreviewPanel files={files} onPreview={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("ProductionFilePreviewPanel", () => {
  test("renders the final production thumbnail without naked protected file links", () => {
    const html = renderPanel([finalFile()]);

    expect(html).toContain("Production file / sheet layout");
    expect(html).toContain("20000-coroplast-imposed-page-1.png");
    expect(html).not.toContain("href=\"/api/production/jobs/job-1/files/final-1/download");
    expect(html).toContain("Open");
    expect(html).toContain("Download");
    expect(html).not.toContain("Proof");
  });

  test("shows processing state while a final-file derivative is pending", () => {
    const html = renderPanel([finalFile({ thumbnailUrl: null, previewUrl: null, previewAvailabilityStatus: "pending" })]);

    expect(html).toContain("Production file preview processing");
  });

  test("shows a clear placeholder while retaining open and download actions", () => {
    const html = renderPanel([finalFile({ thumbnailUrl: null, previewUrl: null })]);

    expect(html).toContain("Production file preview unavailable");
    expect(html).toContain("The final file is available to open or download.");
    expect(html).toContain("Open");
    expect(html).toContain("Download");
  });

  test("does not break jobs without a production file", () => {
    const html = renderPanel([]);
    expect(html).toContain("No final production file");
  });

  test("polls authenticated thumbnail status until an existing final file is ready", async () => {
    const ReactClient = require("react-dom/client") as typeof import("react-dom/client");
    const { act } = require("react") as typeof import("react");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = ReactClient.createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockedApiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { thumbnailStatus: "processing", thumbnailUrl: null },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { thumbnailStatus: "ready", thumbnailUrl: "/objects/generated-thumb.jpg" },
        }),
      } as Response);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProductionFilePreviewPanel
            files={[finalFile({ thumbnailUrl: null, previewUrl: null })]}
            onPreview={() => undefined}
          />
        </QueryClientProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["/api/prepress/files", "final-1", "thumbnail", "production"]))
      .toEqual({ thumbnailUrl: null, status: "processing", processingStartedAt: null });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1550));
    });

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/prepress/files/final-1/thumbnail", {
      credentials: "include",
    });
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain("generated-thumb.jpg");
    await act(async () => root.unmount());
    queryClient.clear();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  test("shows a non-blocking timeout message and keeps file actions available", async () => {
    const ReactClient = require("react-dom/client") as typeof import("react-dom/client");
    const { act } = require("react") as typeof import("react");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = ReactClient.createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockedApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          thumbnailStatus: "processing",
          thumbnailUrl: null,
          processingStartedAt: "2020-01-01T00:00:00.000Z",
        },
      }),
    } as Response);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProductionFilePreviewPanel
            files={[finalFile({ thumbnailUrl: null, previewUrl: null })]}
            onPreview={() => undefined}
          />
        </QueryClientProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(queryClient.getQueryData(["/api/prepress/files", "final-1", "thumbnail", "production"]))
      .toEqual({
        thumbnailUrl: null,
        status: "processing",
        processingStartedAt: "2020-01-01T00:00:00.000Z",
      });
    expect(container.innerHTML).toContain("Preview still processing");
    expect(container.innerHTML).toContain("Open");
    expect(container.innerHTML).toContain("Download");
    await act(async () => root.unmount());
    queryClient.clear();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
});
