import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { ArtworkUploadService, type ArtworkUploadInput } from "../../infrastructure/artwork/artworkUploadService";
import type { ArtworkBinaryStorage } from "../../infrastructure/artwork/artworkBinaryStorage";
import type { ArtworkStorageUploadLedger } from "../../infrastructure/artwork/artworkStorageUploadLedger";
import { ArtworkApplicationService, type ArtworkTransaction, type ArtworkTransactionRunner } from "../../src/modules/artwork/artworkApplication";
import type { ArtworkAssignment, ArtworkFile, ArtworkMutationResult } from "../../src/modules/artwork/contracts";
import type { OperationContext } from "../../src/application/operation";
import type { Capability } from "../../src/authorization/capabilities";
import { V2ApplicationError } from "../../src/errors/applicationError";
import { PortalArtworkApplicationService } from "../../src/modules/portal/portalArtwork";

const context = (id = "request-a") => ({ organizationId: "org-a", operationId: "test", businessRequest: { id, payloadFingerprint: "test" }, principal: { kind: "staff" as const, organizationId: "org-a", userId: "staff", authority: { membershipId: "member", capabilities: ["artwork.adopt"] as Capability[] } } });
let knownFixturePdf: Buffer; let validPdf: Buffer;
beforeAll(async () => {
  knownFixturePdf = Buffer.from(await readFile(new URL("../fixtures/p7-qa-artwork.pdf", import.meta.url)));
  const document = await PDFDocument.create(); const page = document.addPage([144, 144]); const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Print-ready artwork", { x: 18, y: 72, font, size: 12 }); validPdf = Buffer.from(await document.save());
});
const input = (overrides: Partial<ArtworkUploadInput> = {}): ArtworkUploadInput => ({ businessRequestId: "request-a", orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front", filename: "qa-art.pdf", contentType: "application/pdf", bytes: Buffer.from(validPdf), ...overrides });

class MemoryStorage implements ArtworkBinaryStorage {
  readonly objects = new Map<string, Buffer>(); readonly contentTypes = new Map<string, string>(); readonly removed: string[] = [];
  failPut = false; failRemove = false; afterPut = () => {};
  constructor(private readonly effects: string[]) {}
  async put(value: Parameters<ArtworkBinaryStorage["put"]>[0]) {
    this.effects.push("put"); if (this.failPut) throw Error("unavailable");
    const created = !this.objects.has(value.objectKey); this.objects.set(value.objectKey, value.bytes); this.contentTypes.set(value.objectKey, value.contentType);
    this.afterPut(); return { storageProvider: "supabase" as const, objectKey: value.objectKey, created };
  }
  async remove(key: string) { this.effects.push("remove"); if (this.failRemove) throw Error("unavailable"); this.removed.push(key); this.objects.delete(key); }
  async exists(key: string) { this.effects.push("exists"); return this.objects.has(key); }
}
class MemoryUploads implements ArtworkStorageUploadLedger {
  readonly rows = new Map<string, { state: string; created: boolean; fileId?: string }>();
  constructor(private readonly effects: string[]) {}
  async reserve(input: Parameters<ArtworkStorageUploadLedger["reserve"]>[0]) { this.effects.push("reserve"); const id = `intent:${input.objectKey}`; this.rows.set(id, { state: "pending_write", created: input.objectExpectedToBeCreated }); return { id, organizationId: input.organizationId, storageProvider: input.storageProvider, objectKey: input.objectKey, requestIdentity: input.requestIdentity, expectedChecksumSha256: input.expectedChecksumSha256, expectedContentType: input.expectedContentType, expectedByteSize: input.expectedByteSize, state: "pending_write" as const, objectCreatedByIntent: input.objectExpectedToBeCreated, cleanupAttempts: 0 }; }
  async markStored(input: Parameters<ArtworkStorageUploadLedger["markStored"]>[0]) { this.effects.push("markStored"); const row = this.rows.get(input.intentId)!; row.state = "stored"; row.created ||= input.objectCreatedByIntent; }
  async markAdopted(input: Parameters<ArtworkStorageUploadLedger["markAdopted"]>[0]) { this.effects.push("markAdopted"); const row = this.rows.get(input.intentId)!; row.state = "adopted"; row.fileId = input.artworkFileId; }
  async markCleanupPending(input: Parameters<ArtworkStorageUploadLedger["markCleanupPending"]>[0]) { this.effects.push("markCleanupPending"); const row = this.rows.get(input.intentId)!; row.state = "cleanup_pending"; }
  async markCleaned(input: Parameters<ArtworkStorageUploadLedger["markCleaned"]>[0]) { this.effects.push("markCleaned"); const row = this.rows.get(input.intentId)!; row.state = "cleaned"; }
  async claimStale() { this.effects.push("claimStale"); return []; }
  async listStale() { this.effects.push("listStale"); return []; }
  async markRetained() { this.effects.push("markRetained"); }
  async findCanonicalArtworkFileId() { this.effects.push("findCanonicalArtworkFileId"); return null; }
  async recordCleanupFailure() { this.effects.push("recordCleanupFailure"); }
}
class MemoryArtworkTransaction implements ArtworkTransaction {
  readonly files = new Map<string, ArtworkFile>(); readonly assignments = new Map<string, ArtworkAssignment>();
  readonly requests = new Map<string, { fingerprint: string; result: ArtworkMutationResult | null }>();
  readonly audits: Parameters<ArtworkTransaction["audit"]>[0][] = [];
  readonly attributions: Parameters<ArtworkTransaction["attribute"]>[0][] = [];
  readonly reservations: Parameters<ArtworkTransaction["reserve"]>[0][] = [];
  rejectReservation = false;
  async reserve(value: Parameters<ArtworkTransaction["reserve"]>[0]) {
    this.reservations.push(value);
    if (this.rejectReservation) throw new V2ApplicationError("CONFLICT", "Artwork state changed.");
    const id = `${value.organizationId}:${value.operation}:${value.businessRequestId}`;
    const prior = this.requests.get(id);
    if (prior && prior.fingerprint !== value.payloadFingerprint) throw new V2ApplicationError("CONFLICT", "Request payload changed.");
    if (prior?.result) return { kind: "replay" as const, request: { id, resultJson: prior.result } };
    this.requests.set(id, { fingerprint: value.payloadFingerprint, result: null });
    return { kind: "new" as const, request: { id, resultJson: null } };
  }
  async succeed(_organizationId: string, id: string, result: ArtworkMutationResult) { this.requests.get(id)!.result = result; }
  async attribute(value: Parameters<ArtworkTransaction["attribute"]>[0]) { this.attributions.push(value); }
  async audit(value: Parameters<ArtworkTransaction["audit"]>[0]) { this.audits.push(value); }
  async findFile(_organizationId: Parameters<ArtworkTransaction["findFile"]>[0], id: Parameters<ArtworkTransaction["findFile"]>[1]) { return this.files.get(id) ?? null; }
  async findOrderLineArtwork() { return []; }
  async findOrderArtwork() { return []; }
  async removeAssignment(): Promise<ArtworkMutationResult> { throw Error("Not used by upload"); }
  async createOrGetFile(value: Parameters<ArtworkTransaction["createOrGetFile"]>[0]) {
    const prior = [...this.files.values()].find(file => file.objectReference.objectKey === value.file.objectReference.objectKey);
    if (prior) return prior;
    const file: ArtworkFile = { ...value.file, id: value.id, organizationId: value.organizationId, displayFilename: value.file.displayFilename ?? value.file.originalFilename, createdAt: "now" };
    this.files.set(file.id, file); return file;
  }
  async createOrGetAssignment(value: Parameters<ArtworkTransaction["createOrGetAssignment"]>[0]) {
    const assignment: ArtworkAssignment = { ...value.usage, id: value.id, organizationId: value.organizationId, artworkFileId: value.artworkFileId, createdAt: "now" };
    this.assignments.set(assignment.id, assignment); return assignment;
  }
  async createOrGetReplacementAssignment(value: Parameters<ArtworkTransaction["createOrGetReplacementAssignment"]>[0]) {
    const predecessor = this.assignments.get(value.supersedesArtworkAssignmentId);
    if (!predecessor || predecessor.orderId !== value.usage.orderId || predecessor.orderLineId !== value.usage.orderLineId) throw new V2ApplicationError("CONFLICT", "Replacement target changed.");
    const assignment = { ...await this.createOrGetAssignment(value), supersedesArtworkAssignmentId: value.supersedesArtworkAssignmentId };
    this.assignments.set(assignment.id, assignment); return assignment;
  }
}
const setup = () => {
  const effects: string[] = []; const storage = new MemoryStorage(effects); const uploads = new MemoryUploads(effects); const tx = new MemoryArtworkTransaction();
  const runner: ArtworkTransactionRunner = { transaction: async action => action(tx) };
  const transaction = jest.spyOn(runner, "transaction");
  const artwork = new ArtworkApplicationService(runner);
  return { effects, storage, uploads, tx, transaction, artwork, service: new ArtworkUploadService(artwork, storage, uploads) };
};

describe("Artwork binary adoption through the actual owner", () => {
  test("stores a bounded PDF then adopts through the existing Artwork service", async () => {
    const { service, storage, uploads, tx, effects } = setup();
    const result = await service.upload(context(), input());
    expect(result).toMatchObject({ ok: true, value: { artworkFile: { source: "customer_upload", checksum: { algorithm: "sha256" } }, assignment: { orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front" } } });
    expect(storage.objects.size).toBe(1); expect(tx.files.size).toBe(1); expect(tx.assignments.size).toBe(1);
    expect([...uploads.rows.values()]).toEqual([expect.objectContaining({ state: "adopted", fileId: [...tx.files.keys()][0] })]);
    expect(effects).toEqual(["exists", "reserve", "put", "markStored", "markAdopted"]);
  });

  test("accepts the repository's known-small structural PDF fixture", async () => {
    const { service, tx } = setup();
    expect(await service.upload(context(), input({ bytes: knownFixturePdf }))).toMatchObject({ ok: true });
    expect(tx.files.size).toBe(1);
  });

  test("accepts a structurally valid PDF when the browser reports a generic MIME type", async () => {
    const { service, storage } = setup();
    expect(await service.upload(context(), input({ contentType: "application/octet-stream" }))).toMatchObject({ ok: true });
    expect([...storage.contentTypes.values()]).toEqual(["application/pdf"]);
  });

  test.each([
    ["empty", () => Buffer.alloc(0), "EMPTY_FILE"],
    ["renamed non-PDF", () => Buffer.from("PNG"), "NOT_PDF"],
    ["signature-only malformed PDF", () => Buffer.from("%PDF-1.4\nqa"), "CORRUPT_PDF"],
    ["oversized PDF", () => Buffer.alloc(10 * 1024 * 1024 + 1, 1), "SIZE_LIMIT"],
    ["truncated PDF", () => validPdf.subarray(0, validPdf.length - 32), "CORRUPT_PDF"],
  ] as const)("rejects %s before storage or assignment", async (_label, bytes, code) => {
    const { service, effects, transaction } = setup();
    expect(await service.upload(context(), input({ bytes: bytes() }))).toMatchObject({ ok: false, error: { code } });
    expect(effects).toEqual([]); expect(transaction).not.toHaveBeenCalled();
  });

  describe.each(["upload", "replace"] as const)("%s admission and final authority", operation => {
    const execute = (service: ArtworkUploadService, ctx: OperationContext, value = input()) => service[operation](ctx, { ...value, supersedesArtworkAssignmentId: "current-assignment" });
    test.each([
      ["missing capability", () => ({ ...context(), principal: { ...context().principal, authority: { membershipId: "member", capabilities: [] } } }), "request-a", "FORBIDDEN"],
      ["foreign tenant", () => ({ ...context(), organizationId: "other-org" }), "request-a", "WRONG_TENANT"],
      ["missing context request", () => ({ ...context(), businessRequest: undefined }), "request-a", "VALIDATION_ERROR"],
      ["mismatched request", () => context("other-request"), "request-a", "VALIDATION_ERROR"],
      ["empty request", () => context(""), "", "VALIDATION_ERROR"],
      ["whitespace-only request", () => context(" \t "), " \t ", "VALIDATION_ERROR"],
    ] as const)("rejects %s with zero storage/ledger calls or transactions", async (_label, ctx, requestId, code) => {
      const { service, effects, transaction, tx } = setup();
      expect(await execute(service, ctx(), input({ businessRequestId: requestId }))).toMatchObject({ ok: false, error: { code } });
      expect(effects).toEqual([]); expect(transaction).not.toHaveBeenCalled(); expect(tx.reservations).toEqual([]);
    });

    test("rejects a missing input request identity before storage/ledger calls or transactions", async () => {
      const { service, effects, transaction } = setup(); const value = input();
      Reflect.deleteProperty(value, "businessRequestId");
      expect(await execute(service, context(), value)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
      expect(effects).toEqual([]); expect(transaction).not.toHaveBeenCalled();
    });

    test.each([
      ["revoked capability", (ctx: ReturnType<typeof context>) => { ctx.principal.authority.capabilities.length = 0; }, "FORBIDDEN"],
      ["changed tenant scope", (ctx: ReturnType<typeof context>) => { ctx.principal.organizationId = "other-org"; }, "WRONG_TENANT"],
      ["changed request identity", (ctx: ReturnType<typeof context>) => { ctx.businessRequest.id = "changed"; }, "VALIDATION_ERROR"],
    ] as const)("rechecks %s after preflight and cleans only the newly stored object", async (_label, change, code) => {
      const { service, storage, uploads, effects, transaction } = setup(); const ctx = context();
      storage.afterPut = () => change(ctx);
      expect(await execute(service, ctx)).toMatchObject({ ok: false, error: { code } });
      expect(transaction).not.toHaveBeenCalled(); expect(storage.objects.size).toBe(0);
      expect(effects).toEqual(["exists", "reserve", "put", "markStored", "remove", "markCleaned"]);
      expect([...uploads.rows.values()]).toEqual([expect.objectContaining({ state: "cleaned" })]);
    });
  });

  test("leaves cleanup pending when deletion fails after final authority is revoked", async () => {
    const { service, storage, uploads, transaction } = setup(); const ctx = context();
    storage.afterPut = () => { ctx.principal.authority.capabilities.length = 0; }; storage.failRemove = true;
    expect(await service.upload(ctx, input())).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(storage.objects.size).toBe(1); expect(transaction).not.toHaveBeenCalled();
    expect([...uploads.rows.values()]).toEqual([expect.objectContaining({ state: "cleanup_pending" })]);
  });

  test("still reserves the request at final adoption and cleans up on a state conflict", async () => {
    const { service, storage, tx, transaction } = setup();
    storage.afterPut = () => { tx.rejectReservation = true; };
    expect(await service.upload(context(), input())).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(transaction).toHaveBeenCalledTimes(1); expect(tx.reservations).toHaveLength(1);
    expect(tx.assignments.size).toBe(0); expect(storage.objects.size).toBe(0); expect(storage.removed).toHaveLength(1);
  });

  test("retains deterministic object identity, exact replay and payload conflict behavior", async () => {
    const { service, storage, tx, transaction, effects } = setup();
    const first = await service.upload(context(), input());
    expect(first.ok).toBe(true);
    expect(await service.upload(context(), input())).toEqual(first);
    const key = `v2-artwork/org-a/${createHash("sha256").update(validPdf).digest("hex")}.pdf`;
    expect([...storage.objects.keys()]).toEqual([key]); expect(tx.files.size).toBe(1); expect(tx.assignments.size).toBe(1);
    expect(tx.audits).toHaveLength(1); expect(tx.attributions).toHaveLength(1); expect(transaction).toHaveBeenCalledTimes(2);
    expect(await service.upload(context(), input({ filename: "changed.pdf" }))).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(storage.objects.size).toBe(1); expect(storage.removed).toEqual([]); expect(tx.audits).toHaveLength(1);
    const before = effects.length; const denied = context(); denied.principal.authority.capabilities = [];
    expect(await service.upload(denied, input())).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(effects).toHaveLength(before); expect(transaction).toHaveBeenCalledTimes(3);
  });

  test("does not delete an existing object when final replay authorization fails", async () => {
    const { service, storage, tx, transaction } = setup();
    expect((await service.upload(context(), input())).ok).toBe(true);
    const ctx = context(); storage.afterPut = () => { ctx.principal.authority.capabilities = []; };
    expect(await service.upload(ctx, input())).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(storage.objects.size).toBe(1); expect(storage.removed).toEqual([]); expect(transaction).toHaveBeenCalledTimes(1); expect(tx.audits).toHaveLength(1);
  });

  test("uses canonical replacement with an exact predecessor and preserves replacement replay", async () => {
    const { service, storage, tx } = setup();
    const first = await service.upload(context(), input()); if (!first.ok) throw Error("setup");
    const value = { ...input({ businessRequestId: "replace-a", bytes: knownFixturePdf }), supersedesArtworkAssignmentId: first.value.assignment.id };
    const replacement = await service.replace(context("replace-a"), value);
    expect(replacement).toMatchObject({ ok: true, value: { assignment: { supersedesArtworkAssignmentId: first.value.assignment.id } } });
    expect(await service.replace(context("replace-a"), value)).toEqual(replacement);
    expect(tx.assignments.get(first.value.assignment.id)).toEqual(first.value.assignment);
    expect(storage.objects.size).toBe(2); expect(tx.files.size).toBe(2); expect(tx.assignments.size).toBe(2); expect(tx.audits).toHaveLength(2);
    expect(tx.reservations.map(value => value.operation)).toEqual(["artwork.adopt.v1", "artwork.replace.v1", "artwork.replace.v1"]);
  });

  test("rejects replacement without an exact assignment before storage", async () => {
    const { service, effects, transaction } = setup();
    expect(await service.replace(context(), { ...input(), supersedesArtworkAssignmentId: " " })).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(effects).toEqual([]); expect(transaction).not.toHaveBeenCalled();
  });

  test("preserves customer-scoped Portal delegation through upload, replacement and replay", async () => {
    const { service, tx, storage } = setup();
    const ownership = { assertActiveOwnedOrderLine: jest.fn(async () => {}), assertCurrentOwnedCustomerSuppliedArtwork: jest.fn(async () => {}) };
    const portal = new PortalArtworkApplicationService(ownership, service);
    const principal = { kind: "portal" as const, organizationId: "org-a", customerId: "customer-a", subjectId: "portal-a", capabilities: ["order.create"] as const };
    const first = await portal.upload(principal, input()); if (!first.ok) throw Error("Portal setup failed");
    const value = { ...input({ businessRequestId: "portal-replace", bytes: knownFixturePdf }), supersedesArtworkAssignmentId: first.value.assignment.id };
    const replacement = await portal.upload(principal, value);
    expect(replacement).toMatchObject({ ok: true, value: { assignment: { supersedesArtworkAssignmentId: first.value.assignment.id } } });
    expect(await portal.upload(principal, value)).toEqual(replacement);
    expect(ownership.assertActiveOwnedOrderLine).toHaveBeenCalledWith(principal, "order-a", "line-a");
    expect(ownership.assertCurrentOwnedCustomerSuppliedArtwork).toHaveBeenCalledWith(principal, "order-a", "line-a", first.value.assignment.id);
    expect(tx.reservations.every(value => value.principalKind === "portal" && value.principalSubject === "portal-a")).toBe(true);
    expect(principal.capabilities).toEqual(["order.create"]); expect(storage.objects.size).toBe(2); expect(tx.audits).toHaveLength(2);
  });
});
