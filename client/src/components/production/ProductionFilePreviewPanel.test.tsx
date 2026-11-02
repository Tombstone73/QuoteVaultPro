import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

import { ProductionFilePreviewPanel, ProductionFilePreviewImage } from "./ProductionFilePreviewPanel";
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
  URL.createObjectURL = jest.fn(() => "blob:production-artwork");
  URL.revokeObjectURL = jest.fn();
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
    expect(html).not.toContain('src="/api/artwork/');
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
    let statusCalls = 0;
    mockedApiFetch.mockImplementation(async (url) => {
      if (String(url).includes('/api/artwork/')) return { ok: true, blob: async () => new Blob(['private image'], { type: 'image/png' }) } as Response;
      statusCalls += 1;
      return statusCalls === 1 ? {
        ok: true,
        json: async () => ({
          success: true,
          data: { thumbnailStatus: "processing", thumbnailUrl: null },
        }),
      } as Response : {
        ok: true,
        json: async () => ({
          success: true,
          data: { thumbnailStatus: "ready", thumbnailUrl: "/objects/generated-thumb.jpg" },
        }),
      } as Response;
    });

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

    expect(statusCalls).toBe(1);
    expect(queryClient.getQueryData(["/api/prepress/files", "final-1", "thumbnail", "production"]))
      .toEqual({ thumbnailUrl: null, status: "processing", processingStartedAt: null });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1550));
    });

    expect(mockedApiFetch).toHaveBeenCalledWith("/api/prepress/files/final-1/thumbnail", {
      credentials: "include",
    });
    expect(statusCalls).toBe(2);
    expect(container.querySelector('img')?.src).toBe('blob:production-artwork');
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/artwork/file-records/record-1/content?variant=thumbnail', expect.objectContaining({ credentials: 'include' }));
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
    mockedApiFetch.mockImplementation(async (url) => String(url).includes('/api/artwork/') ? { ok: false } as Response : {
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

  test('the enlarged viewer fetches the selected canonical preview as a blob and revokes it on replacement', async () => {
    const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
    const { act } = require('react') as typeof import('react');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockedApiFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['preview'], { type: 'image/png' }) } as Response);
    const host = document.createElement('div'); const root = createRoot(host);
    const renderImage = (src: string) => <img data-testid="zoom-viewer" src={src} alt="Selected final" />;
    await act(async () => root.render(<ProductionFilePreviewImage file={finalFile()} variant="preview" fallback={<span>Missing</span>} renderImage={renderImage} />));
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/artwork/file-records/record-1/content?variant=preview', expect.objectContaining({ credentials: 'include' }));
    expect(host.querySelector('img')?.src).toBe('blob:production-artwork');
    await act(async () => root.render(<ProductionFilePreviewImage file={finalFile({ fileRecordId: 'record-2' })} variant="preview" fallback={<span>Missing</span>} renderImage={renderImage} />));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:production-artwork');
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/artwork/file-records/record-2/content?variant=preview', expect.any(Object));
    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
});
