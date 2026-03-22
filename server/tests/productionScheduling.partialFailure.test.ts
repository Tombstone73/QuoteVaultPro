import { describe, expect, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { scheduleOrderLineItemsForProduction } from "../services/productionScheduling";

describe("/api/orders/:orderId/production/schedule partial failure", () => {
  test("returns 200 with one scheduled and one failed item", async () => {
    const app = express();
    app.use(express.json());

    app.post("/api/orders/:orderId/production/schedule", async (req, res) => {
      try {
        const result = await scheduleOrderLineItemsForProduction({
          organizationId: "org_test_001",
          orderId: String(req.params.orderId || ""),
          lineItemIds: ["li_ok", "li_fail"],
          traceId: "trace_test_partial_failure",
          loadRoutingRules: async () => ({ source: "org", rules: [] }),
          appendEvent: async () => undefined,
          loadLineItemsForSchedulingFn: async () => ({
            orderExists: true,
            lineItemRecords: [
              {
                lineItemId: "li_ok",
                productId: "prod_1",
                productTypeId: "pt_1",
                materialId: null,
                status: "new",
                workflowState: "new",
                lineItemRequiresDesignSnapshot: false,
                lineItemRequiresProofApprovalSnapshot: false,
                lineItemRequiresPrepressSnapshot: true,
                requiresProductionJob: true,
              },
              {
                lineItemId: "li_fail",
                productId: "prod_2",
                productTypeId: "pt_2",
                materialId: null,
                status: "new",
                workflowState: "new",
                lineItemRequiresDesignSnapshot: false,
                lineItemRequiresProofApprovalSnapshot: false,
                lineItemRequiresPrepressSnapshot: false,
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
          resolveInitialProductionRouteFn: async ({ lineItemRequiresPrepressSnapshot }: any) => ({
            stationKey: lineItemRequiresPrepressSnapshot ? "prepress" : "flatbed",
            stepKey: "queued",
            reason: lineItemRequiresPrepressSnapshot
              ? "line_item_requires_prepress_snapshot_true"
              : "line_item_requires_prepress_snapshot_false",
          }),
          routeLineItemToProductionFn: async ({ lineItemId }: any) => {
            if (lineItemId === "li_fail") {
              const error: any = new Error("insert or update on table \"production_jobs\" violates foreign key constraint");
              error.code = "23503";
              error.constraint = "production_jobs_line_item_id_fkey";
              error.table = "production_jobs";
              error.detail = "Key (line_item_id)=(li_fail) is not present in table \"order_line_items\".";
              throw error;
            }

            return {
              jobId: "job_ok_001",
              outcome: "created" as const,
              stationKey: "prepress",
              stepKey: "queued",
              status: "queued",
              stationId: null,
              ignoredDueToDone: false,
              ignoredDueToExistingRouting: false,
            };
          },
        });

        res.json(result);
      } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || "failed" });
      }
    });

    const response = await request(app)
      .post("/api/orders/order_123/production/schedule")
      .send({ lineItemIds: ["li_ok", "li_fail"] })
      .expect(200);

    expect(response.body?.success).toBe(true);
    expect(response.body?.traceId).toBe("trace_test_partial_failure");

    expect(Array.isArray(response.body?.data?.scheduled)).toBe(true);
    expect(Array.isArray(response.body?.data?.failed)).toBe(true);

    expect(response.body.data.scheduled).toHaveLength(1);
    expect(response.body.data.scheduled[0]).toMatchObject({
      lineItemId: "li_ok",
      productionJobId: "job_ok_001",
      stationKey: "prepress",
      stepKey: "queued",
      routingReason: "line_item_requires_prepress_snapshot_true",
      reused: false,
    });

    expect(response.body.data.failed).toHaveLength(1);
    expect(response.body.data.failed[0]).toMatchObject({
      lineItemId: "li_fail",
      traceId: "trace_test_partial_failure",
      step: "route_line_item_to_production",
      code: "23503",
      constraint: "production_jobs_line_item_id_fkey",
      table: "production_jobs",
    });
  });
});
