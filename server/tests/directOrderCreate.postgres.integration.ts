import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
  app.use((req, res, next) => {
    if (req.header("x-fixture-drop-response")) {
      const send = res.json.bind(res);
      res.json = body => {
        if (body?.success) {
          res.socket?.destroy();
          return res;
        }
        return send(body);
      };
    }
    next();
  });
  const middleware: express.RequestHandler = (req, _res, next) => {
    req.organizationId = req.header("x-fixture-org") ?? org;
    req.orgRole = "admin";
    req.user = { id: req.header("x-fixture-actor") ?? actor, firstName: "Test", lastName: "Actor" } as Express.User;
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
const keyed = (body: ReturnType<typeof fixture>, key: string) => post(body).set("Idempotency-Key", key);
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

async function expectOneCommercialResult(label: string, expectedId: string, expectedActor = actor) {
  const orders = await byLabel(label);
  expect(orders.map(order => order.id)).toEqual([expectedId]);
  expect(orders[0].createdByUserId).toBe(expectedActor);
  const receipts = await db.select().from(schema.staffOrderCreateRequests)
    .where(eq(schema.staffOrderCreateRequests.orderId, expectedId));
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ organizationId: org, actorUserId: expectedActor, operation: "orders:create" });
  const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.orderId, expectedId));
  expect(invoices).toHaveLength(1);
  expect(invoices[0]).toMatchObject({ organizationId: org, orderId: expectedId, status: "billed", issuedAt: expect.anything(), totalCents: 2800 });
  const lines = await db.select().from(schema.orderLineItems).where(eq(schema.orderLineItems.orderId, expectedId));
  const invoiceLines = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, invoices[0].id));
  expect(invoiceLines.map(line => line.orderLineItemId).sort()).toEqual(lines.map(line => line.id).sort());
  for (const line of lines) {
    expect(invoiceLines.find(item => item.orderLineItemId === line.id)?.pbv2SnapshotJson).toEqual(line.pbv2SnapshotJson);
  }
  expect(lines.map(line => line.pbv2SnapshotJson).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
    .toEqual([{ pricing: { totalCents: 1000 } }, { pricing: { totalCents: 2000 } }]);
  return { receipt: receipts[0], invoiceId: invoices[0].id };
}

test.each(["canonical audit", "route audit", "proof override audit"])("keyed create recovers after %s rejection without replaying the follow-up", async step => {
  const input = fixture(`R1 ${step}`);
  const key = randomUUID();
  if (step === "proof override audit") {
    await db.update(schema.organizations).set({ settings: {} }).where(eq(schema.organizations.id, org));
    await db.update(schema.products).set({ requiresProofApproval: true }).where(eq(schema.products.id, product));
    input.lineItems = input.lineItems.map(line => ({ ...line, requiresProofApproval: false }));
  }
  let rejections = 0;
  const realInsert = db.insert.bind(db);
  const failure = new Error("synthetic post-commit audit rejection");
  const routeAudit = jest.spyOn(storage, "createAuditLog");
  if (step === "route audit") routeAudit.mockImplementationOnce(async () => { rejections++; throw failure; });
  const databaseAudit = jest.spyOn(db, "insert").mockImplementation(((table: typeof schema.auditLogs) => {
    const statement = realInsert(table);
    if (table !== schema.auditLogs || step === "route audit") return statement;
    const values = statement.values.bind(statement);
    const target = step === "canonical audit" ? "CREATE" : "PROOF_APPROVAL_MANUAL_OVERRIDE";
    statement.values = ((value: typeof schema.auditLogs.$inferInsert) => {
      if (value.actionType === target) { rejections++; throw failure; }
      return values(value);
    }) as typeof statement.values;
    return statement;
  }) as typeof db.insert);
  try {
    const first = await keyed(input, key).expect(200);
    const id = first.body.data.order.id;
    expect(first.body).toMatchObject({ success: true, id, data: { followUpWarning: expect.any(String) } });
    const before = await expectOneCommercialResult(input.label, id);
    expect(before.receipt.followUpVerified).toBe(false);
    const auditCount = databaseAudit.mock.calls.length;
    const routeAuditCount = routeAudit.mock.calls.length;
    const second = await keyed(input, key).expect(200);
    expect(second.body).toMatchObject({ id, data: { recovered: true, followUpWarning: expect.any(String) } });
    expect(await expectOneCommercialResult(input.label, id)).toEqual(before);
    expect(rejections).toBe(1);
    expect(databaseAudit).toHaveBeenCalledTimes(auditCount);
    expect(routeAudit).toHaveBeenCalledTimes(routeAuditCount);
  } finally {
    databaseAudit.mockRestore();
    routeAudit.mockRestore();
    if (step === "proof override audit") {
      await db.update(schema.organizations).set({ settings: { preferences: { proofing: { policy: "manual_requested_only" } } } } as Partial<typeof schema.organizations.$inferInsert>).where(eq(schema.organizations.id, org));
      await db.update(schema.products).set({ requiresProofApproval: false }).where(eq(schema.products.id, product));
    }
  }
});

test("concurrent same-process requests, a lost response and a retry after two minutes recover one Order", async () => {
  const input = fixture("R1 lost response");
  const key = randomUUID();
  let disconnected = false;
  await Promise.all([
    keyed(input, key).set("x-fixture-drop-response", "yes").then(
      () => { throw new Error("Expected the response to be dropped"); },
      error => { if (error.code !== "ECONNRESET") throw error; disconnected = true; },
    ),
    keyed(input, key).expect(200),
  ]);
  expect(disconnected).toBe(true);
  const [saved] = await byLabel(input.label);
  const before = await expectOneCommercialResult(input.label, saved.id);
  const auditBefore = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, saved.id));
  const clock = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 121_000);
  try {
    const retry = await keyed(input, key).expect(200);
    expect(retry.body).toMatchObject({ id: saved.id, data: { recovered: true } });
    expect(retry.body.data.followUpWarning).toBeUndefined();
  } finally {
    clock.mockRestore();
  }
  expect(await expectOneCommercialResult(input.label, saved.id)).toEqual(before);
  expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, saved.id))).toEqual(auditBefore);
  const conflict = await keyed({ ...input, lineItems: [] }, key).expect(409);
  expect(conflict.body.code).toBe("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
});

test("a lost commit acknowledgment is recovered from the receipt before any follow-up", async () => {
  const input = fixture("R1 lost commit acknowledgement");
  const key = randomUUID();
  const begin = db.transaction.bind(db);
  const transaction = jest.spyOn(db, "transaction").mockImplementationOnce(async run => {
    await begin(run);
    throw new Error("Synthetic COMMIT acknowledgment lost");
  });
  try {
    const response = await keyed(input, key).expect(200);
    expect(response.body.data).toMatchObject({ recovered: true, followUpWarning: expect.any(String) });
    const id = response.body.id;
    expect((await expectOneCommercialResult(input.label, id)).receipt.followUpVerified).toBe(false);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, id))).toHaveLength(0);
    expect((await keyed(input, key).expect(200)).body.id).toBe(id);
    await expectOneCommercialResult(input.label, id);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, id))).toHaveLength(0);
  } finally {
    transaction.mockRestore();
  }
});

test("body key precedence and normalized request fingerprint survive header-only replay", async () => {
  const input = fixture("R1 key precedence");
  const key = randomUUID();
  const created = await post({ ...input, ...{ idempotencyKey: ` ${key} ` } }).set("Idempotency-Key", "ignored-header").expect(200);
  const replayed = await post(input).set("X-Idempotency-Key", key).expect(200);
  expect(replayed.body).toMatchObject({ id: created.body.id, data: { recovered: true } });
  await expectOneCommercialResult(input.label, created.body.id);
});

test("receipt keys are actor- and tenant-scoped, and separate keys allow identical Orders", async () => {
  const input = fixture("R1 legitimately separate");
  const key = randomUUID();
  const original = await keyed(input, key).expect(200);
  expect(original.body.data.recovered).toBeUndefined();
  expect(original.body.data.followUpWarning).toBeUndefined();
  const sameDetailsNewKey = await keyed(input, randomUUID()).expect(200);
  const otherActor = randomUUID();
  await db.insert(schema.users).values({ id: otherActor, email: `${otherActor}@example.test`, role: "admin" });
  await db.insert(schema.userOrganizations).values({ userId: otherActor, organizationId: org, role: "admin" });
  const actorResult = await keyed(input, key).set("x-fixture-actor", otherActor).expect(200);
  expect(actorResult.body.createdByUserId).toBe(otherActor);
  expect(new Set([original.body.id, sameDetailsNewKey.body.id, actorResult.body.id]).size).toBe(3);

  const otherOrg = randomUUID();
  await db.insert(schema.organizations).values({ id: otherOrg, name: "Other synthetic tenant", slug: otherOrg });
  await db.insert(schema.userOrganizations).values({ userId: actor, organizationId: otherOrg, role: "admin" });
  const tenantResult = await keyed(input, key).set("x-fixture-org", otherOrg).expect(404);
  expect(tenantResult.body).toMatchObject({ code: "ORDER_CUSTOMER_NOT_FOUND" });
  expect(tenantResult.body.id).toBeUndefined();
  expect(await byLabel(input.label)).toHaveLength(3);
});

test("pre-commit rollback removes the keyed receipt with the Order and Invoice", async () => {
  const input = fixture("R1 atomic rollback");
  const key = randomUUID();
  const begin = db.transaction.bind(db);
  let rolledBackOrderId = "";
  const transaction = jest.spyOn(db, "transaction").mockImplementationOnce(async run => begin(async tx => {
    const result = await run(tx) as { order: { id: string } };
    rolledBackOrderId = result.order.id;
    expect(await tx.select().from(schema.staffOrderCreateRequests).where(eq(schema.staffOrderCreateRequests.orderId, rolledBackOrderId))).toHaveLength(1);
    expect(await tx.select().from(schema.invoices).where(eq(schema.invoices.orderId, rolledBackOrderId))).toHaveLength(1);
    throw new Error("R1 injected commercial rollback");
  }));
  try {
    await keyed(input, key).expect(500);
  } finally {
    transaction.mockRestore();
  }
  expect(rolledBackOrderId).toBeTruthy();
  expect(await db.select().from(schema.staffOrderCreateRequests).where(eq(schema.staffOrderCreateRequests.orderId, rolledBackOrderId))).toHaveLength(0);
  expect(await db.select().from(schema.invoices).where(eq(schema.invoices.orderId, rolledBackOrderId))).toHaveLength(0);
  expect(await byLabel(input.label)).toHaveLength(0);
  const retry = await keyed(input, key).expect(200);
  await expectOneCommercialResult(input.label, retry.body.id);
});

test("a retained receipt whose result is missing returns a controlled conflict", async () => {
  const input = fixture("R1 missing Order");
  const key = randomUUID();
  const first = await keyed(input, key).expect(200);
  const [receipt] = await db.select().from(schema.staffOrderCreateRequests).where(eq(schema.staffOrderCreateRequests.orderId, first.body.id));
  // Simulate a removed Order while keeping the independent receipt.
  await db.update(schema.staffOrderCreateRequests).set({ orderId: randomUUID() })
    .where(and(eq(schema.staffOrderCreateRequests.organizationId, org), eq(schema.staffOrderCreateRequests.keyHash, receipt.keyHash)));
  const confirmed = await keyed(input, key).expect(409);
  expect(confirmed.body.code).toBe("ORDER_CREATE_RESULT_REMOVED");
  expect(await byLabel(input.label)).toHaveLength(1);
});

function startWorker(input: ReturnType<typeof fixture>, key: string) {
  const { DATABASE_URL: _db, MIGRATION_DATABASE_URL: _migration, DIRECT_DATABASE_URL: _direct, ...fixtureEnv } = process.env;
  const child = spawn(process.execPath, [
    "--import", "tsx", "server/tests/helpers/staffOrderRetry.postgres.child.mjs",
  ], { env: { ...fixtureEnv, STAFF_ORDER_RETRY_FIXTURE: JSON.stringify({ org, actor, input, key }) },
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let output = "";
  child.stdout?.on("data", chunk => { output += String(chunk); });
  child.stderr?.on("data", chunk => { output += String(chunk); });
  const message = (kind: string) => new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Worker timed out: ${output.slice(-1200)}`)), 60_000);
    const onClose = (code: number) => finish(new Error(`Worker exited ${code}: ${output.slice(-1600)}`));
    const onMessage = (data: { kind?: string; orderId?: string }) => {
      if (data.kind === kind) finish(undefined, data.orderId ?? "");
    };
    function finish(error?: Error, value = "") {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("close", onClose);
      child.off("error", finish);
      if (error) reject(error);
      else resolve(value);
    }
    child.on("message", onMessage);
    child.once("close", onClose);
    child.once("error", finish);
  });
  return {
    ready: message("ready"),
    run: async () => {
      const done = message("result");
      const closed = once(child, "close");
      child.send({ kind: "submit" });
      const id = await done;
      const [code] = await closed;
      expect(code).toBe(0);
      return id;
    },
    stop: () => { if (child.exitCode === null) child.kill(); },
  };
}

test("independent API processes serialize concurrent creates and a fresh process replays the committed receipt", async () => {
  const input = fixture("R1 independent processes");
  const key = randomUUID();
  const workers = [startWorker(input, key), startWorker(input, key)];
  try {
    await Promise.all(workers.map(worker => worker.ready));
    const [first, second] = await Promise.all(workers.map(worker => worker.run()));
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    const receipt = await expectOneCommercialResult(input.label, first);
    const restarted = startWorker(input, key);
    workers.push(restarted);
    await restarted.ready;
    expect(await restarted.run()).toBe(first);
    expect(await expectOneCommercialResult(input.label, first)).toEqual(receipt);
  } finally {
    workers.forEach(worker => worker.stop());
  }
}, 180_000);
