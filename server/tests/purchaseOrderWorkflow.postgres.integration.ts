import { beforeAll, expect, jest, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLogs, customers, inventoryAdjustments, materialProductLinks, materials, orders, organizations, payments, products, purchaseOrders, users, vendors } from "@shared/schema";
import { registerProcurementRoutes } from "../routes/procurement.routes";
import { safeTestDatabaseUrl } from "./helpers/safeTestDatabase";
import type { emailService } from "../emailService";
import { markInvoiceEmailDeliveryFailure } from "../services/invoiceEmailDeliveryFailure";
import { materialFamilyCreationService as families } from "../services/materialFamilyCreation.service";
import { materialFamilyAssignmentService } from "../services/materialFamilyAssignment.service";
import { materialMutationService } from "../services/materialMutation.service";

const url = safeTestDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
if (!url || url !== process.env.DATABASE_URL || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Disposable PostgreSQL required.");

const org = randomUUID();
const otherOrg = randomUUID();
const actor = randomUUID();
const vendorId = randomUUID();
const foreignVendor = randomUUID();
let orderId: string;
const sendEmail = jest.fn<typeof emailService.sendEmail>().mockResolvedValue("gmail-accepted");
function app(tenant = org, canWrite = true) {
  const api = express();
  api.use(express.json());
  registerProcurementRoutes(api, {
    isAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { user: { id: actor, firstName: "Synthetic Buyer" } });
      next();
    },
    tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { organizationId: tenant });
      next();
    },
    isAdminOrOwner: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (canWrite) next(); else res.sendStatus(403);
    },
  }, sendEmail);
  return request(api);
}

beforeAll(async () => {
  await db.insert(organizations).values([{ id: org, name: "Purchasing fixture", slug: org }, { id: otherOrg, name: "Other tenant", slug: otherOrg }]);
  await db.insert(users).values({ id: actor, role: "admin" });
  await db.insert(vendors).values([
    { id: vendorId, organizationId: org, name: "Synthetic Vendor", email: "orders@example.invalid", salesRepEmail: "rep@example.invalid" },
    { id: foreignVendor, organizationId: otherOrg, name: "Foreign Vendor" },
  ]);
  const [customer] = await db.insert(customers).values({ organizationId: org, companyName: "Synthetic buyer" }).returning();
  const [order] = await db.insert(orders).values({ organizationId: org, orderNumber: "21029", customerId: customer.id, createdByUserId: actor }).returning();
  orderId = order.id;
});

const endpoint = "/api/purchase-orders";
const line = (description: string, quantityOrdered: string, unitCost: string) => ({ description, quantityOrdered, unitCost });
const frames = line("36x36x60 Real Estate Frames", "60", "31.50");
const freight = line("Delivery", "1", "30");
const draft = (lineItems: Array<ReturnType<typeof line> & { materialId?: string }> = [frames, freight]) => ({
  vendorId, relatedOrderId: orderId, issueDate: "2026-11-12", expectedDate: "2026-11-20",
  paymentTerms: "cod", paymentMethod: "check", paymentInstructions: "Collect check at delivery", lineItems,
});
async function create(input = draft()) {
  const result = await app().post(endpoint + "/workflow").send(input);
  expect(result.status).toBe(200);
  return result.body.data;
}
async function issue(po: { id: string; version: number }) {
  const result = await app().post(endpoint + "/" + po.id + "/issue").send({ expectedVersion: po.version });
  expect(result.status).toBe(200);
  return result.body.data;
}

test("mixed edit with dates and multiple manual lines persists, preserving IDs and vendor/Order projection", async () => {
  const po = await create();
  const path = endpoint + "/" + po.id;
  const [original] = po.lineItems;
  const response = await app().patch(path + "/workflow").send({
    ...draft(), expectedVersion: po.version, expectedDate: "2026-12-01", paymentTerms: "net_30", paymentMethod: "ach",
    lineItems: [{ ...frames, id: original.id, description: "Frame corrected", quantityOrdered: "2", unitCost: "10.125" },
      line("24x36x60 Real Estate Frames", "3", "25.1"), line("Pickup packaging", "1", "5")],
  });
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ grandTotal: "100.55", expectedDate: "2026-12-01T00:00:00.000Z", paymentTerms: "net_30", paymentMethod: "ach" });
  const reload = await app().get(path);
  expect(reload.body.data.lineItems).toEqual(response.body.data.lineItems);
  expect(reload.body.data.lineItems[0].id).toBe(original.id);
  expect(reload.body.data.timeline.map((event: { actionType: string }) => event.actionType)).toEqual(expect.arrayContaining(["DRAFT_SAVE", "LINE_ADD", "LINE_EDIT", "LINE_REMOVE", "EXPECTED_DELIVERY"]));
  const list = await app().get(endpoint).query({ search: po.poNumber, vendorId, status: "draft" });
  expect(list.body.data).toHaveLength(1);
  expect(list.body.data[0]).toMatchObject({ vendor: { id: vendorId, name: "Synthetic Vendor" }, relatedOrder: { id: orderId, orderNumber: "21029" }, itemSummary: expect.stringContaining("Frame corrected") });
  expect(list.body.data[0]).not.toHaveProperty("lineItems");
  const clear = await app().patch(path + "/workflow").send({ expectedVersion: response.body.data.version, expectedDate: null });
  expect(clear.body.data.expectedDate).toBeNull();
});

test("duplicate submits and stale writes are rejected, invalid edits roll back all changes", async () => {
  const po = await create();
  const path = endpoint + "/" + po.id;
  const body = { expectedVersion: po.version, lineItems: [{ ...frames, id: po.lineItems[0].id }, line("New frame", "1", "5")] };
  expect((await app().patch(path).send({ lineItems: body.lineItems })).status).toBe(400);
  const [first, second] = await Promise.all([app().patch(path + "/workflow").send(body), app().patch(path + "/workflow").send(body)]);
  expect([first.status, second.status].sort()).toEqual([200, 409]);
  const stable = (await app().get(path)).body.data;
  expect(stable.lineItems).toHaveLength(2);
  const failed = await app().patch(path + "/workflow").send({ expectedVersion: stable.version, lineItems: [{ ...frames, materialId: randomUUID() }] });
  expect(failed.status).toBe(400);
  expect((await app().get(path)).body.data).toEqual(stable);
});

test("issued revision preserves original snapshot and received quantities", async () => {
  const po = await create();
  const issued = await issue(po);
  const path = endpoint + "/" + po.id;
  const noReason = await app().patch(path + "/workflow").send({ expectedVersion: issued.version, notes: "Unapproved" });
  expect(noReason.status).toBe(400);
  const receive = { expectedVersion: issued.version, items: [{ lineItemId: po.lineItems[0].id, quantityToReceive: "2" }] };
  const received = await app().post(path + "/receipts").send(receive);
  expect(received.status).toBe(200);
  expect((await app().post(path + "/receipts").send(receive)).status).toBe(409);
  const removal = await app().patch(path + "/workflow").send({ expectedVersion: received.body.data.version, revisionReason: "Remove frame", lineItems: [{ ...freight, id: po.lineItems[1].id }] });
  expect(removal.status).toBe(400);
  const next = await app().patch(path + "/workflow").send({
    expectedVersion: received.body.data.version, revisionReason: "Vendor approved expanded order",
    lineItems: [{ ...frames, id: po.lineItems[0].id, unitCost: "32" }, { ...freight, id: po.lineItems[1].id }, line("Extra frame", "1", "12")],
  });
  expect(next.status).toBe(200);
  expect(next.body.data).toMatchObject({ revision: 1, originalTotal: "1920.00", grandTotal: "1962.00", status: "partially_received" });
  expect(next.body.data.lineItems[0]).toMatchObject({ id: po.lineItems[0].id, quantityReceived: "2.00" });
  const detail = (await app().get(path)).body.data;
  expect(detail.originalLines[0].unitCost).toBe("31.5000");
  expect(detail.revisions.map((entry: { source: string }) => entry.source)).toEqual(["issued", "revision"]);
  const pdf0 = await app().get(path + "/revisions/0/pdf");
  const pdf1 = await app().get(path + "/revisions/1/pdf");
  expect(pdf0.status).toBe(200);
  expect(pdf0.body.equals(pdf1.body)).toBe(false);
  expect((await app().get(path + "/revisions/0/pdf")).body.equals(pdf0.body)).toBe(true);
});

test("actual adjustments stay provisional until complete and retain both overage and credit history", async () => {
  const po = await create();
  const issued = await issue(po);
  const path = endpoint + "/" + po.id;
  const originalOrder = (await db.select().from(orders).where(eq(orders.id, orderId)))[0];
  const paymentCount = (await db.select({ id: payments.id }).from(payments)).length;
  const adjust = (expectedVersion: number, values: Record<string, unknown>) => app().post(path + "/actual-costs")
    .send({ expectedVersion, final: true, reason: "Vendor invoice", reference: "Vendor-42", date: "2026-11-22", ...values });
  const cost = await adjust(issued.version, { lineId: po.lineItems[0].id, quantity: "60", unitCost: "33" });
  expect(cost.status).toBe(200);
  expect(cost.body.data).toMatchObject({ actualTotal: "1980.00", actualProvisional: true, originalTotal: "1920.00" });
  expect((await adjust(cost.body.data.version, { charge: "freight", total: "30" })).status).toBe(400);
  const delivered = await adjust(cost.body.data.version, { lineId: po.lineItems[1].id, total: "30" });
  expect(delivered.body.data).toMatchObject({ actualTotal: "2010.00", actualProvisional: false });
  const credited = await adjust(delivered.body.data.version, { lineId: po.lineItems[0].id, quantity: "60", unitCost: "30" });
  expect(credited.body.data).toMatchObject({ actualTotal: "1830.00", actualProvisional: false, grandTotal: "1920.00", originalTotal: "1920.00" });
  const updated = (await app().get(path)).body.data;
  const changes = updated.timeline.filter((event: { actionType: string }) => event.actionType === "ACTUAL_COST");
  expect(changes).toHaveLength(3);
  expect(changes[0]).toMatchObject({ userId: actor, oldValues: { total: "1980.00" }, newValues: { total: "1800.00", reference: "Vendor-42" } });
  expect((await db.select().from(orders).where(eq(orders.id, orderId)))[0]).toEqual(originalOrder);
  expect((await db.select({ id: payments.id }).from(payments)).length).toBe(paymentCount);
});

test("tenant scope and staff permissions protect vendor, purchase orders, revisions and cost writes", async () => {
  const invalid = await app().post(endpoint + "/workflow").send({ ...draft(), vendorId: foreignVendor });
  expect(invalid.status).toBe(400);
  const po = await create();
  const issued = await issue(po);
  const path = endpoint + "/" + po.id;
  expect((await app(otherOrg).get(path)).status).toBe(404);
  expect((await app(otherOrg).get(path + "/revisions/0/pdf")).status).toBe(404);
  expect((await app(otherOrg).get(endpoint)).body.data).toEqual([]);
  expect((await app(org, false).patch(path + "/workflow").send({ expectedVersion: issued.version })).status).toBe(403);
  expect((await app(org, false).post(path + "/actual-costs").send({})).status).toBe(403);
  expect((await app(org, false).post(path + "/email").send({})).status).toBe(403);
});

test("email submits one exact saved PDF with To, CC and BCC and records Gmail acceptance once", async () => {
  const po = await create();
  await issue(po);
  const path = endpoint + "/" + po.id;
  const pdf = await app().get(path + "/revisions/0/pdf");
  const key = randomUUID();
  const body = { revision: 0, subject: "Synthetic PO", message: "Please review", recipients: {
    to: "orders@example.invalid; manual@example.invalid", cc: "rep@example.invalid", bcc: ["copy@example.invalid"],
  } };
  const send = () => app().post(path + "/email").set("Idempotency-Key", key).send(body);
  sendEmail.mockClear();
  expect((await send()).status).toBe(200);
  expect((await send()).status).toBe(200);
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(sendEmail.mock.calls[0][1]).toMatchObject({
    to: ["orders@example.invalid", "manual@example.invalid"], cc: ["rep@example.invalid"], bcc: ["copy@example.invalid"],
    attachments: [{ content: pdf.body, contentType: "application/pdf" }],
  });
  const events = (await app().get(path)).body.data.timeline;
  expect(events.filter((event: { actionType: string }) => event.actionType === "EMAIL_ACCEPTED")).toEqual([
    expect.objectContaining({ newValues: expect.objectContaining({ revision: 0, providerMessageId: "gmail-accepted" }) }),
  ]);
});

test("ambiguous Gmail failure cannot trigger a second matching send even with a new key", async () => {
  const po = await create();
  await issue(po);
  const path = endpoint + "/" + po.id;
  const body = { revision: 0, subject: "Synthetic PO", message: "Please review", recipients: { to: "one@example.invalid" } };
  sendEmail.mockClear();
  sendEmail.mockRejectedValueOnce(markInvoiceEmailDeliveryFailure(new Error("synthetic timeout"), "needs_review"));
  const send = (key: string) => app().post(path + "/email").set("Idempotency-Key", key).send(body);
  const key = randomUUID();
  expect((await send(key)).status).toBe(409);
  expect((await send(key)).status).toBe(409);
  expect((await send(randomUUID())).status).toBe(409);
  expect(sendEmail).toHaveBeenCalledTimes(1);
});

test("legacy issued audit reconstructs original cost without treating the current total as historical", async () => {
  const po = await create();
  const path = endpoint + "/" + po.id;
  await db.insert(auditLogs).values({
    organizationId: org, userId: actor, entityType: "purchase_order", entityId: po.id, actionType: "ISSUE", description: "Legacy issuance",
    oldValues: po, newValues: { ...po, status: "issued" },
  });
  await db.update(purchaseOrders).set({ status: "issued" }).where(eq(purchaseOrders.id, po.id));
  expect((await app().get(path)).body.data.originalTotal).toBe("1920.00");
  const result = await app().patch(path + "/workflow").send({
    expectedVersion: po.version, revisionReason: "New vendor pricing",
    lineItems: [{ ...frames, id: po.lineItems[0].id, unitCost: "30" }, { ...freight, id: po.lineItems[1].id }],
  });
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject({ originalTotal: "1920.00", grandTotal: "1830.00" });
  expect((await app().get(path)).body.data.revisions[0]).toMatchObject({ revision: 0, source: "issued", reason: expect.stringContaining("recorded issuance") });

  const withoutHistory = await create();
  await db.update(purchaseOrders).set({ status: "issued", vendorId: foreignVendor }).where(eq(purchaseOrders.id, withoutHistory.id));
  const missingPath = endpoint + "/" + withoutHistory.id;
  const revised = await app().patch(missingPath).send({ expectedVersion: withoutHistory.version, revisionReason: "Document the current agreement" });
  expect(revised.status).toBe(200);
  expect(revised.body.data).toMatchObject({ originalTotal: null, vendor: null });
  expect((await app().get(missingPath)).body.data.revisions[0].source).toBe("legacy_capture");
  expect((await app().get(endpoint).query({ search: withoutHistory.poNumber })).body.data[0].vendor).toBeNull();
});

test("a legacy received PO can archive and send its saved agreement without fabricating original costs or reopening it", async () => {
  const po = await create();
  await db.update(purchaseOrders).set({ status: "received" }).where(eq(purchaseOrders.id, po.id));
  const path = endpoint + "/" + po.id;
  const archive = await app().post(path + "/archive-current").send({ expectedVersion: po.version });
  expect(archive.status).toBe(200);
  expect(archive.body.data).toMatchObject({ status: "received", originalTotal: null, revision: 0, grandTotal: "1920.00" });
  expect((await app().post(path + "/archive-current").send({ expectedVersion: archive.body.data.version })).status).toBe(409);
  expect((await app().get(path + "/revisions/0/pdf")).status).toBe(200);
  const send = await app().post(path + "/email").set("Idempotency-Key", randomUUID()).send({
    revision: 0, recipients: { to: ["orders@example.invalid"] }, subject: "Current agreement", message: "",
  });
  expect(send.status).toBe(200);
  const reloaded = (await app().get(path)).body.data;
  expect(reloaded.lineItems).toEqual(po.lineItems);
  expect(reloaded.timeline.map((event: { actionType: string }) => event.actionType)).toEqual(expect.arrayContaining(["ARCHIVE_AGREEMENT", "EMAIL_ACCEPTED"]));
});

test("receipts use the original purchase conversion atomically and actual costs never change stock or valuation", async () => {
  const [material] = await db.insert(materials).values({
    organizationId: org, name: "Synthetic frame stock", sku: randomUUID(), type: "sheet", costPerUnit: "1.00",
    materialForm: "sheet", inventoryUnit: "each", consumptionUnit: "each",
    inventoryUnitsPerPurchaseUnit: "12.000000", minimumPurchaseQuantity: "1.000000",
  }).returning();
  const materialLine = { ...line("Case of frames", "5", "24"), materialId: material.id };
  const po = await create(draft([materialLine]));
  const issued = await issue(po);
  const path = endpoint + "/" + po.id;
  const lineId = po.lineItems[0].id;
  const readMaterial = async () => (await db.select().from(materials).where(eq(materials.id, material.id)))[0];
  await db.update(materials).set({ inventoryUnitsPerPurchaseUnit: "6.000000" }).where(eq(materials.id, material.id));
  const before = await readMaterial();
  const receive = (items: { lineItemId: string; quantityToReceive: string }[]) =>
    app().post(path + "/receipts").send({ expectedVersion: issued.version, items });
  const valid = { lineItemId: lineId, quantityToReceive: "2" };
  expect((await receive([valid, { lineItemId: randomUUID(), quantityToReceive: "1" }])).status).toBe(400);
  expect(await readMaterial()).toEqual(before);
  const receipt = await receive([valid]);
  expect(receipt.status).toBe(200);
  expect((await readMaterial()).stockQuantity).toBe("24.000000");
  const adjustedMaterial = await readMaterial();
  const adjust = (quantity: string, final: boolean, expectedVersion: number) =>
    app().post(path + "/actual-costs").send({ lineId, quantity, unitCost: "29", final, expectedVersion, reason: "Vendor invoice", date: "2026-11-23" });
  expect((await adjust("3", true, receipt.body.data.version)).status).toBe(400);
  const provisional = await adjust("3", false, receipt.body.data.version);
  expect(provisional.body.data).toMatchObject({ actualTotal: "87.00", actualProvisional: true, status: "partially_received" });
  const confirmed = await adjust("2", true, provisional.body.data.version);
  expect(confirmed.body.data).toMatchObject({ actualTotal: "58.00", actualProvisional: false, status: "partially_received" });
  expect(await readMaterial()).toEqual(adjustedMaterial);
});

test("variant identity and receipt economics remain isolated across sibling Materials", async () => {
  const family = await families.createFamily({ organizationId: org, name: "Synthetic Canon M-Series Ink", dimensions: [{ key: "color", displayName: "Color" }, { key: "pack_size", displayName: "Pack Size" }] });
  const [color, size] = family.dimensions;
  const dimensions = (value: string, pack = "2 L") => [{ dimensionId: color.id, value }, { dimensionId: size.id, value: pack }];
  const fields = (name: string, sku: string, vendorCostPerUnit = 350, conversion = 2000) => ({
    name, sku, materialForm: "liquid", inventoryUnit: "milliliter", consumptionUnit: "milliliter",
    vendorCostUnit: "pack", inventoryUnitsPerPurchaseUnit: conversion, vendorCostPerUnit,
    preferredVendorId: vendorId, vendorSku: `V-${sku}`, stockQuantity: 0, minStockAlert: 20, costPerUnit: 0,
  });
  const variant = (material: ReturnType<typeof fields>, values: ReturnType<typeof dimensions>, organizationId = org) => families.createVariant({ organizationId, familyId: family.id, material, values });
  const [product] = await db.insert(products).values({ organizationId: org, name: "Synthetic Ink Product", description: "Receipt fixture" }).returning();
  const existing = await materialMutationService.create({ organizationId: org, material: fields("Cyan", "INK-STANDALONE") });
  const { material: cyan } = await families.createVariant({ organizationId: org, familyId: family.id, material: { ...fields("Cyan", "INK-CYAN"), linkedProductIds: [product.id] }, values: dimensions("Cyan") });
  const { material: magenta } = await variant(fields("Magenta", "INK-MAGENTA", 300), dimensions("Magenta"));
  const { material: yellow } = await variant(fields("Yellow", "INK-YELLOW"), dimensions("Yellow"));
  const { material: cyanSmall } = await variant(fields("Cyan small", "INK-CYAN-SMALL", 190, 1000), dimensions("Cyan", "1 L"));
  expect(new Set([cyan.id, magenta.id, yellow.id, cyanSmall.id]).size).toBe(4);
  expect((await families.getFamilyContext(org, family.id))?.variants).toHaveLength(4);
  const readMaterial = async (id: string) => (await db.select().from(materials).where(and(eq(materials.id, id), eq(materials.organizationId, org))))[0];
  expect((await readMaterial(existing.material.id)).materialFamilyId).toBeNull();
  expect(await db.select().from(materialProductLinks).where(eq(materialProductLinks.materialId, cyan.id))).toEqual([expect.objectContaining({ productId: product.id })]);

  await expect(variant(fields("SKU duplicate", " ink-cyan "), dimensions("Other"))).rejects.toMatchObject({ code: "MATERIAL_DUPLICATE_SKU" });
  await expect(variant(fields("Variant duplicate", "INK-OTHER"), dimensions(" cyan ").reverse())).rejects.toMatchObject({ code: "DUPLICATE_VARIANT" });
  await expect(materialFamilyAssignmentService.assign({ organizationId: org, materialId: existing.material.id, familyId: family.id, values: dimensions("CYAN") })).rejects.toMatchObject({ code: "DUPLICATE_VARIANT" });
  await expect(variant(fields("Missing dimensions", "INK-MISSING"), [{ dimensionId: color.id, value: "Missing" }])).rejects.toMatchObject({ code: "MISSING_DIMENSION_VALUE" });
  await expect(variant({ ...fields("Wrong tenant", "INK-WRONG"), preferredVendorId: foreignVendor }, dimensions("Other"), otherOrg)).rejects.toMatchObject({ code: "FAMILY_NOT_FOUND" });
  await expect(variant({ ...fields("Wrong vendor", "INK-WRONG-VENDOR"), preferredVendorId: foreignVendor }, dimensions("Other"))).rejects.toMatchObject({ code: "MATERIAL_VENDOR_NOT_FOUND" });
  await expect(materialMutationService.create({ organizationId: org, material: { ...fields("Bypass", "INK-BYPASS"), materialFamilyId: family.id } })).rejects.toMatchObject({ code: "MATERIAL_FAMILY_ASSIGNMENT_REQUIRED" });
  for (const sku of ["INK-OTHER", "INK-MISSING", "INK-WRONG", "INK-WRONG-VENDOR", "INK-BYPASS"]) expect(await db.select().from(materials).where(eq(materials.sku, sku))).toHaveLength(0);
  await expect(materialMutationService.create({ organizationId: otherOrg, material: { ...fields("Other tenant cyan", "INK-CYAN"), preferredVendorId: foreignVendor } })).resolves.toMatchObject({ created: true });

  const concurrent = async (attempts: ReturnType<typeof variant>[], code: string) => {
    const outcomes = await Promise.allSettled(attempts);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes).toContainEqual(expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ code }) }));
  };
  await concurrent([variant(fields("White", "INK-WHITE"), dimensions("White")), variant(fields("White alternate", "INK-WHITE-2"), dimensions("WHITE"))], "DUPLICATE_VARIANT");
  await concurrent([variant(fields("Black", "INK-SAME"), dimensions("Black")), variant(fields("Grey", "ink-same"), dimensions("Grey"))], "MATERIAL_DUPLICATE_SKU");
  expect((await families.getFamilyContext(org, family.id))?.variants).toHaveLength(6);

  const po = await create(draft([{ ...line("Cyan", "2", "360"), materialId: cyan.id }, { ...line("Magenta", "2", "300"), materialId: magenta.id }]));
  expect(po.lineItems).toMatchObject([{ materialId: cyan.id, inventoryUnitsPerPurchaseUnit: "2000.000000" }, { materialId: magenta.id }]);
  const issued = await issue(po);
  const receipt = { expectedVersion: issued.version, items: [{ lineItemId: po.lineItems[0].id, quantityToReceive: "1" }] };
  const path = `${endpoint}/${po.id}/receipts`;
  const beforeCyan = await readMaterial(cyan.id);
  const beforeMagenta = await readMaterial(magenta.id);
  expect((await app().post(path).send({ ...receipt, items: [...receipt.items, { lineItemId: randomUUID(), quantityToReceive: "1" }] })).status).toBe(400);
  expect(await readMaterial(cyan.id)).toEqual(beforeCyan);
  expect((await app().post(path).send(receipt)).status).toBe(200);
  expect((await app().post(path).send(receipt)).status).toBe(409);
  expect(await readMaterial(cyan.id)).toMatchObject({ stockQuantity: "2000.000000", costPerUnit: "0.1800", vendorLastPriceCents: 36000, minStockAlert: "20.00" });
  expect(await readMaterial(magenta.id)).toEqual(beforeMagenta);
  expect(await db.select().from(inventoryAdjustments).where(eq(inventoryAdjustments.materialId, cyan.id))).toEqual([expect.objectContaining({ type: "purchase_receipt", reason: `PO receipt ${po.poNumber}`, quantityChange: "2000.000000" })]);
  expect(await db.select().from(inventoryAdjustments).where(eq(inventoryAdjustments.materialId, magenta.id))).toHaveLength(0);
});
