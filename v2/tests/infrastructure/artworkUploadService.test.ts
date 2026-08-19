import { describe, expect, jest, test } from "@jest/globals";
import { ArtworkUploadService } from "../../infrastructure/artwork/artworkUploadService";
import type { ArtworkBinaryStorage } from "../../infrastructure/artwork/artworkBinaryStorage";
import type { ArtworkApplicationService } from "../../src/modules/artwork/artworkApplication";

const context = { organizationId: "org-a", operationId: "test", businessRequest: { id: "request-a", payloadFingerprint: "test" }, principal: { kind: "staff" as const, organizationId: "org-a", userId: "staff", authority: { membershipId: "member", capabilities: ["artwork.adopt"] as const } } };
const input = (overrides: object = {}) => ({ businessRequestId: "request-a", orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied" as const, side: "front" as const, filename: "qa-art.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nqa"), ...overrides });
const successResult = { ok: true as const, value: { artworkFile: { id: "file-a" }, assignment: { id: "assignment-a" } } };

class MemoryStorage implements ArtworkBinaryStorage {
  readonly objects = new Map<string, Buffer>(); readonly removed: string[] = [];
  failPut = false;
  async put(value: Parameters<ArtworkBinaryStorage["put"]>[0]) { if (this.failPut) throw Error("unavailable"); const created = !this.objects.has(value.objectKey); this.objects.set(value.objectKey, value.bytes); return { storageProvider: "supabase" as const, objectKey: value.objectKey, created }; }
  async remove(key: string) { this.removed.push(key); this.objects.delete(key); }
  async exists(key: string) { return this.objects.has(key); }
}

describe("Artwork binary adoption", () => {
  test("stores a bounded PDF then adopts through the existing Artwork service", async () => {
    const storage = new MemoryStorage(); const adopt = jest.fn(async () => successResult);
    const service = new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage);
    const result = await service.upload(context, input());
    expect(result).toEqual(successResult); expect(storage.objects.size).toBe(1);
    expect(adopt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "customer_upload", checksum: expect.objectContaining({ algorithm: "sha256" }), usage: expect.objectContaining({ orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front" }) }));
  });

  test.each([input({ bytes: Buffer.alloc(0) }), input({ contentType: "image/png", filename: "bad.png", bytes: Buffer.from("PNG") }), input({ bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 1) })])("rejects unsafe binary input before storage", async (unsafe) => {
    const storage = new MemoryStorage(); const adopt = jest.fn(async () => successResult);
    const result = await new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage).upload(context, unsafe);
    expect(result.ok).toBe(false); expect(storage.objects.size).toBe(0); expect(adopt).not.toHaveBeenCalled();
  });

  test("cleans a newly stored object when Artwork adoption fails", async () => {
    const storage = new MemoryStorage(); const adopt = jest.fn(async () => ({ ok: false as const, error: { code: "CONFLICT", publicMessage: "conflict" } }));
    const result = await new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage).upload(context, input());
    expect(result.ok).toBe(false); expect(storage.objects.size).toBe(0); expect(storage.removed).toHaveLength(1);
  });

  test("uses one deterministic object for retry of the same binary", async () => {
    const storage = new MemoryStorage(); const adopt = jest.fn(async () => successResult);
    const service = new ArtworkUploadService({ adopt } as unknown as ArtworkApplicationService, storage);
    await service.upload(context, input()); await service.upload(context, input());
    expect(storage.objects.size).toBe(1); expect(adopt).toHaveBeenCalledTimes(2);
  });
});
