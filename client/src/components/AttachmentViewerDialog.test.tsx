import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "node:util";

const getDocument = jest.fn();
const apiFetchBlob = jest.fn();
const downloadFileFromUrl = jest.fn();

jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument,
}));

jest.mock("@/lib/queryClient", () => ({ apiFetchBlob }));
jest.mock("@/lib/downloadFile", () => ({ downloadFileFromUrl }));
jest.mock("@/lib/apiConfig", () => ({ resolveObjectsPublicUrl: (value: string) => value }));
jest.mock("@/lib/pdfUrls", () => ({
  buildPdfDownloadUrl: jest.fn(),
  buildPdfViewUrl: jest.fn(),
  isPdfFile: (mimeType: string | null | undefined, name: string) => mimeType === "application/pdf" || name.endsWith(".pdf"),
}));
jest.mock("@/lib/artworkAccess", () => ({
  buildArtworkAccessUrl: (id: string | null | undefined, variant: string) => id ? `/api/artwork/file-records/${id}/content?variant=${variant}` : null,
  openArtworkPreview: jest.fn(),
  resolveArtworkDownloadUrl: (id: string | null | undefined) => id ? `/api/artwork/file-records/${id}/content?variant=original` : null,
}));
jest.mock("@/components/AttachmentPreviewMeta", () => ({ AttachmentPreviewMeta: () => null }));
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
}));

import { AttachmentViewerDialog } from "./AttachmentViewerDialog";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

const visiblePdfBytes = new TextEncoder().encode(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >> endobj
4 0 obj << /Length 37 >> stream
0 0 1 rg 10 10 180 180 re f
endstream endobj
trailer << /Root 1 0 R >>
%%EOF`);

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AttachmentViewerDialog PDF rendering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders visible PDF page pixels after the loading placeholder mounts the canvas", async () => {
    const canvasContext = {
      setTransform: jest.fn(),
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      fillStyle: "",
    };
    const render = jest.fn(({ canvasContext: context }: any) => {
      context.fillStyle = "#0088ff";
      context.fillRect(0, 0, 50, 50);
      return { promise: Promise.resolve(), cancel: jest.fn() };
    });
    const page = {
      rotate: 0,
      getViewport: ({ scale }: any) => ({ width: 200 * scale, height: 200 * scale }),
      render,
    };
    const pdfDocument = {
      numPages: 1,
      getPage: jest.fn().mockResolvedValue(page),
      getMetadata: jest.fn().mockResolvedValue({ info: {} }),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    getDocument.mockReturnValue({ promise: Promise.resolve(pdfDocument) });
    apiFetchBlob.mockResolvedValue({
      type: "application/pdf",
      arrayBuffer: async () => visiblePdfBytes.buffer.slice(visiblePdfBytes.byteOffset, visiblePdfBytes.byteOffset + visiblePdfBytes.byteLength),
    } as Blob);

    const resizeObserver = class {
      observe() {}
      disconnect() {}
    };
    (globalThis as any).ResizeObserver = resizeObserver;
    const rect = { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) };
    const rectSpy = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
    const contextSpy = jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext as any);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(<AttachmentViewerDialog open onOpenChange={jest.fn()} attachment={{ id: "attachment-display-id", fileRecordId: "canonical-file-id", fileName: "visible.pdf", mimeType: "application/pdf" }} />);
        await flush();
        await flush();
        await flush();
      });

      const canvas = host.querySelector('[data-testid="attachment-viewer-pdf-canvas"]') as HTMLCanvasElement;
      expect(apiFetchBlob).toHaveBeenCalledWith("/api/artwork/file-records/canonical-file-id/content?variant=original", expect.objectContaining({ credentials: "include" }));
      expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array) }));
      expect(pdfDocument.getPage).toHaveBeenCalledWith(1);
      expect(render).toHaveBeenCalledWith(expect.objectContaining({ canvasContext, viewport: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }) }));
      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
      expect(canvasContext.fillRect).toHaveBeenCalledWith(0, 0, 50, 50);
      expect(host.textContent).not.toContain("PDF preview unavailable");

      const fitWidth = host.querySelector('[title="Fit width"]') as HTMLButtonElement;
      const zoomIn = host.querySelector('[title="Zoom in"]') as HTMLButtonElement;
      const rotateRight = host.querySelector('[title="Rotate right"]') as HTMLButtonElement;
      await act(async () => {
        fitWidth.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flush();
      });
      await act(async () => {
        zoomIn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flush();
      });
      await act(async () => {
        rotateRight.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flush();
      });
      expect(render.mock.calls.length).toBeGreaterThanOrEqual(3);

      const download = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Download")) as HTMLButtonElement;
      await act(async () => download.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(downloadFileFromUrl).toHaveBeenCalledWith("/api/artwork/file-records/canonical-file-id/content?variant=original", "visible.pdf");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      rectSpy.mockRestore();
      contextSpy.mockRestore();
    }
  });

  test("keeps canonical image previews working through an authenticated Blob", async () => {
    const createObjectUrl = jest.fn(() => "blob:fixture-image");
    const revokeObjectUrl = jest.fn();
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    apiFetchBlob.mockResolvedValue(new Blob(["fixture-image"], { type: "image/png" }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(<AttachmentViewerDialog open onOpenChange={jest.fn()} attachment={{ id: "image-attachment", fileRecordId: "image-file", fileName: "artwork.png", mimeType: "image/png" }} />);
        await flush();
        await flush();
      });

      const image = host.querySelector('img[alt="artwork.png"]') as HTMLImageElement;
      expect(apiFetchBlob).toHaveBeenLastCalledWith("/api/artwork/file-records/image-file/content?variant=preview", expect.objectContaining({ credentials: "include" }));
      expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
      expect(image.src).toBe("blob:fixture-image");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
      else Reflect.deleteProperty(URL, "createObjectURL");
      if (revokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
      else Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  test("renders again after navigating from a PDF to an image and back", async () => {
    const canvasContext = { setTransform: jest.fn(), clearRect: jest.fn(), fillRect: jest.fn(), fillStyle: "" };
    const render = jest.fn(() => ({ promise: Promise.resolve(), cancel: jest.fn() }));
    const pdfDocument = {
      numPages: 1,
      getPage: jest.fn().mockResolvedValue({ rotate: 0, getViewport: ({ scale }: any) => ({ width: 200 * scale, height: 200 * scale }), render }),
      getMetadata: jest.fn().mockResolvedValue({ info: {} }),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    getDocument.mockReturnValue({ promise: Promise.resolve(pdfDocument) });
    apiFetchBlob.mockImplementation((url: string) => Promise.resolve(url.includes("pdf-file")
      ? { type: "application/pdf", arrayBuffer: async () => visiblePdfBytes.buffer.slice(visiblePdfBytes.byteOffset, visiblePdfBytes.byteOffset + visiblePdfBytes.byteLength) } as Blob
      : new Blob(["fixture-image"], { type: "image/png" })));
    const createObjectUrl = jest.fn(() => "blob:navigation-image");
    const revokeObjectUrl = jest.fn();
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
    const rectSpy = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const contextSpy = jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext as any);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(<AttachmentViewerDialog open onOpenChange={jest.fn()} attachments={[
          { id: "pdf-attachment", fileRecordId: "pdf-file", fileName: "visible.pdf", mimeType: "application/pdf" },
          { id: "image-attachment", fileRecordId: "image-file", fileName: "artwork.png", mimeType: "image/png" },
        ]} />);
        await flush();
        await flush();
        await flush();
      });
      expect(render).toHaveBeenCalledTimes(1);

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        await flush();
        await flush();
      });
      expect(host.querySelector('img[alt="artwork.png"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="attachment-viewer-pdf-canvas"]')).toBeNull();

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
        await flush();
        await flush();
        await flush();
      });
      expect(pdfDocument.destroy).toHaveBeenCalled();
      expect(getDocument).toHaveBeenCalledTimes(2);
      expect(render).toHaveBeenCalledTimes(2);
      expect(host.querySelector('[data-testid="attachment-viewer-pdf-canvas"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      rectSpy.mockRestore();
      contextSpy.mockRestore();
      if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
      else Reflect.deleteProperty(URL, "createObjectURL");
      if (revokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
      else Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  test("shows a useful fallback instead of a blank canvas when PDF loading fails", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    getDocument.mockReturnValue({
      get promise() {
        return Promise.reject(new Error("fixture PDF cannot be parsed"));
      },
    });
    apiFetchBlob.mockResolvedValue({
      type: "application/pdf",
      arrayBuffer: async () => visiblePdfBytes.buffer.slice(visiblePdfBytes.byteOffset, visiblePdfBytes.byteOffset + visiblePdfBytes.byteLength),
    } as Blob);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(<AttachmentViewerDialog open onOpenChange={jest.fn()} attachment={{ id: "bad-pdf", fileRecordId: "bad-file", fileName: "bad.pdf", mimeType: "application/pdf" }} />);
        await flush();
        await flush();
        await flush();
      });
      expect(host.textContent).toContain("Unable to render PDF preview. Download the original file to view it.");
      expect(host.querySelector('[data-testid="attachment-viewer-pdf-canvas"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      consoleErrorSpy.mockRestore();
    }
  });
});
