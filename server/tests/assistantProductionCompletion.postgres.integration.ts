import { afterAll, beforeAll, expect, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { buildOrderReadinessLights } from "@shared/orderReadinessLights";
import { db, pool } from "../db";
import { registerProductionJobsRoutes } from "../routes/productionJobs.routes";
import { OrdersRepository } from "../storage/orders.repo";
import { readOrderFulfillmentReadiness } from "../services/assistant/orderFulfillmentReadinessRead";
import { canonicalFulfillmentOperations } from "../services/fulfillment/canonicalFulfillmentOperations";
import { previewReviewedProductionCompletion, executeReviewedProductionCompletion } from "../services/reviewedProductionCompletion";
import { DrizzleAssistantExecutionRepository } from "../storage/assistantExecution.repo";
import { ExecutionPlanningService } from "../services/assistant/execution/executionPlanningService";
import { createProductionCompletionExecutionCommand, productionCompletionCommandName, prepareProductionCompletionCommandArguments } from "../services/assistant/execution/productionCompletionCommand";
import type { ExecutionActorScope } from "../services/assistant/execution/types";

// Real isolated PostgreSQL, ordinary Production-board route and reviewed native
// service. NO workflow/repository/provider mocks. Authenticated HTTP identity and
// the trusted GO request are synthetic; persisted native membership is real.
// Current-schema projection plus setupLocalPostgres supplements is not the full
// production migration chain. No workers or configured notification mappings.
const org = randomUUID(), otherOrg = randomUUID(), actor = randomUUID();
const buyer = randomUUID(), product = randomUUID();
let orderNumber = 960000;
const reader = new OrdersRepository(db);
type Fixture = Awaited<ReturnType<typeof fixture>>;
const scope = (f: Fixture) => ({ organizationId: org, actorUserId: actor, orderId: f.orderId, lineItemId: f.lineId });

async function fixture() {
  const orderId = randomUUID(), lineId = randomUUID(), jobId = randomUUID(), quoteId = randomUUID(), invoiceId = randomUUID();
  const number = ++orderNumber, startedAt = new Date(Date.now() - 120_000);
  await db.transaction(async tx => {
    await tx.insert(schema.quotes).values({ id: quoteId, organizationId: org, userId: actor, customerId: buyer, quoteNumber: number, totalPrice: "125.00" });
    await tx.insert(schema.orders).values({ id: orderId, organizationId: org, customerId: buyer, createdByUserId: actor, quoteId,
      orderNumber: String(number), state: "open", status: "in_production", shippingMethod: "pickup", subtotal: "125.00", total: "125.00" });
    await tx.insert(schema.invoices).values({ id: invoiceId, organizationId: org, orderId, customerId: buyer, createdByUserId: actor,
      invoiceNumber: number, sourceOrderNumber: number, subtotal: "125.00", total: "125.00", totalCents: 12500 });
    await tx.insert(schema.orderLineItems).values({ id: lineId, orderId, productId: product, description: "Synthetic historical printed material", quantity: 5,
      width: "24.00", height: "18.00", unitPrice: "25.00", totalPrice: "125.00", workflowState: "in_production", status: "in_production",
      requiresPrepress: false, requiresDesign: false, requiresProofApproval: false, productType: "wide_roll",
      materialUsageJson: [{ materialId: "synthetic-sold-media", materialName: "Historical media", quantityUsed: 15, unitOfMeasure: "sqft" }],
      optionSelectionsJson: { schemaVersion: 2, selected: { sides: { value: "double" } } },
      pbv2SnapshotJson: { synthetic: true, pricing: { totalCents: 12500 }, units: { width: "in", height: "in" } } });
    await tx.insert(schema.productionJobs).values({ id: jobId, organizationId: org, orderId, lineItemId: lineId,
      stationKey: "roll", stepKey: "queued", status: "in_progress", startedAt });
    await tx.insert(schema.productionEvents).values({ organizationId: org, productionJobId: jobId, orderId, orderLineItemId: lineId,
      actorUserId: actor, type: "timer_started", payload: {}, createdAt: startedAt });
  });
  return { orderId, lineId, jobId, quoteId, invoiceId };
}

async function snapshot() {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: tables } = await connection.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
    const state: Record<string, { count: string; fingerprint: string }> = {};
    for (const { table_name } of tables) {
      const quoted = `"${table_name.replace(/"/g, '""')}"`;
      const { rows } = await connection.query<{ count: string; fingerprint: string }>(
        `SELECT count(*)::text AS count, md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), '')) AS fingerprint FROM public.${quoted} t`);
      state[table_name] = rows[0]!;
    }
    await connection.query("COMMIT");
    return state;
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}

// Existing routing owner ensureSystemFulfillmentStation also refreshes the
// canonical fulfillment step's active/updated_at via an unconditional upsert.
const mutationTables = ["orders", "order_line_items", "production_jobs", "production_events", "audit_logs", "production_station_steps"];
function expectOnlyChanged(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>, allowed = mutationTables) {
  expect(Object.keys(before).filter(table => JSON.stringify(before[table]) !== JSON.stringify(after[table]) && !allowed.includes(table))).toEqual([]);
  expect(after.shipments.count).toBe("0");
  expect(after.fulfillment_ready_quantities.count).toBe("0");
  expect(after.fulfillment_events.count).toBe("0");
}

async function commercial(f: Fixture) {
  const [line] = await db.select().from(schema.orderLineItems).where(eq(schema.orderLineItems.id, f.lineId));
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, f.orderId));
  return { quoteId: order.quoteId, customerId: order.customerId, total: order.total, subtotal: order.subtotal, tax: order.tax,
    line: { quantity: line.quantity, width: line.width, height: line.height, unitPrice: line.unitPrice, totalPrice: line.totalPrice,
      materialUsageJson: line.materialUsageJson, optionSelectionsJson: line.optionSelectionsJson, pbv2SnapshotJson: line.pbv2SnapshotJson } };
}
async function saved(f: Fixture) {
  const jobs = await db.select().from(schema.productionJobs).where(eq(schema.productionJobs.lineItemId, f.lineId));
  const events = await db.select().from(schema.productionEvents).where(eq(schema.productionEvents.productionJobId, f.jobId));
  const timeline = await db.select().from(schema.productionEvents).where(eq(schema.productionEvents.orderLineItemId, f.lineId));
  const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.entityId, f.jobId), eq(schema.auditLogs.entityType, "production_job")));
  const [line] = await db.select().from(schema.orderLineItems).where(eq(schema.orderLineItems.id, f.lineId));
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, f.orderId));
  return { jobs, events, timeline, audits, line, order };
}

function normalApp() {
  const app = express(); app.use(express.json());
  const auth: express.RequestHandler = (req, _res, next) => { Object.assign(req, { user: { id: actor, role: "employee", accountType: "INTERNAL_USER" } }); next(); };
  const tenant: express.RequestHandler = async (req, res, next) => {
    const [membership] = await db.select().from(schema.userOrganizations)
      .where(and(eq(schema.userOrganizations.organizationId, org), eq(schema.userOrganizations.userId, actor)));
    if (!membership) { res.status(403).json({ error: "No synthetic membership" }); return; }
    Object.assign(req, { organizationId: org, orgRole: membership.role }); next();
  };
  registerProductionJobsRoutes(app, { isAuthenticated: auth, tenantContext: tenant, isAdminOrOwner: auth, assertInternalUser: () => true });
  return app;
}
async function ordinary(f: Fixture) {
  const response = await request(normalApp()).post(`/api/production/jobs/${f.jobId}/complete`).send({ skipProduction: false });
  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  return response.body.data;
}

const executionScope = (): ExecutionActorScope => ({ organizationId: org, userId: actor, organizationRole: "owner", authorityStatus: "resolved",
  permissions: ["assistant.production.update_job_status"], environment: "test" });
function planner() {
  const command = createProductionCompletionExecutionCommand();
  return new ExecutionPlanningService(new DrizzleAssistantExecutionRepository(), {
    get: name => name === command.name ? command : undefined, list: () => [command],
  }, { allowProductionExecution: true });
}
async function reviewedPlan(f: Fixture) {
  const conversationId = randomUUID();
  await db.insert(schema.aiConversations).values({ id: conversationId, orgId: org, userId: actor, title: "Synthetic production completion" });
  const preview = await previewReviewedProductionCompletion(scope(f));
  const args = prepareProductionCompletionCommandArguments(preview);
  const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: `/orders/${f.orderId}`, pageTitle: "Order",
    entityType: "order", entityId: f.orderId, unsavedChanges: false, capturedAt: new Date().toISOString() });
  const service = planner();
  const plan = await service.createPlan(executionScope(), { conversationId, commandName: productionCompletionCommandName, arguments: args, context });
  const issued = await service.issueConfirmation(executionScope(), plan.id, plan.version);
  return { args, context, service, plan, issued };
}

beforeAll(async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.port !== "55599" || url.pathname !== "/printershero_job_completion_test") {
    throw new Error("Production completion requires its assigned disposable loopback PostgreSQL database on port 55599");
  }
  await db.transaction(async tx => {
    await tx.insert(schema.organizations).values([org, otherOrg].map(id => ({ id, name: "Synthetic production completion", slug: id,
      settings: { preferences: { proofing: { policy: "manual_requested_only" as const } } } })));
    await tx.insert(schema.users).values({ id: actor, email: `${actor}@example.invalid`, role: "employee", accountType: "INTERNAL_USER" });
    await tx.insert(schema.userOrganizations).values([{ organizationId: org, userId: actor, role: "owner" }, { organizationId: otherOrg, userId: actor, role: "owner" }]);
    await tx.insert(schema.customers).values({ id: buyer, organizationId: org, companyName: "Synthetic completion buyer", creditLimit: "100000", creditLimitConfiguredAt: new Date() });
    await tx.insert(schema.products).values({ id: product, organizationId: org, name: "Synthetic individual production", description: "Synthetic only", requiresProductionJob: true, requiresProofApproval: false });
    await tx.insert(schema.stations).values(["roll", "fulfillment"].map(key => ({ id: randomUUID(), organizationId: org, key, name: key, active: true })));
    await tx.insert(schema.productionStationSteps).values({ organizationId: org, stationKey: "roll", key: "queued", label: "Queued", active: true,
      triggers: [{ type: "on_complete_route", config: { stationKey: "fulfillment", stepKey: "fulfillment" } }] });
    await tx.insert(schema.productionStationSteps).values({ organizationId: org, stationKey: "fulfillment", key: "fulfillment", label: "Fulfillment", active: true, triggers: [] });
  });
  // Native postcommit hook finds no mapping and skips BEFORE notification
  // scheduling. Do not replace the hook or suppress an external send in a mock.
  expect(await db.select().from(schema.workflowStatusPillMappings)).toHaveLength(0);
});
afterAll(async () => { await pool.end(); });

test("ordinary Production-board completion remains native and creates one canonical successor, never physical readiness", async () => {
  const f = await fixture(), history = await commercial(f), before = await snapshot();
  await ordinary(f);
  const state = await saved(f);
  expect(state.jobs.find(job => job.id === f.jobId)).toMatchObject({ status: "done", completedByUserId: actor, previousStatus: "in_progress" });
  expect(state.jobs).toHaveLength(2);
  expect(state.jobs.filter(job => job.stationKey === "fulfillment")).toEqual([expect.objectContaining({ status: "queued", orderId: f.orderId, lineItemId: f.lineId })]);
  expect(state.line).toMatchObject({ status: "complete", workflowState: "completed" });
  expect(state.order).toMatchObject({ state: "production_complete", status: "ready_for_shipment", routingTarget: "fulfillment" });
  expect(state.events.filter(event => event.type === "timer_stopped")).toHaveLength(1);
  expect(state.events.filter(event => event.payload.eventType === "production_job_completed")).toHaveLength(1);
  expect(state.audits).toHaveLength(1);
  expect(await commercial(f)).toEqual(history);
  expectOnlyChanged(before, await snapshot());
});

test("reviewed native completion matches the normal job/line/order result and native completion timeline", async () => {
  const direct = await fixture(), assisted = await fixture();
  await ordinary(direct);
  const before = await snapshot(), historical = await commercial(assisted);
  const preview = await previewReviewedProductionCompletion(scope(assisted));
  expect(await snapshot()).toEqual(before);
  const applied = await executeReviewedProductionCompletion(scope(assisted), preview);
  expect(applied.status).toBe("applied");
  expect(applied.postcommit).toEqual([{ triggerKey: "sent_to_fulfillment", status: "skipped", reason: "mapping_missing" }]);
  const a = await saved(direct), b = await saved(assisted);
  expect(b.jobs).toHaveLength(a.jobs.length);
  expect(b.jobs.map(job => ({ station: job.stationKey, step: job.stepKey, status: job.status })).sort((x, y) => x.station.localeCompare(y.station)))
    .toEqual(a.jobs.map(job => ({ station: job.stationKey, step: job.stepKey, status: job.status })).sort((x, y) => x.station.localeCompare(y.station)));
  expect([b.line.status, b.line.workflowState, b.order.state, b.order.status, b.order.routingTarget])
    .toEqual([a.line.status, a.line.workflowState, a.order.state, a.order.status, a.order.routingTarget]);
  const completed = (state: Awaited<ReturnType<typeof saved>>) => state.events.find(event => event.payload.eventType === "production_job_completed")!;
  const semantic = (event: ReturnType<typeof completed>) => {
    const payload = structuredClone(event.payload); delete payload.completedAt; delete payload.restoreUntil;
    return { type: event.type, actorUserId: event.actorUserId, payload };
  };
  expect(semantic(completed(b))).toEqual(semantic(completed(a)));
  expect(b.events).toHaveLength(a.events.length);
  // Compare all native job/line history, including successor intake and parent
  // handoff. Normalize only fixture IDs and elapsed/clock values; no AI-only
  // event may be added or omitted to make the timeline match.
  const timeline = (state: typeof a, f: Fixture) => {
    const ids = new Map<string, string>([[f.orderId, "order"], [f.lineId, "line"], [f.jobId, "original-job"],
      ...state.jobs.filter(job => job.id !== f.jobId).map(job => [job.id, `successor:${job.stationKey}`] as [string, string])]);
    const normalize = (value: unknown, key = ""): unknown => {
      if (key === "seconds") return "elapsed-seconds";
      if (typeof value === "string") return ids.get(value) ?? (/^\d{4}-\d\d-\d\dT/.test(value) ? "native-clock" : value);
      if (Array.isArray(value)) return value.map(item => normalize(item));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, normalize(item, name)]));
      return value;
    };
    return state.timeline.map(event => JSON.stringify(normalize({ jobId: event.productionJobId, type: event.type,
      actorUserId: event.actorUserId, orderId: event.orderId, lineId: event.orderLineItemId, payload: event.payload }))).sort();
  };
  expect(timeline(b, assisted)).toEqual(timeline(a, direct));
  expect(b.events.filter(event => event.type === "timer_stopped")).toHaveLength(1);
  expect(b.audits).toHaveLength(1);
  expect(await commercial(assisted)).toEqual(historical);
  expectOnlyChanged(before, await snapshot());
});

test("fresh native/assistant fulfillment and Order indicators reflect committed production completion without physical quantities", async () => {
  const f = await fixture();
  const initial = await canonicalFulfillmentOperations.getOrderDetail(org, f.orderId, "owner");
  expect(initial.productionCompleteQuantity).toBe(0);
  expect(buildOrderReadinessLights((await reader.getOrderById(org, f.orderId))!).inProgressCount).toBe(1);
  const preview = await previewReviewedProductionCompletion(scope(f));
  await executeReviewedProductionCompletion(scope(f), preview);
  const beforeRead = await snapshot();
  const native = await canonicalFulfillmentOperations.getOrderDetail(org, f.orderId, "owner");
  const assistant = await readOrderFulfillmentReadiness({ organizationId: org, userId: actor, orderId: f.orderId });
  expect(native.productionCompleteQuantity).toBe(5);
  expect(native.readyWaitingQuantity).toBe(0);
  expect(assistant.status).toBe("available");
  if (assistant.status === "available") expect(assistant.quantities).toMatchObject({ productionCompleteQuantity: 5, readyWaitingQuantity: 0, shippedQuantity: 0, pickedUpQuantity: 0 });
  expect(buildOrderReadinessLights((await reader.getOrderById(org, f.orderId))!)).toMatchObject({ inProgressCount: 0, actionNeededCount: 0 });
  expect(await snapshot()).toEqual(beforeRead);
});

test.each(["job", "line", "route"] as const)("reviewed %s revision changed after preview rejects without completing anything", async changed => {
  const f = await fixture(), preview = await previewReviewedProductionCompletion(scope(f));
  const [route] = await db.select().from(schema.productionStationSteps).where(and(eq(schema.productionStationSteps.organizationId, org),
    eq(schema.productionStationSteps.stationKey, "roll"), eq(schema.productionStationSteps.key, "queued")));
  if (changed === "job") await db.update(schema.productionJobs).set({ status: "queued", updatedAt: new Date() }).where(eq(schema.productionJobs.id, f.jobId));
  if (changed === "line") await db.update(schema.orderLineItems).set({ quantity: 6, updatedAt: new Date() }).where(eq(schema.orderLineItems.id, f.lineId));
  if (changed === "route") await db.update(schema.productionStationSteps).set({ triggers: [{ type: "on_complete_route", config: { stationKey: "roll", stepKey: "finishing" } }] })
    .where(eq(schema.productionStationSteps.id, route.id));
  try {
    const before = await snapshot();
    await expect(executeReviewedProductionCompletion(scope(f), preview)).rejects.toMatchObject({ code:
      changed === "job" ? "PRODUCTION_COMPLETION_STARTED_REQUIRED" : "PRODUCTION_COMPLETION_REVIEW_STALE" });
    expect(await snapshot()).toEqual(before);
    expect((await saved(f)).jobs).toHaveLength(1);
  } finally {
    if (changed === "route") await db.update(schema.productionStationSteps).set({ triggers: route.triggers }).where(eq(schema.productionStationSteps.id, route.id));
  }
});

test("cross-tenant, different actor and revoked persisted membership cannot complete the reviewed job", async () => {
  const f = await fixture(), preview = await previewReviewedProductionCompletion(scope(f));
  const before = await snapshot();
  await expect(previewReviewedProductionCompletion({ ...scope(f), organizationId: otherOrg })).rejects.toMatchObject({ code: "PRODUCTION_COMPLETION_TARGET_NOT_FOUND" });
  await expect(executeReviewedProductionCompletion({ ...scope(f), organizationId: otherOrg }, preview)).rejects.toMatchObject({ code: "PRODUCTION_COMPLETION_SCOPE_MISMATCH" });
  await expect(executeReviewedProductionCompletion({ ...scope(f), actorUserId: randomUUID() }, preview)).rejects.toMatchObject({ code: "PRODUCTION_COMPLETION_SCOPE_MISMATCH" });
  expect(await snapshot()).toEqual(before);
  await db.delete(schema.userOrganizations).where(and(eq(schema.userOrganizations.organizationId, org), eq(schema.userOrganizations.userId, actor)));
  try {
    const revoked = await snapshot();
    await expect(executeReviewedProductionCompletion(scope(f), preview)).rejects.toMatchObject({ code: "PRODUCTION_COMPLETION_FORBIDDEN" });
    expect(await snapshot()).toEqual(revoked);
  } finally { await db.insert(schema.userOrganizations).values({ organizationId: org, userId: actor, role: "owner" }); }
});

test("a database failure at completion-event insertion rolls back timers, completion, successor and parent handoff", async () => {
  const f = await fixture(), preview = await previewReviewedProductionCompletion(scope(f));
  await pool.query(`CREATE FUNCTION production_completion_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.payload->>'eventType' = 'production_job_completed' THEN RAISE EXCEPTION 'synthetic completion event failure'; END IF;
    RETURN NEW; END $body$`);
  await pool.query("CREATE TRIGGER production_completion_fixture_failure BEFORE INSERT ON production_events FOR EACH ROW EXECUTE FUNCTION production_completion_fixture_failure()");
  try {
    const before = await snapshot();
    await expect(executeReviewedProductionCompletion(scope(f), preview)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    expect((await saved(f)).jobs).toHaveLength(1);
  } finally {
    await pool.query("DROP TRIGGER production_completion_fixture_failure ON production_events");
    await pool.query("DROP FUNCTION production_completion_fixture_failure()");
  }
});

test("actual overlapping normal/reviewed completion transactions cannot duplicate the completion or successor", async () => {
  const f = await fixture(), preview = await previewReviewedProductionCompletion(scope(f));
  const before = await snapshot();
  const gate = await pool.connect();
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await gate.query("BEGIN");
    await gate.query("SELECT id FROM order_line_items WHERE id=$1 FOR UPDATE", [f.lineId]);
    pending = Promise.allSettled([ordinary(f), executeReviewedProductionCompletion(scope(f), preview)]);
    let blocked = 0;
    const until = Date.now() + 6000;
    do {
      const observed = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%FOR UPDATE%'`);
      blocked = Number(observed.rows[0]?.count);
      if (blocked < 2) await new Promise(resolve => setTimeout(resolve, 20));
    } while (blocked < 2 && Date.now() < until);
    expect(blocked).toBe(2);
    await gate.query("COMMIT");
  } finally {
    await gate.query("ROLLBACK"); gate.release();
    if (pending) await pending;
  }
  const outcomes = await pending!;
  expect(outcomes[0].status).toBe("fulfilled");
  if (outcomes[1].status === "rejected") {
    expect(["PRODUCTION_COMPLETION_STARTED_REQUIRED", "PRODUCTION_COMPLETION_REVIEW_STALE"]).toContain(outcomes[1].reason.code);
  }
  const state = await saved(f);
  expect(state.jobs).toHaveLength(2);
  expect(state.jobs.filter(job => job.stationKey === "fulfillment")).toHaveLength(1);
  expect(state.events.filter(event => event.payload.eventType === "production_job_completed")).toHaveLength(1);
  expect(state.events.filter(event => event.type === "timer_stopped")).toHaveLength(1);
  expect(state.audits).toHaveLength(1);
  const after = await snapshot();
  expectOnlyChanged(before, after);
});

test.each(["membership_role", "canceled_parent"] as const)("native %s changed after review rejects atomically", async changed => {
  const f = await fixture(), preview = await previewReviewedProductionCompletion(scope(f));
  if (changed === "membership_role") await db.update(schema.userOrganizations).set({ role: "member" })
    .where(and(eq(schema.userOrganizations.organizationId, org), eq(schema.userOrganizations.userId, actor)));
  else await db.update(schema.orders).set({ status: "canceled", canceledAt: new Date().toISOString() }).where(eq(schema.orders.id, f.orderId));
  try {
    const before = await snapshot();
    await expect(executeReviewedProductionCompletion(scope(f), preview)).rejects.toMatchObject({ code:
      changed === "membership_role" ? "PRODUCTION_COMPLETION_REVIEW_STALE" : "PRODUCTION_COMPLETION_STATE_CHANGED" });
    expect(await snapshot()).toEqual(before);
  } finally {
    if (changed === "membership_role") await db.update(schema.userOrganizations).set({ role: "owner" })
      .where(and(eq(schema.userOrganizations.organizationId, org), eq(schema.userOrganizations.userId, actor)));
  }
});

test("durable GO completes once and reconstructed-planner replay creates no second completion or obligation", async () => {
  const f = await fixture(), historical = await commercial(f);
  const { service, plan, issued, context, args } = await reviewedPlan(f);
  const before = await snapshot();
  const confirm = { planId: plan.id, expectedVersion: issued.plan.version, token: issued.token, context };
  await expect(service.confirmAndExecute(executionScope(), { ...confirm, token: "GO" })).rejects.toMatchObject({ code: "INVALID_CONFIRMATION" });
  await expect(service.confirmAndExecute({ ...executionScope(), organizationId: otherOrg }, confirm)).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
  expect(await snapshot()).toEqual(before);
  expect((await saved(f)).jobs).toEqual([expect.objectContaining({ id: f.jobId, status: "in_progress" })]);
  const first = await service.confirmAndExecute(executionScope(), confirm);
  expect(first.plan.status).toBe("succeeded");
  expect(first.result?.status).toBe("succeeded");
  expect(first.result?.summary).toContain(`Completed production job ${f.jobId}`);
  const after = await snapshot();
  expectOnlyChanged(before, after, [...mutationTables, "ai_execution_plans", "ai_confirmations", "ai_execution_steps", "ai_idempotency_records", "ai_audit_events"]);
  const replay = await planner().confirmAndExecute(executionScope(), confirm);
  expect(replay.result).toEqual(first.result);
  expect(await snapshot()).toEqual(after);
  // A completed native job is not a new preview or an actor-attributed receipt.
  // Only the existing durable GO record may replay the original success.
  await expect(executeReviewedProductionCompletion(scope(f), args.preview)).rejects.toMatchObject({ code: "PRODUCTION_COMPLETION_STARTED_REQUIRED" });
  expect(await snapshot()).toEqual(after);
  const state = await saved(f);
  expect(state.jobs).toHaveLength(2);
  expect(state.events.filter(event => event.payload.eventType === "production_job_completed")).toHaveLength(1);
  expect(state.audits).toHaveLength(1);
  expect(await commercial(f)).toEqual(historical);
});

test("normal completion after GO review invalidates that GO rather than repeating production side effects", async () => {
  const f = await fixture();
  const { service, plan, issued, context } = await reviewedPlan(f);
  await ordinary(f);
  const before = await snapshot();
  await expect(service.confirmAndExecute(executionScope(), { planId: plan.id, expectedVersion: issued.plan.version, token: issued.token, context }))
    .rejects.toMatchObject({ code: "PLAN_STALE" });
  expect((await service.getPlan(executionScope(), plan.id)).status).toBe("invalidated");
  expectOnlyChanged(before, await snapshot(), ["ai_execution_plans", "ai_confirmations", "ai_audit_events"]);
  expect((await saved(f)).events.filter(event => event.payload.eventType === "production_job_completed")).toHaveLength(1);
});
