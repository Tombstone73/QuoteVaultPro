import { afterAll, beforeAll, expect, jest, test } from "@jest/globals";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { directPrintJobs, fulfillmentReadyQuantities, inventoryAdjustments, invoices, localBridgeAgents,
  orders, orderLineItems, organizations, printerProfiles, productionJobs, products, shipments, users } from "@shared/schema";
import { safeTestDatabaseUrl } from "./helpers/safeTestDatabase";

const url = safeTestDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
if (!url || url !== process.env.DATABASE_URL || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Disposable PostgreSQL required.");
const wake = jest.fn(async () => ({ published: true, attempts: 1 }));
jest.unstable_mockModule("../services/printAgentWake", () => ({
  publishPrintAgentWake: wake, getPrintAgentRealtimeConfiguration: () => null,
}));
const { registerProductionItemLabelRoutes } = await import("../routes/productionItemLabels.routes");
const { registerLocalBridgeRoutes } = await import("../routes/localBridge.routes");
const { registerPrinterProfileRoutes } = await import("../routes/printerProfiles.routes");

const org = randomUUID(), otherOrg = randomUUID(), agent = randomUUID(), otherAgent = randomUUID();
const actor = randomUUID(), orderId = randomUUID(), lineId = randomUUID(), otherLine = randomUUID();
const token = "synthetic-" + randomUUID(), foreignToken = "synthetic-" + randomUUID();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const printProfile = randomUUID(), foreignProfile = randomUUID();
const queue = "QA Epson TM-L90";
const health = () => ({ state: "connected" as const, error: null, reportedAt: new Date().toISOString() });
const previousWebOrigin = process.env.APP_PUBLIC_WEB_ORIGIN;
const app = express();
app.use(express.json());
const middleware = {
  isAuthenticated: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.header("x-staff")) return res.sendStatus(401);
    Object.assign(req, { user: { id: actor, role: req.header("x-staff") === "portal" ? "customer" : "employee" } });
    next();
  },
  tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    Object.assign(req, { organizationId: req.header("x-other-tenant") ? otherOrg : org }); next();
  },
  requireOrgOwnerAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  assertInternalUser: (req: express.Request, res: express.Response) => {
    if ((req.user as { role?: string })?.role === "customer") { res.sendStatus(403); return false; }
    return true;
  },
};
registerProductionItemLabelRoutes(app, middleware);
registerPrinterProfileRoutes(app, { ...middleware, isAdminOrOwner: middleware.requireOrgOwnerAdmin });
registerLocalBridgeRoutes(app, middleware);
const api = request(app);
const endpoint = "/api/orders/" + orderId + "/production-item-labels";
const fields = { orderNumber: true, lineNumber: true, description: true, dimensions: true };
const options = { mode: "panels", scope: "line", fields, lines: [{ lineItemId: lineId, panelCount: 4 }] };
const preview = (destinationId = printProfile, config: object = options) => api.post(endpoint + "/preview").set("x-staff", "employee")
  .send({ options: config, destination: { type: "printer", id: destinationId } });
const send = (previewFingerprint: string, requestKey = randomUUID(), overrides: object = {}) => api.post(endpoint + "/print")
  .set("x-staff", "employee").set("Idempotency-Key", requestKey)
  .send({ options, destinationId: printProfile, previewFingerprint, requestKey, confirmedLargeJob: false, ...overrides });
const agentPath = (id: string) => "/api/local-bridge/direct-print/jobs/" + id;

beforeAll(async () => {
  process.env.APP_PUBLIC_WEB_ORIGIN = "https://dev.printershero.com";
  await db.insert(organizations).values([org, otherOrg].map(id => ({ id, slug: id, name: "Synthetic label organization" })));
  await db.insert(users).values({ id: actor, role: "employee" });
  const [product] = await db.insert(products).values({ organizationId: org, name: "Synthetic wrap", description: "Fixture" }).returning();
  await db.insert(orders).values({ id: orderId, organizationId: org, orderNumber: "21004", createdByUserId: actor });
  await db.insert(orderLineItems).values([
    { id: lineId, orderId, productId: product.id, quantity: 4, sortOrder: 1, width: "48", height: "144", description: "Avery 1105 Wrap Film", unitPrice: "20", totalPrice: "80" },
    { id: otherLine, orderId, productId: product.id, quantity: 500, sortOrder: 2, description: "Sticker pack", unitPrice: "1", totalPrice: "500" },
  ]);
  await db.insert(localBridgeAgents).values([
    { id: agent, organizationId: org, name: "Synthetic agent", status: "active", tokenHash: hash(token),
      agentVersion: "1.0.32", knownWindowsQueues: [queue], connectionHealth: health() },
    { id: otherAgent, organizationId: otherOrg, name: "Foreign agent", status: "active", tokenHash: hash(foreignToken),
      agentVersion: "1.0.32", knownWindowsQueues: [queue], connectionHealth: health() },
  ]);
  await db.insert(printerProfiles).values([
    { id: printProfile, organizationId: org, displayName: "Fixture label profile", printerType: "production_ticket", windowsQueueName: queue,
      printAgentId: agent, supportedDocuments: ["production_item_label"], productionLabelWidthMm: "80", productionLabelHeightMm: "50" },
    { id: foreignProfile, organizationId: otherOrg, displayName: "Foreign profile", printerType: "production_ticket", windowsQueueName: queue,
      printAgentId: otherAgent, supportedDocuments: ["production_item_label"], productionLabelWidthMm: "80", productionLabelHeightMm: "50" },
  ]);
});
afterAll(async () => {
  if (previousWebOrigin === undefined) delete process.env.APP_PUBLIC_WEB_ORIGIN;
  else process.env.APP_PUBLIC_WEB_ORIGIN = previousWebOrigin;
  await pool.end();
});

test("source and preview use saved line order and selected media, without creating a print job", async () => {
  const response = await api.get(endpoint).set("x-staff", "employee");
  expect(response.status).toBe(200);
  expect(response.body.data.source).toMatchObject({ orderNumber: "21004", lines: [
    { id: lineId, number: 1, description: "Avery 1105 Wrap Film", quantity: 4 },
    { id: otherLine, number: 2, description: "Sticker pack", quantity: 500 },
  ] });
  expect(response.body.data.destinations).toEqual([
    expect.objectContaining({ id: printProfile, queueName: queue, media: { widthMm: 80, heightMm: 50 }, unavailableReason: null }),
  ]);
  const printed = await preview();
  expect(printed.status).toBe(200);
  expect(printed.body.data.document.labels[0].rows.join(" ")).toMatch(/Order 21004 1\. Avery 1105 Wrap Film 48(?:\.0+)? × 144(?:\.0+)? 1 of 4/);
  expect(printed.body.data.document.labels).toHaveLength(4);
  expect(await db.select().from(directPrintJobs).where(eq(directPrintJobs.orderId, orderId))).toEqual([]);
});

test("tenant, staff, incompatible agent versions and out-of-scope selections fail closed", async () => {
  expect((await api.get(endpoint)).status).toBe(401);
  expect((await api.get(endpoint).set("x-staff", "portal")).status).toBe(403);
  expect((await api.get(endpoint).set("x-staff", "employee").set("x-other-tenant", "1")).status).toBe(404);
  expect((await preview(foreignProfile)).status).toBe(409);
  expect((await preview(printProfile, { ...options, lines: [{ lineItemId: "unrelated-line", panelCount: 4 }] })).status).toBe(400);
  await db.update(localBridgeAgents).set({ agentVersion: "1.0.31" }).where(eq(localBridgeAgents.id, agent));
  expect((await preview()).body.error).toMatch(/1\.0\.32/);
  const fallback = await api.post(endpoint + "/preview").set("x-staff", "employee")
    .send({ options, destination: { type: "browser", media: { widthMm: 60, heightMm: 35 } } });
  expect(fallback.body.data.document.media).toEqual({ widthMm: 60, heightMm: 35 });
  await db.update(localBridgeAgents).set({ agentVersion: "1.0.32", connectionHealth: health() }).where(eq(localBridgeAgents.id, agent));
});

async function businessState() {
  return Promise.all([
    db.select().from(orders).where(eq(orders.id, orderId)),
    db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId)),
    db.select().from(productionJobs).where(eq(productionJobs.orderId, orderId)),
    db.select().from(fulfillmentReadyQuantities).where(eq(fulfillmentReadyQuantities.orderId, orderId)),
    db.select().from(inventoryAdjustments).where(eq(inventoryAdjustments.organizationId, org)),
    db.select().from(shipments).where(eq(shipments.organizationId, org)),
    db.select().from(invoices).where(eq(invoices.organizationId, org)),
  ]);
}

test("duplicate submission queues once; claimed source equals preview; failure, deliberate subset retry and history are print-only", async () => {
  const before = await businessState();
  const { body } = await preview();
  const key = randomUUID();
  const [first, replay] = await Promise.all([send(body.data.previewFingerprint, key), send(body.data.previewFingerprint, key)]);
  expect([first.status, replay.status].sort()).toEqual([200, 202]);
  const jobId = first.body.data.id;
  expect(jobId).toBe(replay.body.data.id);
  expect((await send(body.data.previewFingerprint, key, { confirmedLargeJob: true })).status).toBe(409);
  const claim = (auth: string) => api.post(agentPath(jobId) + "/claim").auth(auth, { type: "bearer" }).send({});
  expect((await claim(foreignToken)).status).toBe(409);
  const claimed = await claim(token);
  expect(claimed.status).toBe(200);
  expect(claimed.body.data).toMatchObject({ queueName: queue, copies: 1, documentType: "production_item_label" });
  expect(claimed.body.data.travelerUrl).toContain("/print-agent/documents/" + jobId);
  const document = () => api.get(agentPath(jobId) + "/document").auth(token, { type: "bearer" });
  expect((await document()).body.data.document).toEqual(body.data.document);
  expect((await api.post(agentPath(jobId) + "/failed").auth(token, { type: "bearer" }).send({ error: "Fixture media unsupported" })).status).toBe(200);
  expect((await claim(token)).status).toBe(409);

  const status = await api.get("/api/direct-print/jobs/status?ids=" + jobId).set("x-staff", "employee");
  expect(status.body.data[0]).toMatchObject({ id: jobId, status: "failed", queueName: queue, requestedByUserId: actor,
    productionLabels: { mode: "panels", labelCount: 4, lines: [{ lineItemId: lineId, lineNumber: 1, labelCount: 4 }] },
    lastError: "Fixture media unsupported" });
  expect(status.body.data[0]).not.toHaveProperty("printContext");
  const subset = { ...options, lines: [{ ...options.lines[0], selection: { start: 3, end: 3 } }] };
  const retryPreview = await preview(printProfile, subset);
  expect(retryPreview.body.data.document.labels[0].rows.at(-1)).toBe("3 of 4");
  const retry = await send(retryPreview.body.data.previewFingerprint, randomUUID(), { options: subset });
  expect(retry.body.data).toMatchObject({ status: "queued", labelCount: 1 });
  expect(retry.body.data.id).not.toBe(jobId);
  expect(await businessState()).toEqual(before);
  expect(wake).toHaveBeenCalledWith(hash(token));
});

test("stale preview, a changed printer after queueing, and unconfirmed large jobs are rejected", async () => {
  const initial = await preview();
  await db.update(orderLineItems).set({ description: "Saved revised wrap" }).where(eq(orderLineItems.id, lineId));
  expect((await send(initial.body.data.previewFingerprint)).status).toBe(409);
  const large = { ...options, lines: [{ ...options.lines[0], panelCount: 101 }] };
  const current = await preview(printProfile, large);
  expect((await send(current.body.data.previewFingerprint, randomUUID(), { options: large })).status).toBe(400);
  const queued = await send(current.body.data.previewFingerprint, randomUUID(), { options: large, confirmedLargeJob: true });
  expect(queued.status).toBe(202);
  await db.update(printerProfiles).set({ productionLabelHeightMm: "55" }).where(eq(printerProfiles.id, printProfile));
  const claim = await api.post(agentPath(queued.body.data.id) + "/claim").auth(token, { type: "bearer" }).send({});
  expect(claim.status).toBe(409);
  expect((await db.select().from(directPrintJobs).where(eq(directPrintJobs.id, queued.body.data.id)))[0].status).toBe("failed");
});
