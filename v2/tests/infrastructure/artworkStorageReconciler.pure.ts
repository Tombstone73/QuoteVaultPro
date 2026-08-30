import assert from "node:assert/strict";
import { ArtworkStorageReconciler } from "../../infrastructure/artwork/artworkStorageReconciler.js";
import type { ArtworkBinaryStorage } from "../../infrastructure/artwork/artworkBinaryStorage.js";
import type { ArtworkStorageUploadIntent, ArtworkStorageUploadLedger } from "../../infrastructure/artwork/artworkStorageUploadLedger.js";

const base = (overrides: Partial<ArtworkStorageUploadIntent> = {}): ArtworkStorageUploadIntent => ({ id: "intent-a", organizationId: "org-a", storageProvider: "supabase", objectKey: "v2-artwork/org-a/a.pdf", requestIdentity: "request-a", expectedChecksumSha256: "a".repeat(64), expectedContentType: "application/pdf", expectedByteSize: 1, state: "stored", objectCreatedByIntent: true, cleanupAttempts: 0, reconciliationLeaseToken: "lease-a", ...overrides });
class Ledger implements ArtworkStorageUploadLedger {
  constructor(readonly candidates: ArtworkStorageUploadIntent[], readonly references = new Map<string, string>()) {}
  cleaned: string[] = []; retained: string[] = []; failures: string[] = []; adopted: string[] = [];
  async reserve(): Promise<ArtworkStorageUploadIntent> { return base(); }
  async markStored(): Promise<void> {}
  async markAdopted(input: { intentId: string }): Promise<void> { this.adopted.push(input.intentId); }
  async markCleanupPending(): Promise<void> {}
  async markCleaned(input: { intentId: string }): Promise<void> { this.cleaned.push(input.intentId); }
  async markRetained(input: { intentId: string }): Promise<void> { this.retained.push(input.intentId); }
  async listStale(): Promise<readonly ArtworkStorageUploadIntent[]> { return this.candidates; }
  async claimStale(): Promise<readonly ArtworkStorageUploadIntent[]> { return this.candidates; }
  async findCanonicalArtworkFileId(input: { objectKey: string }): Promise<string | null> { return this.references.get(input.objectKey) ?? null; }
  async recordCleanupFailure(input: { intentId: string }): Promise<void> { this.failures.push(input.intentId); }
}
class Storage implements ArtworkBinaryStorage {
  objects = new Set<string>(); failDelete = false; removed: string[] = [];
  async put() { return { storageProvider: "supabase" as const, objectKey: "unused", created: true }; }
  async remove(key: string): Promise<void> { if (this.failDelete) throw new Error("unavailable"); this.removed.push(key); this.objects.delete(key); }
  async exists(key: string): Promise<boolean> { return this.objects.has(key); }
  async read(): Promise<Buffer> { return Buffer.alloc(0); }
}

const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
{
  const ledger = new Ledger([base()]); const storage = new Storage(); storage.objects.add("v2-artwork/org-a/a.pdf");
  const result = await new ArtworkStorageReconciler(ledger, storage).reconcile({ olderThan: old, limit: 10, leaseMs: 1000 });
  assert.equal(result.deleted, 1); assert.deepEqual(storage.removed, ["v2-artwork/org-a/a.pdf"]); assert.deepEqual(ledger.cleaned, ["intent-a"]);
}
{
  const candidate = base({ objectKey: "v2-artwork/org-a/referenced.pdf" }); const ledger = new Ledger([candidate], new Map([[candidate.objectKey, "file-a"]])); const storage = new Storage(); storage.objects.add(candidate.objectKey);
  const result = await new ArtworkStorageReconciler(ledger, storage).reconcile({ olderThan: old, limit: 10, leaseMs: 1000 });
  assert.equal(result.adopted, 1); assert.equal(storage.removed.length, 0); assert.deepEqual(ledger.adopted, ["intent-a"]);
}
{
  const candidate = base({ objectCreatedByIntent: false }); const ledger = new Ledger([candidate]); const storage = new Storage(); storage.objects.add(candidate.objectKey);
  const result = await new ArtworkStorageReconciler(ledger, storage).reconcile({ olderThan: old, limit: 10, leaseMs: 1000 });
  assert.equal(result.retained, 1); assert.equal(storage.removed.length, 0);
}
{
  const ledger = new Ledger([base()]); const storage = new Storage(); storage.objects.add("v2-artwork/org-a/a.pdf"); storage.failDelete = true;
  const result = await new ArtworkStorageReconciler(ledger, storage).reconcile({ olderThan: old, limit: 10, leaseMs: 1000 });
  assert.equal(result.deleteFailed, 1); assert.deepEqual(ledger.failures, ["intent-a"]);
}
console.log("artworkStorageReconciler.pure: PASS");
