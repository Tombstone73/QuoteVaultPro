import { randomUUID } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, expect, jest, test } from "@jest/globals";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../db";
import * as schema from "@shared/schema";
import { storageApplicationService } from "../services/storage/StorageApplicationService";
import { storageRegistry } from "../services/storage/StorageRegistry";
import { resolveLocalStoragePath } from "../services/localStoragePath";

// Only optional thumbnails are stubbed. Original file upload, verification,
// storage placement, reads, HTTP handlers, version persistence and locks are real.
jest.unstable_mockModule("../services/assets/AssetPreviewGenerator", () => ({ assetPreviewGenerator: { generateCanonicalFilePreviews: async () => "failed" } }));
let app: express.Express, proofing: typeof import("../services/proofingService");
let org: string, actor: string, customer: string, product: string;
const root = path.resolve("node_modules/.cache/proof-file-validation", randomUUID());
const previousRoot = process.env.FILE_STORAGE_ROOT;
beforeAll(async () => {
  process.env.FILE_STORAGE_ROOT = root; await mkdir(root, { recursive: true });
  org = randomUUID(); actor = randomUUID();
  await db.insert(schema.organizations).values({ id: org, name: "Synthetic proof readback", slug: org, settings: { preferences: { proofing: { policy: "manual_requested_only" } } } } as any);
  await db.insert(schema.users).values({ id: actor, email: `${actor}@example.test`, role: "admin" });
  await db.insert(schema.userOrganizations).values({ userId: actor, organizationId: org, role: "admin" });
  [{ id: customer }] = await db.insert(schema.customers).values({ organizationId: org, companyName: "Synthetic proof buyer", creditLimit: "100000", creditLimitConfiguredAt: new Date() }).returning();
  [{ id: product }] = await db.insert(schema.products).values({ organizationId: org, name: "Synthetic stickers", description: "Isolated test" }).returning();
  const [canonical] = await db.insert(schema.storageProviderConfigs).values({ organizationId: org, providerType: "local_filesystem", role: "canonical", status: "validated", displayName: "Isolated test files", configJson: {} }).returning();
  const [intake] = await db.insert(schema.storageProviderConfigs).values({ organizationId: org, providerType: "local_filesystem", role: "intake", status: "validated", displayName: "Isolated intake", configJson: {} }).returning();
  await db.insert(schema.organizationStorageProfiles).values({ organizationId: org, mode: "byos_local", status: "active", primaryProviderConfigId: canonical.id, intakeProviderConfigId: intake.id });
  await db.insert(schema.stations).values(["prepress", "roll", "flatbed"].map(key => ({ id: randomUUID(), organizationId: org, key, name: key, active: true })));
  const auth = (req: any, res: any, next: any) => { if (req.headers["x-unauthenticated"]) return res.sendStatus(401); req.user = { id: actor, role: "admin" }; next(); };
  const tenant = (req: any, _res: any, next: any) => { req.organizationId = req.headers["x-test-org"] || org; req.orgRole = "admin"; next(); };
  app = express(); app.use(express.json());
  const { registerProofingRoutes } = await import("../routes/proofing.routes");
  registerProofingRoutes(app, { isAuthenticated: auth, tenantContext: tenant, isAdmin: auth, assertInternalUser: () => true });
  proofing = await import("../services/proofingService");
}, 120000);
afterAll(async () => {
  jest.restoreAllMocks();
  if (!root.startsWith(path.resolve("node_modules/.cache/proof-file-validation") + path.sep)) throw new Error("Unsafe cleanup target");
  await rm(root, { recursive: true, force: true });
  if (previousRoot === undefined) delete process.env.FILE_STORAGE_ROOT; else process.env.FILE_STORAGE_ROOT = previousRoot;
  await pool.end();
});
async function fixture() {
  const [order] = await db.insert(schema.orders).values({ organizationId: org, customerId: customer, createdByUserId: actor, orderNumber: `PROOF-QA-${randomUUID()}`, state: "open", status: "in_production", total: "10", subtotal: "10" } as any).returning();
  const [line] = await db.insert(schema.orderLineItems).values({ orderId: order.id, productId: product, description: "Synthetic stickers", quantity: 1, width: "2", height: "2", unitPrice: "10", totalPrice: "10", productType: "flatbed", requiresPrepress: true, requiresProofApproval: true, workflowState: "in_prepress", status: "new" } as any).returning();
  const buffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).png().toBuffer();
  const stored = await storageApplicationService.finalizeUpload({ organizationId: org, createdByUserId: actor, resource: { organizationId: org, resourceType: "order", resourceId: order.id, lineItemId: line.id }, source: { kind: "buffer", buffer, originalFilename: "source.png", mimeType: "image/png" }, persistLink: async (tx, stored) => {
    const [attachment] = await tx.insert(schema.orderAttachments).values({ orderId: order.id, orderLineItemId: line.id, fileRecordId: stored.fileRecord.id, fileName: "source.png", mimeType: "image/png", fileUrl: stored.legacyFileUrl, relativePath: stored.legacyRelativePath, storageProvider: stored.legacyStorageProvider, fileSize: buffer.length, role: "artwork", side: "front" }).returning();
    await tx.insert(schema.lineItemArtwork).values({ organizationId: org, orderId: order.id, lineItemId: line.id, fileRecordId: stored.fileRecord.id, role: "customer_source", side: "front", origin: "staff_upload", allocationQuantity: 1 });
    return attachment;
  } });
  return { order, line, stored };
}
const generate = (lineId: string, key = randomUUID()) => request(app).post(`/api/proofing/line-item/${lineId}/versions`).set("Idempotency-Key", key).send({ mode: "generated" });
test("generation stores a readable PDF; concurrent/replayed requests create one version; authenticated access and history stay exact", async () => {
  const f = await fixture(), key = randomUUID();
  const responses = await Promise.all([generate(f.line.id, key), generate(f.line.id, key)]);
  expect(responses.map(r => ({ status: r.status, error: r.body.error }))).toEqual([{ status: 200, error: undefined }, { status: 200, error: undefined }]);
  const first = responses[0].body.data.proofVersion;
  expect(responses[1].body.data.proofVersion.id).toBe(first.id);
  expect(await db.select().from(schema.lineItemProofVersions).where(eq(schema.lineItemProofVersions.lineItemId, f.line.id))).toHaveLength(1);
  const metadata = await request(app).get(`/api/proofing/versions/${first.id}/file`);
  expect(metadata.body.data).toMatchObject({ id: first.proofFileId, available: true });
  const read = await request(app).get(metadata.body.data.authenticatedUrl);
  expect(read.status).toBe(200); expect((await PDFDocument.load(read.body)).getPageCount()).toBeGreaterThan(0);
  expect((await request(app).get(metadata.body.data.authenticatedUrl).set("x-unauthenticated", "1")).status).toBe(401);
  expect((await request(app).get(metadata.body.data.authenticatedUrl).set("x-test-org", randomUUID())).status).toBe(404);
  const next = await generate(f.line.id);
  expect(next.status).toBe(200); expect(next.body.data.proofVersion.id).not.toBe(first.id);
  const history = await proofing.resolveLineItemProofingTruth(db, { organizationId: org, lineItemId: f.line.id });
  expect(history.proofVersionHistory).toHaveLength(2);
  await writeFile("node_modules/.cache/proof-browser-data.json", JSON.stringify({
    queue: await proofing.listProofingQueue(db, { organizationId: org }), detail: history,
    order: { ...f.order, lineItems: [f.line] }, file: (await request(app).get(`/api/proofing/versions/${next.body.data.proofVersion.id}/file`)).body.data,
    pdf: read.body.toString("base64"),
  }));
  const historicalRead = await request(app).get(metadata.body.data.authenticatedUrl);
  expect(historicalRead.body).toEqual(read.body);
  // Canonical send and approval continue to own the workflow (no customer email is sent).
  const versionId = next.body.data.proofVersion.id;
  await db.transaction(tx => proofing.markProofVersionSent(tx, { organizationId: org, proofVersionId: versionId, actorUserId: actor }));
  await db.transaction(tx => proofing.recordProofResponse(tx, { organizationId: org, proofVersionId: versionId, actorUserId: actor, decision: "approved" }));
  expect((await proofing.resolveLineItemProofingTruth(db, { organizationId: org, lineItemId: f.line.id })).approvedProofVersionId).toBe(versionId);
}, 120000);
test("acknowledged upload with failed original readback publishes no ready version", async () => {
  const f = await fixture();
  const failure = jest.spyOn(storageRegistry.getAdapter("local_filesystem"), "readObject").mockRejectedValueOnce(new Error("Synthetic readback unavailable"));
  const response = await generate(f.line.id); failure.mockRestore();
  expect(response.status).toBe(409); expect(response.body.reason).toBe("PROOF_FILE_UNAVAILABLE");
  expect(await db.select().from(schema.lineItemProofVersions).where(eq(schema.lineItemProofVersions.lineItemId, f.line.id))).toHaveLength(0);
}, 120000);
test("changed order inputs during generation cannot publish a proof of stale specifications", async () => {
  const f = await fixture();
  const adapter = storageRegistry.getAdapter("local_filesystem");
  const put = adapter.putObject.bind(adapter);
  const change = jest.spyOn(adapter, "putObject").mockImplementationOnce(async input => {
    const result = await put(input);
    await db.update(schema.orderLineItems).set({ quantity: 2, updatedAt: new Date() }).where(eq(schema.orderLineItems.id, f.line.id));
    return result;
  });
  const response = await generate(f.line.id); change.mockRestore();
  expect(response.status).toBe(409); expect(response.body.reason).toBe("PROOF_SOURCE_CHANGED");
  expect(await db.select().from(schema.lineItemProofVersions).where(eq(schema.lineItemProofVersions.lineItemId, f.line.id))).toHaveLength(0);
}, 120000);
test("legacy original remains readable and a missing reference is never ready", async () => {
  const f = await fixture(), created = await generate(f.line.id); expect(created.status).toBe(200);
  const version = created.body.data.proofVersion;
  await db.update(schema.orderAttachments).set({ fileRecordId: null }).where(eq(schema.orderAttachments.id, version.proofFileId));
  expect((await request(app).get(`/api/proofing/versions/${version.id}/file`)).body.data.available).toBe(true);
  await db.update(schema.orderAttachments).set({ fileUrl: "", relativePath: null }).where(eq(schema.orderAttachments.id, version.proofFileId));
  expect((await request(app).get(`/api/proofing/versions/${version.id}/file`)).body.data.available).toBe(false);
}, 120000);
test("a changed request cannot reuse a successful generation identity", async () => {
  const f = await fixture(), key = randomUUID(); expect((await generate(f.line.id, key)).status).toBe(200);
  const response = await request(app).post(`/api/proofing/line-item/${f.line.id}/versions`).set("Idempotency-Key", key).send({ mode: "generated", internalNotes: "Changed intent" });
  expect(response.status).toBe(409); expect(response.body.reason).toBe("PROOF_GENERATION_REQUEST_CHANGED");
  expect(await db.select().from(schema.lineItemProofVersions).where(eq(schema.lineItemProofVersions.lineItemId, f.line.id))).toHaveLength(1);
}, 120000);
test("combined proof generation reads back a durable multi-page original without blocking storage's attachment transaction", async () => {
  const f = await fixture();
  const [second] = await db.insert(schema.orderLineItems).values({ orderId: f.order.id, productId: product, description: "Second synthetic line", quantity: 1, width: "3", height: "2", unitPrice: "10", totalPrice: "10", productType: "flatbed", requiresPrepress: true, requiresProofApproval: true, workflowState: "in_prepress", status: "new" } as any).returning();
  await db.insert(schema.lineItemArtwork).values({ organizationId: org, orderId: f.order.id, lineItemId: second.id, fileRecordId: f.stored.fileRecord.id, role: "customer_source", side: "front", origin: "staff_upload", allocationQuantity: 1 });
  await db.insert(schema.orderAttachments).values({ orderId: f.order.id, orderLineItemId: second.id, fileRecordId: f.stored.fileRecord.id, fileName: "source.png", mimeType: "image/png", fileUrl: f.stored.linkedRecord.fileUrl, relativePath: f.stored.linkedRecord.relativePath, storageProvider: f.stored.linkedRecord.storageProvider, fileSize: f.stored.linkedRecord.fileSize, role: "artwork", side: "front" });
  const key = randomUUID();
  const generateCombined = () => request(app).post("/api/proofing/combined/versions").set("Idempotency-Key", key).send({ lineItemIds: [f.line.id, second.id] });
  const first = await generateCombined(); expect({ status: first.status, error: first.body.error }).toEqual({ status: 200, error: undefined });
  expect((await generateCombined()).body.data.proofVersion.id).toBe(first.body.data.proofVersion.id);
  const original = await proofing.readProofVersionFile(db, { organizationId: org, proofVersionId: first.body.data.proofVersion.id });
  expect((await PDFDocument.load(original.buffer)).getPageCount()).toBe(2);
}, 120000);
test("upload failure publishes no version and the same request can safely retry", async () => {
  const f = await fixture(), key = randomUUID();
  const failure = jest.spyOn(storageRegistry.getAdapter("local_filesystem"), "putObject").mockRejectedValueOnce(new Error("Synthetic storage upload unavailable"));
  const response = await generate(f.line.id, key); expect(response.status).toBe(500);
  expect(response.body.error).toContain("Synthetic storage upload unavailable"); failure.mockRestore();
  expect(await db.select().from(schema.lineItemProofVersions).where(eq(schema.lineItemProofVersions.lineItemId, f.line.id))).toHaveLength(0);
  expect((await generate(f.line.id, key)).status).toBe(200);
}, 120000);
test("missing original blocks readiness/readback and send without mutating proof history", async () => {
  const f = await fixture(), created = await generate(f.line.id); expect(created.status).toBe(200);
  const version = created.body.data.proofVersion;
  const [attachment] = await db.select().from(schema.orderAttachments).where(eq(schema.orderAttachments.id, version.proofFileId));
  const [placement] = await db.select().from(schema.storagePlacements).where(and(eq(schema.storagePlacements.fileRecordId, attachment.fileRecordId!), eq(schema.storagePlacements.placementState, "active")));
  await unlink(resolveLocalStoragePath(placement.localPathRef!));
  const metadata = await request(app).get(`/api/proofing/versions/${version.id}/file`);
  expect(metadata.body.data.available).toBe(false);
  expect((await request(app).get(metadata.body.data.authenticatedUrl)).status).toBe(409);
  await expect(db.transaction(tx => proofing.markProofVersionSent(tx, { organizationId: org, proofVersionId: version.id, actorUserId: actor }))).rejects.toMatchObject({ code: "PROOF_FILE_UNAVAILABLE" });
  const [saved] = await db.select().from(schema.lineItemProofVersions).where(eq(schema.lineItemProofVersions.id, version.id));
  expect(saved.status).toBe("draft");
}, 120000);
