import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { PDFDocument } from "pdf-lib";
import { promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";

jest.unstable_mockModule("../db", () => ({ db: {} }));
jest.unstable_mockModule("../services/artwork/ArtworkFileAccessService", () => ({ readArtworkFileForOrganization: jest.fn() }));
let inspect: typeof import("../services/artwork/ArtworkPdfSizeService").inspectArtworkPdfSize;
beforeAll(async () => { ({ inspectArtworkPdfSize: inspect } = await import("../services/artwork/ArtworkPdfSizeService")); });

async function bytes() { const pdf = await PDFDocument.create(); pdf.addPage([162, 144]); return Buffer.from(await pdf.save()); }
function deps(buffer: Buffer) {
  return {
    loadUpload: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ uploadId: "up", organizationId: "tenant", createdByUserId: "staff", purpose: "order-attachment", status: "finalized", relativePath: "trusted.pdf", sizeBytes: buffer.length, originalFilename: "art.pdf", mimeType: "application/pdf", checksum: "sha", expiresAt: "2099-01-01T00:00:00Z" }),
    attachedFile: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ id: "canonical", originalFilename: "art.pdf", mimeType: "application/pdf", sizeBytes: buffer.length, checksum: "sha" }),
    readArtwork: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ buffer, filename: "art.pdf", mimeType: "application/pdf" }),
    readLocal: jest.fn<(...args: any[]) => Promise<Buffer>>().mockResolvedValue(buffer),
  };
}
const args = { organizationId: "tenant", userId: "staff", source: { uploadId: "up" } };

describe("read-only artwork PDF size adapter", () => {
  test("uses actual finalized chunked upload identity and bytes without creating artwork", async () => {
    const root = await fs.mkdtemp(path.resolve("node_modules/.cache/pdf-size-upload-"));
    const previousRoot = process.env.FILE_STORAGE_ROOT; const previousTemp = process.env.FILE_UPLOAD_TEMP_ROOT;
    process.env.FILE_STORAGE_ROOT = root; process.env.FILE_UPLOAD_TEMP_ROOT = path.join(root, "temp");
    try {
      const uploads = await import("../services/chunkedUploads"); const buffer = await bytes();
      const upload = await uploads.createUploadSession({ organizationId: "tenant", createdByUserId: "staff", purpose: "order-attachment", filename: "art.pdf", mimeType: "application/pdf", sizeBytes: buffer.length });
      await uploads.writeUploadChunkFromStream({ uploadId: upload.uploadId, chunkIndex: 0, stream: Readable.from(buffer) });
      await uploads.finalizeUploadSession({ uploadId: upload.uploadId, organizationId: "tenant" });
      const before = await uploads.loadUploadSessionMeta(upload.uploadId);
      const result = await inspect({ ...args, source: { uploadId: upload.uploadId } });
      expect(result).toMatchObject({ status: "succeeded", effectiveWidthInches: 2.25, effectiveHeightInches: 2 });
      expect(await uploads.loadUploadSessionMeta(upload.uploadId)).toEqual(before);
    } finally {
      if (previousRoot === undefined) delete process.env.FILE_STORAGE_ROOT; else process.env.FILE_STORAGE_ROOT = previousRoot;
      if (previousTemp === undefined) delete process.env.FILE_UPLOAD_TEMP_ROOT; else process.env.FILE_UPLOAD_TEMP_ROOT = previousTemp;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  test.each([{ organizationId: "other" }, { userId: "other" }])("rejects a different tenant or upload owner before reading bytes", async patch => {
    const dependency = deps(await bytes()); expect(await inspect({ ...args, ...patch }, dependency)).toBeNull(); expect(dependency.readLocal).not.toHaveBeenCalled();
  });
  test.each([{ status: "uploading" }, { linkedAt: "2026-01-01" }, { expiresAt: "2000-01-01" }, { mimeType: "text/plain", originalFilename: "art.txt" }, { sizeBytes: 30 * 1024 * 1024 }])("rejects unusable staged sources", async patch => {
    const dependency = deps(await bytes()); const current = await dependency.loadUpload(); dependency.loadUpload.mockResolvedValue({ ...current, ...patch });
    expect(await inspect(args, dependency)).toBeNull(); expect(dependency.readLocal).not.toHaveBeenCalled();
  });
  test("canonical reload uses original file resolution and retains its ID", async () => {
    const dependency = deps(await bytes());
    const result = await inspect({ ...args, source: { fileRecordId: "canonical" } }, dependency);
    expect(dependency.attachedFile).toHaveBeenCalledWith("tenant", "canonical");
    expect(dependency.readArtwork).toHaveBeenCalledWith({ organizationId: "tenant", fileRecordId: "canonical", variant: "original" });
    expect(result).toMatchObject({ status: "succeeded", fileIdentity: "canonical:sha" });
  });
  test("unlinked/quarantined or cross-tenant canonical records cannot be inspected", async () => {
    const dependency = deps(await bytes()); dependency.attachedFile.mockResolvedValue(null);
    expect(await inspect({ ...args, source: { fileRecordId: "quarantine" } }, dependency)).toBeNull(); expect(dependency.readArtwork).not.toHaveBeenCalled();
  });
  test("malformed PDF returns failed metadata and missing storage rejects safely", async () => {
    const dependency = deps(Buffer.from("bad")); expect(await inspect(args, dependency)).toMatchObject({ status: "failed", errorCode: "INVALID_PDF" });
    dependency.readLocal.mockRejectedValue(new Error("unavailable")); await expect(inspect(args, dependency)).rejects.toThrow("unavailable");
  });
});
