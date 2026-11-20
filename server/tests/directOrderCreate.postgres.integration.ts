import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, expect, jest, test } from "@jest/globals";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db, pool } from "../db";
import { storage } from "../storage";
import { createUploadSession, finalizeUploadSession, writeUploadChunkFromStream } from "../services/chunkedUploads";

// Keep attachment persistence and proofing real. Only optional derivatives are stubbed.
jest.unstable_mockModule("../services/thumbnailGenerator", () => ({
  ensureSharp: async () => true,
  generateImageDerivatives: jest.fn(), isSupportedImageType: () => false, isThumbnailGenerationEnabled: () => false,
}));
jest.unstable_mockModule("../workers/thumbnailWorker", () => ({ triggerThumbnailGenerationForAttachment: jest.fn() }));
jest.unstable_mockModule("../services/assets/AssetPreviewGenerator", () => ({
  assetPreviewGenerator: { generateCanonicalFilePreviews: async () => "failed" },
}));

const org = randomUUID();
const actor = randomUUID();
const cache = path.resolve("node_modules/.cache/inbound-pg-validation");
const previousStorage = process.env.FILE_STORAGE_ROOT;
const previousTemp = process.env.FILE_UPLOAD_TEMP_ROOT;
let root: string | undefined;
let buyer: string;
let product: string;
let app: express.Express;

beforeAll(async () => {
  root = await mkdtemp(path.join(cache, "direct-order-"));
  process.env.FILE_STORAGE_ROOT = root;
  process.env.FILE_UPLOAD_TEMP_ROOT = path.join(root, "temp");
  await db.insert(schema.organizations).values({
    id: org, name: "Synthetic Direct Order", slug: org,
    settings: { preferences: { proofing: { policy: "manual_requested_only" } } },
  } as typeof schema.organizations.$inferInsert);
  await db.insert(schema.users).values({ id: actor, email: `${actor}@example.test`, role: "admin" });
  await db.insert(schema.userOrganizations).values({ userId: actor, organizationId: org, role: "admin" });
  [{ id: buyer }] = await db.insert(schema.customers).values({
    organizationId: org, companyName: "Synthetic buyer", creditLimit: "100000", creditLimitConfiguredAt: new Date(),
  }).returning();
  [{ id: product }] = await db.insert(schema.products).values({
    organizationId: org, name: "Synthetic direct-create product", description: "Isolated fixture", isTaxable: false,
  }).returning();
  await db.insert(schema.stations).values(["design", "prepress", "roll", "flatbed"].map(key => ({
    id: randomUUID(), organizationId: org, key, name: key, active: true,
  })));
  const [canonical, intake] = await db.insert(schema.storageProviderConfigs).values([
    { role: "canonical" as const, organizationId: org, providerType: "local_filesystem", status: "validated", displayName: "Fixture files", configJson: {} },
    { role: "intake" as const, organizationId: org, providerType: "local_filesystem", status: "validated", displayName: "Fixture intake", configJson: {} },
  ]).returning();
  await db.insert(schema.organizationStorageProfiles).values({
    organizationId: org, mode: "byos_local", status: "active", primaryProviderConfigId: canonical.id, intakeProviderConfigId: intake.id,
  });
  app = express();
  app.use(express.json());
  const middleware: express.RequestHandler = (req, _res, next) => {
    req.organizationId = org;
    req.orgRole = "admin";
    req.user = { id: actor, firstName: "Test", lastName: "Actor" } as Express.User;
    next();
  };
  const { registerOrderRoutes } = await import("../routes/orders.routes");
  await registerOrderRoutes(app, { isAuthenticated: middleware, tenantContext: middleware, isAdmin: middleware, isAdminOrOwner: middleware });
}, 120_000);

afterAll(async () => {
  jest.restoreAllMocks();
  await pool.end();
  if (root && path.dirname(root) === cache && path.basename(root).startsWith("direct-order-")) {
    await rm(root, { recursive: true, force: true });
  }
  if (previousStorage === undefined) delete process.env.FILE_STORAGE_ROOT;
  else process.env.FILE_STORAGE_ROOT = previousStorage;
  if (previousTemp === undefined) delete process.env.FILE_UPLOAD_TEMP_ROOT;
  else process.env.FILE_UPLOAD_TEMP_ROOT = previousTemp;
});

async function stagedPng(filename: string) {
  const buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const { uploadId } = await createUploadSession({
    organizationId: org, createdByUserId: actor, purpose: "order-attachment",
    filename, mimeType: "image/png", sizeBytes: buffer.length,
  });
  await writeUploadChunkFromStream({ uploadId, chunkIndex: 0, stream: Readable.from([buffer]) });
  await finalizeUploadSession({ uploadId, organizationId: org });
  return uploadId;
}

const fixture = (label: string) => ({
  label, customerId: buyer, status: "new", shippingMethod: "pickup", routeAfterSave: "save_only", discount: 2,
  lineItems: [2000, 1000].map((cents, index) => ({
    productId: product, productType: "wide_roll", description: `${label} line ${index}`,
    width: 3, height: 4, quantity: 1, unitPrice: cents / 100, totalPrice: cents / 100,
    requiresProofApproval: index === 0, sortOrder: index,
    pbv2SnapshotJson: { pricing: { totalCents: cents } },
  })),
});

const post = (body: ReturnType<typeof fixture>) => request(app).post("/api/orders").send(body);
const byLabel = (label: string) => db.select().from(schema.orders)
  .where(and(eq(schema.orders.organizationId, org), eq(schema.orders.label, label)));

test("direct create commits billed Invoice, snapshots, indexed artwork, and a linked proof", async () => {
  const uploadIds = await Promise.all([stagedPng("first.png"), stagedPng("second.png")]);
  const input = fixture("M4 successful create");
  const response = await post({
    ...input, routeAfterSave: "route_eligible",
    lineItems: input.lineItems.map((line, index) => ({ ...line, pendingOrderAttachmentUploadIds: [uploadIds[index]] })),
  });
  expect({ status: response.status, error: response.body.error, warnings: response.body.warnings })
    .toEqual({ status: 200, error: undefined, warnings: undefined });
  const [order] = await byLabel(input.label);
  expect(response.body.data.order.id).toBe(order.id);
  expect(response.body.id).toBe(order.id);
  expect(response.body.data.invoice).toBeUndefined();
  expect(order.total).toBe("28.00");
  const lines = await db.select().from(schema.orderLineItems)
    .where(eq(schema.orderLineItems.orderId, order.id)).orderBy(schema.orderLineItems.sortOrder);
  expect(lines.map(line => line.pbv2SnapshotJson)).toEqual(input.lineItems.map(line => line.pbv2SnapshotJson));
  const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.orderId, order.id));
  expect(invoices).toHaveLength(1);
  expect(invoices[0]).toMatchObject({ organizationId: org, customerId: buyer, status: "billed", issuedAt: expect.anything(), totalCents: 2800 });
  const invoiceLines = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, invoices[0].id));
  expect(invoiceLines.map(line => line.orderLineItemId).sort()).toEqual(lines.map(line => line.id).sort());
  expect(invoiceLines.map(line => line.lineTotalCents).sort()).toEqual([1000, 2000]);
  const attachments = await db.select().from(schema.orderAttachments).where(eq(schema.orderAttachments.orderId, order.id));
  for (const [index, filename] of [[0, "first.png"], [1, "second.png"]] as const) {
    const attachment = attachments.find(item => item.role === "artwork" && item.originalFilename === filename);
    expect(attachment).toMatchObject({ orderLineItemId: lines[index].id, fileRecordId: expect.any(String) });
    const original = await db.select().from(schema.lineItemFiles).where(eq(schema.lineItemFiles.lineItemId, lines[index].id));
    expect(original).toEqual(expect.arrayContaining([expect.objectContaining({
      role: "original", fileRecordId: attachment?.fileRecordId, sourceOrderAttachmentId: attachment?.id,
    })]));
  }
  const versions = await db.select().from(schema.lineItemProofVersions).where(eq(schema.lineItemProofVersions.lineItemId, lines[0].id));
  expect(versions).toHaveLength(1);
  expect(attachments.find(item => item.id === versions[0].proofFileId)).toMatchObject({
    role: "proof", orderLineItemId: lines[0].id,
    fileRecordId: attachments.find(item => item.role === "artwork" && item.orderLineItemId === lines[0].id)?.fileRecordId,
  });
  expect(response.body.data.routingResult).toEqual(expect.arrayContaining([
    expect.objectContaining({ lineItemId: lines[0].id, destination: "Proofing" }),
  ]));
});

test("rejecting the commercial transaction after its writes rolls back Order, lines and linked Invoice", async () => {
  const begin = db.transaction.bind(db);
  let insertedIds: string[] = [];
  const spy = jest.spyOn(db, "transaction").mockImplementationOnce(async run => begin(async tx => {
    const order = await run(tx) as { id: string; lineItems: { id: string }[] };
    const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.orderId, order.id));
    insertedIds = [order.id, ...order.lineItems.map(line => line.id), invoice.id];
    throw new Error("fixture rejection before commercial commit");
  }));
  const input = fixture("M4 rolled back create");
  try {
    const response = await post(input).expect(500);
    expect(response.body.error).toBe("fixture rejection before commercial commit");
  } finally {
    spy.mockRestore();
  }
  expect(insertedIds).toHaveLength(4);
  expect(await byLabel(input.label)).toHaveLength(0);
  expect(await db.select().from(schema.orderLineItems).where(eq(schema.orderLineItems.orderId, insertedIds[0]))).toHaveLength(0);
  expect(await db.select().from(schema.invoices).where(eq(schema.invoices.id, insertedIds[3]))).toHaveLength(0);
});

// Characterization of the existing split commit, pending a separate recovery repair.
test("an awaited route audit failure is observable after the commercial commit", async () => {
  const spy = jest.spyOn(storage, "createAuditLog").mockRejectedValueOnce(new Error("fixture route audit rejection"));
  const input = fixture("M4 post-commit failure");
  try {
    const response = await post(input).expect(500);
    expect(response.body).toMatchObject({ code: "ORDER_CREATE_FAILED", error: "fixture route audit rejection" });
  } finally {
    spy.mockRestore();
  }
  const [order] = await byLabel(input.label);
  expect(order.total).toBe("28.00");
  const lines = await db.select().from(schema.orderLineItems).where(eq(schema.orderLineItems.orderId, order.id));
  expect(lines).toHaveLength(2);
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.orderId, order.id));
  expect(invoice).toMatchObject({ status: "billed", issuedAt: expect.anything(), totalCents: 2800 });
  const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, order.id));
  expect(audits.filter(audit => audit.actionType === "CREATE")).toHaveLength(1);
});
