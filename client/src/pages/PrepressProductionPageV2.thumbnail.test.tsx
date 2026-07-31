import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextDecoder, TextEncoder } from "util";

import { PrepressFileThumbnail } from "@/components/prepress/PrepressFileThumbnail";

jest.mock("@/lib/apiConfig", () => ({
  resolveObjectsPublicUrl: (value: string) => value,
}));

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

afterEach(() => {
  jest.restoreAllMocks();
});

function renderThumbnail(props: React.ComponentProps<typeof PrepressFileThumbnail>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PrepressFileThumbnail {...props} />
    </QueryClientProvider>,
  );
}

describe("Prepress final production thumbnail", () => {
  test("renders the generated final PDF thumbnail", () => {
    const html = renderThumbnail({
      fileId: "file_1",
      filename: "imposed-sheet.pdf",
      mimeType: "application/pdf",
      thumbnailUrl: "/objects/generated-thumb.jpg",
      thumbnailAvailabilityStatus: "available",
    });

    expect(html).toContain("generated-thumb.jpg");
    expect(html).toContain("<img");
  });

  test("shows preview processing for a pending PDF derivative", () => {
    const html = renderThumbnail({
      fileId: "file_1",
      filename: "imposed-sheet.pdf",
      mimeType: "application/pdf",
      thumbnailAvailabilityStatus: "pending",
    });

    expect(html).toContain("Preview processing");
    expect(html).not.toContain("<img");
  });

  test("shows the PDF placeholder after preview failure", () => {
    const html = renderThumbnail({
      fileId: "file_1",
      filename: "imposed-sheet.pdf",
      mimeType: "application/pdf",
      thumbnailAvailabilityStatus: "failed",
    });

    expect(html).toContain("PDF");
    expect(html).not.toContain("<img");
  });

  test("retries the tenant-scoped thumbnail endpoint after a supplied thumbnail fails", async () => {
    const ReactClient = require("react-dom/client") as typeof import("react-dom/client");
    const { act } = require("react") as typeof import("react");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = jest.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { thumbnailStatus: "ready", thumbnailUrl: "/objects/canonical-thumb.jpg" } }),
    } as Response);
    (globalThis as any).fetch = fetchMock;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    const root = ReactClient.createRoot(container);

    await act(async () => {
      root.render(<QueryClientProvider client={client}><PrepressFileThumbnail fileId="file_retry" filename="final.pdf" mimeType="application/pdf" thumbnailUrl="/objects/expired-thumb.jpg" /></QueryClientProvider>);
    });
    await act(async () => {
      container.querySelector("img")?.dispatchEvent(new Event("error", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/prepress/files/file_retry/thumbnail", { credentials: "include" });
    expect(container.innerHTML).toContain("canonical-thumb.jpg");
    await act(async () => root.unmount());
    client.clear();
    delete (globalThis as any).fetch;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  test("polls a processing repair until the final PDF thumbnail is ready", async () => {
    const ReactClient = require("react-dom/client") as typeof import("react-dom/client");
    const { act } = require("react") as typeof import("react");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = jest.fn<() => Promise<Response>>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { thumbnailStatus: "processing", thumbnailUrl: null } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { thumbnailStatus: "ready", thumbnailUrl: "/objects/repaired-thumb.jpg" } }),
      } as Response);
    (globalThis as any).fetch = fetchMock;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    const root = ReactClient.createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <PrepressFileThumbnail
            fileId="file_poll"
            filename="existing-final.pdf"
            mimeType="application/pdf"
            thumbnailAvailabilityStatus="missing"
          />
        </QueryClientProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(client.getQueryData(["/api/prepress/files", "file_poll", "thumbnail"]))
      .toEqual({ url: null, status: "processing", processingStartedAt: null });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1550));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain("repaired-thumb.jpg");
    await act(async () => root.unmount());
    client.clear();
    delete (globalThis as any).fetch;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
});
