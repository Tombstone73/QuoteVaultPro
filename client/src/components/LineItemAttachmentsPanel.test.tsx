import React from "react";
import { act, useState } from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextDecoder, TextEncoder } from "util";
import { createRoot } from "react-dom/client";
import { LineItemAttachmentsPanel } from "./LineItemAttachmentsPanel";

jest.mock("@/lib/apiConfig", () => ({
  objectsUrl: (value: string) => value,
  resolveObjectsPublicUrl: (value: string) => value,
}));

jest.mock("@/lib/getThumbSrc", () => ({ getThumbSrc: () => null }));

jest.mock("@/components/AttachmentViewerDialog", () => ({
  AttachmentViewerDialog: () => null,
}));

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

function renderPanel(doubleSided: boolean, useSameArtworkBothSides?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["/api/orders/order-1/line-items/line-1/files"], [
    {
      id: "art-front",
      source: "attachment",
      fileName: "front.pdf",
      fileUrl: "/objects/front.pdf",
      mimeType: "application/pdf",
      createdAt: "2026-07-16T00:00:00.000Z",
      side: "front",
    },
  ]);

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LineItemAttachmentsPanel
        quoteId={null}
        parentType="order"
        orderId="order-1"
        lineItemId="line-1"
        defaultExpanded
        doubleSided={doubleSided}
        useSameArtworkBothSides={useSameArtworkBothSides}
      />
    </QueryClientProvider>,
  );
}

describe("LineItemAttachmentsPanel double-sided artwork controls", () => {
  test("shows explicit Front/Back assignment controls only for double-sided line items", () => {
    const doubleSided = renderPanel(true);
    expect(doubleSided).toContain("Use same artwork on both sides");
    expect(doubleSided).toContain("Front artwork");
    expect(doubleSided).toContain("Back artwork");
    expect(doubleSided).toContain("Back artwork not assigned");

    const singleSided = renderPanel(false);
    expect(singleSided).not.toContain("Use same artwork on both sides");

    const sameArtwork = renderPanel(true, true);
    expect(sameArtwork).toContain('data-testid="order-use-same-artwork-both-sides"');
    expect(sameArtwork).toContain('data-state="checked"');
    expect(sameArtwork).not.toContain("Back artwork not assigned");
  });

  test("removes staged artwork locally and updates the count", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    function Harness() {
      const [pending, setPending] = useState([{
        uploadId: "staged-1",
        fileName: "staged-art.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1200,
        uploadedAt: "2026-07-20T00:00:00.000Z",
      }]);
      return (
        <QueryClientProvider client={client}>
          <LineItemAttachmentsPanel
            quoteId={null}
            parentType="order"
            orderId={null}
            lineItemId="temp-line-1"
            defaultExpanded
            pendingOrderAttachments={pending}
            onTemporaryOrderAttachmentRemove={(uploadId) => (
              setPending((current) => current.filter((file) => file.uploadId !== uploadId))
            )}
          />
        </QueryClientProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    expect(host.querySelector("[data-testid='line-item-artwork-count']")?.textContent).toBe("1");
    const removeButton = host.querySelector("button[aria-label='Remove staged artwork staged-art.pdf']") as HTMLButtonElement;
    await act(async () => removeButton.click());
    expect(host.textContent).not.toContain("staged-art.pdf");
    expect(host.querySelector("[data-testid='line-item-artwork-count']")).toBeNull();

    await act(async () => root.unmount());
    host.remove();
  });

  test("unlinks saved artwork, reports its side assignment, and updates the count", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const filesPath = "/api/orders/order-1/line-items/line-1/files";
    client.setQueryData([filesPath], [{
      id: "saved-1",
      fileRecordId: "record-1",
      source: "attachment",
      fileName: "saved-art.pdf",
      fileUrl: "/objects/saved-art.pdf",
      mimeType: "application/pdf",
      createdAt: "2026-07-20T00:00:00.000Z",
      side: "both",
    }]);
    client.setQueryData(["/api/system/status"], { thumbnailsEnabled: true });
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => ({
      ok: true,
      json: async () => init?.method === "DELETE" ? { success: true } : { data: [], assets: [] },
    })) as unknown as typeof fetch;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    const removed = jest.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => root.render(
        <QueryClientProvider client={client}>
          <LineItemAttachmentsPanel
            quoteId={null}
            parentType="order"
            orderId="order-1"
            lineItemId="line-1"
            defaultExpanded
            onSavedAttachmentRemoved={removed}
          />
        </QueryClientProvider>,
      ));
      expect(host.querySelector("[data-testid='line-item-artwork-count']")?.textContent).toBe("1");
      const removeButton = host.querySelector("button[aria-label='Remove saved artwork saved-art.pdf']") as HTMLButtonElement;
      await act(async () => removeButton.click());

      expect(fetchMock).toHaveBeenCalledWith(`${filesPath}/saved-1`, expect.objectContaining({ method: "DELETE" }));
      expect(removed).toHaveBeenCalledWith({ id: "saved-1", fileRecordId: "record-1", side: "both" });
      expect(host.querySelector("[data-testid='line-item-artwork-count']")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      globalThis.fetch = previousFetch;
    }
  });
});
