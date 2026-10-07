import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { getTableName } from "drizzle-orm";

let rows: Record<string, any[]>;
let audit: any;
let timerStopped: boolean;
const completeJob = jest.fn(async () => {
  timerStopped = true;
  rows.production_jobs[0].status = "done";
  rows.production_jobs[0].completedAt = new Date();
  rows.order_line_items[0].workflowState = "completed";
  rows.order_line_items[0].status = "complete";
  return rows.production_jobs[0];
});
const cancelJob = jest.fn(async () => {
  timerStopped = true;
  rows.production_jobs[0].status = "canceled";
  return rows.production_jobs[0];
});
const tx: any = {
  select: () => {
    let table = "";
    const query: any = {
      from: (t: any) => { table = getTableName(t); return query; },
      where: () => query, for: () => query,
      limit: async () => (rows[table] ?? []).slice(0, 1),
    };
    return query;
  },
  update: (table: any) => ({ set: (patch: any) => ({ where: async () => {
    for (const row of rows[getTableName(table)] ?? []) Object.assign(row, patch);
  } }) }),
  insert: () => ({ values: (value: any) => {
    audit = value;
    return { returning: async () => [{ id: "audit-1" }] };
  } }),
};
jest.unstable_mockModule("../db", () => ({ db: { transaction: async (fn: any) => fn(tx) } }));
jest.unstable_mockModule("../routes/productionJobs.routes", () => ({ completeProductionJobWorkflow: completeJob, updateProductionJobStatusWorkflow: cancelJob }));
jest.unstable_mockModule("../services/productionBypassConflictService", () => ({
  listProductionExecutionConflicts: async () => [{ lineItemId: "line-1", jobId: "job-1", stationKey: "roll", jobStatus: rows.production_jobs[0].status, runningTimer: !timerStopped, runId: null }],
}));
let reconcile: typeof import("../services/productionBypassReconciliationService").reconcileProductionBypassConflict;
beforeAll(async () => { reconcile = (await import("../services/productionBypassReconciliationService")).reconcileProductionBypassConflict; });
beforeEach(() => {
  rows = {
    orders: [{ id: "order-1", orderNumber: "20577" }],
    order_line_items: [{ id: "line-1", orderId: "order-1", productId: "product-1", lineItemRole: "standalone", productionBypassed: true, productionBypassReason: "done", workflowState: "no_production_required", status: "in_production" }],
    products: [{ id: "product-1", requiresProductionJob: true, workflowIntent: "standard_production" }],
    production_jobs: [{ id: "job-1", orderId: "order-1", lineItemId: "line-1", stationKey: "roll", status: "in_progress", startedAt: new Date() }],
  };
  audit = null; timerStopped = false; completeJob.mockClear(); cancelJob.mockClear();
});
const input = { organizationId: "org-1", orderId: "order-1", lineItemId: "line-1", jobId: "job-1", actorUserId: "admin-1", reason: "Operator confirmed actual outcome" };

describe("administrative production bypass reconciliation", () => {
  test("completed choice restores obligation and delegates to canonical completion with audit", async () => {
    const result = await reconcile({ ...input, resolution: "production_completed" });
    expect(completeJob).toHaveBeenCalledTimes(1);
    expect(cancelJob).not.toHaveBeenCalled();
    expect(timerStopped).toBe(true);
    expect(rows.order_line_items[0]).toMatchObject({ productionBypassed: false, workflowState: "completed" });
    expect(rows.production_jobs[0].status).toBe("done");
    expect(audit).toMatchObject({ organizationId: "org-1", userId: "admin-1", entityId: "line-1", oldValues: { jobId: "job-1", productionBypassed: true }, newValues: { resolution: "production_completed", jobStatus: "done" } });
    expect(result.auditId).toBe("audit-1");
  });

  test("not-required choice delegates cancellation, preserves bypass, and does not fabricate completion", async () => {
    await reconcile({ ...input, resolution: "production_not_required" });
    expect(cancelJob).toHaveBeenCalledWith(tx, expect.objectContaining({ status: "canceled", reason: input.reason }));
    expect(completeJob).not.toHaveBeenCalled();
    expect(timerStopped).toBe(true);
    expect(rows.order_line_items[0].productionBypassed).toBe(true);
    expect(rows.production_jobs[0]).toMatchObject({ status: "canceled" });
    expect(rows.production_jobs[0].completedAt).toBeUndefined();
    expect(audit.newValues).toMatchObject({ resolution: "production_not_required", jobStatus: "canceled" });
  });

  test("already resolved owner creates no duplicate terminal event or audit", async () => {
    rows.production_jobs[0].status = "done";
    await expect(reconcile({ ...input, resolution: "production_completed" })).rejects.toMatchObject({ statusCode: 409 });
    expect(completeJob).not.toHaveBeenCalled(); expect(cancelJob).not.toHaveBeenCalled(); expect(audit).toBeNull();
  });
});
