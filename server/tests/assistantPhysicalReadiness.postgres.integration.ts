import { afterAll, beforeAll, expect, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { db, pool } from "../db";
import { registerFulfillmentRoutes } from "../routes/fulfillment.routes";
import { canonicalFulfillmentOperations as native } from "../services/fulfillment/canonicalFulfillmentOperations";
import { readOrderFulfillmentReadiness } from "../services/assistant/orderFulfillmentReadinessRead";
import { previewPhysicalReadinessAdjustment, executePhysicalReadinessAdjustment } from "../services/assistant/physicalReadinessAdjustment";
import { DrizzleAssistantExecutionRepository } from "../storage/assistantExecution.repo";
import { ExecutionPlanningService } from "../services/assistant/execution/executionPlanningService";
import { createPhysicalReadinessExecutionCommand, physicalReadinessCommandName, preparePhysicalReadinessCommandArguments } from "../services/assistant/execution/physicalReadinessCommand";
import type { ExecutionActorScope } from "../services/assistant/execution/types";

// Real disposable loopback PostgreSQL, canonical services, default adapter and
// persisted authorization. No repository/provider/business-operation mocks.
// Run with jest.local-postgres.config.js. Schema-projection bootstrap plus that
// config's supplements is NOT a full production migration/trigger rehearsal.
// Authentication middleware is synthetic; membership and native role are real.
const org = randomUUID(), foreignOrg = randomUUID(), actor = randomUUID(), member = randomUUID();
const buyer = randomUUID(), product = randomUUID();
const reason = "Synthetic inspection confirmed these physical units at the fulfillment desk";
let orderNumber = 940000;
type Fixture = Awaited<ReturnType<typeof fixture>>;

const scope = (f: { orderId: string }, userId = actor, organizationId = org) => ({ organizationId, userId, orderId: f.orderId });
const input = (f: Fixture, quantityDelta = 2) => ({ orderLineItemId: f.lineId, quantityDelta, reason });

async function fixture() {
  const orderId = randomUUID(), lineId = randomUUID(), secondLineId = randomUUID(), quoteId = randomUUID(), invoiceId = randomUUID();
  const number = ++orderNumber;
  await db.transaction(async tx => {
    await tx.insert(schema.quotes).values({ id: quoteId, organizationId: org, userId: actor, customerId: buyer, quoteNumber: number, totalPrice: "150.00" });
    await tx.insert(schema.orders).values({ id: orderId, organizationId: org, createdByUserId: actor, customerId: buyer, quoteId,
      orderNumber: String(number), state: "open", status: "in_production", shippingMethod: "pickup", subtotal: "150.00", total: "150.00" });
    await tx.insert(schema.invoices).values({ id: invoiceId, organizationId: org, createdByUserId: actor, customerId: buyer, orderId,
      invoiceNumber: number, sourceOrderNumber: number, subtotal: "150.00", total: "150.00", totalCents: 15000 });
    await tx.insert(schema.orderLineItems).values([
      { id: lineId, orderId, productId: product, description: "Synthetic sold media preserved", quantity: 5,
        width: "24.00", height: "18.00", unitPrice: "25.00", totalPrice: "125.00", status: "in_production", workflowState: "in_production",
        requiresDesign: false, requiresProofApproval: false,
        materialUsageJson: [{ materialId: "synthetic-sold-media", materialName: "Historical media", quantityUsed: 15, unitOfMeasure: "sqft" }],
        optionSelectionsJson: { schemaVersion: 2, selected: { sides: { value: "double" } } },
        pbv2SnapshotJson: { synthetic: true, pricing: { totalCents: 12500 }, units: { width: "in", height: "in" } }, sortOrder: 0 },
      { id: secondLineId, orderId, productId: product, description: "Synthetic second line", quantity: 1, unitPrice: "25.00", totalPrice: "25.00",
        status: "in_production", workflowState: "in_production", requiresDesign: false, requiresProofApproval: false, sortOrder: 1 },
    ]);
  });
  return { orderId, lineId, secondLineId, quoteId, invoiceId };
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

function expectOnlyChanged(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>, allowed: string[]) {
  const changed = Object.keys(before).filter(table => JSON.stringify(before[table]) !== JSON.stringify(after[table]));
  expect(changed.filter(table => !allowed.includes(table))).toEqual([]);
  expect(after.production_jobs.count).toBe("0");
  expect(after.shipments.count).toBe("0");
}

function normalApp(userId = actor, organizationId = org) {
  const app = express();
  app.use(express.json());
  registerFulfillmentRoutes(app, {
    isAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => { Object.assign(req, { user: { id: userId } }); next(); },
    tenantContext: async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const [membership] = await db.select().from(schema.userOrganizations)
        .where(and(eq(schema.userOrganizations.organizationId, organizationId), eq(schema.userOrganizations.userId, userId)));
      if (!membership) { res.status(403).json({ success: false }); return; }
      Object.assign(req, { organizationId, orgRole: membership.role }); next();
    },
    requireOrgOwnerAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(), // unused by the tested ready-quantities route
  });
  return app;
}

async function normalAdjust(f: Fixture, quantityDelta = 2) {
  const response = await request(normalApp()).post(`/api/fulfillment/orders/${f.orderId}/ready-quantities`)
    .send({ items: [{ orderLineItemId: f.lineId, quantityDelta }], reason });
  expect(response.status).toBe(200);
  return native.getOrderDetail(org, f.orderId, "owner");
}

const executionScope = (): ExecutionActorScope => ({ organizationId: org, userId: actor, organizationRole: "owner", authorityStatus: "resolved",
  permissions: ["assistant.fulfillment.add_note"], environment: "test" });
const contextFor = (f: Fixture) => assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: `/orders/${f.orderId}`,
  pageTitle: "Order", entityType: "order", entityId: f.orderId, unsavedChanges: false, capturedAt: new Date().toISOString() });
function planner() {
  const command = createPhysicalReadinessExecutionCommand();
  return new ExecutionPlanningService(new DrizzleAssistantExecutionRepository(), {
    get: name => name === command.name ? command : undefined, list: () => [command],
  }, { allowProductionExecution: true });
}
async function reviewedPlan(f: Fixture) {
  const conversationId = randomUUID();
  await db.insert(schema.aiConversations).values({ id: conversationId, orgId: org, userId: actor, title: "Synthetic physical adjustment" });
  const preview = await previewPhysicalReadinessAdjustment(scope(f), input(f));
  const args = preparePhysicalReadinessCommandArguments(preview);
  const context = contextFor(f), service = planner();
  const plan = await service.createPlan(executionScope(), { conversationId, commandName: physicalReadinessCommandName, arguments: args, context });
  const issued = await service.issueConfirmation(executionScope(), plan.id, plan.version);
  return { args, context, service, plan, issued };
}

beforeAll(async () => {
  const target = new URL(process.env.TEST_DATABASE_URL!);
  if (target.hostname !== "127.0.0.1" || target.port !== "55598" || target.pathname !== "/printershero_physical_readiness_test") {
    throw new Error("This fixture requires its assigned disposable loopback PostgreSQL database on port 55598");
  }
  await db.transaction(async tx => {
    await tx.insert(schema.organizations).values([
      { id: org, name: "Synthetic physical readiness", slug: org }, { id: foreignOrg, name: "Synthetic other tenant", slug: foreignOrg },
    ]);
    await tx.insert(schema.users).values([
      { id: actor, email: `${actor}@example.invalid`, role: "employee", accountType: "INTERNAL_USER" },
      { id: member, email: `${member}@example.invalid`, role: "employee", accountType: "INTERNAL_USER" },
    ]);
    await tx.insert(schema.userOrganizations).values([
      { organizationId: org, userId: actor, role: "owner" }, { organizationId: foreignOrg, userId: actor, role: "owner" },
      { organizationId: org, userId: member, role: "member" },
    ]);
    await tx.insert(schema.customers).values({ id: buyer, organizationId: org, companyName: "Synthetic physical-readiness buyer" });
    await tx.insert(schema.products).values({ id: product, organizationId: org, name: "Synthetic production item", description: "Synthetic only", requiresProductionJob: true });
  });
});

afterAll(async () => { await pool.end(); });

test("normal native route works without AI; physical readiness neither completes production nor changes commercial history", async () => {
  const f = await fixture();
  const before = await snapshot();
  const detail = await normalAdjust(f);
  expect(detail.readyWaitingQuantity).toBe(2);
  expect(detail.productionCompleteQuantity).toBe(0);
  expect(detail.events).toHaveLength(1);
  expect(detail.events[0]).toMatchObject({ eventType: "FULFILLMENT_READY", actorUserId: actor, payloadJson: {
    source: "operator_physical_confirmation", reason, adjustments: [{ orderLineItemId: f.lineId, quantityDelta: 2,
      previousReadyQuantity: 0, nextReadyQuantity: 2, productionState: { workflowState: "in_production", lifecycleStatus: "in_production", ownerJobId: null } }],
  } });
  expectOnlyChanged(before, await snapshot(), ["fulfillment_ready_quantities", "fulfillment_events"]);
});

test("native HTTP validation rejects fractional/zero quantities; out-of-range and multi-line failures are all-or-nothing", async () => {
  const f = await fixture();
  const before = await snapshot();
  for (const quantityDelta of [0, 0.5]) {
    const response = await request(normalApp()).post(`/api/fulfillment/orders/${f.orderId}/ready-quantities`)
      .send({ items: [{ orderLineItemId: f.lineId, quantityDelta }], reason });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  }
  await expect(native.adjustReadyQuantities(org, f.orderId, {
    items: [{ orderLineItemId: f.lineId, quantityDelta: 2 }, { orderLineItemId: f.secondLineId, quantityDelta: 2 }], reason,
  }, actor, "owner")).rejects.toMatchObject({ code: "QTY_EXCEEDS_ORDER" });
  await expect(native.adjustReadyQuantities(org, f.orderId, { items: [{ orderLineItemId: f.lineId, quantityDelta: -1 }], reason }, actor, "owner"))
    .rejects.toMatchObject({ code: "QTY_BELOW_FULFILLED" });
  expect(await snapshot()).toEqual(before);
});

test("default assistant adapter uses the same native quantities and timeline and exact retry writes once", async () => {
  const direct = await fixture(), assisted = await fixture();
  const directDetail = await normalAdjust(direct);
  const beforePreview = await snapshot();
  const preview = await previewPhysicalReadinessAdjustment(scope(assisted), input(assisted));
  expect(await snapshot()).toEqual(beforePreview);
  const key = randomUUID();
  const result = await executePhysicalReadinessAdjustment(scope(assisted), preview, { clientRequestId: key });
  expect(result.status).toBe("applied");
  const detail = await native.getOrderDetail(org, assisted.orderId, "owner");
  expect(detail.readyWaitingQuantity).toBe(directDetail.readyWaitingQuantity);
  expect(detail.productionCompleteQuantity).toBe(0);
  expect(detail.events).toHaveLength(1);
  const normalize = (event: typeof detail.events[number], lineId: string) => {
    const payload = structuredClone(event.payloadJson);
    delete payload.confirmedAt; delete payload.clientRequestId;
    payload.adjustments = payload.adjustments.map((adjustment: Record<string, unknown>) => ({ ...adjustment,
      orderLineItemId: adjustment.orderLineItemId === lineId ? "tested-line" : adjustment.orderLineItemId }));
    return { actorUserId: event.actorUserId, eventType: event.eventType, entityType: event.entityType, payload };
  };
  expect(normalize(detail.events[0], assisted.lineId)).toEqual(normalize(directDetail.events[0], direct.lineId));
  const after = await snapshot();
  expectOnlyChanged(beforePreview, after, ["fulfillment_ready_quantities", "fulfillment_events"]);
  const replay = await executePhysicalReadinessAdjustment(scope(assisted), preview, { clientRequestId: key });
  expect(replay.status).toBe("applied");
  expect(await snapshot()).toEqual(after);
});

test("default fulfillment reader sees only committed physical quantities and refreshes after native commit", async () => {
  const f = await fixture();
  await normalAdjust(f, 1);
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("UPDATE fulfillment_ready_quantities SET ready_waiting_quantity=3 WHERE order_id=$1", [f.orderId]);
    const during = await readOrderFulfillmentReadiness(scope(f));
    expect(during.status).toBe("available");
    if (during.status === "available") expect(during.quantities.readyWaitingQuantity).toBe(1);
    await connection.query("COMMIT");
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
  const before = await snapshot();
  const fresh = await readOrderFulfillmentReadiness(scope(f));
  expect(fresh.status).toBe("available");
  if (fresh.status === "available") {
    expect(fresh.quantities.readyWaitingQuantity).toBe(3);
    expect(fresh.quantities.readyWaitingQuantity).toBe((await native.getOrderDetail(org, f.orderId, "owner")).readyWaitingQuantity);
  }
  expect(await snapshot()).toEqual(before);
  // Actual ordinary business operation, not just a direct fixture update.
  await normalAdjust(f, 1);
  const afterNativeCommit = await readOrderFulfillmentReadiness(scope(f));
  expect(afterNativeCommit.status).toBe("available");
  if (afterNativeCommit.status === "available") expect(afterNativeCommit.quantities.readyWaitingQuantity).toBe(4);
});

test("tenant, member and missing actor fail closed without side effects", async () => {
  const f = await fixture();
  const before = await snapshot();
  for (const [denied, code] of [[scope(f, actor, foreignOrg), "NOT_FOUND"], [scope(f, member), "READY_PERMISSION_DENIED"],
    [scope(f, randomUUID()), "NATIVE_AUTHORITY_UNVERIFIED"]] as const) {
    await expect(previewPhysicalReadinessAdjustment(denied, input(f))).rejects.toMatchObject({ code });
  }
  expect(await snapshot()).toEqual(before);
});

test("stale native readiness and membership revocation after preview cannot execute", async () => {
  const f = await fixture();
  const preview = await previewPhysicalReadinessAdjustment(scope(f), input(f));
  await normalAdjust(f, 1);
  const afterChange = await snapshot();
  await expect(executePhysicalReadinessAdjustment(scope(f), preview, { clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "READINESS_CHANGED" });
  expect(await snapshot()).toEqual(afterChange);
  const current = await previewPhysicalReadinessAdjustment(scope(f), input(f));
  await db.delete(schema.userOrganizations).where(and(eq(schema.userOrganizations.organizationId, org), eq(schema.userOrganizations.userId, actor)));
  try {
    const revoked = await snapshot();
    await expect(executePhysicalReadinessAdjustment(scope(f), current, { clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "NATIVE_AUTHORITY_UNVERIFIED" });
    expect(await snapshot()).toEqual(revoked);
  } finally { await db.insert(schema.userOrganizations).values({ organizationId: org, userId: actor, role: "owner" }); }
});

test("real simultaneous native/assistant corrections serialize and reject the stale expected ready quantity", async () => {
  const f = await fixture();
  const preview = await previewPhysicalReadinessAdjustment(scope(f), input(f));
  const before = await snapshot();
  const nativePayload = { items: [{ orderLineItemId: f.lineId, quantityDelta: 2 }], reason,
    clientRequestId: randomUUID(), expectedReadyByLine: { [f.lineId]: 0 } };
  const gate = await pool.connect();
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await gate.query("BEGIN");
    await gate.query("SELECT id FROM order_line_items WHERE order_id=$1 FOR UPDATE", [f.orderId]);
    pending = Promise.allSettled([
      native.adjustReadyQuantities(org, f.orderId, nativePayload, actor, "owner"),
      executePhysicalReadinessAdjustment(scope(f), preview, { clientRequestId: randomUUID() }),
    ]);
    // Observe BOTH actual repository transactions waiting on the fixture row
    // lock before release. This is real lock contention, not a timing assertion.
    let blocked = 0;
    const deadline = Date.now() + 5000;
    do {
      // A separate autocommit connection avoids PostgreSQL's cached statistics
      // snapshot inside the long-lived gate transaction.
      const observed = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%FOR UPDATE%'`);
      blocked = Number(observed.rows[0]?.count);
      if (blocked < 2) await new Promise(resolve => setTimeout(resolve, 20));
    } while (blocked < 2 && Date.now() < deadline);
    expect(blocked).toBe(2);
    await gate.query("COMMIT");
  } finally {
    await gate.query("ROLLBACK"); gate.release();
    // Release blocked native work even if the observation assertion fails.
    if (pending) await pending;
  }
  const outcomes = await pending!;
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
  const rejection = outcomes.find(result => result.status === "rejected") as PromiseRejectedResult;
  expect(rejection.reason).toMatchObject({ code: "READINESS_CHANGED" });
  const detail = await native.getOrderDetail(org, f.orderId, "owner");
  expect(detail.readyWaitingQuantity).toBe(2);
  expect(detail.productionCompleteQuantity).toBe(0);
  expect(detail.events).toHaveLength(1);
  expectOnlyChanged(before, await snapshot(), ["fulfillment_ready_quantities", "fulfillment_events"]);
});

test("negative physical correction and conflicting native retry keys preserve native history", async () => {
  const f = await fixture();
  await normalAdjust(f, 3);
  const preview = await previewPhysicalReadinessAdjustment(scope(f), input(f, -1));
  const key = randomUUID(), before = await snapshot();
  const result = await executePhysicalReadinessAdjustment(scope(f), preview, { clientRequestId: key });
  expect(result.status).toBe("applied");
  const detail = await native.getOrderDetail(org, f.orderId, "owner");
  expect(detail.readyWaitingQuantity).toBe(2);
  expect(detail.events).toHaveLength(2);
  expect(detail.events.find(event => event.payloadJson.clientRequestId === key)).toMatchObject({ payloadJson: {
    reason, adjustments: [{ orderLineItemId: f.lineId, quantityDelta: -1, previousReadyQuantity: 3, nextReadyQuantity: 2 }],
  } });
  expectOnlyChanged(before, await snapshot(), ["fulfillment_ready_quantities", "fulfillment_events"]);
  const after = await snapshot();
  const different = await previewPhysicalReadinessAdjustment(scope(f), input(f, 1));
  await expect(executePhysicalReadinessAdjustment(scope(f), different, { clientRequestId: key })).rejects.toMatchObject({ code: "READY_REQUEST_CONFLICT" });
  expect(await snapshot()).toEqual(after);
});

test("optional native production guard and native cancellation reject without an invented override", async () => {
  const f = await fixture();
  const guarded = await previewPhysicalReadinessAdjustment(scope(f), { ...input(f), requireProductionComplete: true });
  const before = await snapshot();
  await expect(executePhysicalReadinessAdjustment(scope(f), guarded, { clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "PRODUCTION_NOT_COMPLETE" });
  expect(await snapshot()).toEqual(before);
  const preview = await previewPhysicalReadinessAdjustment(scope(f), input(f));
  await db.update(schema.orders).set({ canceledAt: new Date().toISOString(), status: "canceled" }).where(eq(schema.orders.id, f.orderId));
  const canceled = await snapshot();
  await expect(executePhysicalReadinessAdjustment(scope(f), preview, { clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "ORDER_CANCELLED" });
  expect(await snapshot()).toEqual(canceled);
});

test("a real database event-insert failure rolls back the earlier quantity upsert", async () => {
  const f = await fixture();
  // Failure injection is confined to this private synthetic database, not an
  // adapter mock. The trigger raises AFTER the real repository quantity upsert.
  await pool.query(`CREATE FUNCTION physical_readiness_fixture_reject_event() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.payload_json->>'reason' = 'Synthetic rollback trigger failure' THEN
      RAISE EXCEPTION 'synthetic fixture event insert rejected'; END IF; RETURN NEW; END $body$`);
  await pool.query("CREATE TRIGGER physical_readiness_fixture_reject_event BEFORE INSERT ON fulfillment_events FOR EACH ROW EXECUTE FUNCTION physical_readiness_fixture_reject_event()");
  try {
    const before = await snapshot();
    await expect(native.adjustReadyQuantities(org, f.orderId, { items: [{ orderLineItemId: f.lineId, quantityDelta: 2 }],
      reason: "Synthetic rollback trigger failure", clientRequestId: randomUUID() }, actor, "owner")).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  } finally {
    await pool.query("DROP TRIGGER physical_readiness_fixture_reject_event ON fulfillment_events");
    await pool.query("DROP FUNCTION physical_readiness_fixture_reject_event()");
  }
});

test("durable protected GO executes the real adapter once and replay returns the original result", async () => {
  const f = await fixture();
  const { service, plan, issued, context, args } = await reviewedPlan(f);
  expect((await native.getOrderDetail(org, f.orderId, "owner")).readyWaitingQuantity).toBe(0);
  const before = await snapshot();
  const confirmation = { planId: plan.id, expectedVersion: issued.plan.version, token: issued.token, context };
  await expect(service.confirmAndExecute(executionScope(), { ...confirmation, token: "GO" })).rejects.toMatchObject({ code: "INVALID_CONFIRMATION" });
  await expect(service.confirmAndExecute({ ...executionScope(), organizationId: foreignOrg }, confirmation)).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
  await expect(service.confirmAndExecute({ ...executionScope(), userId: member }, confirmation)).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
  expect(await snapshot()).toEqual(before);
  const first = await service.confirmAndExecute(executionScope(), confirmation);
  expect(first.plan.status).toBe("succeeded");
  expect(first.result?.status).toBe("succeeded");
  const detail = await native.getOrderDetail(org, f.orderId, "owner");
  expect(detail.readyWaitingQuantity).toBe(2);
  expect(detail.events).toHaveLength(1);
  expect(detail.events[0].payloadJson.clientRequestId).toBe(args.clientRequestId);
  expect(first.result?.steps[0].domainAuditReference).toBe(detail.events[0].id);
  const after = await snapshot();
  expectOnlyChanged(before, after, ["fulfillment_ready_quantities", "fulfillment_events", "ai_execution_plans", "ai_confirmations",
    "ai_execution_steps", "ai_idempotency_records", "ai_audit_events"]);
  // Reconstruct the actual durable planner/repository: replay does not rely on
  // the first process instance's memory, nor mint a new native request key.
  const replay = await planner().confirmAndExecute(executionScope(), confirmation);
  expect(replay.result).toEqual(first.result);
  expect(await snapshot()).toEqual(after);
});

test.each(["readiness", "membership", "trusted_grant"] as const)("durable GO rejects %s revoked or stale after review without a physical write", async changed => {
  const f = await fixture();
  const { service, plan, issued, context } = await reviewedPlan(f);
  if (changed === "readiness") await normalAdjust(f, 1);
  if (changed === "membership") await db.delete(schema.userOrganizations)
    .where(and(eq(schema.userOrganizations.organizationId, org), eq(schema.userOrganizations.userId, actor)));
  try {
    const before = await snapshot();
    const currentScope = changed === "trusted_grant" ? { ...executionScope(), permissions: [] } : executionScope();
    await expect(service.confirmAndExecute(currentScope, { planId: plan.id, expectedVersion: issued.plan.version, token: issued.token, context }))
      .rejects.toMatchObject({ code: changed === "trusted_grant" ? "PERMISSION_CHANGED" : "PLAN_STALE" });
    expect((await service.getPlan(executionScope(), plan.id)).status).toBe("invalidated");
    expectOnlyChanged(before, await snapshot(), ["ai_execution_plans", "ai_confirmations", "ai_audit_events"]);
  } finally {
    if (changed === "membership") await db.insert(schema.userOrganizations).values({ organizationId: org, userId: actor, role: "owner" });
  }
});
