import { describe, expect, jest, test } from "@jest/globals";

import { readBufferFromDownloadHandle, resolveProofPreviewSource } from "../services/proofPreviewResolver";

const PREVIEW_BUFFER = Buffer.from("preview-bytes");
const ORIGINAL_BUFFER = Buffer.from("original-bytes");

describe("resolveProofPreviewSource", () => {
  test("uses an existing image derivative when present", async () => {
    const readCanonicalDerivative = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValueOnce({
        buffer: PREVIEW_BUFFER,
        mimeType: "image/jpeg",
        providerType: "titan_managed",
        status: "ready",
        error: null,
      });
    const readCanonicalFileRecord = jest.fn<(...args: any[]) => Promise<any>>();

    const resolved = await resolveProofPreviewSource({
      context: { organizationId: "org_1", orderId: "order_1", lineItemId: "line_1" },
      candidates: [
        {
          candidateId: "artwork:1",
          fileName: "artwork.png",
          mimeType: "image/png",
          fileRecordId: "file_1",
          allowOriginalPdf: false,
        },
      ],
      loader: {
        readCanonicalDerivative,
        readCanonicalFileRecord,
        readLegacyStorageKey: jest.fn<(...args: any[]) => Promise<any>>(),
      },
    });

    expect(resolved.kind).toBe("image");
    expect(resolved.previewStatus).toBe("ready");
    expect(readCanonicalDerivative).toHaveBeenCalledWith("file_1", "preview", expect.any(Object));
    expect(readCanonicalFileRecord).not.toHaveBeenCalled();
  });

  test("falls back to the original image when the derivative is missing", async () => {
    const readCanonicalDerivative = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValueOnce({ buffer: null, mimeType: null, providerType: null, status: "missing", error: null })
      .mockResolvedValueOnce({ buffer: null, mimeType: null, providerType: null, status: "missing", error: null });
    const readCanonicalFileRecord = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValueOnce({
        buffer: ORIGINAL_BUFFER,
        mimeType: "image/png",
        providerType: "titan_managed",
        status: "ready",
        error: null,
      });

    const resolved = await resolveProofPreviewSource({
      context: { organizationId: "org_1", orderId: "order_1", lineItemId: "line_1" },
      candidates: [
        {
          candidateId: "artwork:1",
          fileName: "artwork.png",
          mimeType: "image/png",
          fileRecordId: "file_1",
          allowOriginalPdf: false,
        },
      ],
      loader: {
        readCanonicalDerivative,
        readCanonicalFileRecord,
        readLegacyStorageKey: jest.fn<(...args: any[]) => Promise<any>>(),
      },
    });

    expect(resolved.kind).toBe("image");
    expect(resolved.previewStatus).toBe("ready");
    expect(readCanonicalFileRecord).toHaveBeenCalledWith("file_1", expect.any(Object));
  });

  test("marks the preview unavailable when only a PDF original exists and no preview derivative exists", async () => {
    const resolved = await resolveProofPreviewSource({
      context: { organizationId: "org_1", orderId: "order_1", lineItemId: "line_1" },
      candidates: [
        {
          candidateId: "artwork:pdf",
          fileName: "artwork.pdf",
          mimeType: "application/pdf",
          fileRecordId: "file_pdf",
          allowOriginalPdf: false,
        },
      ],
      loader: {
        readCanonicalDerivative: jest
          .fn<(...args: any[]) => Promise<any>>()
          .mockResolvedValue({ buffer: null, mimeType: null, providerType: null, status: "missing", error: null }),
        readCanonicalFileRecord: jest.fn<(...args: any[]) => Promise<any>>(),
        readLegacyStorageKey: jest.fn<(...args: any[]) => Promise<any>>(),
      },
    });

    expect(resolved.kind).toBe("unavailable");
    expect(resolved.previewStatus).toBe("missing_preview");
    expect(resolved.reason).toBe("no_pdf_preview_derivative");
  });

  test("serves the original PDF when an inline source viewer explicitly requests it", async () => {
    const readCanonicalFileRecord = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
      buffer: ORIGINAL_BUFFER,
      mimeType: "application/pdf",
      providerType: "titan_managed",
      status: "ready",
      error: null,
    });
    const readCanonicalDerivative = jest.fn<(...args: any[]) => Promise<any>>();

    const resolved = await resolveProofPreviewSource({
      context: { organizationId: "org_1", orderId: "order_1", lineItemId: "line_1" },
      candidates: [{
        candidateId: "artwork:pdf",
        fileName: "artwork.pdf",
        mimeType: "application/pdf",
        fileRecordId: "file_pdf",
        allowOriginalPdf: true,
        preferOriginalPdf: true,
      }],
      loader: {
        readCanonicalDerivative,
        readCanonicalFileRecord,
        readLegacyStorageKey: jest.fn<(...args: any[]) => Promise<any>>(),
      },
    });

    expect(resolved).toMatchObject({ kind: "pdf", mimeType: "application/pdf", sourceBuffer: ORIGINAL_BUFFER });
    expect(readCanonicalDerivative).not.toHaveBeenCalled();
  });

  test("records preview_error when storage access fails", async () => {
    const resolved = await resolveProofPreviewSource({
      context: { organizationId: "org_1", orderId: "order_1", lineItemId: "line_1" },
      candidates: [
        {
          candidateId: "artwork:1",
          fileName: "artwork.png",
          mimeType: "image/png",
          fileRecordId: "file_1",
          allowOriginalPdf: false,
        },
      ],
      loader: {
        readCanonicalDerivative: jest
          .fn<(...args: any[]) => Promise<any>>()
          .mockResolvedValue({ buffer: null, mimeType: null, providerType: null, status: "failed", error: "The server could not read the artwork preview from storage." }),
        readCanonicalFileRecord: jest.fn<(...args: any[]) => Promise<any>>(),
        readLegacyStorageKey: jest.fn<(...args: any[]) => Promise<any>>(),
      },
    });

    expect(resolved.kind).toBe("unavailable");
    expect(resolved.previewStatus).toBe("generation_failed");
    expect(resolved.previewError).toBe("The server could not read the artwork preview from storage.");
  });
});

describe("readBufferFromDownloadHandle", () => {
  test("uses the provider download handle instead of local file reads in cloud mode", async () => {
    const readFileImpl = jest.fn<typeof Promise.resolve>();
    const fetchImpl = jest.fn<typeof fetch>(async () =>
      new Response(Uint8Array.from([1, 2, 3]), { status: 200 }),
    );

    const result = await readBufferFromDownloadHandle({
      handle: { kind: "signed_url", value: "https://example.com/object" },
      fetchImpl,
      readFileImpl: readFileImpl as any,
    });

    expect(Array.from(result)).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readFileImpl).not.toHaveBeenCalled();
  });
});
