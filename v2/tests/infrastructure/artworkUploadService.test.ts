import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { ArtworkUploadService } from "../../infrastructure/artwork/artworkUploadService";
import type { ArtworkBinaryStorage } from "../../infrastructure/artwork/artworkBinaryStorage";
import type { ArtworkStorageUploadLedger } from "../../infrastructure/artwork/artworkStorageUploadLedger";
import type { ArtworkApplicationService } from "../../src/modules/artwork/artworkApplication";

const context = { organizationId: "org-a", operationId: "test", businessRequest: { id: "request-a", payloadFingerprint: "test" }, principal: { kind: "staff" as const, organizationId: "org-a", userId: "staff", authority: { membershipId: "member", capabilities: ["artwork.adopt"] as const } } };
let knownFixturePdf: Buffer; let validPdf: Buffer;
beforeAll(async () => {
  knownFixturePdf = Buffer.from(await readFile(new URL("../fixtures/p7-qa-artwork.pdf", import.meta.url)));
  const document = await PDFDocument.create(); const page = document.addPage([144, 144]); const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Print-ready artwork", { x: 18, y: 72, font, size: 12 }); validPdf = Buffer.from(await document.save());
});
const input = (overrides: object = {}) => ({ businessRequestId: "request-a", orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied" as const, side: "front" as const, filename: "qa-art.pdf", contentType: "application/pdf", bytes: Buffer.from(validPdf), ...overrides });
const successResult = { ok: true as const, value: { artworkFile: { id: "file-a" }, assignment: { id: "assignment-a" } } };

class MemoryStorage implements ArtworkBinaryStorage {
  readonly objects = new Map<string, Buffer>(); readonly contentTypes = new Map<string, string>(); readonly removed: string[] = [];
  failPut = false;
  async put(value: Parameters<ArtworkBinaryStorage["put"]>[0]) { if (this.failPut) throw Error("unavailable"); const created = !this.objects.has(value.objectKey); this.objects.set(value.objectKey, value.bytes); this.contentTypes.set(value.objectKey, value.contentType); return { storageProvider: "supabase" as const, objectKey: value.objectKey, created }; }
  async remove(key: string) { this.removed.push(key); this.objects.delete(key); }
  async exists(key: string) { return this.objects.has(key); }
}
class MemoryUploads implements ArtworkStorageUploadLedger {
  readonly rows = new Map<string, { state: string; created: boolean; fileId?: string }>();
  async reserve(input: Parameters<ArtworkStorageUploadLedger["reserve"]>[0]) { const id = `intent:${input.objectKey}`; this.rows.set(id, { state: "pending_write", created: input.objectExpectedToBeCreated }); return { id, organizationId: input.organizationId, storageProvider: input.storageProvider, objectKey: input.objectKey, requestIdentity: input.requestIdentity, expectedChecksumSha256: input.expectedChecksumSha256, expectedContentType: input.expectedContentType, expectedByteSize: input.expectedByteSize, state: "pending_write" as const, objectCreatedByIntent: input.objectExpectedToBeCreated, cleanupAttempts: 0 }; }
  async markStored(input: Parameters<ArtworkStorageUploadLedger["markStored"]>[0]) { const row = this.rows.get(input.intentId)!; row.state = "stored"; row.created ||= input.objectCreatedByIntent; }
  async markAdopted(input: Parameters<ArtworkStorageUploadLedger["markAdopted"]>[0]) { const row = this.rows.get(input.intentId)!; row.state = "adopted"; row.fileId = input.artworkFileId; }
  async markCleanupPending(input: Parameters<ArtworkStorageUploadLedger["markCleanupPending"]>[0]) { const row = this.rows.get(input.intentId)!; row.state = "cleanup_pending"; }
  async markCleaned(input: Parameters<ArtworkStorageUploadLedger["markCleaned"]>[0]) { const row = this.rows.get(input.intentId)!; row.state = "cleaned"; }
  async claimStale() { return []; }
  async listStale() { return []; }
  async markRetained() {}
  async findCanonicalArtworkFileId() { return null; }
  async recordCleanupFailure() {}
}

describe("Artwork binary adoption", () => {
  test("stores a bounded PDF then adopts through the existing Artwork service", async () => {
    const storage = new MemoryStorage(); const uploads = new MemoryUploads(); const adopt = jest.fn(async () => successResult);
    const service = new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage, uploads);
    const result = await service.upload(context, input());
    expect(result).toEqual(successResult); expect(storage.objects.size).toBe(1);
    expect([...uploads.rows.values()]).toContainEqual(expect.objectContaining({ state: "adopted", fileId: "file-a" }));
    expect(adopt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "customer_upload", checksum: expect.objectContaining({ algorithm: "sha256" }), usage: expect.objectContaining({ orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front" }) }));
  });

  test("accepts the repository's known-small structural PDF fixture", async () => {
    const storage = new MemoryStorage(); const adopt = jest.fn(async () => successResult);
    const result = await new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage, new MemoryUploads()).upload(context, input({ bytes: knownFixturePdf }));
    expect(result).toEqual(successResult); expect(adopt).toHaveBeenCalledTimes(1);
  });

  test("accepts a structurally valid PDF when the browser reports a generic MIME type", async () => {
    const storage = new MemoryStorage(); const adopt = jest.fn(async () => successResult);
    const result = await new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage, new MemoryUploads()).upload(context, input({ contentType: "application/octet-stream" }));
    expect(result).toEqual(successResult); expect([...storage.contentTypes.values()]).toEqual(["application/pdf"]);
  });

  test.each([
    ["empty", { bytes: Buffer.alloc(0) }, "EMPTY_FILE"],
    ["renamed non-PDF", { filename: "bad.pdf", bytes: Buffer.from("PNG") }, "NOT_PDF"],
    ["signature-only malformed PDF", { bytes: Buffer.from("%PDF-1.4\nqa") }, "CORRUPT_PDF"],
    ["oversized PDF", { bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 1) }, "SIZE_LIMIT"],
  ])("rejects %s before storage or assignment", async (_label, overrides, code) => {
    const storage = new MemoryStorage(); const adopt = jest.fn(async () => successResult);
    const result = await new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage, new MemoryUploads()).upload(context, input(overrides));
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })); expect(storage.objects.size).toBe(0); expect(adopt).not.toHaveBeenCalled();
  });

  test("rejects a truncated PDF before storage or assignment", async () => {
    const storage = new MemoryStorage(); const adopt = jest.fn(async () => successResult);
    const result = await new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage, new MemoryUploads()).upload(context, input({ bytes: validPdf.subarray(0, validPdf.length - 32) }));
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "CORRUPT_PDF" }) })); expect(storage.objects.size).toBe(0); expect(adopt).not.toHaveBeenCalled();
  });

  test("cleans a newly stored object when Artwork adoption fails", async () => {
    const storage = new MemoryStorage(); const uploads = new MemoryUploads(); const adopt = jest.fn(async () => ({ ok: false as const, error: { code: "CONFLICT", publicMessage: "conflict" } }));
    const result = await new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage, uploads).upload(context, input());
    expect(result.ok).toBe(false); expect(storage.objects.size).toBe(0); expect(storage.removed).toHaveLength(1);
    expect([...uploads.rows.values()]).toContainEqual(expect.objectContaining({ state: "cleaned" }));
  });

  test("uses one deterministic object for retry of the same binary", async () => {
    const storage = new MemoryStorage(); const adopt = jest.fn(async () => successResult);
    const service = new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage, new MemoryUploads());
    await service.upload(context, input()); await service.upload(context, input());
    expect(storage.objects.size).toBe(1); expect(adopt).toHaveBeenCalledTimes(2);
  });

  test("uses the canonical replacement operation only when an exact current assignment is supplied", async () => {
    const storage = new MemoryStorage(); const replace = jest.fn(async () => successResult);
    const service = new ArtworkUploadService({ replace } as unknown as ArtworkApplicationService, storage, new MemoryUploads());
    const result = await service.replace(context, input({ supersedesArtworkAssignmentId: "current-assignment" }));
    expect(result).toEqual(successResult); expect(replace).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ supersedesArtworkAssignmentId: "current-assignment" }));
  });
});
