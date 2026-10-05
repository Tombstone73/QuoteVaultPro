import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "node:util";

type CanvasContextMock = {
  setTransform: jest.MockedFunction<(a: number, b: number, c: number, d: number, e: number, f: number) => void>;
  clearRect: jest.MockedFunction<(x: number, y: number, width: number, height: number) => void>;
  fillRect: jest.MockedFunction<(x: number, y: number, width: number, height: number) => void>;
  fillStyle: string;
};
type PdfViewport = { width: number; height: number };
type PdfRenderTask = { promise: Promise<void>; cancel: () => void };
type PdfRenderParameters = { canvasContext: CanvasContextMock; viewport: PdfViewport; transform?: number[] };
type PdfPage = {
  rotate: number;
  getViewport: (parameters: { scale: number; rotation?: number }) => PdfViewport;
  render: (parameters: PdfRenderParameters) => PdfRenderTask;
};
type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  getMetadata: () => Promise<{ info: Record<string, unknown> }>;
  destroy: () => Promise<void>;
};
type PdfLoadingTask = { promise: Promise<PdfDocument> };
type PdfDocumentOptions = {
  data: Uint8Array;
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
  useWorkerFetch?: boolean;
  isEvalSupported?: boolean;
  stopAtErrors?: boolean;
};
type TestBlob = Blob & { arrayBuffer: () => Promise<ArrayBuffer> };

const getDocument = jest.fn<(options: PdfDocumentOptions) => PdfLoadingTask>();
const apiFetchBlob = jest.fn<(url: string, options?: RequestInit) => Promise<TestBlob>>();
const downloadFileFromUrl = jest.fn<(url: string, fileName: string) => void>();

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
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { AttachmentViewerDialog, type AttachmentData } from "./AttachmentViewerDialog";

function findButton(host: HTMLElement, predicate: (button: HTMLButtonElement) => boolean): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("button")).find(predicate);
  if (!button) throw new Error("Expected button was not rendered");
  return button;
}

class TestResizeObserver implements ResizeObserver {
  observe(_target: Element, _options?: ResizeObserverOptions) {}
  unobserve(_target: Element) {}
  disconnect() {}
}

const previewStates: Array<{
  status: NonNullable<AttachmentData["thumbStatus"]>;
  error: string | null;
  message: string;
}> = [
  { status: "thumb_pending", error: null, message: "Generating preview..." },
  { status: "thumb_failed", error: "preview_unsupported_postscript", message: "Preview unavailable for this Illustrator/EPS file." },
  { status: "thumb_failed", error: "preview_render_failed", message: "Preview generation failed. Download the original file." },
];

const viewerBounds: DOMRect = {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  top: 0,
  right: 800,
  bottom: 600,
  left: 0,
  toJSON: () => ({}),
};

function testBlob(bytes: Uint8Array, type: string): TestBlob {
  const copy = Uint8Array.from(bytes);
  return Object.assign(new Blob([new TextDecoder().decode(copy)], { type }), { arrayBuffer: async () => copy.buffer });
}

describe('Illustrator derivative viewer', () => {
  test('EPS shows its original-download fallback immediately for generic MIME', async () => {
    jest.clearAllMocks();
    const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => root.render(<AttachmentViewerDialog open onOpenChange={() => {}} attachment={{ id:'eps', fileName:'logo.eps', mimeType:'application/octet-stream', fileRecordId:'eps-original', thumbStatus:'uploaded' }} />));
    expect(host.textContent).toContain('EPS Artwork');
    expect(host.textContent).toContain('Preview unavailable');
    expect(host.textContent).toContain('Download original');
    expect(host.textContent).not.toContain('Generating preview');
    expect(host.querySelector('img[alt="logo.eps"]')).toBeNull();
    expect(apiFetchBlob).not.toHaveBeenCalled();
    const download = findButton(host, (button) => button.textContent?.includes("Download original") === true);
    await act(async () => { download.click(); });
    expect(downloadFileFromUrl).toHaveBeenCalledWith('/api/artwork/file-records/eps-original/content?variant=original', 'logo.eps');
    act(() => root.unmount()); host.remove();
  });
  test('PDF MIME Illustrator uses only its ready image derivative, and downloads original', async () => {
    jest.clearAllMocks();
    URL.createObjectURL = jest.fn(() => 'blob:ai-preview'); URL.revokeObjectURL = jest.fn();
    apiFetchBlob.mockImplementation(async () => testBlob(new TextEncoder().encode('image'), 'image/png'));
    const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => { root.render(<AttachmentViewerDialog open onOpenChange={() => {}} attachment={{ id:'ai', fileName:'logo.ai', mimeType:'application/pdf', fileRecordId:'source-ai', thumbStatus:'thumb_ready' }} />); await flush(); });
    expect(apiFetchBlob).toHaveBeenCalledWith('/api/artwork/file-records/source-ai/content?variant=preview', expect.anything());
    expect(getDocument).not.toHaveBeenCalled();
    expect(host.querySelector('img[alt="logo.ai"]')?.getAttribute('src')).toBe('blob:ai-preview');
    const download = findButton(host, (button) => button.textContent?.includes("Download original") === true);
    await act(async () => { download.click(); });
    expect(downloadFileFromUrl).toHaveBeenCalledWith('/api/artwork/file-records/source-ai/content?variant=original', 'logo.ai');
    act(() => root.unmount()); host.remove();
  });
  test.each(previewStates)("state $status leaves original available without attempting native source rendering", async ({ status, error, message }) => {
    jest.clearAllMocks();
    const host = document.createElement('div'); document.body.appendChild(host); const root=createRoot(host);
    await act(async () => root.render(<AttachmentViewerDialog open onOpenChange={() => {}} attachment={{ id:'ai', fileName:'logo.ai', mimeType:'application/octet-stream', fileRecordId:'ai', thumbStatus:status, thumbError:error }} />));
    expect(host.textContent).toContain(message);
    expect(host.textContent).toContain('Download original');
    expect(apiFetchBlob).not.toHaveBeenCalled(); expect(getDocument).not.toHaveBeenCalled();
    act(() => root.unmount()); host.remove();
  });
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, TextEncoder, TextDecoder });

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
    const canvasContext: CanvasContextMock = {
      setTransform: jest.fn<(a: number, b: number, c: number, d: number, e: number, f: number) => void>(),
      clearRect: jest.fn<(x: number, y: number, width: number, height: number) => void>(),
      fillRect: jest.fn<(x: number, y: number, width: number, height: number) => void>(),
      fillStyle: "",
};

    const render = jest.fn((parameters: PdfRenderParameters): PdfRenderTask => {
      const { canvasContext: context } = parameters;
      context.fillStyle = "#0088ff";
      context.fillRect(0, 0, 50, 50);
      return { promise: Promise.resolve(), cancel: () => undefined };
    });
    const page: PdfPage = {
      rotate: 0,
      getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 200 * scale }),
      render,
    };
    const pdfDocument: PdfDocument = {
      numPages: 1,
      getPage: jest.fn<(pageNumber: number) => Promise<PdfPage>>().mockResolvedValue(page),
      getMetadata: jest.fn<() => Promise<{ info: Record<string, unknown> }>>().mockResolvedValue({ info: {} }),
      destroy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    getDocument.mockReturnValue({ promise: Promise.resolve(pdfDocument) });
    apiFetchBlob.mockResolvedValue(testBlob(visiblePdfBytes, "application/pdf"));

    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });
    const rectSpy = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewerBounds);
    const contextDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => canvasContext });
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

      const canvas = host.querySelector<HTMLCanvasElement>('[data-testid="attachment-viewer-pdf-canvas"]');
      if (!canvas) throw new Error("Expected PDF canvas was not rendered");
      expect(apiFetchBlob).toHaveBeenCalledWith("/api/artwork/file-records/canonical-file-id/content?variant=original", expect.objectContaining({ credentials: "include" }));
      expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array) }));
      expect(pdfDocument.getPage).toHaveBeenCalledWith(1);
      expect(render).toHaveBeenCalledWith(expect.objectContaining({ canvasContext, viewport: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }) }));
      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
      expect(canvasContext.fillRect).toHaveBeenCalledWith(0, 0, 50, 50);
      expect(host.textContent).not.toContain("PDF preview unavailable");

      const fitWidth = host.querySelector<HTMLButtonElement>('[title="Fit width"]');
      const zoomIn = host.querySelector<HTMLButtonElement>('[title="Zoom in"]');
      const rotateRight = host.querySelector<HTMLButtonElement>('[title="Rotate right"]');
      if (!fitWidth || !zoomIn || !rotateRight) throw new Error("Expected PDF controls were not rendered");
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

      const download = findButton(host, (button) => button.textContent?.includes("Download") === true);
      await act(async () => download.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(downloadFileFromUrl).toHaveBeenCalledWith("/api/artwork/file-records/canonical-file-id/content?variant=original", "visible.pdf");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      rectSpy.mockRestore();
      if (contextDescriptor) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", contextDescriptor);
      else Reflect.deleteProperty(HTMLCanvasElement.prototype, "getContext");
    }
  });

  test("keeps canonical image previews working through an authenticated Blob", async () => {
    const createObjectUrl = jest.fn(() => "blob:fixture-image");
    const revokeObjectUrl = jest.fn();
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    apiFetchBlob.mockResolvedValue(testBlob(new TextEncoder().encode("fixture-image"), "image/png"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(<AttachmentViewerDialog open onOpenChange={jest.fn()} attachment={{ id: "image-attachment", fileRecordId: "image-file", fileName: "artwork.png", mimeType: "image/png" }} />);
        await flush();
        await flush();
      });

      const image = host.querySelector<HTMLImageElement>('img[alt="artwork.png"]');
      if (!image) throw new Error("Expected image preview was not rendered");
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
    const canvasContext: CanvasContextMock = {
      setTransform: jest.fn<(a: number, b: number, c: number, d: number, e: number, f: number) => void>(),
      clearRect: jest.fn<(x: number, y: number, width: number, height: number) => void>(),
      fillRect: jest.fn<(x: number, y: number, width: number, height: number) => void>(),
      fillStyle: "",
    };
    const render = jest.fn((_parameters: PdfRenderParameters): PdfRenderTask => ({ promise: Promise.resolve(), cancel: () => undefined }));
    const pdfDocument: PdfDocument = {
      numPages: 1,
      getPage: jest.fn<(pageNumber: number) => Promise<PdfPage>>().mockResolvedValue({ rotate: 0, getViewport: ({ scale }) => ({ width: 200 * scale, height: 200 * scale }), render }),
      getMetadata: jest.fn<() => Promise<{ info: Record<string, unknown> }>>().mockResolvedValue({ info: {} }),
      destroy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    getDocument.mockReturnValue({ promise: Promise.resolve(pdfDocument) });
    apiFetchBlob.mockImplementation((url: string) => Promise.resolve(url.includes("pdf-file")
      ? testBlob(visiblePdfBytes, "application/pdf")
      : testBlob(new TextEncoder().encode("fixture-image"), "image/png")));
    const createObjectUrl = jest.fn(() => "blob:navigation-image");
    const revokeObjectUrl = jest.fn();
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });
    const rectSpy = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewerBounds);
    const contextDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => canvasContext });
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
      if (contextDescriptor) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", contextDescriptor);
      else Reflect.deleteProperty(HTMLCanvasElement.prototype, "getContext");
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
    apiFetchBlob.mockResolvedValue(testBlob(visiblePdfBytes, "application/pdf"));
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
