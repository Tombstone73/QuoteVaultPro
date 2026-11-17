import { afterAll, beforeAll, expect, jest, test } from "@jest/globals";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { customers, directPrintJobs, fileRecords, fulfillmentEvents, invoices, lineItemArtwork, localBridgeAgents,
  orderLineItems, orders, organizations, payments, printerProfiles, productionJobs, products, shipments, users } from "@shared/schema";
import type { ItemTagDirectPrintRequest } from "@shared/itemTagDirectPrint";

const wake = jest.fn(async (_hash: string) => ({ published: true, attempts: 1 }));
const thumbnail = jest.fn(async (_args: unknown) => ({ buffer: Buffer.from("synthetic thumbnail"), mimeType: "image/png", filename: "test.png" }));
jest.unstable_mockModule("../services/printAgentWake", () => ({
  publishPrintAgentWake: wake, getPrintAgentRealtimeConfiguration: () => null,
}));
jest.unstable_mockModule("../services/artwork/ArtworkFileAccessService", () => ({ readArtworkFileForOrganization: thumbnail }));
const { registerPrinterProfileRoutes } = await import("../routes/printerProfiles.routes");
const { registerLocalBridgeRoutes } = await import("../routes/localBridge.routes");

const ids = { org: randomUUID(), foreign: randomUUID(), user: randomUUID(), live: randomUUID(), offline: randomUUID(), foreignAgent: randomUUID() };
const tokens = { live: randomUUID(), offline: randomUUID(), foreign: randomUUID() };
const oldOrigin = process.env.APP_PUBLIC_WEB_ORIGIN;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
let orderId: string, lineId: string, artId: string, fileId: string, printerId: string, offlineProfileId: string;
const app = express();
app.use(express.json());
const middleware = {
  isAuthenticated: (req: any, res: any, next: any) => {
    if (!req.header("x-staff")) return res.sendStatus(401);
    req.user = { id: ids.user, role: req.header("x-staff") === "portal" ? "customer" : "employee" };
    next();
  },
  tenantContext: (req: any, _res: any, next: any) => {
    req.organizationId = req.header("x-foreign") ? ids.foreign : ids.org;
    next();
  },
  isAdminOrOwner: (_req: any, res: any) => res.sendStatus(403),
  requireOrgOwnerAdmin: (_req: any, res: any) => res.sendStatus(403),
};
registerPrinterProfileRoutes(app, middleware);
registerLocalBridgeRoutes(app, middleware);

beforeAll(async () => {
  process.env.APP_PUBLIC_WEB_ORIGIN = "https://dev.printershero.com";
  await db.insert(organizations).values([ids.org, ids.foreign].map(id => ({ id, name: "Synthetic print organization", slug: id })));
  await db.insert(users).values({ id: ids.user, email: ids.user + "@example.invalid" });
  const [customer] = await db.insert(customers).values({ organizationId: ids.org, companyName: "Synthetic customer" }).returning();
  const [order] = await db.insert(orders).values({ organizationId: ids.org, customerId: customer.id,
    createdByUserId: ids.user, orderNumber: "TAG-" + randomUUID().slice(0, 12), shippingMethod: "pickup" }).returning();
  orderId = order.id;
  const [product] = await db.insert(products).values({ organizationId: ids.org, name: "Synthetic banner", description: "Synthetic" }).returning();
  [{ id: lineId }] = await db.insert(orderLineItems).values({ orderId, productId: product.id, quantity: 15, description: "Synthetic banner",
    unitPrice: "1", totalPrice: "15" }).returning();
  [{ id: fileId }] = await db.insert(fileRecords).values({ organizationId: ids.org,
    originalFilename: "sample-test.pdf", mimeType: "application/pdf", sizeBytes: 12 }).returning();
  [{ id: artId }] = await db.insert(lineItemArtwork).values({ organizationId: ids.org, orderId, lineItemId: lineId,
    fileRecordId: fileId, role: "customer_source", side: "front", origin: "staff_upload" }).returning();
  await db.insert(localBridgeAgents).values([
    { id: ids.live, organizationId: ids.org, name: "Packing Station", status: "active", tokenHash: hash(tokens.live),
      configuredTravelerPrinterName: "Epson", lastSeenAt: new Date() },
    { id: ids.offline, organizationId: ids.org, name: "Offline workstation", status: "active", tokenHash: hash(tokens.offline),
      configuredTravelerPrinterName: "Offline Epson", lastSeenAt: new Date(0) },
    { id: ids.foreignAgent, organizationId: ids.foreign, name: "Foreign agent", status: "active", tokenHash: hash(tokens.foreign),
      configuredTravelerPrinterName: "Foreign Epson", lastSeenAt: new Date() },
  ]);
  const base = { organizationId: ids.org, printerType: "production_ticket" as const, supportedDocuments: ["traveler"] };
  [{ id: printerId }, { id: offlineProfileId }] = await db.insert(printerProfiles).values([
    { ...base, displayName: "Packing tag printer", printAgentId: ids.live, windowsQueueName: "Epson", location: "Fulfillment", isDefault: true },
    { ...base, displayName: "Offline tag printer", printAgentId: ids.offline, windowsQueueName: "Offline Epson" },
    { ...base, displayName: "Narrow ticket", printAgentId: ids.live, windowsQueueName: "Epson", receiptWidthMm: "58" },
    { ...base, displayName: "Zebra", printAgentId: ids.live, windowsQueueName: "Epson", printerType: "shipping_label" },
    { ...base, organizationId: ids.foreign, displayName: "Foreign", printAgentId: ids.foreignAgent, windowsQueueName: "Foreign Epson" },
  ]).returning();
});

afterAll(async () => {
  if (oldOrigin === undefined) delete process.env.APP_PUBLIC_WEB_ORIGIN;
  else process.env.APP_PUBLIC_WEB_ORIGIN = oldOrigin;
  await pool.end();
});

const destinations = "/api/direct-print/item-tag-destinations";
const post = (body: ItemTagDirectPrintRequest, staff = "employee") =>
  request(app).post(`/api/orders/${orderId}/direct-print/item-tag`).set("x-staff", staff)
    .set("Idempotency-Key", body.requestKey).send(body);
const jobPath = (id: string) => `/api/local-bridge/direct-print/jobs/${id}`;
const get = (path: string, token = tokens.live) => request(app).get(path).auth(token, { type: "bearer" });
const orderSelection = () => ({ destinationId: printerId, requestKey: randomUUID(), selection: { scope: "order" } } as const);

test("discovers matching thermal profiles with agent availability and rejects unauthorized callers", async () => {
  expect((await request(app).get(destinations)).status).toBe(401);
  expect((await request(app).get(destinations).set("x-staff", "portal")).status).toBe(403);
  const response = await request(app).get(destinations).set("x-staff", "employee");
  expect(response.status).toBe(200);
  expect(response.body.data).toHaveLength(2);
  expect(response.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: printerId, available: true, queueName: "Epson", location: "Fulfillment" }),
    expect.objectContaining({ id: offlineProfileId, available: false, unavailableReason: expect.stringContaining("offline") }),
  ]));
  expect(JSON.stringify(response.body)).not.toContain(hash(tokens.live));
  expect((await post({ ...orderSelection(), destinationId: offlineProfileId })).status).toBe(409);
  expect((await post(orderSelection(), "portal")).status).toBe(403);
});

test("a duplicate request queues once and can be claimed once, while whole-order rendering uses its own source", async () => {
  const [before] = await db.select().from(orders).where(eq(orders.id, orderId));
  const input = orderSelection();
  const started = wake.mock.calls.length;
  const concurrent = await Promise.all([post(input), post(input)]);
  expect(concurrent.map(result => result.status).sort()).toEqual([200, 202]);
  const id = concurrent[0].body.data.id;
  expect(concurrent[1].body.data.id).toBe(id);
  expect(await db.select().from(directPrintJobs).where(eq(directPrintJobs.requestKey, input.requestKey)))
    .toEqual([expect.objectContaining({ documentType: "item_tag" })]);
  expect(wake.mock.calls.length - started).toBe(1);
  expect((await post({ ...input, selection: { scope: "line", lineItemId: lineId, includeThumbnails: false } })).status).toBe(409);
  const base = jobPath(id);
  expect((await get("/api/local-bridge/direct-print/jobs")).body.data)
    .toEqual(expect.arrayContaining([expect.objectContaining({ id, documentType: "item_tag" })]));
  expect((await get(base + "/item-tag")).status).toBe(404);
  expect((await request(app).post(base + "/claim").auth(tokens.foreign, { type: "bearer" }).send({})).status).toBe(409);
  const claims = await Promise.all([1, 2].map(() => request(app).post(base + "/claim").auth(tokens.live, { type: "bearer" }).send({})));
  expect(claims.map(result => result.status).sort()).toEqual([200, 409]);
  expect(claims.find(result => result.status === 200)?.body.data.travelerUrl).toContain("&itemTag=1");
  expect(claims.find(result => result.status === 200)?.body.data.documentType).toBe("traveler");
  expect((await get(base + "/traveler")).status).toBe(404);
  expect((await get(base + "/item-tag")).body.data).toMatchObject({ jobId: id, source: { orderId }, itemTag: { selection: { scope: "order" } } });
  expect((await request(app).post(base + "/submitted").auth(tokens.live, { type: "bearer" }).send({})).status).toBe(200);
  expect((await post(input)).body.data).toMatchObject({ id, status: "submitted", duplicate: true });
  expect((await db.select().from(orders).where(eq(orders.id, orderId)))[0]).toEqual(before);
  expect(await db.select().from(productionJobs).where(eq(productionJobs.orderId, orderId))).toEqual([]);
  expect(await db.select().from(fulfillmentEvents).where(eq(fulfillmentEvents.organizationId, ids.org))).toEqual([]);
  expect(await db.select().from(shipments).where(eq(shipments.organizationId, ids.org))).toEqual([]);
  expect(await db.select().from(invoices).where(eq(invoices.organizationId, ids.org))).toEqual([]);
  expect(await db.select().from(payments).where(eq(payments.organizationId, ids.org))).toEqual([]);
});

test("selected line and partial quantity preserve canonical artwork and allow only the claimed thumbnail", async () => {
  for (const selection of [
    { scope: "line", lineItemId: lineId, includeThumbnails: false },
    { scope: "partial", lineItemId: lineId, includeThumbnails: true, quantity: 5 },
  ] as const) {
    const result = await post({ ...orderSelection(), selection });
    expect(result.status).toBe(202);
    const base = jobPath(result.body.data.id);
    expect((await request(app).post(base + "/claim").auth(tokens.live, { type: "bearer" }).send({})).status).toBe(200);
    expect((await get(base + "/item-tag", tokens.foreign)).status).toBe(404);
    expect((await get(base + "/item-tag")).body.data.itemTag).toMatchObject({
      selection, orderedQuantity: 15, artwork: [{ id: artId, fileRecordId: fileId }],
    });
    expect((await get(base + "/item-tag/thumbnails/arbitrary-file")).status).toBe(404);
    const before = thumbnail.mock.calls.length;
    const resultThumbnail = await get(base + "/item-tag/thumbnails/" + artId);
    expect(resultThumbnail.status).toBe(selection.includeThumbnails ? 200 : 404);
    expect(thumbnail.mock.calls.length - before).toBe(selection.includeThumbnails ? 1 : 0);
    if (selection.includeThumbnails) expect(thumbnail).toHaveBeenLastCalledWith({ organizationId: ids.org, fileRecordId: fileId, variant: "thumbnail" });
  }
  const excessive = await post({ ...orderSelection(), selection: { scope: "partial", lineItemId: lineId, includeThumbnails: false, quantity: 16 } });
  expect(excessive.status).toBe(409);
});
