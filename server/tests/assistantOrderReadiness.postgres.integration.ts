import { afterAll, beforeAll, expect, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { buildOrderReadinessLights } from "@shared/orderReadinessLights";
import * as schema from "@shared/schema";
import { db, pool } from "../db";
import { OrdersRepository } from "../storage/orders.repo";
import { createCurrentOrderReadinessTool, currentReadinessResult } from "../services/assistant/currentOrderReadinessTool";
import { AssistantOrchestrationService } from "../services/assistant/orchestration";
import { canonicalFulfillmentOperations } from "../services/fulfillment/canonicalFulfillmentOperations";
import type { AssistantTrustedToolContext } from "../services/assistant/toolRegistry";

// Run only with jest.local-postgres.config.js and a fresh, disposable loopback
// TEST_DATABASE_URL. The harness maps Neon transport to real pg; there are NO
// repository, default adapter, canonical fulfillment, or persistence mocks.
// Fixtures below are direct synthetic inserts/updates, NOT production workflow
// commands. Current-schema bootstrap does not prove migration/trigger parity.
const org = randomUUID(), otherOrg = randomUUID(), actor = randomUUID(), memberActor = randomUUID();
const buyer = randomUUID(), product = randomUUID(), feeProduct = randomUUID();
const orderId = randomUUID(), foreignOrderId = randomUUID(), emptyOrderId = randomUUID();
const quoteId = randomUUID(), invoiceId = randomUUID();
const needsDesignLine = randomUUID(), productionLine = randomUUID(), feeLine = randomUUID(), canceledLine = randomUUID();
const reader = new OrdersRepository(db);
const toolName = "orders.current_readiness";
const service = () => new AssistantOrchestrationService({ [toolName]: createCurrentOrderReadinessTool() });

function trusted(id = orderId, organizationId = org, userId = actor): AssistantTrustedToolContext {
  return {
    scope: { organizationId, userId }, actor: { userId, email: null },
    permissions: ["assistant.internal_staff"], correlationId: randomUUID(), signal: new AbortController().signal,
    context: assistantContextEnvelopeSchema.parse({
      contextVersion: "v1", route: `/orders/${id}`, pageTitle: "Order",
      entityType: "order", entityId: id, unsavedChanges: false, capturedAt: new Date().toISOString(),
    }),
  };
}

async function operational(input: Record<string, unknown> = {}, context = trusted()) {
  const execution = await service().executeTool(toolName, input, context);
  expect(execution.status).toBe("succeeded");
  const data = currentReadinessResult.parse(execution.result?.data);
  if (data.view !== "operational") throw new Error("Expected native Operational Summary projection");
  return { execution, data };
}

// All public base tables, not just the Order row: detect changed values as well
// as inserted/deleted Jobs, TEMP records, shipments, audits, and assistant state.
// No concurrent fixture writes take place while these snapshots are compared.
async function databaseSnapshot() {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: tables } = await connection.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    const snapshot: Record<string, { count: string; fingerprint: string }> = {};
    for (const { table_name } of tables) {
      const name = `"${table_name.replace(/"/g, '""')}"`;
      const { rows } = await connection.query<{ count: string; fingerprint: string }>(
        `SELECT count(*)::text AS count, md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), '')) AS fingerprint FROM public.${name} t`,
      );
      snapshot[table_name] = rows[0]!;
    }
    await connection.query("COMMIT");
    return snapshot;
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}

beforeAll(async () => {
  await db.transaction(async tx => {
    await tx.insert(schema.organizations).values([
      { id: org, name: "Synthetic readiness tenant", slug: org },
      { id: otherOrg, name: "Synthetic unrelated tenant", slug: otherOrg },
    ]);
    await tx.insert(schema.users).values([
      { id: actor, email: `${actor}@example.invalid`, role: "employee", accountType: "INTERNAL_USER" },
      { id: memberActor, email: `${memberActor}@example.invalid`, role: "employee", accountType: "INTERNAL_USER" },
    ]);
    await tx.insert(schema.userOrganizations).values([
      { organizationId: org, userId: actor, role: "owner" },
      { organizationId: otherOrg, userId: actor, role: "member" },
      { organizationId: org, userId: memberActor, role: "member" },
    ]);
    await tx.insert(schema.customers).values({ id: buyer, organizationId: org, companyName: "Synthetic readiness buyer" });
    await tx.insert(schema.products).values([
      { id: product, organizationId: org, name: "Synthetic historical print", description: "Synthetic only", requiresProductionJob: true },
      { id: feeProduct, organizationId: org, name: "Synthetic service fee", description: "Synthetic only", requiresProductionJob: true, workflowIntent: "service_fee" },
    ]);
    await tx.insert(schema.quotes).values({ id: quoteId, organizationId: org, userId: actor, customerId: buyer, quoteNumber: 920001, totalPrice: "125.00" });
    await tx.insert(schema.orders).values([
      { id: orderId, organizationId: org, customerId: buyer, createdByUserId: actor, quoteId,
        orderNumber: "920001", displayNumber: "O-920001", state: "open", status: "new",
        statusPillValue: "Synthetic awaiting artwork", shippingMethod: "pickup", total: "125.00" },
      { id: foreignOrderId, organizationId: otherOrg, createdByUserId: actor, orderNumber: "920002", state: "open" },
      { id: emptyOrderId, organizationId: org, createdByUserId: actor, orderNumber: "920003", displayNumber: null, state: "open" },
    ]);
    await tx.insert(schema.invoices).values({ id: invoiceId, organizationId: org, orderId, customerId: buyer,
      createdByUserId: actor, invoiceNumber: 920001, sourceOrderNumber: 920001, subtotal: "125.00", total: "125.00", totalCents: 12500 });
    await tx.insert(schema.orderLineItems).values([
      { id: needsDesignLine, orderId, productId: product, description: "Historical material/options/price fixture",
        quantity: 2, width: "24.00", height: "18.00", unitPrice: "25.00", totalPrice: "50.00", status: "new", workflowState: "needs_design",
        requiresDesign: true, requiresProofApproval: true,
        materialUsageJson: [{ materialId: "synthetic-historical-media", materialName: "Sold media", quantityUsed: 6, unitOfMeasure: "sqft" }],
        optionSelectionsJson: { schemaVersion: 2, selected: { sides: { value: "double" } } },
        pbv2SnapshotJson: { synthetic: true, pricing: { totalCents: 5000 }, units: { width: "in", height: "in" } }, sortOrder: 0 },
      { id: productionLine, orderId, productId: product, description: "In production fixture", quantity: 3, unitPrice: "20.00", totalPrice: "60.00", status: "in_production", workflowState: "in_production", sortOrder: 1 },
      { id: feeLine, orderId, productId: feeProduct, description: "Fee fixture", quantity: 1, unitPrice: "15.00", totalPrice: "15.00", status: "new", workflowState: "new", sortOrder: 2 },
      { id: canceledLine, orderId, productId: product, description: "Canceled historical fixture", quantity: 7, unitPrice: "10.00", totalPrice: "70.00", status: "canceled", workflowState: "in_production", sortOrder: 3 },
    ]);
  });
});

afterAll(async () => { await pool.end(); });

test("real PH repository supplies native indicators without constructing AI or repricing historical snapshots", async () => {
  const before = await databaseSnapshot();
  const native = await reader.getOrderById(org, orderId);
  expect(native).toBeDefined();
  expect(buildOrderReadinessLights(native!)).toMatchObject({
    totalItems: 3, productionRequiredCount: 2, actionNeededCount: 2, inProgressCount: 1,
    proof: { status: "proof_needed", lineItemId: needsDesignLine, openProofingAvailable: true },
  });
  expect(native?.quoteId).toBe(quoteId);
  expect(native?.lineItems.find(line => line.id === needsDesignLine)).toMatchObject({
    quantity: 2, optionSelectionsJson: { selected: { sides: { value: "double" } } },
    materialUsageJson: [{ unitOfMeasure: "sqft", quantityUsed: 6 }], pbv2SnapshotJson: { pricing: { totalCents: 5000 } },
  });
  expect(Number(native?.lineItems.find(line => line.id === needsDesignLine)?.totalPrice)).toBe(50);
  expect(await databaseSnapshot()).toEqual(before);
});

test("default adapter and registry exactly project fresh native shared summary, action lines and proof navigation without writes", async () => {
  const before = await databaseSnapshot();
  const native = await reader.getOrderById(org, orderId);
  const implicit = await operational();
  const explicit = await operational({ view: "operational" });
  expect(implicit.data).toEqual(explicit.data);
  expect(implicit.data.summary).toEqual(buildOrderReadinessLights(native!));
  expect(implicit.data.orderNumber).toBe(native!.displayNumber);
  expect(implicit.data.actionLines).toEqual([
    { lineItemId: needsDesignLine, state: "needs_design", inspect: "Review the design queue", href: "/production/design", correctionEligibility: "not_supplied" },
    { lineItemId: feeLine, state: "new", inspect: "Inspect Line Items; the summary gives no specific cause", href: `/orders/${orderId}`, correctionEligibility: "not_supplied" },
  ]);
  expect(implicit.data.omittedActionLines).toBe(0);
  const proofNavigation = `/production/proofing?${new URLSearchParams({ lineItemId: needsDesignLine, slice: "all" })}`;
  expect(implicit.data.proofNavigation).toBe(proofNavigation);
  expect(implicit.execution.result?.provenance?.sourceLinks).toEqual(expect.arrayContaining([
    expect.objectContaining({ href: `/orders/${orderId}`, entityId: orderId }), expect.objectContaining({ href: proofNavigation }),
  ]));
  expect(await databaseSnapshot()).toEqual(before);
});

test("committed native line/status changes are reflected on the next default-adapter read", async () => {
  const old = (await operational()).data.summary;
  // Fixture edits only: not a substitute for native workflow mutation tests.
  await db.transaction(async tx => {
    await tx.update(schema.orderLineItems).set({ status: "in_production", workflowState: "in_prepress" }).where(eq(schema.orderLineItems.id, needsDesignLine));
    await tx.update(schema.orderLineItems).set({ status: "complete", workflowState: "completed" }).where(eq(schema.orderLineItems.id, productionLine));
    await tx.update(schema.orderLineItems).set({ status: "canceled", workflowState: "canceled" }).where(eq(schema.orderLineItems.id, feeLine));
    await tx.update(schema.orders).set({ status: "scheduled", statusPillValue: "Synthetic committed status" }).where(eq(schema.orders.id, orderId));
  });
  const beforeRead = await databaseSnapshot();
  const native = await reader.getOrderById(org, orderId);
  const { data } = await operational();
  expect(native?.statusPillValue).toBe("Synthetic committed status");
  expect(data.summary).toEqual(buildOrderReadinessLights(native!));
  expect(data.summary).toMatchObject({ totalItems: 2, productionRequiredCount: 2, actionNeededCount: 0, inProgressCount: 1 });
  expect(data.summary).not.toEqual(old);
  expect(data.actionLines).toEqual([]);
  expect(await databaseSnapshot()).toEqual(beforeRead);
});

test("an uncommitted fixture is invisible to reads; committed changes are fresh with the same adapter instance", async () => {
  const instance = service();
  const lastCommitted = buildOrderReadinessLights((await reader.getOrderById(org, orderId))!);
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("UPDATE order_line_items SET status='new', workflow_state='on_hold' WHERE id=$1", [needsDesignLine]);
    const during = await instance.executeTool(toolName, {}, trusted());
    expect(during.status).toBe("succeeded");
    const duringData = currentReadinessResult.parse(during.result?.data);
    expect(duringData.view).toBe("operational");
    if (duringData.view === "operational") expect(duringData.summary).toEqual(lastCommitted);
    await connection.query("COMMIT");
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
  const beforeRead = await databaseSnapshot();
  const after = await instance.executeTool(toolName, {}, trusted());
  expect(after.status).toBe("succeeded");
  const data = currentReadinessResult.parse(after.result?.data);
  expect(data.view).toBe("operational");
  if (data.view === "operational") {
    expect(data.summary).toEqual(buildOrderReadinessLights((await reader.getOrderById(org, orderId))!));
    expect(data.summary.actionNeededCount).toBe(1);
  }
  expect(await databaseSnapshot()).toEqual(beforeRead);
});

test("committed proof requirement changes use canonical proof derivation, not a cached assistant verdict", async () => {
  await db.update(schema.orderLineItems).set({ requiresProofApproval: false }).where(eq(schema.orderLineItems.id, needsDesignLine));
  const before = await databaseSnapshot();
  const { data } = await operational();
  expect(data.summary).toEqual(buildOrderReadinessLights((await reader.getOrderById(org, orderId))!));
  expect(data.summary.proof).toEqual({ status: "no_proof_required", label: "No Proof Needed", lineItemId: null, openProofingAvailable: false });
  expect(data.proofNavigation).toBeNull();
  expect(await databaseSnapshot()).toEqual(before);
});

test("missing and cross-tenant current orders return not_found without identifiers, summary or navigation", async () => {
  const before = await databaseSnapshot();
  for (const context of [trusted(orderId, otherOrg), trusted(foreignOrderId), trusted(randomUUID())]) {
    expect(await reader.getOrderById(context.scope.organizationId, context.context.entityId!)).toBeUndefined();
    for (const input of [{}, { view: "fulfillment" }]) {
      const result = await service().executeTool(toolName, input, context);
      expect(result.status).toBe("not_found");
      expect(result.result?.data).toBeNull();
      expect(result.result?.provenance).toBeUndefined();
    }
  }
  const noOrder = trusted();
  noOrder.context = assistantContextEnvelopeSchema.parse({ ...noOrder.context, entityType: "quote", entityId: quoteId });
  expect((await service().executeTool(toolName, {}, noOrder)).status).toBe("not_found");
  expect(await databaseSnapshot()).toEqual(before);
});

test("denied trusted grants and model-supplied role/tenant claims cannot reveal the current order", async () => {
  const before = await databaseSnapshot();
  for (const input of [{}, { view: "fulfillment" }, { organizationId: org, userId: actor, role: "owner", permissions: ["assistant.internal_staff"] }]) {
    const result = await service().executeTool(toolName, input, { ...trusted(), permissions: [] });
    expect(result.status).toBe("permission_denied");
    expect(result.result).toBeUndefined();
  }
  const { data } = await operational({ organizationId: otherOrg, userId: randomUUID(), role: "owner" });
  expect(data.summary).toEqual(buildOrderReadinessLights((await reader.getOrderById(org, orderId))!));
  for (const input of [{ orderId: foreignOrderId }, { view: "shipping" }, { sql: "select 1" }, { view: "operational", force: true }]) {
    const result = await service().executeTool(toolName, input, trusted());
    expect(result.status).toBe("rejected");
    expect(result.result).toBeUndefined();
  }
  expect(await databaseSnapshot()).toEqual(before);
});

test("empty native Order summary and fallback number remain exact without inventing an overall ready verdict", async () => {
  const before = await databaseSnapshot();
  const { data } = await operational({}, trusted(emptyOrderId));
  expect(data.orderNumber).toBe("920003");
  expect(data.summary).toEqual(buildOrderReadinessLights((await reader.getOrderById(org, emptyOrderId))!));
  expect(data.summary).not.toHaveProperty("readyToShip");
  expect(data.summary).not.toHaveProperty("canOverride");
  expect(await databaseSnapshot()).toEqual(before);
});

test("fulfillment view uses real canonical native quantities/status and persisted membership without mutations", async () => {
  const before = await databaseSnapshot();
  const native = await canonicalFulfillmentOperations.getOrderDetail(org, orderId, "owner");
  const execution = await service().executeTool(toolName, { view: "fulfillment" }, trusted());
  expect(execution.status).toBe("succeeded");
  const data = currentReadinessResult.parse(execution.result?.data);
  expect(data.view).toBe("fulfillment");
  if (data.view !== "fulfillment") throw new Error("Expected native fulfillment view");
  expect(data.fulfillment.status).toBe("available");
  if (data.fulfillment.status !== "available") throw new Error("Native fulfillment evidence was unexpectedly omitted");
  expect(data.fulfillment.orderId).toBe(native.orderId);
  expect(data.fulfillment.nativeStatus).toBe(native.status);
  expect(data.fulfillment.quantities).toEqual({
    orderedQuantity: native.orderedQuantity, productionCompleteQuantity: native.productionCompleteQuantity,
    fulfilledQuantity: native.fulfilledQuantity, shippedQuantity: native.shippedQuantity, pickedUpQuantity: native.pickedUpQuantity,
    readyWaitingQuantity: native.readyWaitingQuantity, notReadyQuantity: native.notReadyQuantity, remainingQuantity: native.remainingQuantity,
  });
  expect(data.fulfillment.lines.map(line => ({ id: line.id, nativeStatus: line.nativeStatus, nativeLabel: line.nativeLabel })))
    .toEqual(native.lineItems.map(line => ({ id: line.id, nativeStatus: line.production.status, nativeLabel: line.production.label })));
  expect(data.fulfillment.navigation).toEqual({ order: `/orders/${orderId}`, fulfillment: `/fulfillment/orders/${orderId}` });
  expect(data.fulfillment).not.toHaveProperty("eligibleToShip");
  expect(await databaseSnapshot()).toEqual(before);
});

test("revoked native membership omits fulfillment facts even when a stale trusted assistant grant remains", async () => {
  await db.delete(schema.userOrganizations).where(and(eq(schema.userOrganizations.organizationId, org), eq(schema.userOrganizations.userId, actor)));
  try {
    const before = await databaseSnapshot();
    const execution = await service().executeTool(toolName, { view: "fulfillment" }, trusted());
    expect(execution.status).toBe("permission_denied");
    expect(execution.result?.data).toBeNull();
    expect(execution.result?.provenance).toBeUndefined();
    expect(await databaseSnapshot()).toEqual(before);
  } finally {
    await db.insert(schema.userOrganizations).values({ organizationId: org, userId: actor, role: "owner" });
  }
});

test("real member membership preserves native fulfillment evidence and native operation permissions without owner elevation", async () => {
  const before = await databaseSnapshot();
  const native = await canonicalFulfillmentOperations.getOrderDetail(org, orderId, "member");
  const execution = await service().executeTool(toolName, { view: "fulfillment" }, trusted(orderId, org, memberActor));
  expect(execution.status).toBe("succeeded");
  const data = currentReadinessResult.parse(execution.result?.data);
  if (data.view !== "fulfillment" || data.fulfillment.status !== "available") throw new Error("Expected native member fulfillment evidence");
  expect(data.fulfillment.nativeStatus).toBe(native.status);
  expect(data.fulfillment.quantities.remainingQuantity).toBe(native.remainingQuantity);
  expect(data.fulfillment.checklist).toEqual({ complete: native.checklistComplete, ...native.checklistSummary });
  for (const [key, value] of Object.entries(data.fulfillment.operationAuthority)) {
    expect(value).toEqual(Object.entries(native.permissions ?? {}).find(([name]) => name === key)?.[1]);
  }
  expect(data.fulfillment.operationAuthority.canCompleteProductionOverride).toBe(false);
  expect(await databaseSnapshot()).toEqual(before);
});
