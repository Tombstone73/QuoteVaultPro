import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { OrdersRepository } from "../storage/orders.repo";
import { getDesignCostSummaryByLineItemId, syncDesignCostSummary } from "../services/designCostSummaryService";
import {
  auditLogs,
  customers,
  organizations,
  products,
  userOrganizations,
  users,
} from "@shared/schema";

const ordersRepo = new OrdersRepository(db);

describe("design cost summary contract", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const organizationId = `org_design_cost_${suffix}`;
  const userId = `user_design_cost_${suffix}`;
  const customerId = `cust_design_cost_${suffix}`;
  const productId = `prod_design_cost_${suffix}`;

  let orderId = "";
  let noDesignLineItemId = "";
  let hourlyLineItemId = "";
  let overageLineItemId = "";
  let flatFeeLineItemId = "";

  beforeAll(async () => {
    await db.insert(organizations).values({ id: organizationId, name: `Design Cost ${suffix}`, slug: `design-cost-${suffix}` });
    await db.insert(users).values({ id: userId, email: `design-cost-${suffix}@example.com`, role: "owner", isAdmin: true } as any);
    await db.insert(userOrganizations).values({ userId, organizationId, role: "owner", isDefault: true });
    await db.insert(customers).values({ id: customerId, organizationId, companyName: "Design Cost Customer", status: "active" } as any);
    await db.insert(products).values({
      id: productId,
      organizationId,
      name: "Design Cost Product",
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
          description: "No Design",
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
        {
          productId,
          productType: "wide_roll",
          description: "Hourly Design",
          width: 12,
          height: 18,
          quantity: 1,
          unitPrice: 30,
          totalPrice: 30,
          status: "new",
          requiresDesign: true,
          requiresPrepress: true,
          selectedOptions: [],
        },
        {
          productId,
          productType: "wide_roll",
          description: "Overage Design",
          width: 12,
          height: 18,
          quantity: 1,
          unitPrice: 40,
          totalPrice: 40,
          status: "new",
          requiresDesign: true,
          requiresPrepress: true,
          selectedOptions: [],
        },
        {
          productId,
          productType: "wide_roll",
          description: "Flat Fee Design",
          width: 12,
          height: 18,
          quantity: 1,
          unitPrice: 50,
          totalPrice: 50,
          status: "new",
          requiresDesign: true,
          requiresPrepress: true,
          selectedOptions: [],
        },
      ],
    } as any);

    orderId = createdOrder.id;
    [noDesignLineItemId, hourlyLineItemId, overageLineItemId, flatFeeLineItemId] = createdOrder.lineItems.map((item) => item.id);

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
        included_design_minutes_snapshot = null,
        flat_fee_amount_snapshot = null,
        hourly_rate_snapshot = 120.00,
        overage_rate_snapshot = null,
        internal_labor_rate_snapshot = 30.00,
        needs_design_override = null,
        requires_design = true
      where id = ${hourlyLineItemId}
    `);

    await db.execute(sql`
      update order_line_items
      set
        requires_design_snapshot = true,
        design_pricing_mode_snapshot = 'included_minutes_plus_overage',
        included_design_minutes_snapshot = 60,
        flat_fee_amount_snapshot = null,
        hourly_rate_snapshot = null,
        overage_rate_snapshot = 80.00,
        internal_labor_rate_snapshot = 40.00,
        needs_design_override = null,
        requires_design = true
      where id = ${overageLineItemId}
    `);

    await db.execute(sql`
      update order_line_items
      set
        requires_design_snapshot = true,
        design_pricing_mode_snapshot = 'flat_fee',
        included_design_minutes_snapshot = null,
        flat_fee_amount_snapshot = 150.00,
        hourly_rate_snapshot = null,
        overage_rate_snapshot = null,
        internal_labor_rate_snapshot = 50.00,
        needs_design_override = null,
        requires_design = true
      where id = ${flatFeeLineItemId}
    `);
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

  async function addAuditEvent(args: {
    lineItemId: string;
    actionType: string;
    description: string;
    createdAt: string;
    newValues?: Record<string, unknown> | null;
  }) {
    await db.insert(auditLogs).values({
      organizationId,
      userId,
      userName: `design-cost-${suffix}@example.com`,
      actionType: args.actionType,
      entityType: "order_line_item",
      entityId: args.lineItemId,
      entityName: `Line item ${args.lineItemId}`,
      description: args.description,
      newValues: args.newValues ?? null,
      createdAt: new Date(args.createdAt),
    } as any);
  }

  test("returns a safe not-applicable summary when design does not apply", async () => {
    const summary = await syncDesignCostSummary({ organizationId, lineItemId: noDesignLineItemId });

    expect(summary).not.toBeNull();
    expect(summary?.designCostState).toBe("not_applicable");
    expect(summary?.actualTrackedMinutes).toBe(0);
    expect(summary?.correctedTrackedMinutes).toBe(0);
    expect(summary?.internalDesignCostCalculated).toBeNull();
    expect(summary?.soldDesignAmount).toBeNull();
    expect(summary?.billableDesignAmount).toBe(0);
    expect(summary?.billingStatus).toBe("not_billable");
  });

  test("tracked time changes affect hourly summary without mutating sold design amount", async () => {
    await addAuditEvent({
      lineItemId: hourlyLineItemId,
      actionType: "design_session_started",
      description: "Started design session",
      createdAt: "2026-03-20T10:00:00.000Z",
      newValues: { sessionState: "active" },
    });
    await addAuditEvent({
      lineItemId: hourlyLineItemId,
      actionType: "design_session_paused",
      description: "Paused design session",
      createdAt: "2026-03-20T10:30:00.000Z",
      newValues: { sessionState: "paused" },
    });
    await addAuditEvent({
      lineItemId: hourlyLineItemId,
      actionType: "design_time_adjusted",
      description: "Adjusted tracked design time",
      createdAt: "2026-03-20T10:35:00.000Z",
      newValues: { beforeMs: 1800000, afterMs: 2700000, deltaMs: 900000, reason: "Include review time" },
    });

    const initial = await syncDesignCostSummary({ organizationId, lineItemId: hourlyLineItemId });
    expect(initial?.actualTrackedMinutes).toBe(30);
    expect(initial?.correctedTrackedMinutes).toBe(45);
    expect(initial?.internalDesignCostCalculated).toBe(22.5);
    expect(initial?.billableDesignMinutes).toBe(45);
    expect(initial?.billableDesignAmount).toBe(90);
    expect(initial?.soldDesignAmount).toBeNull();
    expect(initial?.billingStatus).toBe("candidate");

    await addAuditEvent({
      lineItemId: hourlyLineItemId,
      actionType: "design_session_resumed",
      description: "Resumed design session",
      createdAt: "2026-03-20T10:40:00.000Z",
      newValues: { sessionState: "active" },
    });
    await addAuditEvent({
      lineItemId: hourlyLineItemId,
      actionType: "design_session_paused",
      description: "Paused design session",
      createdAt: "2026-03-20T10:55:00.000Z",
      newValues: { sessionState: "paused" },
    });

    const updated = await syncDesignCostSummary({ organizationId, lineItemId: hourlyLineItemId });
    expect(updated?.actualTrackedMinutes).toBe(45);
    expect(updated?.correctedTrackedMinutes).toBe(60);
    expect(updated?.internalDesignCostCalculated).toBe(30);
    expect(updated?.billableDesignAmount).toBe(120);
    expect(updated?.soldDesignAmount).toBeNull();

    const persisted = await getDesignCostSummaryByLineItemId({ organizationId, lineItemId: hourlyLineItemId });
    expect(persisted?.correctedTrackedMinutes).toBe(60);
    expect(persisted?.soldDesignAmount).toBeNull();
  });

  test("included minutes plus overage computes a conservative candidate", async () => {
    await addAuditEvent({
      lineItemId: overageLineItemId,
      actionType: "design_session_started",
      description: "Started design session",
      createdAt: "2026-03-20T11:00:00.000Z",
      newValues: { sessionState: "active" },
    });
    await addAuditEvent({
      lineItemId: overageLineItemId,
      actionType: "design_session_paused",
      description: "Paused design session",
      createdAt: "2026-03-20T12:30:00.000Z",
      newValues: { sessionState: "paused" },
    });

    const summary = await syncDesignCostSummary({ organizationId, lineItemId: overageLineItemId });
    expect(summary?.designCostState).toBe("accrued");
    expect(summary?.actualTrackedMinutes).toBe(90);
    expect(summary?.correctedTrackedMinutes).toBe(90);
    expect(summary?.internalDesignCostCalculated).toBe(60);
    expect(summary?.billableDesignMinutes).toBe(30);
    expect(summary?.billableDesignAmount).toBe(40);
    expect(summary?.billingStatus).toBe("candidate");
    expect(summary?.soldDesignAmount).toBeNull();
  });

  test("flat fee keeps sold design amount fixed and does not recompute it from time", async () => {
    await addAuditEvent({
      lineItemId: flatFeeLineItemId,
      actionType: "design_session_started",
      description: "Started design session",
      createdAt: "2026-03-20T13:00:00.000Z",
      newValues: { sessionState: "active" },
    });
    await addAuditEvent({
      lineItemId: flatFeeLineItemId,
      actionType: "design_session_paused",
      description: "Paused design session",
      createdAt: "2026-03-20T14:30:00.000Z",
      newValues: { sessionState: "paused" },
    });

    const summary = await syncDesignCostSummary({ organizationId, lineItemId: flatFeeLineItemId });
    expect(summary?.designCostState).toBe("accrued");
    expect(summary?.actualTrackedMinutes).toBe(90);
    expect(summary?.correctedTrackedMinutes).toBe(90);
    expect(summary?.internalDesignCostCalculated).toBe(75);
    expect(summary?.soldDesignAmount).toBe(150);
    expect(summary?.billableDesignMinutes).toBe(0);
    expect(summary?.billableDesignAmount).toBe(0);
    expect(summary?.billingStatus).toBe("not_billable");
  });
});