import { jest, expect, test } from "@jest/globals";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// In-memory transaction/row-lock model. This exercises the real return and start
// operations, but is deliberately not evidence of PostgreSQL concurrency.
await jest.unstable_mockModule("../db", () => ({ db: {} }));
await jest.unstable_mockModule("../services/productionOwnership", () => ({
  findActiveJobForLineItem: async (tx: any, input: any) => input.organizationId === tx.state.org ? tx.state.owner : null,
  isPrepressOwnershipJob: (job: any) => job.stationKey === "prepress" || job.stepKey === "prepress",
}));
await jest.unstable_mockModule("../services/lineItemWorkflowService", () => ({
  transitionLineItemWorkflowState: async (tx: any) => {
    tx.state.transitions++;
    tx.state.job.status = "done";
    tx.state.owner = { ...tx.state.job, id: "prepress-job", stationKey: "prepress", stepKey: "prepress", status: "queued" };
    tx.state.line.workflowState = "in_prepress";
    return { activeOwnerJobId: "prepress-job", activeOwnerStationKey: "prepress", activeOwnerStepKey: "prepress" };
  },
}));
await jest.unstable_mockModule("../services/fulfillment/repository", () => ({
  FulfillmentDashboardRepo: class { constructor(private tx: any) {} async listLineEligibility() { return [{ projection: this.tx.state.quantities }]; } },
}));
await jest.unstable_mockModule("../services/proofGateService", () => ({ assertPhysicalProductionProofGate: jest.fn() }));
await jest.unstable_mockModule("../services/orderCreditHoldService", () => ({ assertProductionCredit: jest.fn() }));
await jest.unstable_mockModule("../services/orderProductionGate", () => ({ assertParentOrderInProductionForJob: jest.fn() }));
await jest.unstable_mockModule("../services/productionScheduling", () => ({ scheduleOrderLineItemsForProduction: jest.fn() }));
await jest.unstable_mockModule("../routes/production.shared", () => ({
  getTimerStateForJob: async () => ({ isRunning: false }),
  appendEvent: async ({ tx, type }: any) => { tx.state.events.push({ type }); },
}));
const { CanonicalPrepressOperations } = await import("../services/canonicalPrepressOperations");
const { CanonicalProductionOperations } = await import("../services/canonicalProductionOperations");
const { unstartedProductionReturnReason } = await import("../services/productionReturnToPrepressService");
const { resolveProductionItemLocation } = await import("../services/productionItemLocation");

function fixture() {
  const job = { id: "job", organizationId: "org", lineItemId: "line", orderId: "order", stationKey: "flatbed", stepKey: "print", status: "queued", startedAt: null, totalSeconds: 0 };
  const state: any = { org: "org", role: "admin", job, owner: job, line: { id: "line", orderId: "order", workflowState: "ready_for_production", requiresPrepress: false }, events: [], sessions: [], audit: [], transitions: 0, runs: [], quantities: { fulfilledQuantity: 0, administrativelyReconciledQuantity: 0, productionCompleteQuantity: 0 }, files: [{ id: "source", role: "original", lineItemId: "line" }, { id: "ready", role: "final", lineItemId: "line" }] };
  let tail = Promise.resolve();
  const dialect = new PgDialect();
  function tx() {
    let release: (() => void) | undefined;
    const self: any = { state, async lock() { if (release) return; const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous; }, release() { release?.(); } };
    self.select = (fields?: any) => {
      let table = "", locked = false, params: any[] = [];
      const q: any = {
        from(t: any) { table = getTableName(t); return q; }, innerJoin() { return q; },
        where(sql: any) { params = dialect.sqlToQuery(sql).params; return q; }, orderBy() { return q; }, limit() { return q; },
        for() { locked = true; return q; },
        async then(resolve: any, reject: any) { try {
          if (locked && table === "order_line_items") await self.lock();
          let rows: any[] = [];
          const tenant = !params.includes("other-org");
          if (table === "user_organizations") rows = tenant ? [{ role: state.role }] : [];
          if (table === "order_line_items") rows = tenant ? [{ ...state.line, productionBypassed: false }] : [];
          if (table === "production_jobs" && tenant) {
            if (fields?.job) rows = [{ job: { ...state.job }, line: { ...state.line }, order: { id: "order" } }];
            else if (fields?.lineItemId) rows = [{ lineItemId: "line" }];
            else rows = [{ ...state.job }];
          }
          if (table === "production_events") rows = state.events;
          if (table === "production_run_members") rows = state.runs;
          if (table === "prepress_sessions") rows = state.sessions;
          resolve(rows);
        } catch (error) { reject(error); } },
      }; return q;
    };
    self.update = (table: any) => ({ set: (data: any) => ({ where: async () => { Object.assign(getTableName(table) === "production_jobs" ? state.job : state.sessions[0], data); } }) });
    self.insert = (table: any) => ({ values: (data: any) => {
      const name = getTableName(table); const row = { ...data, id: "session" };
      (name === "prepress_sessions" ? state.sessions : state.audit).push(row);
      return { returning: async () => [row], then: (resolve: any) => resolve(undefined) };
    } });
    return self;
  }
  async function transaction<T>(operation: (tx: any) => Promise<T>) { const connection = tx(); try { return await operation(connection); } finally { connection.release(); } }
  return { state, tx, transaction };
}
const input = { organizationId: "org", actorUserId: "staff", lineItemId: "line", expectedOwnerJobId: "job" };
const prepress = new CanonicalPrepressOperations();
const production = new CanonicalProductionOperations();

test("queued assignment returns through the shared operation; source/final art and history remain intact", async () => {
  const f = fixture(); const files = structuredClone(f.state.files);
  const result = await f.transaction(tx => prepress.requestUnstartedLineInTransaction(tx, input));
  expect(result).toMatchObject({ toState: "in_prepress", activeOwnerJobId: "prepress-job" });
  expect(f.state.transitions).toBe(1); expect(f.state.sessions).toHaveLength(1);
  expect(f.state.files).toEqual(files); expect(f.state.audit).toHaveLength(1);
  await expect(f.transaction(tx => prepress.requestUnstartedLineInTransaction(tx, input))).rejects.toMatchObject({ code: "RETURN_TO_PREPRESS_OWNER_CHANGED" });
  expect(f.state.transitions).toBe(1); expect(f.state.sessions).toHaveLength(1);
});
test.each([
  { startedAt: new Date() }, { totalSeconds: 1 }, { status: "in_progress" }, { status: "paused" },
])("recorded work blocks the Order checkbox: %j", async patch => {
  const f = fixture(); Object.assign(f.state.job, patch);
  await expect(f.transaction(tx => prepress.requestUnstartedLineInTransaction(tx, input))).rejects.toThrow();
  expect(f.state.transitions).toBe(0); expect(f.state.sessions).toHaveLength(0);
});
test("resetting a job to queued does not erase timer or completion history", async () => {
  for (const event of [{ type: "timer_started" }, { type: "status_changed", payload: { newStatus: "done" } }]) {
    const f = fixture(); f.state.events.push(event);
    await expect(f.transaction(tx => prepress.requestUnstartedLineInTransaction(tx, input))).rejects.toMatchObject({ code: "RETURN_TO_PREPRESS_STARTED" });
  }
  expect(unstartedProductionReturnReason({ jobs: [{ status: "done", completedAt: new Date() }], events: [{ type: "printer_assigned" }, { type: "ticket_printed" }] })).toBeNull();
});
test("completed quantities and active Combined Runs retain their recovery boundary", async () => {
  const f = fixture(); f.state.quantities.productionCompleteQuantity = 1;
  await expect(f.transaction(tx => prepress.requestUnstartedLineInTransaction(tx, input))).rejects.toMatchObject({ code: "RETURN_TO_PREPRESS_STARTED" });
  f.state.quantities.productionCompleteQuantity = 0; f.state.runs = [{ productionJobId: "job", runNumber: 12 }];
  await expect(f.transaction(tx => prepress.requestUnstartedLineInTransaction(tx, input))).rejects.toMatchObject({ code: "RETURN_TO_PREPRESS_ACTIVE_RUN" });
});
test("tenant and existing Order editing permissions fail closed", async () => {
  const f = fixture(); f.state.role = "employee";
  await expect(f.transaction(tx => prepress.requestUnstartedLineInTransaction(tx, input))).rejects.toMatchObject({ statusCode: 403 });
  await expect(resolveProductionItemLocation(f.tx(), "other-org", "job")).rejects.toMatchObject({ statusCode: 404 });
  expect(f.state.transitions).toBe(0);
});
test("navigation follows the current owner and active run, not the historical job", async () => {
  const f = fixture(); f.state.owner = { ...f.state.job, id: "new-job", stationKey: "roll" }; f.state.runs = [{ runId: "run" }];
  await expect(resolveProductionItemLocation(f.tx(), "org", "job")).resolves.toMatchObject({ jobId: "new-job", stationKey: "roll", runId: "run" });
});
test("modeled concurrent start wins: return reloads activity after the shared line lock", async () => {
  const f = fixture(); const startTx = f.tx(); await startTx.lock();
  const returning = f.transaction(tx => prepress.requestUnstartedLineInTransaction(tx, input));
  await production.startJobInTransaction(startTx, { organizationId: "org", jobId: "job" }); startTx.release();
  await expect(returning).rejects.toThrow(); expect(f.state.transitions).toBe(0);
});
test("modeled concurrent return wins: stale start cannot start the retired owner", async () => {
  const f = fixture(); const returnTx = f.tx(); await returnTx.lock();
  const starting = f.transaction(tx => production.startJobInTransaction(tx, { organizationId: "org", jobId: "job" }));
  await prepress.requestUnstartedLineInTransaction(returnTx, input); returnTx.release();
  await expect(starting).rejects.toThrow("ownership changed");
  expect(f.state.events).toHaveLength(0); expect(f.state.transitions).toBe(1);
});
