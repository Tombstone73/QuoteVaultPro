import { afterAll, beforeAll, describe, expect, jest, test } from "@jest/globals";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { productionJobs } from "@shared/schema";
import { scheduleOrderLineItemsForProduction } from "../services/productionScheduling";

jest.mock("../services/productionRoutingResolver", () => ({
  resolveInitialProductionRoute: jest.fn(async () => ({
    stationKey: "prepress",
    stepKey: "prepress",
    reason: "org_default_prepress_required",
  })),
}));

jest.mock("../services/productionRoutingService", () => ({
  routeLineItemToProduction: jest.fn(async ({ tx, organizationId, orderId, lineItemId, stationKey, stepKey }: any) => {
    const [created] = await tx
      .insert(productionJobs)
      .values({
        organizationId,
        orderId,
        lineItemId,
        stationKey,
        stepKey,
        status: "queued",
      })
      .returning({ id: productionJobs.id });

    return {
      outcome: "created",
      jobId: created.id,
      stationKey,
      stepKey,
    };
  }),
}));

describe("production schedule routing diagnostics", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const orgA = `org_sched_a_${suffix}`;
  const orgB = `org_sched_b_${suffix}`;
  const userId = `user_sched_${suffix}`;

  const customerA = `cust_sched_a_${suffix}`;
  const customerB = `cust_sched_b_${suffix}`;
  const productA = `prod_sched_a_${suffix}`;
  const productB = `prod_sched_b_${suffix}`;
  const orderA = `order_sched_a_${suffix}`;
  const orderB = `order_sched_b_${suffix}`;
  const lineItemA = `line_sched_a_${suffix}`;
  const lineItemB = `line_sched_b_${suffix}`;

  beforeAll(async () => {
    await db.execute(sql`
      insert into organizations (id, name, slug)
      values
        (${orgA}, ${`Schedule Org A ${suffix}`}, ${`schedule-org-a-${suffix}`}),
        (${orgB}, ${`Schedule Org B ${suffix}`}, ${`schedule-org-b-${suffix}`})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into users (id, email, role, is_admin, is_platform_admin)
      values (${userId}, ${`schedule-${suffix}@example.com`}, ${"employee"}, ${false}, ${false})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into user_organizations (user_id, organization_id, role, is_default)
      values
        (${userId}, ${orgA}, ${"admin"}, ${true}),
        (${userId}, ${orgB}, ${"admin"}, ${false})
      on conflict (user_id, organization_id) do nothing
    `);

    await db.execute(sql`
      insert into customers (id, organization_id, company_name, status)
      values
        (${customerA}, ${orgA}, ${"Routing Cust A"}, ${"active"}),
        (${customerB}, ${orgB}, ${"Routing Cust B"}, ${"active"})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into products (id, organization_id, name, description, requires_production_job)
      values
        (${productA}, ${orgA}, ${"Routing Product A"}, ${"desc"}, ${true}),
        (${productB}, ${orgB}, ${"Routing Product B"}, ${"desc"}, ${true})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into orders (
        id,
        organization_id,
        order_number,
        customer_id,
        created_by_user_id,
        subtotal,
        tax,
        total,
        discount,
        status,
        state,
        priority,
        fulfillment_status,
        billing_status,
        billing_ready_override
      )
      values
        (${orderA}, ${orgA}, ${`SO-A-${suffix}`}, ${customerA}, ${userId}, ${0}, ${0}, ${0}, ${0}, ${"new"}, ${"open"}, ${"normal"}, ${"pending"}, ${"not_ready"}, ${false}),
        (${orderB}, ${orgB}, ${`SO-B-${suffix}`}, ${customerB}, ${userId}, ${0}, ${0}, ${0}, ${0}, ${"new"}, ${"open"}, ${"normal"}, ${"pending"}, ${"not_ready"}, ${false})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into order_line_items (
        id,
        order_id,
        product_id,
        description,
        quantity,
        unit_price,
        total_price,
        sort_order,
        requires_prepress,
        status
      )
      values
        (${lineItemA}, ${orderA}, ${productA}, ${"Line A"}, ${2}, ${10}, ${20}, ${0}, ${true}, ${"new"}),
        (${lineItemB}, ${orderB}, ${productB}, ${"Line B"}, ${1}, ${15}, ${15}, ${0}, ${true}, ${"new"})
      on conflict (id) do nothing
    `);
  });

  afterAll(async () => {
    await db.execute(sql`delete from production_events where organization_id in (${orgA}, ${orgB})`);
    await db.execute(sql`delete from production_jobs where organization_id in (${orgA}, ${orgB})`);
    await db.execute(sql`delete from order_line_items where id in (${lineItemA}, ${lineItemB})`);
    await db.execute(sql`delete from orders where id in (${orderA}, ${orderB})`);
    await db.execute(sql`delete from products where id in (${productA}, ${productB})`);
    await db.execute(sql`delete from customers where id in (${customerA}, ${customerB})`);
    await db.execute(sql`delete from user_organizations where user_id = ${userId}`);
    await db.execute(sql`delete from users where id = ${userId}`);
    await db.execute(sql`delete from organizations where id in (${orgA}, ${orgB})`);
  });

  test("includes routingReason diagnostics in schedule response", async () => {
    const result = await scheduleOrderLineItemsForProduction({
      organizationId: orgA,
      orderId: orderA,
      lineItemIds: [lineItemA],
      loadRoutingRules: async () => ({ source: "test", rules: [] }),
      appendEvent: async () => {
        return;
      },
      loadLineItemsForSchedulingFn: async () => ({
        orderExists: true,
        lineItemRecords: [
          {
            lineItemId: lineItemA,
            productId: productA,
            productTypeId: null,
            materialId: null,
            status: "new",
            workflowState: "new",
            lineItemRequiresDesignSnapshot: false,
            lineItemRequiresProofApprovalSnapshot: false,
            lineItemRequiresPrepressSnapshot: true,
            requiresProductionJob: true,
          },
        ],
      }),
      transactionRunner: {
        transaction: async <T>(cb: (tx: any) => Promise<T>) => cb({
          update: () => ({
            set: () => ({
              where: async () => undefined,
            }),
          }),
        }),
      },
      resolveInitialProductionRouteFn: async () => ({
        stationKey: "prepress",
        stepKey: "prepress",
        reason: "org_default_prepress_required",
      }),
      routeLineItemToProductionFn: async ({ lineItemId }: any) => ({
        jobId: `job_${lineItemId}`,
        outcome: "created",
        stationKey: "prepress",
        stepKey: "prepress",
        status: "queued",
        stationId: null,
        ignoredDueToDone: false,
        ignoredDueToExistingRouting: false,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.data.createdJobCount).toBe(1);

    const diagnostics = result.data.lineItemDiagnostics;
    expect(diagnostics[lineItemA]).toBeDefined();
    expect(diagnostics[lineItemA].stationKey).toBe("prepress");
    expect(diagnostics[lineItemA].stepKey).toBe("prepress");
    expect(diagnostics[lineItemA].routingReason).toBe("org_default_prepress_required");
  });

  test("is tenant-scoped and cannot schedule another org order", async () => {
    await expect(
      scheduleOrderLineItemsForProduction({
        organizationId: orgA,
        orderId: orderB,
        lineItemIds: [lineItemB],
        loadRoutingRules: async () => ({ source: "test", rules: [] }),
        appendEvent: async () => {
          return;
        },
      }),
    ).rejects.toThrow("Order not found");
  });

  test("returns partial success when one of two line items fails", async () => {
    const okLineItemId = `line_sched_ok_${suffix}`;
    const failLineItemId = `line_sched_fail_${suffix}`;

    const result = await scheduleOrderLineItemsForProduction({
      organizationId: orgA,
      orderId: orderA,
      lineItemIds: [okLineItemId, failLineItemId],
      loadRoutingRules: async () => ({ source: "test", rules: [] }),
      appendEvent: async () => {
        return;
      },
      loadLineItemsForSchedulingFn: async () => ({
        orderExists: true,
        lineItemRecords: [
          {
            lineItemId: okLineItemId,
            productId: productA,
            productTypeId: null,
            materialId: null,
            status: "new",
            workflowState: "new",
            lineItemRequiresDesignSnapshot: false,
            lineItemRequiresProofApprovalSnapshot: false,
            lineItemRequiresPrepressSnapshot: true,
            requiresProductionJob: true,
          },
          {
            lineItemId: failLineItemId,
            productId: productA,
            productTypeId: null,
            materialId: null,
            status: "new",
            workflowState: "new",
            lineItemRequiresDesignSnapshot: false,
            lineItemRequiresProofApprovalSnapshot: false,
            lineItemRequiresPrepressSnapshot: true,
            requiresProductionJob: true,
          },
        ],
      }),
      transactionRunner: {
        transaction: async <T>(cb: (tx: any) => Promise<T>) => cb({
          update: () => ({
            set: () => ({
              where: async () => undefined,
            }),
          }),
        }),
      },
      resolveInitialProductionRouteFn: async () => ({
        stationKey: "prepress",
        stepKey: "prepress",
        reason: "org_default_prepress_required",
      }),
      routeLineItemToProductionFn: async ({ lineItemId }: any) => {
        if (lineItemId === failLineItemId) {
          const err: any = new Error("duplicate key value violates unique constraint");
          err.code = "23505";
          err.constraint = "production_jobs_org_line_item_station_unique";
          err.table = "production_jobs";
          throw err;
        }
        return {
          jobId: `job_${lineItemId}`,
          outcome: "created",
          stationKey: "prepress",
          stepKey: "prepress",
          status: "queued",
          stationId: null,
          ignoredDueToDone: false,
          ignoredDueToExistingRouting: false,
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.data.scheduled).toHaveLength(1);
    expect(result.data.scheduled[0].lineItemId).toBe(okLineItemId);
    expect(result.data.failed).toHaveLength(1);
    expect(result.data.failed[0].lineItemId).toBe(failLineItemId);
  });

  test("skips scheduling while a proof-required line item is awaiting approval", async () => {
    const routeLineItemToProductionFn = jest.fn(async () => ({
      jobId: `job_${lineItemA}`,
      outcome: "created" as const,
      stationKey: "prepress",
      stepKey: "prepress",
      status: "queued",
      stationId: null,
      ignoredDueToDone: false,
      ignoredDueToExistingRouting: false,
    }));

    const result = await scheduleOrderLineItemsForProduction({
      organizationId: orgA,
      orderId: orderA,
      lineItemIds: [lineItemA],
      loadRoutingRules: async () => ({ source: "test", rules: [] }),
      appendEvent: async () => {
        return;
      },
      loadLineItemsForSchedulingFn: async () => ({
        orderExists: true,
        lineItemRecords: [
          {
            lineItemId: lineItemA,
            productId: productA,
            productTypeId: null,
            materialId: null,
            status: "new",
            workflowState: "awaiting_proof_approval",
            lineItemRequiresDesignSnapshot: false,
            lineItemRequiresProofApprovalSnapshot: true,
            lineItemRequiresPrepressSnapshot: true,
            requiresProductionJob: true,
          },
        ],
      }),
      resolveInitialProductionRouteFn: async () => ({
        stationKey: "prepress",
        stepKey: "prepress",
        reason: "org_default_prepress_required",
      }),
      routeLineItemToProductionFn,
      transactionRunner: {
        transaction: async <T>(cb: (tx: any) => Promise<T>) => cb({
          update: () => ({
            set: () => ({
              where: async () => undefined,
            }),
          }),
        }),
      },
    });

    expect(result.success).toBe(true);
    expect(result.data.createdJobCount).toBe(0);
    expect(result.data.existingJobCount).toBe(0);
    expect(result.data.affectedLineItemIds).toEqual([]);
    expect(result.data.failed).toEqual([]);
    expect(result.data.lineItemDiagnostics[lineItemA]).toMatchObject({
      stationKey: "proofing",
      stepKey: "awaiting_proof_approval",
      routingReason: "proof_approval_required_before_scheduling",
    });
    expect(routeLineItemToProductionFn).not.toHaveBeenCalled();
  });
});
