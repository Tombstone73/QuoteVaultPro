import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import { db } from "../db";
import {
  customers,
  insertOrderInternalNoteSchema,
  insertOrderLineItemNoteSchema,
  orderLineItems,
  orders,
  organizations,
  products,
  userOrganizations,
  users,
} from "@shared/schema";
import { OrdersRepository } from "../storage/orders.repo";
import { addLineItemNote, addOrderInternalNote, listLineItemNotes, listOrderInternalNotes } from "../services/structuredOrderNotesService";

const ordersRepo = new OrdersRepository(db);

function createApp(opts: { organizationId: string; userId: string }) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: opts.userId, email: `${opts.userId}@example.com`, role: "owner" };
    req.organizationId = opts.organizationId;
    next();
  });

  app.get("/api/orders/:orderId/internal-notes", async (req: any, res) => {
    try {
      const notes = await listOrderInternalNotes({
        organizationId: opts.organizationId,
        orderId: String(req.params.orderId),
      });

      if (notes === null) {
        return res.status(404).json({ message: "Order not found" });
      }

      return res.json({ success: true, data: notes, message: "Order internal notes loaded" });
    } catch (error) {
      return res.status(500).json({ message: String(error) });
    }
  });

  app.post("/api/orders/:orderId/internal-notes", async (req: any, res) => {
    try {
      const parsed = insertOrderInternalNoteSchema.parse(req.body ?? {});
      const note = await addOrderInternalNote({
        organizationId: opts.organizationId,
        orderId: String(req.params.orderId),
        userId: opts.userId,
        values: parsed,
      });

      if (!note) {
        return res.status(404).json({ message: "Order not found" });
      }

      return res.status(201).json({ success: true, data: note, message: "Order internal note added" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      return res.status(500).json({ message: String(error) });
    }
  });

  app.get("/api/orders/:orderId/line-items/:lineItemId/notes", async (req: any, res) => {
    try {
      const notes = await listLineItemNotes({
        organizationId: opts.organizationId,
        orderId: String(req.params.orderId),
        lineItemId: String(req.params.lineItemId),
        category: typeof req.query.category === "string" ? req.query.category : null,
      });

      if (notes === null) {
        return res.status(404).json({ message: "Order line item not found for this order" });
      }

      return res.json({ success: true, data: notes, message: "Line item notes loaded" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      return res.status(500).json({ message: String(error) });
    }
  });

  app.post("/api/orders/:orderId/line-items/:lineItemId/notes", async (req: any, res) => {
    try {
      const parsed = insertOrderLineItemNoteSchema.parse(req.body ?? {});
      const note = await addLineItemNote({
        organizationId: opts.organizationId,
        orderId: String(req.params.orderId),
        lineItemId: String(req.params.lineItemId),
        userId: opts.userId,
        values: parsed,
      });

      if (!note) {
        return res.status(404).json({ message: "Order line item not found for this order" });
      }

      return res.status(201).json({ success: true, data: note, message: "Line item note added" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      return res.status(500).json({ message: String(error) });
    }
  });

  return app;
}

describe("structured order notes contract", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const organizationId = `org_structured_notes_${suffix}`;
  const userId = `user_structured_notes_${suffix}`;
  const customerId = `cust_structured_notes_${suffix}`;
  const productId = `prod_structured_notes_${suffix}`;

  let orderId = "";
  let otherOrderId = "";
  let lineItemId = "";

  beforeAll(async () => {
    await db.insert(organizations).values({ id: organizationId, name: `Structured Notes ${suffix}`, slug: `structured-notes-${suffix}` });
    await db.insert(users).values({ id: userId, email: `structured-notes-${suffix}@example.com`, role: "owner", isAdmin: true } as any);
    await db.insert(userOrganizations).values({ userId, organizationId, role: "owner", isDefault: true });
    await db.insert(customers).values({ id: customerId, organizationId, companyName: "Structured Notes Customer", status: "active" } as any);
    await db.insert(products).values({
      id: productId,
      organizationId,
      name: "Structured Notes Product",
      description: "test product",
      pricingProfileKey: "default",
      pricingFormula: "1",
      pricingMode: "flat",
      isTaxable: true,
      isActive: true,
    } as any);

    const createdOrder = await ordersRepo.createOrder(organizationId, {
      customerId,
      createdByUserId: userId,
      lineItems: [
        {
          productId,
          productType: "wide_roll",
          description: "Structured Notes Item",
          width: 12,
          height: 18,
          quantity: 1,
          unitPrice: 20,
          totalPrice: 20,
          status: "new",
          requiresDesign: false,
          requiresPrepress: true,
          selectedOptions: [],
        },
      ],
    } as any);

    orderId = createdOrder.id;
    lineItemId = createdOrder.lineItems[0].id;

    const otherOrder = await ordersRepo.createOrder(organizationId, {
      customerId,
      createdByUserId: userId,
      lineItems: [
        {
          productId,
          productType: "wide_roll",
          description: "Structured Notes Other Item",
          width: 10,
          height: 10,
          quantity: 1,
          unitPrice: 10,
          totalPrice: 10,
          status: "new",
          requiresDesign: false,
          requiresPrepress: true,
          selectedOptions: [],
        },
      ],
    } as any);

    otherOrderId = otherOrder.id;
  });

  afterAll(async () => {
    await db.execute(sql`delete from order_line_item_notes where organization_id = ${organizationId}`);
    await db.execute(sql`delete from order_internal_notes where organization_id = ${organizationId}`);
    await db.execute(sql`delete from order_line_items where order_id in (select id from orders where organization_id = ${organizationId})`);
    await db.execute(sql`delete from orders where organization_id = ${organizationId}`);
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(userOrganizations).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.organizationId, organizationId)));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  });

  test("GET returns empty arrays when no notes exist", async () => {
    const app = createApp({ organizationId, userId });

    const orderRes = await request(app).get(`/api/orders/${orderId}/internal-notes`);
    expect(orderRes.status).toBe(200);
    expect(orderRes.body.success).toBe(true);
    expect(orderRes.body.data).toEqual([]);

    const lineItemRes = await request(app).get(`/api/orders/${orderId}/line-items/${lineItemId}/notes?category=internal`);
    expect(lineItemRes.status).toBe(200);
    expect(lineItemRes.body.success).toBe(true);
    expect(lineItemRes.body.data).toEqual([]);
  });

  test("POST rejects blank note text", async () => {
    const app = createApp({ organizationId, userId });

    const orderRes = await request(app)
      .post(`/api/orders/${orderId}/internal-notes`)
      .send({ noteText: "   " });
    expect(orderRes.status).toBe(400);

    const lineItemRes = await request(app)
      .post(`/api/orders/${orderId}/line-items/${lineItemId}/notes`)
      .send({ category: "internal", noteText: "   " });
    expect(lineItemRes.status).toBe(400);
  });

  test("POST creates order internal note correctly", async () => {
    const app = createApp({ organizationId, userId });

    const res = await request(app)
      .post(`/api/orders/${orderId}/internal-notes`)
      .send({ noteText: "Order-level note" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.noteText).toBe("Order-level note");

    const listRes = await request(app).get(`/api/orders/${orderId}/internal-notes`);
    expect(listRes.body.data.some((note: any) => note.noteText === "Order-level note")).toBe(true);
  });

  test("POST creates line-item internal and design working notes correctly", async () => {
    const app = createApp({ organizationId, userId });

    const internalRes = await request(app)
      .post(`/api/orders/${orderId}/line-items/${lineItemId}/notes`)
      .send({ category: "internal", noteText: "Line-item internal note" });

    expect(internalRes.status).toBe(201);
    expect(internalRes.body.data.category).toBe("internal");

    const workingRes = await request(app)
      .post(`/api/orders/${orderId}/line-items/${lineItemId}/notes`)
      .send({ category: "design_working", noteText: "Design working note" });

    expect(workingRes.status).toBe(201);
    expect(workingRes.body.data.category).toBe("design_working");

    const filteredRes = await request(app)
      .get(`/api/orders/${orderId}/line-items/${lineItemId}/notes?category=design_working`);

    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.data).toHaveLength(1);
    expect(filteredRes.body.data[0].noteText).toBe("Design working note");
  });

  test("line item notes route rejects invalid category and order/lineItem mismatch", async () => {
    const app = createApp({ organizationId, userId });

    const invalidCategoryRes = await request(app)
      .post(`/api/orders/${orderId}/line-items/${lineItemId}/notes`)
      .send({ category: "bad_category", noteText: "Nope" });

    expect(invalidCategoryRes.status).toBe(400);

    const mismatchRes = await request(app)
      .post(`/api/orders/${otherOrderId}/line-items/${lineItemId}/notes`)
      .send({ category: "internal", noteText: "Mismatch" });

    expect(mismatchRes.status).toBe(404);
  });
});