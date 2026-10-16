import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "@jest/globals";
import { and, eq } from "drizzle-orm";
import express from "express";
import request from "supertest";

import { auditLogs, customers, organizations, pbv2TreeVersions, products, quoteLineItems, quotes, users } from "@shared/schema";
import { db } from "../db";
import { registerQuoteRoutes } from "../routes/quotes.routes";

const created: Array<{ organizationId: string; userId: string }> = [];

async function fixture() {
  const suffix = randomUUID();
  const [organization] = await db.insert(organizations).values({ name: `Quote save ${suffix}`, slug: `quote-save-${suffix}` }).returning();
  const [user] = await db.insert(users).values({ email: `quote-save-${suffix}@example.test`, firstName: "Quote", lastName: "Save", role: "admin" }).returning();
  created.push({ organizationId: organization.id, userId: user.id });
  const [product] = await db.insert(products).values({ organizationId: organization.id, name: "Synthetic product", description: "Disposable test product" }).returning();
  const [tree] = await db.insert(pbv2TreeVersions).values({ organizationId: organization.id, productId: product.id, status: "ACTIVE", schemaVersion: 2, treeJson: { schemaVersion: 2, status: "ACTIVE", rootNodeIds: [], nodes: {}, edges: [], meta: { pricingV2: { base: { perPieceCents: 1000 } } } } }).returning();
  await db.update(products).set({ pbv2ActiveTreeVersionId: tree.id }).where(eq(products.id, product.id));
  const [quote] = await db.insert(quotes).values({ organizationId: organization.id, userId: user.id, status: "draft", customerName: "Fixture", shippingMethod: "ship", shippingCents: 500, shipToAddress1: "99 Custom Lane", shipToState: "IN" }).returning();
  const [line] = await db.insert(quoteLineItems).values({ quoteId: quote.id, productId: product.id, productName: product.name, width: "1", height: "1", quantity: 1, pbv2SnapshotJson: {}, linePrice: "10", priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "" } }).returning();
  const app = express();
  app.use(express.json());
  registerQuoteRoutes(app, {
    isAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => { Object.assign(req, { user: { id: user.id, role: "admin" } }); next(); },
    isAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => { Object.assign(req, { organizationId: organization.id, orgRole: "admin" }); next(); },
  });
  return { app, organization, user, product, quote, line };
}

const lineData = (productId: string, changes: Record<string, unknown> = {}) => ({
  productId, productName: "Synthetic product", width: 1, height: 1, quantity: 1,
  optionSelectionsJson: null, description: null, status: "active", ...changes,
});

async function stored(quoteId: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  const lines = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
  const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "quote"), eq(auditLogs.entityId, quoteId)));
  return { quote, lines, audits };
}

afterEach(async () => {
  for (const row of created.splice(0)) {
    await db.delete(quotes).where(eq(quotes.organizationId, row.organizationId));
    await db.delete(organizations).where(eq(organizations.id, row.organizationId));
    await db.delete(users).where(eq(users.id, row.userId));
  }
});

describe("normal Quote editor save on isolated PostgreSQL", () => {
  test("header and existing-line changes commit together; a no-op leaves revision and audit alone", async () => {
    const f = await fixture();
    const before = await stored(f.quote.id);
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision,
      header: { customerNotes: "Saved with line", shipToAddress1: "99 Custom Lane" },
      lines: { create: [], update: [{ id: f.line.id, data: lineData(f.product.id, { description: "Updated line", productionNotes: "Internal production note" }) }], delete: [] },
    });
    expect(saved.status).toBe(200);
    const after = await stored(f.quote.id);
    expect(after.quote.customerNotes).toBe("Saved with line");
    expect(after.quote.shipToAddress1).toBe("99 Custom Lane");
    expect(after.lines[0].description).toBe("Updated line");
    expect(after.lines[0].productionNotes).toBe("Internal production note");
    expect(after.quote.revision).toBeGreaterThan(before.quote.revision);
    expect(after.audits).toHaveLength(1);
    expect(saved.body.quote.revision).toBe(after.quote.revision);
    const noop = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: after.quote.revision, header: { customerNotes: "Saved with line" }, lines: { create: [], update: [], delete: [] } });
    expect(noop.status).toBe(200);
    expect(noop.body.changed).toBe(false);
    const afterNoop = await stored(f.quote.id);
    expect(afterNoop.quote.revision).toBe(after.quote.revision);
    expect(afterNoop.audits).toHaveLength(1);
  });

  test("a failed later line validation rolls back header, lines, revision, and audit", async () => {
    const f = await fixture();
    const before = await stored(f.quote.id);
    const failed = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision, header: { customerNotes: "Must roll back" },
      lines: { create: [], update: [{ id: f.line.id, data: lineData(randomUUID(), { description: "Invalid product" }) }], delete: [] },
    });
    expect(failed.status).toBe(404);
    const after = await stored(f.quote.id);
    expect(after.quote.customerNotes).toBe(before.quote.customerNotes);
    expect(after.quote.revision).toBe(before.quote.revision);
    expect(after.lines).toEqual(before.lines);
    expect(after.audits).toEqual(before.audits);
  });

  test("add and remove with a header edit use canonical totals and one transaction", async () => {
    const f = await fixture();
    const revision = (await stored(f.quote.id)).quote.revision;
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: revision, header: { label: "Replacement line" },
      lines: { create: [{ clientKey: "local-new-line", data: lineData(f.product.id) }], update: [], delete: [f.line.id] },
    });
    expect(saved.status).toBe(200);
    const after = await stored(f.quote.id);
    expect(after.quote.label).toBe("Replacement line");
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0].id).not.toBe(f.line.id);
    expect(saved.body.created).toEqual([{ clientKey: "local-new-line", id: after.lines[0].id }]);
    expect(Number(after.quote.subtotal)).toBe(Number(after.lines[0].linePrice));
    expect(Number(after.quote.totalPrice)).toBe(Number(after.quote.subtotal) + 5);
    expect(after.audits).toHaveLength(1);
    const retry = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: revision, header: { label: "Replacement line" },
      lines: { create: [{ clientKey: "local-new-line", data: lineData(f.product.id) }], update: [], delete: [f.line.id] },
    });
    expect(retry.status).toBe(409);
    expect((await stored(f.quote.id)).lines).toHaveLength(1);
  });

  test("a header-only save does not rewrite an unchanged line", async () => {
    const f = await fixture();
    const before = await stored(f.quote.id);
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision, header: { label: "Header only" },
      lines: { create: [], update: [], delete: [] },
    });
    expect(saved.status).toBe(200);
    expect((await stored(f.quote.id)).lines).toEqual(before.lines);
  });

  test("concurrent saves using one reviewed revision accept at most one change", async () => {
    const f = await fixture();
    const revision = (await stored(f.quote.id)).quote.revision;
    const save = (customerNotes: string) => request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: revision, header: { customerNotes }, lines: { create: [], update: [], delete: [] } });
    const responses = await Promise.all([save("First"), save("Second")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await stored(f.quote.id)).audits).toHaveLength(1);
  });

  test("missing or foreign line references reject without a partial header write", async () => {
    const f = await fixture();
    const other = await fixture();
    const before = await stored(f.quote.id);
    const failed = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: before.quote.revision, header: { label: "Should not save" }, lines: { create: [], update: [], delete: [randomUUID()] } });
    expect(failed.status).toBe(409);
    const foreign = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: before.quote.revision, header: { label: "Should not save" }, lines: { create: [], update: [], delete: [other.line.id] } });
    expect(foreign.status).toBe(409);
    expect((await stored(f.quote.id)).quote).toEqual(before.quote);
    expect((await stored(other.quote.id)).lines).toHaveLength(1);
  });

  test("a full editor header payload with unchanged values is a true no-op", async () => {
    const f = await fixture();
    const before = await stored(f.quote.id);
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision,
      header: {
        customerId: null, contactId: null, customerName: "Fixture", label: null,
        requestedDueDate: null, shippingMethod: "ship", shippingCents: 500,
        shippingInstructions: null, customerNotes: null, discountAmount: Number(before.quote.discountAmount ?? 0),
        tags: [],
        subtotal: 999999, totalPrice: 999999, source: "internal",
      },
      lines: { create: [], update: [], delete: [] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.changed).toBe(false);
    const after = await stored(f.quote.id);
    expect(after.quote.revision).toBe(before.quote.revision);
    expect(after.audits).toEqual(before.audits);
    expect(after.lines).toEqual(before.lines);
  });

  test("explicit address clears and due date survive readback", async () => {
    const f = await fixture();
    const revision = (await stored(f.quote.id)).quote.revision;
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: revision, header: { shipToAddress1: "", shipToState: null, requestedDueDate: "2026-11-15T00:00:00.000Z" }, lines: { create: [], update: [], delete: [] } });
    expect(saved.status).toBe(200);
    const persisted = (await stored(f.quote.id)).quote;
    expect(persisted.shipToAddress1).toBe("");
    expect(persisted.shipToState).toBeNull();
    expect(new Date(String(persisted.requestedDueDate)).toISOString().slice(0, 10)).toBe("2026-11-15");
  });

  test("changing the customer preserves the entire saved custom destination snapshot", async () => {
    const f = await fixture();
    const [customer] = await db.insert(customers).values({
      organizationId: f.organization.id, companyName: "Synthetic new customer",
      shippingStreet1: "Customer default street", shippingCity: "Default City", shippingState: "CA",
    }).returning();
    const revision = (await stored(f.quote.id)).quote.revision;
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: revision, header: { customerId: customer.id },
      lines: { create: [], update: [], delete: [] },
    });
    expect(saved.status).toBe(200);
    const persisted = (await stored(f.quote.id)).quote;
    expect(persisted.customerId).toBe(customer.id);
    expect(persisted.billToCompany).toBe("Synthetic new customer");
    expect(persisted.shipToAddress1).toBe("99 Custom Lane");
    expect(persisted.shipToState).toBe("IN");
    expect(persisted.shipToCity).toBeNull();
  });

  test("a locked Quote rejects normal editor saves without changing its lines or audit", async () => {
    const f = await fixture();
    await db.update(quotes).set({ status: "active" }).where(eq(quotes.id, f.quote.id));
    const before = await stored(f.quote.id);
    const response = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision, header: { label: "Must remain unchanged" },
      lines: { create: [], update: [{ id: f.line.id, data: lineData(f.product.id, { description: "Must remain unchanged" }) }], delete: [] },
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("QUOTE_NOT_EDITABLE");
    expect(await stored(f.quote.id)).toEqual(before);
  });

  test("normal save preserves a canonical total price override and recalculates Quote totals", async () => {
    const f = await fixture();
    const revision = (await stored(f.quote.id)).quote.revision;
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: revision, header: {}, lines: {
        create: [], delete: [], update: [{ id: f.line.id, data: lineData(f.product.id, {
          priceOverrideMode: "override_total_after_margin", priceOverrideValueCents: 4000,
          overridePriceCents: 4000, priceOverride: { mode: "override_total_after_margin", valueCents: 4000 },
        }) }],
      },
    });
    expect(saved.status).toBe(200);
    const after = await stored(f.quote.id);
    expect(after.lines[0].overridePriceCents).toBe(4000);
    expect(Number(after.lines[0].linePrice)).toBe(40);
    expect((after.lines[0].specsJson as { priceOverride?: { mode?: string } })?.priceOverride?.mode).toBe("override_total_after_margin");
    expect(Number(after.quote.subtotal)).toBe(40);
    expect(Number(after.quote.totalPrice)).toBe(45);
  });
});
