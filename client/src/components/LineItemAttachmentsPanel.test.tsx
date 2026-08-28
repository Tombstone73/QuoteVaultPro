import React from "react";
import { act, useState } from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextDecoder, TextEncoder } from "util";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRoot } from "react-dom/client";
import { LineItemAttachmentsPanel } from "./LineItemAttachmentsPanel";
import { uploadAttachmentViaChunked } from "@/lib/uploads/chunkedAttachmentUpload";
import { downloadAuthenticatedFile } from "@/lib/authenticatedFileDownload";

jest.mock("@/lib/uploads/chunkedAttachmentUpload", () => ({
  uploadAttachmentViaChunked: jest.fn(),
}));

jest.mock("@/lib/authenticatedFileDownload", () => ({
  downloadAuthenticatedFile: jest.fn(),
}));

jest.mock("@/lib/apiConfig", () => ({
  objectsUrl: (value: string) => value,
  resolveObjectsPublicUrl: (value: string) => value,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "staff" } }),
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

function TemporaryArtworkHarness() {
  const [pending, setPending] = useState<any[]>([]);
  const [savedNames, setSavedNames] = useState<string[]>([]);

  return (
    <>
      <div data-testid="artwork-dirty-state">{pending.length > 0 ? "dirty" : "clean"}</div>
      <div data-testid="saved-artwork">{savedNames.join(",")}</div>
      <button type="button" onClick={() => setSavedNames(pending.map((file) => file.fileName))}>Save Item</button>
      <LineItemAttachmentsPanel
        quoteId={null}
        parentType="order"
        orderId={null}
        lineItemId="temp-line-1"
        defaultExpanded
        pendingOrderAttachments={pending}
        onTemporaryOrderUpload={async (files) => {
          setPending((current) => [
            ...current,
            ...files.map((file, index) => ({
              uploadId: `staged-${current.length + index + 1}`,
              fileName: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              uploadedAt: "2026-07-20T00:00:00.000Z",
            })),
          ]);
        }}
        onTemporaryOrderAttachmentRemove={(uploadId) => {
          setPending((current) => current.filter((file) => file.uploadId !== uploadId));
        }}
      />
    </>
  );
}

function setInputFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
}

function createDropEvent(files: File[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: { files, dropEffect: "none" },
  });
  return event;
}

describe("LineItemAttachmentsPanel artwork controls", () => {
  test("existing Order line-item Upload Artwork sends the canonical artwork role", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const filesPath = "/api/orders/order-1/line-items/line-1/files";
    client.setQueryData([filesPath], []);
    client.setQueryData(["/api/system/status"], { thumbnailsEnabled: true });
    const uploadMock = jest.mocked(uploadAttachmentViaChunked);
    uploadMock.mockResolvedValueOnce({} as any);
    const previousFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: [], assets: [] }) })) as unknown as typeof fetch;
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
          />
        </QueryClientProvider>,
      ));
      const input = host.querySelector("input[type='file']") as HTMLInputElement;
      setInputFiles(input, [new File(["art"], "order-art.pdf", { type: "application/pdf" })]);
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();
      });

      expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
        purpose: "order-attachment",
        parentId: "order-1",
        linkUrl: "/api/orders/order-1/files",
        linkBody: { orderLineItemId: "line-1", role: "artwork", side: "na" },
      }));
      expect(uploadMock).not.toHaveBeenCalledWith(expect.objectContaining({
        linkBody: expect.objectContaining({ role: "other" }),
      }));
    } finally {
      await act(async () => root.unmount());
      host.remove();
      globalThis.fetch = previousFetch;
      uploadMock.mockReset();
    }
  });

  test("generic Order Attachments retain non-artwork classification", () => {
    const genericAttachments = readFileSync(path.join(process.cwd(), "client/src/components/AttachmentsPanel.tsx"), "utf8");
    expect(genericAttachments).toContain('? { role: "other", side: "na" }');
    expect(genericAttachments).toContain('attachPayload.role = "other"');
  });

  test("quote artwork upload remains quote-scoped without an Order role override", () => {
    const panel = readFileSync(path.join(process.cwd(), "client/src/components/LineItemAttachmentsPanel.tsx"), "utf8");
    const quoteBranch = panel.slice(panel.indexOf('purpose: "quote-attachment"'), panel.indexOf("successCount++;", panel.indexOf('purpose: "quote-attachment"')));
    expect(quoteBranch).toContain("parentId: targetQuoteId");
    expect(quoteBranch).toContain("linkUrl: uploadApiPath");
    expect(quoteBranch).not.toContain("linkBody");
  });

  test("Order artwork downloads use the authenticated canonical proxy instead of a persisted URL", () => {
    const panel = readFileSync(path.join(process.cwd(), "client/src/components/LineItemAttachmentsPanel.tsx"), "utf8");
    expect(panel).toContain('/api/orders/${orderId}/line-items/${lineItemId}/files/${fileId}/download/proxy');
    expect(panel).toContain("await downloadAuthenticatedFile(proxyUrl, fileName)");
    expect(panel).not.toContain("downloadFileFromUrl(proxyUrl, fileName)");
    expect(panel).not.toContain('This file does not have a downloadable URL.');
  });

  test("one Order artwork download click makes one credential-aware proxy request", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const filesPath = "/api/orders/order-1/line-items/line-1/files";
    client.setQueryData([filesPath], [{
      id: "saved-1",
      fileRecordId: "record-1",
      source: "canonical",
      fileName: "saved-art.pdf",
      originalFilename: "saved-art.pdf",
      mimeType: "application/pdf",
      createdAt: "2026-07-20T00:00:00.000Z",
      side: "na",
    }]);
    client.setQueryData(["/api/system/status"], { thumbnailsEnabled: true });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: [], assets: [] }) })) as unknown as typeof fetch;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => root.render(
        <QueryClientProvider client={client}>
          <LineItemAttachmentsPanel quoteId={null} parentType="order" orderId="order-1" lineItemId="line-1" defaultExpanded />
        </QueryClientProvider>,
      ));
      const downloadButton = host.querySelector("button[title='Download original file']") as HTMLButtonElement;
      await act(async () => downloadButton.click());

      expect(downloadAuthenticatedFile).toHaveBeenCalledTimes(1);
      expect(downloadAuthenticatedFile).toHaveBeenCalledWith(
        "/api/orders/order-1/line-items/line-1/files/saved-1/download/proxy",
        "saved-art.pdf",
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      globalThis.fetch = previousFetch;
      jest.mocked(downloadAuthenticatedFile).mockReset();
    }
  });

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

  test("shows defaulted production allocation quantities and excludes proof rows from the summary", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["/api/orders/order-1/line-items/line-1/files"], [
      {
        id: "art-1",
        source: "attachment",
        fileName: "front.pdf",
        fileUrl: "/objects/front.pdf",
        mimeType: "application/pdf",
        createdAt: "2026-07-16T00:00:00.000Z",
        role: "artwork",
        side: "front",
        productionQuantity: 1,
      },
      {
        id: "art-2",
        source: "attachment",
        fileName: "back.pdf",
        fileUrl: "/objects/back.pdf",
        mimeType: "application/pdf",
        createdAt: "2026-07-16T00:00:00.000Z",
        role: "artwork",
        side: "back",
        productionQuantity: 1,
      },
      {
        id: "proof-1",
        source: "attachment",
        fileName: "proof.pdf",
        fileUrl: "/objects/proof.pdf",
        mimeType: "application/pdf",
        createdAt: "2026-07-16T00:00:00.000Z",
        role: "proof",
        productionQuantity: 1,
      },
    ]);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <LineItemAttachmentsPanel
          quoteId={null}
          parentType="order"
          orderId="order-1"
          lineItemId="line-1"
          defaultExpanded
          lineQuantity={2}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain("Assigned 2 of 2");
    expect(html).toContain('value="1"');
    expect(html).not.toContain("Assigned 3 of 2");
  });

  test("shows staged artwork quantity controls and an allocation total before the line is saved", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LineItemAttachmentsPanel
          quoteId={null}
          parentType="order"
          orderId={null}
          lineItemId="temp-line-1"
          defaultExpanded
          lineQuantity={4}
          pendingOrderAttachments={[{
            uploadId: "staged-1",
            fileName: "banner.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1200,
            uploadedAt: "2026-07-31T00:00:00.000Z",
            productionQuantity: 4,
            allocationSource: "automatic",
          }]}
          onTemporaryOrderAttachmentUpdate={() => undefined}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain("Qty to produce");
    expect(html).toContain("Auto-filled from line quantity");
    expect(html).toContain("Artwork allocation: Assigned 4 of 4");
    expect(html).toContain("Allocation complete");
  });

  test("renders a multilayer staged artwork group as one finished-output quantity", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LineItemAttachmentsPanel
          quoteId={null}
          parentType="order"
          orderId={null}
          lineItemId="temp-line-1"
          defaultExpanded
          lineQuantity={250}
          pendingOrderAttachments={[
            { uploadId: "color", fileName: "color.pdf", mimeType: "application/pdf", sizeBytes: 1200, uploadedAt: "2026-07-31T00:00:00.000Z", productionQuantity: 250, productionGroupId: "window-cling-a", allocationSource: "manual" },
            { uploadId: "white", fileName: "white.pdf", mimeType: "application/pdf", sizeBytes: 1200, uploadedAt: "2026-07-31T00:00:00.000Z", productionQuantity: 250, productionGroupId: "window-cling-a", allocationSource: "manual" },
          ]}
          onTemporaryOrderArtworkSetUpdate={() => undefined}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain("Artwork Set 1 · 2 required layers");
    expect(html).toContain("Artwork allocation: Assigned 250 of 250");
    expect(html).not.toContain("Assigned 500 of 250");
  });

  test("automatically assigns the only artwork file to Both when shared-art intent is active", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const filesPath = "/api/orders/order-1/line-items/line-1/files";
    client.setQueryData([filesPath], [{
      id: "only-art",
      source: "attachment",
      fileName: "only-art.pdf",
      fileUrl: "/objects/only-art.pdf",
      mimeType: "application/pdf",
      createdAt: "2026-07-20T00:00:00.000Z",
      side: "na",
    }]);
    client.setQueryData(["/api/system/status"], { thumbnailsEnabled: true });
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ data: { id: "only-art", side: "both" } }) })) as unknown as typeof fetch;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <LineItemAttachmentsPanel
              quoteId={null}
              parentType="order"
              orderId="order-1"
              lineItemId="line-1"
              defaultExpanded
              doubleSided
              useSameArtworkBothSides
            />
          </QueryClientProvider>,
        );
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        `${filesPath}/only-art/artwork-side`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ side: "both" }) }),
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      globalThis.fetch = previousFetch;
    }
  });

  test("button-selected artwork still stages through the temporary order path", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => root.render(
      <QueryClientProvider client={client}><TemporaryArtworkHarness /></QueryClientProvider>,
    ));
    const input = host.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["art"], "button-art.pdf", { type: "application/pdf" });
    setInputFiles(input, [file]);
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(host.textContent).toContain("button-art.pdf");
    expect(host.querySelector("[data-testid='line-item-artwork-count']")?.textContent).toBe("1");
    expect(host.querySelector("[data-testid='artwork-dirty-state']")?.textContent).toBe("dirty");

    await act(async () => root.unmount());
    host.remove();
  });

  test("drag and drop prevents navigation, stages artwork, updates count and persists on Save Item", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => root.render(
      <QueryClientProvider client={client}><TemporaryArtworkHarness /></QueryClientProvider>,
    ));
    const dropzone = host.querySelector("[data-testid='line-item-artwork-dropzone']") as HTMLElement;
    const file = new File(["art"], "dropped-art.pdf", { type: "application/pdf" });
    const dragEnterEvent = new Event("dragenter", { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnterEvent, "dataTransfer", {
      configurable: true,
      value: { files: [file], dropEffect: "none" },
    });
    await act(async () => dropzone.dispatchEvent(dragEnterEvent));
    expect(dropzone.textContent).toContain("Drop files to add artwork");

    const dropEvent = createDropEvent([file]);
    await act(async () => {
      dropzone.dispatchEvent(dropEvent);
      await Promise.resolve();
    });

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("dropped-art.pdf");
    expect(host.querySelector("[data-testid='line-item-artwork-count']")?.textContent).toBe("1");
    expect(host.querySelector("[data-testid='artwork-dirty-state']")?.textContent).toBe("dirty");

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Save Item") as HTMLButtonElement;
    await act(async () => saveButton.click());
    expect(host.querySelector("[data-testid='saved-artwork']")?.textContent).toBe("dropped-art.pdf");

    await act(async () => root.unmount());
    host.remove();
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
