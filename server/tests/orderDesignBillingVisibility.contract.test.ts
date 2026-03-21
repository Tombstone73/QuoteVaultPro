import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { OrdersRepository } from "../storage/orders.repo";
import { listOrderDesignBillingVisibility, syncDesignCostSummary } from "../services/designCostSummaryService";
import {
  auditLogs,
  customers,
  organizations,
  products,
  userOrganizations,
  users,
} from "@shared/schema";

const ordersRepo = new OrdersRepository(db);

function createApp(opts: { organizationId: string }) {
  const app = express();

  app.get("/api/orders/:orderId/design-billing-visibility", async (req, res) => {
    try {
      const items = await listOrderDesignBillingVisibility({
        organizationId: opts.organizationId,
        orderId: String(req.params.orderId),
      });

      if (items === null) {
        return res.status(404).json({ message: "Order not found" });
      }

      return res.json({ success: true, data: items });
    } catch (error) {
      return res.status(500).json({ message: String(error) });
    }
  });

  return app;
}

describe("order design billing visibility contract", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const organizationId = `org_design_visibility_${suffix}`;
  const userId = `user_design_visibility_${suffix}`;
  const customerId = `cust_design_visibility_${suffix}`;
  const productId = `prod_design_visibility_${suffix}`;

  let orderId = "";
  let noDesignLineItemId = "";
  let hourlyLineItemId = "";
  let overageLineItemId = "";
  let flatFeeLineItemId = "";
  let missingSummaryLineItemId = "";

  beforeAll(async () => {
    await db.insert(organizations).values({ id: organizationId, name: `Design Visibility ${suffix}`, slug: `design-visibility-${suffix}` });
    await db.insert(users).values({ id: userId, email: `design-visibility-${suffix}@example.com`, role: "owner", isAdmin: true } as any);
    await db.insert(userOrganizations).values({ userId, organizationId, role: "owner", isDefault: true });
    await db.insert(customers).values({ id: customerId, organizationId, companyName: "Design Visibility Customer", status: "active" } as any);
    await db.insert(products).values({
      id: productId,
      organizationId,
      name: "Design Visibility Product",
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
        { productId, productType: "wide_roll", description: "No Design", width: 12, height: 18, quantity: 1, unitPrice: 20, totalPrice: 20, status: "new", requiresDesign: false, requiresPrepress: true, selectedOptions: [] },
        { productId, productType: "wide_roll", description: "Hourly Design", width: 12, height: 18, quantity: 1, unitPrice: 30, totalPrice: 30, status: "new", requiresDesign: true, requiresPrepress: true, selectedOptions: [] },
        { productId, productType: "wide_roll", description: "Overage Design", width: 12, height: 18, quantity: 1, unitPrice: 40, totalPrice: 40, status: "new", requiresDesign: true, requiresPrepress: true, selectedOptions: [] },
        { productId, productType: "wide_roll", description: "Flat Fee Design", width: 12, height: 18, quantity: 1, unitPrice: 50, totalPrice: 50, status: "new", requiresDesign: true, requiresPrepress: true, selectedOptions: [] },
        { productId, productType: "wide_roll", description: "Needs Summary", width: 12, height: 18, quantity: 1, unitPrice: 60, totalPrice: 60, status: "new", requiresDesign: true, requiresPrepress: true, selectedOptions: [] },
      ],
    } as any);

    orderId = createdOrder.id;
    [noDesignLineItemId, hourlyLineItemId, overageLineItemId, flatFeeLineItemId, missingSummaryLineItemId] = createdOrder.lineItems.map((item) => item.id);

    await db.execute(sql`
      update order_line_items
      set
        requires_design_snapshot = false,
        design_pricing_mode_snapshot = 'none',
        included_design_minutes_snapshot = null,
        flat_fee_amount_snapshot = null,
        hourly_rate_snapshot = null,
        overage_rate_snapshot = null,
        internal_labor_rate_snapshot = null,
        needs_design_override = null,
        requires_design = false
      where id = ${noDesignLineItemId}
    `);

    await db.execute(sql`
      update order_line_items
      set
        requires_design_snapshot = true,
        design_pricing_mode_snapshot = 'hourly',
        hourly_rate_snapshot = 120.00,
        internal_labor_rate_snapshot = 30.00,
        requires_design = true
      where id = ${hourlyLineItemId}
    `);

    await db.execute(sql`
      update order_line_items
      set
        requires_design_snapshot = true,
        design_pricing_mode_snapshot = 'included_minutes_plus_overage',
        included_design_minutes_snapshot = 60,
        overage_rate_snapshot = 80.00,
        internal_labor_rate_snapshot = 40.00,
        requires_design = true
      where id = ${overageLineItemId}
    `);

    await db.execute(sql`
      update order_line_items
      set
        requires_design_snapshot = true,
        design_pricing_mode_snapshot = 'flat_fee',
        flat_fee_amount_snapshot = 150.00,
        internal_labor_rate_snapshot = 50.00,
        requires_design = true
      where id = ${flatFeeLineItemId}
    `);

    await db.execute(sql`
      update order_line_items
      set
        requires_design_snapshot = true,
        design_pricing_mode_snapshot = 'hourly',
        hourly_rate_snapshot = 95.00,
        internal_labor_rate_snapshot = 35.00,
        requires_design = true
      where id = ${missingSummaryLineItemId}
    `);

    await db.insert(auditLogs).values([
      {
        organizationId,
        userId,
        userName: `design-visibility-${suffix}@example.com`,
        actionType: "design_session_started",
        entityType: "order_line_item",
        entityId: hourlyLineItemId,
        entityName: `Line item ${hourlyLineItemId}`,
        description: "Started design session",
        newValues: { sessionState: "active" },
        createdAt: new Date("2026-03-20T10:00:00.000Z"),
      },
      {
        organizationId,
        userId,
        userName: `design-visibility-${suffix}@example.com`,
        actionType: "design_session_paused",
        entityType: "order_line_item",
        entityId: hourlyLineItemId,
        entityName: `Line item ${hourlyLineItemId}`,
        description: "Paused design session",
        newValues: { sessionState: "paused" },
        createdAt: new Date("2026-03-20T10:45:00.000Z"),
      },
      {
        organizationId,
        userId,
        userName: `design-visibility-${suffix}@example.com`,
        actionType: "design_session_started",
        entityType: "order_line_item",
        entityId: overageLineItemId,
        entityName: `Line item ${overageLineItemId}`,
        description: "Started design session",
        newValues: { sessionState: "active" },
        createdAt: new Date("2026-03-20T11:00:00.000Z"),
      },
      {
        organizationId,
        userId,
        userName: `design-visibility-${suffix}@example.com`,
        actionType: "design_session_paused",
        entityType: "order_line_item",
        entityId: overageLineItemId,
        entityName: `Line item ${overageLineItemId}`,
        description: "Paused design session",
        newValues: { sessionState: "paused" },
        createdAt: new Date("2026-03-20T12:30:00.000Z"),
      },
      {
        organizationId,
        userId,
        userName: `design-visibility-${suffix}@example.com`,
        actionType: "design_session_started",
        entityType: "order_line_item",
        entityId: flatFeeLineItemId,
        entityName: `Line item ${flatFeeLineItemId}`,
        description: "Started design session",
        newValues: { sessionState: "active" },
        createdAt: new Date("2026-03-20T13:00:00.000Z"),
      },
      {
        organizationId,
        userId,
        userName: `design-visibility-${suffix}@example.com`,
        actionType: "design_session_paused",
        entityType: "order_line_item",
        entityId: flatFeeLineItemId,
        entityName: `Line item ${flatFeeLineItemId}`,
        description: "Paused design session",
        newValues: { sessionState: "paused" },
        createdAt: new Date("2026-03-20T14:30:00.000Z"),
      },
    ] as any);

    await syncDesignCostSummary({ organizationId, lineItemId: noDesignLineItemId });
    await syncDesignCostSummary({ organizationId, lineItemId: hourlyLineItemId });
    await syncDesignCostSummary({ organizationId, lineItemId: overageLineItemId });
    await syncDesignCostSummary({ organizationId, lineItemId: flatFeeLineItemId });
  });

  afterAll(async () => {
    await db.execute(sql`delete from line_item_design_cost_summaries where organization_id = ${organizationId}`);
    await db.execute(sql`delete from audit_logs where organization_id = ${organizationId}`);
    await db.execute(sql`delete from order_line_items where order_id = ${orderId}`);
    await db.execute(sql`delete from orders where id = ${orderId}`);
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(userOrganizations).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.organizationId, organizationId)));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  });

  test("GET returns mixed design billing visibility without mutating billing truth", async () => {
    const app = createApp({ organizationId });

    const res = await request(app).get(`/api/orders/${orderId}/design-billing-visibility`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(5);

    const noDesign = res.body.data.find((item: any) => item.lineItemId === noDesignLineItemId);
    expect(noDesign.visibilityState).toBe("not_applicable");
    expect(noDesign.billingStatus).toBe("not_billable");

    const hourly = res.body.data.find((item: any) => item.lineItemId === hourlyLineItemId);
    expect(hourly.visibilityState).toBe("available");
    expect(hourly.billingStatus).toBe("candidate");
    expect(hourly.billableDesignAmount).toBe(90);
    expect(hourly.soldDesignAmount).toBeNull();

    const overage = res.body.data.find((item: any) => item.lineItemId === overageLineItemId);
    expect(overage.visibilityState).toBe("available");
    expect(overage.billingStatus).toBe("candidate");
    expect(overage.billableDesignAmount).toBe(40);

    const flatFee = res.body.data.find((item: any) => item.lineItemId === flatFeeLineItemId);
    expect(flatFee.visibilityState).toBe("available");
    expect(flatFee.billingStatus).toBe("not_billable");
    expect(flatFee.soldDesignAmount).toBe(150);
    expect(flatFee.billableDesignAmount).toBe(0);

    const missingSummary = res.body.data.find((item: any) => item.lineItemId === missingSummaryLineItemId);
    expect(missingSummary.visibilityState).toBe("no_summary");
    expect(missingSummary.billingStatus).toBeNull();
    expect(missingSummary.billableDesignAmount).toBeNull();
    expect(missingSummary.soldDesignAmount).toBeNull();
  });

  test("returns 404 when order is outside the scoped organization", async () => {
    const app = createApp({ organizationId: `other_${organizationId}` });
    const res = await request(app).get(`/api/orders/${orderId}/design-billing-visibility`);
    expect(res.status).toBe(404);
  });
});