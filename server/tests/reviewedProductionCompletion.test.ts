import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Focused native seam tests: real review/CAS/readback/hook orchestration, injected
// synthetic persistence and native workflow. PostgreSQL/native material/timeline
// parity is covered separately by assistantProductionCompletion.postgres.integration.
const dialect = new PgDialect();
let state: any;
let failWorkflow = false, failHook = false, wrongSuccessor = false;
const trace: string[] = [];
const transactionOptions: any[] = [];
const hook = jest.fn(async (_input: any): Promise<any> => {
  trace.push("postcommit");
  if (failHook) throw new Error("Synthetic pill hook failure after commit");
  return { status: "skipped", reason: "mapping_missing" };
});
const workflow = jest.fn(async (_tx: any, input: any) => {
  trace.push("workflow");
  if (failWorkflow) throw Object.assign(new Error("Native completion rejected"), { code: "NATIVE_REJECTED", statusCode: 409 });
  state.jobs[0].status = "done";
  state.jobs[0].completedAt = new Date("2026-11-20T17:00:00Z");
  state.jobs.push({ ...state.jobs[0], id: "successor", status: "queued", stationKey: wrongSuccessor ? "other" : state.target,
    stepKey: state.target, completedAt: null });
  if (state.target === "fulfillment") {
    state.lines[0].workflowState = "completed";
    state.lines[0].status = "complete";
    state.order.state = "production_complete";
    state.order.status = "ready_for_shipment";
  }
  state.nativeWrites++;
  return { ...state.jobs[0], nextStationKey: state.target, nextStepKey: state.target, input };
});
const tx: any = {
  select: () => {
    let table = "", params: unknown[] = [];
    const rows = () => {
      if (table === "user_organizations") return state.authority && params.includes("org") && params.includes("actor") ? [state.authority] : [];
      if (table === "orders") return params.includes("org") && params.includes("order") ? [state.order] : [];
      if (table === "order_line_items") return params.includes("order") ? state.lines : [];
      if (table === "production_jobs") {
        if (!params.includes("org")) return [];
        if (params.includes("job")) return state.jobs.filter((job: any) => job.id === "job");
        return params.includes("line") ? state.jobs : [];
      }
      if (table === "production_run_members") return state.members;
      if (table === "production_station_steps") return state.steps;
      if (table === "products") return state.products;
      throw new Error(`Unexpected read ${table}`);
    };
    const query: any = { from(value: any) { table = getTableName(value); return query; },
      innerJoin: () => query, where(value: any) { params = dialect.sqlToQuery(value).params; return query; },
      orderBy: () => query, for(mode: string) { trace.push(`lock:${table}:${mode}`); return query; },
      limit: async (count: number) => structuredClone(rows().slice(0, count)),
      then: (resolve: any, reject: any) => Promise.resolve(structuredClone(rows())).then(resolve, reject) };
    return query;
  },
};
jest.unstable_mockModule("../db", () => ({ db: { transaction: async (callback: any, options: any) => {
  transactionOptions.push(options);
  const before = structuredClone(state);
  trace.push("transaction");
  try { const result = await callback(tx); trace.push("commit"); return result; }
  catch (error) { state = before; trace.push("rollback"); throw error; }
} } }));
jest.unstable_mockModule("../services/customerPortalAccessService", () => ({ isPortalCustomerIdentity: (row: any) => row.role === "customer" || row.accountType === "PORTAL_CUSTOMER" }));
jest.unstable_mockModule("../services/productionOwnership", () => ({
  isDesignOwnershipJob: (job: any) => job.stationKey === "design" || job.stepKey === "design",
  isPrepressOwnershipJob: (job: any) => job.stationKey === "prepress" || job.stepKey === "prepress",
}));
jest.unstable_mockModule("../routes/production.shared", () => ({ getProductionConfigForOrganization: async () => state.config }));
jest.unstable_mockModule("../services/orderProductionOverrideBoundary", () => ({
  lockOrderProductionOverrideLines: async () => { trace.push("lock:workflow_lines"); },
}));
jest.unstable_mockModule("../services/workflowStatusPillService", () => ({ applyWorkflowStatusPillFailSoft: hook }));
jest.unstable_mockModule("../routes/productionJobs.routes", () => ({ completeProductionJobWorkflow: workflow }));

let native: typeof import("../services/reviewedProductionCompletion");
const scope = { organizationId: "org", actorUserId: "actor", orderId: "order", lineItemId: "line" };
beforeAll(async () => { native = await import("../services/reviewedProductionCompletion"); });
beforeEach(() => {
  state = {
    authority: { userId: "actor", role: "employee", accountType: "INTERNAL_USER", organizationRole: "employee", deleteState: "active", isArchived: false },
    order: { id: "order", organizationId: "org", state: "open", status: "in_production", canceledAt: null, updatedAt: new Date(1) },
    lines: [{ id: "line", orderId: "order", productId: "product", workflowState: "in_production", status: "in_production", productionBypassed: false, updatedAt: new Date(1) }],
    jobs: [{ id: "job", organizationId: "org", orderId: "order", lineItemId: "line", stationKey: "roll", stepKey: "queued",
      status: "in_progress", startedAt: new Date(1), completedAt: null, updatedAt: new Date(1) }],
    members: [], steps: [], config: { finishingMode: "integrated_with_print" },
    products: [{ id: "product", requiresProductionJob: true }], target: "fulfillment", nativeWrites: 0,
  };
  failWorkflow = false; failHook = false; wrongSuccessor = false;
  trace.length = 0; transactionOptions.length = 0; workflow.mockClear(); hook.mockClear();
});

describe("reviewed ordinary Production completion", () => {
  test("review is read-only and binds exact current identities/state without mutating native history", async () => {
    const before = structuredClone(state);
    const preview = await native.previewReviewedProductionCompletion(scope);
    expect(preview).toMatchObject({ version: "v1", scope, jobId: "job", state: { jobStatus: "in_progress", stationKey: "roll" }, route: { stationKey: "fulfillment" } });
    expect(preview.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(state).toEqual(before);
    expect(transactionOptions).toEqual([{ isolationLevel: "repeatable read", accessMode: "read only" }]);
    expect(workflow).not.toHaveBeenCalled(); expect(hook).not.toHaveBeenCalled();
    expect(trace.some(value => value.startsWith("lock:"))).toBe(false);
  });

  test("uses the native completion transaction then the same ordinary fail-soft pill hook and actual readback", async () => {
    const preview = await native.previewReviewedProductionCompletion(scope);
    trace.length = 0;
    const result = await native.executeReviewedProductionCompletion(scope, preview);
    expect(workflow).toHaveBeenCalledTimes(1);
    expect(workflow).toHaveBeenCalledWith(tx, { organizationId: "org", userId: "actor", jobId: "job", skipProduction: false });
    expect(result).toMatchObject({ status: "applied", job: { id: "job", status: "done" },
      line: { workflowState: "completed", status: "complete" }, order: { state: "production_complete", status: "ready_for_shipment" },
      activeSuccessors: [{ id: "successor", stationKey: "fulfillment", status: "queued" }],
      postcommit: [{ triggerKey: "sent_to_fulfillment", status: "skipped", reason: "mapping_missing" }] });
    expect(trace.indexOf("lock:workflow_lines")).toBeLessThan(trace.indexOf("lock:orders:update"));
    expect(trace.indexOf("lock:production_jobs:update")).toBeLessThan(trace.indexOf("workflow"));
    expect(trace.indexOf("commit")).toBeLessThan(trace.indexOf("postcommit"));
    expect(state.nativeWrites).toBe(1);
  });

  test.each(["job", "line", "order", "role", "routing", "product", "sibling"])("rejects stale %s revision before native mutation", async field => {
    const preview = await native.previewReviewedProductionCompletion(scope);
    if (field === "job") state.jobs[0].updatedAt = new Date(2);
    if (field === "line") state.lines[0].updatedAt = new Date(2);
    if (field === "order") state.order.updatedAt = new Date(2);
    if (field === "role") state.authority.organizationRole = "member";
    if (field === "routing") state.config.finishingMode = "dedicated_finishing_queue";
    if (field === "product") state.products[0].requiresProductionJob = false;
    if (field === "sibling") state.lines.push({ ...state.lines[0], id: "sibling" });
    await expect(native.executeReviewedProductionCompletion(scope, preview)).rejects.toMatchObject({ code: "PRODUCTION_COMPLETION_REVIEW_STALE" });
    expect(workflow).not.toHaveBeenCalled(); expect(hook).not.toHaveBeenCalled(); expect(state.nativeWrites).toBe(0);
  });

  test.each(["queued", "paused", "not_started", "managed", "fulfillment", "run", "multiple", "bypassed", "parent", "canceled"])("does not offer unsupported %s work", async kind => {
    if (kind === "queued" || kind === "paused") state.jobs[0].status = kind;
    if (kind === "not_started") state.jobs[0].startedAt = null;
    if (kind === "managed") state.jobs[0].stepKey = "prepress";
    if (kind === "fulfillment") state.jobs[0].stationKey = "fulfillment";
    if (kind === "run") state.members = [{ id: "run-member" }];
    if (kind === "multiple") state.jobs.push({ ...state.jobs[0], id: "second" });
    if (kind === "bypassed") state.lines[0].productionBypassed = true;
    if (kind === "parent") state.order.status = "new";
    if (kind === "canceled") state.order.canceledAt = new Date();
    await expect(native.previewReviewedProductionCompletion(scope)).rejects.toBeInstanceOf(native.ReviewedProductionCompletionError);
    expect(workflow).not.toHaveBeenCalled(); expect(state.nativeWrites).toBe(0);
  });

  test.each(["revoked", "portal", "archived"])("current native authority %s fails closed", async kind => {
    const preview = await native.previewReviewedProductionCompletion(scope);
    if (kind === "revoked") state.authority = null;
    if (kind === "portal") state.authority.role = "customer";
    if (kind === "archived") state.authority.isArchived = true;
    await expect(native.executeReviewedProductionCompletion(scope, preview)).rejects.toMatchObject({ statusCode: 403 });
    expect(workflow).not.toHaveBeenCalled();
  });

  test("native member authority is not replaced by assistant role rules", async () => {
    state.authority.organizationRole = "member";
    const preview = await native.previewReviewedProductionCompletion(scope);
    await expect(native.executeReviewedProductionCompletion(scope, preview)).resolves.toMatchObject({ status: "applied" });
  });

  test("an active job with drifted parent binding is not treated as this Order's individual owner", async () => {
    state.jobs[0].orderId = "foreign-order";
    await expect(native.previewReviewedProductionCompletion(scope)).rejects.toMatchObject({ code: "PRODUCTION_COMPLETION_STATE_CHANGED" });
    expect(workflow).not.toHaveBeenCalled();
  });

  test("strict trusted scope and original reviewed artifact cannot select another actor/tenant/line or skip", async () => {
    const preview = await native.previewReviewedProductionCompletion(scope);
    for (const field of ["organizationId", "actorUserId", "orderId", "lineItemId"] as const) {
      await expect(native.executeReviewedProductionCompletion({ ...scope, [field]: "other" }, preview)).rejects.toMatchObject({ code: "PRODUCTION_COMPLETION_SCOPE_MISMATCH" });
    }
    expect(() => native.reviewedProductionCompletionPreviewSchema.parse({ ...preview, skipProduction: true })).toThrow();
    await expect(native.completeOrdinaryProductionJob({ organizationId: "org", userId: "actor", jobId: "job", skipProduction: true }, { scope, preview }))
      .rejects.toMatchObject({ code: "PRODUCTION_COMPLETION_SCOPE_MISMATCH" });
    expect(workflow).not.toHaveBeenCalled();
  });

  test("native validation failure rolls back and never applies hooks", async () => {
    const preview = await native.previewReviewedProductionCompletion(scope);
    failWorkflow = true;
    await expect(native.executeReviewedProductionCompletion(scope, preview)).rejects.toMatchObject({ code: "NATIVE_REJECTED" });
    expect(state.jobs[0].status).toBe("in_progress"); expect(state.nativeWrites).toBe(0); expect(hook).not.toHaveBeenCalled();
  });

  test("wrong actual successor rolls back instead of reporting the requested route as success", async () => {
    const preview = await native.previewReviewedProductionCompletion(scope);
    wrongSuccessor = true;
    await expect(native.executeReviewedProductionCompletion(scope, preview)).rejects.toMatchObject({ code: "PRODUCTION_COMPLETION_READBACK_MISMATCH" });
    expect(state.jobs).toHaveLength(1); expect(state.jobs[0].status).toBe("in_progress"); expect(state.nativeWrites).toBe(0); expect(hook).not.toHaveBeenCalled();
  });

  test("postcommit hook failure returns the actual committed completion, not a failed mutation", async () => {
    const preview = await native.previewReviewedProductionCompletion(scope);
    failHook = true;
    await expect(native.executeReviewedProductionCompletion(scope, preview)).resolves.toMatchObject({ status: "applied", job: { status: "done" },
      postcommit: [{ triggerKey: "sent_to_fulfillment", status: "unavailable" }] });
    expect(state.nativeWrites).toBe(1);
  });

  test("intermediate finishing completion does not invent terminal line or fulfillment effects", async () => {
    state.config.finishingMode = "dedicated_finishing_queue"; state.target = "finishing";
    const preview = await native.previewReviewedProductionCompletion(scope);
    const result = await native.executeReviewedProductionCompletion(scope, preview);
    expect(result.activeSuccessors[0].stationKey).toBe("finishing");
    expect(result.line.workflowState).toBe("in_production"); expect(result.order.state).toBe("open"); expect(hook).not.toHaveBeenCalled();
  });

  test("old preview after completion cannot fabricate actor attribution/replay or write extra history", async () => {
    const preview = await native.previewReviewedProductionCompletion(scope);
    await native.executeReviewedProductionCompletion(scope, preview);
    await expect(native.executeReviewedProductionCompletion(scope, preview)).rejects.toBeInstanceOf(native.ReviewedProductionCompletionError);
    expect(workflow).toHaveBeenCalledTimes(1); expect(hook).toHaveBeenCalledTimes(1); expect(state.nativeWrites).toBe(1);
  });

  test("ordinary native executor keeps skip and audit inputs and shares postcommit hooks without reviewed restrictions", async () => {
    state.jobs[0].status = "queued"; state.jobs[0].startedAt = null;
    const input = { organizationId: "org", userId: "actor", jobId: "job", skipProduction: true, auditUserName: "Synthetic operator", ipAddress: "127.0.0.1", userAgent: "unit" };
    const result = await native.completeOrdinaryProductionJob(input);
    expect(workflow).toHaveBeenCalledWith(tx, input); expect(result.completedJob.status).toBe("done");
    expect(result.actual).toBeNull(); expect(hook).toHaveBeenCalledTimes(1);
    expect(trace.indexOf("commit")).toBeLessThan(trace.indexOf("postcommit"));
  });
});
