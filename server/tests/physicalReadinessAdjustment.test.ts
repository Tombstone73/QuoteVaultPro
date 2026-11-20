import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { resolveFulfillmentLineQuantity, summarizeFulfillmentOrderQuantities } from "@shared/fulfillmentReadiness";
import {
  executePhysicalReadinessAdjustment, previewPhysicalReadinessAdjustment,
  physicalReadinessAdjustmentInputSchema, physicalReadinessAdjustmentPreviewSchema, physicalReadinessAdjustmentResultSchema,
  type PhysicalReadinessAdjustmentDependencies, type PhysicalReadinessAdjustmentReceipt,
} from "../services/assistant/physicalReadinessAdjustment";
import type { OrderFulfillmentNativeReadDetail } from "../services/assistant/orderFulfillmentReadinessRead";

// Disposable synthetic persistence only. Native repository locks/transactions
// are NOT certified by this harness; the separate PostgreSQL suite owns that.
const scope = { organizationId: "synthetic_org", userId: "synthetic_actor", orderId: "223d4ed0-2aa4-4dc0-b4b7-0191556bb230" };
const input = { orderLineItemId: "synthetic_line", quantityDelta: 2, reason: "Inspected these two physical units at the packing bench" };
const context = { clientRequestId: "synthetic_server_persisted_key" };
const actor = { organizationId: scope.organizationId, userId: scope.userId, organizationRole: "employee" };

function fixture(ready = 1): OrderFulfillmentNativeReadDetail {
  const projection = resolveFulfillmentLineQuantity({ orderedQuantity: 12, workflowState: "in_production",
    activeOwnerStationKey: "print", activeOwnerStatus: "in_progress", shippedQuantity: 2, pickedUpQuantity: 1,
    administrativelyReconciledQuantity: 1, readyWaitingQuantity: ready });
  return {
    ...summarizeFulfillmentOrderQuantities([projection]), orderId: scope.orderId, orderNumber: "SYNTHETIC-12",
    customerName: "Synthetic customer", fulfillmentType: "SHIP", fulfillmentMethod: "ship", status: "IN_PRODUCTION",
    itemsRemaining: "8 items", readySince: null, shipTo: "Synthetic city", overdue: false, isArchived: false,
    productionJobs: [], customer: { name: "Synthetic", email: "private@example.invalid", phone: "private" },
    permissions: { canConfirmPhysicalReadiness: true, canCompleteProductionOverride: false, canRevertStatus: false,
      revertPermission: "fulfillment.revert_status" },
    lineItems: [{ id: input.orderLineItemId, productName: "Synthetic line", description: "private", productType: null,
      quantity: 12, size: null, materialName: null, optionSummary: [], finishing: { requirements: [], lamination: null },
      production: { ...projection, jobId: "synthetic_open_job", stationKey: "print", stationLabel: "Printing",
        status: projection.status, eligible: false, completedAt: null, availableForAllocationQuantity: ready },
      artwork: [], checklist: { id: "", checked: false, fulfilledQuantity: 0, checkedByUserId: null, checkedAt: null, notes: null } }],
    checklistComplete: false, checklistSummary: { total: 1, checked: 0, unchecked: 1 }, productionSummary: [],
    pickupTicket: null, operationalPickupDate: "2026-11-20", pickupHandoffs: [], shipments: [], events: [],
  };
}

function harness() {
  let ready = 1;
  let persistedActor: typeof actor | null = actor;
  let readFailure = false;
  const receipts = new Map<string, PhysicalReadinessAdjustmentReceipt>();
  const verify = jest.fn(async () => persistedActor);
  const read = jest.fn(async () => { if (readFailure) throw new Error("synthetic hydration failure"); return fixture(ready); });
  const receipt = jest.fn(async (_org: string, _order: string, key: string) => receipts.get(key) ?? null);
  const write = jest.fn<NonNullable<PhysicalReadinessAdjustmentDependencies["adjustReadyQuantities"]>>(async (org, order, payload, user, role) => {
    expect([org, order, user, role]).toEqual([scope.organizationId, scope.orderId, scope.userId, actor.organizationRole]);
    if (receipts.has(payload.clientRequestId!)) return fixture(ready);
    const item = payload.items[0];
    if (payload.expectedReadyByLine?.[item.orderLineItemId] !== ready)
      throw Object.assign(new Error("Ready changed; review again"), { code: "READINESS_CHANGED", status: 409 });
    const previous = ready;
    ready += item.quantityDelta;
    receipts.set(payload.clientRequestId!, { id: "synthetic_native_event", payload: { clientRequestId: payload.clientRequestId!,
      reason: payload.reason, operatorUserId: user!, adjustments: [{ orderLineItemId: item.orderLineItemId,
        quantityDelta: item.quantityDelta, previousReadyQuantity: previous, nextReadyQuantity: ready }] } });
    return fixture(ready);
  });
  const deps: PhysicalReadinessAdjustmentDependencies = { verifyNativeReadAuthority: verify, readDetail: read, adjustReadyQuantities: write, readReceipt: receipt };
  return { deps, verify, read, write, receipt, receipts, setReady: (value: number) => { ready = value; },
    revoke: () => { persistedActor = null; }, setRole: (role: string) => { persistedActor = { ...actor, organizationRole: role }; },
    breakRead: () => { readFailure = true; } };
}

// Exercise default lazy bindings and SQL predicates without a database/client.
let nativeDetail: OrderFulfillmentNativeReadDetail;
let nativeReceipt: PhysicalReadinessAdjustmentReceipt | null;
const predicates: Array<{ event: boolean; predicate: SQL }> = [];
const select = jest.fn((shape: Record<string, unknown>) => {
  const event = "payload" in shape;
  const chain = { from: () => chain, innerJoin: () => chain,
    where: (predicate: SQL) => { predicates.push({ event, predicate }); return chain; },
    limit: async () => event ? (nativeReceipt ? [nativeReceipt] : []) : [{ organizationRole: "employee", deleteState: "active",
      isArchived: false, accountType: "INTERNAL_USER", role: "employee" }],
  };
  return chain;
});
const nativeRead = jest.fn(async () => nativeDetail);
const nativeWrite = jest.fn<NonNullable<PhysicalReadinessAdjustmentDependencies["adjustReadyQuantities"]>>(async (_org, _order, payload, user) => {
  nativeReceipt = { id: "synthetic_native_event", payload: { clientRequestId: payload.clientRequestId!, reason: payload.reason,
    operatorUserId: user!, adjustments: [{ ...payload.items[0], previousReadyQuantity: 1, nextReadyQuantity: 3 }] } };
  nativeDetail = fixture(3);
  return nativeDetail;
});
jest.unstable_mockModule("../db", () => ({ db: { select } }));
jest.unstable_mockModule("../services/customerPortalAccessService", () => ({
  isPortalCustomerIdentity: (user: { accountType?: string; role?: string }) => user.accountType === "PORTAL_CUSTOMER" || user.role === "customer",
}));
jest.unstable_mockModule("../services/fulfillment/canonicalFulfillmentOperations", () => ({
  canonicalFulfillmentOperations: { getOrderDetail: nativeRead, adjustReadyQuantities: nativeWrite },
}));
beforeEach(() => {
  nativeDetail = fixture(); nativeReceipt = null; predicates.length = 0;
  select.mockClear(); nativeRead.mockClear(); nativeWrite.mockClear();
});

describe("native physical-readiness adjustment adapter", () => {
  test("schema import is inert and input is strict, finite, nonzero integer native delta", () => {
    expect(select).not.toHaveBeenCalled(); expect(nativeWrite).not.toHaveBeenCalled();
    for (const quantityDelta of [0, 1.2, NaN, Infinity, "2"]) expect(physicalReadinessAdjustmentInputSchema.safeParse({ ...input, quantityDelta }).success).toBe(false);
    for (const extra of [{ items: [] }, { actorUserId: "foreign" }, { organizationId: "foreign" }, { clientRequestId: "model-key" }, { confirmed: true }])
      expect(physicalReadinessAdjustmentInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    expect(physicalReadinessAdjustmentInputSchema.safeParse({ ...input, reason: "short" }).success).toBe(false);
    expect(physicalReadinessAdjustmentInputSchema.parse({ ...input, quantityDelta: -1 }).quantityDelta).toBe(-1);
  });

  test("preview reads native scope/permission, preserves open production and actual user reason, writes nothing", async () => {
    const f = harness(); const result = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    expect(result).toEqual({ scope, input, organizationRole: "employee", expectedReadyQuantity: 1, nativeStatus: "IN_PRODUCTION",
      productionCompleteQuantity: 0, limitation: expect.stringContaining("Production jobs stay open") });
    expect(f.verify).toHaveBeenCalledTimes(2); expect(f.read).toHaveBeenCalledWith(scope.organizationId, scope.orderId, "employee");
    expect(f.write).not.toHaveBeenCalled(); expect(f.receipt).not.toHaveBeenCalled();
    expect(physicalReadinessAdjustmentPreviewSchema.parse(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/private|synthetic_open_job|AI Override/);
  });

  test.each([null, { ...actor, organizationId: "foreign" }, { ...actor, userId: "foreign" }, { ...actor, organizationRole: "unknown" }])(
    "preview fails closed for missing/foreign/unknown persisted actor (%#)", async value => {
      const f = harness(); f.verify.mockResolvedValue(value);
      await expect(previewPhysicalReadinessAdjustment(scope, input, f.deps)).rejects.toMatchObject({ code: "NATIVE_AUTHORITY_UNVERIFIED" });
      expect(f.read).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
    });

  test("fresh native authority/target/line/permission failures release no preview or write", async () => {
    const f = harness(); f.verify.mockRejectedValueOnce(new Error("membership unavailable"));
    await expect(previewPhysicalReadinessAdjustment(scope, input, f.deps)).rejects.toMatchObject({ code: "NATIVE_AUTHORITY_UNVERIFIED" });
    f.read.mockResolvedValueOnce({ ...fixture(), orderId: "foreign" });
    await expect(previewPhysicalReadinessAdjustment(scope, input, f.deps)).rejects.toMatchObject({ code: "NATIVE_TARGET_MISMATCH" });
    await expect(previewPhysicalReadinessAdjustment(scope, { ...input, orderLineItemId: "foreign" }, f.deps)).rejects.toMatchObject({ code: "LINE_ITEM_NOT_FOUND" });
    f.read.mockResolvedValueOnce({ ...fixture(), permissions: { ...fixture().permissions!, canConfirmPhysicalReadiness: false } });
    await expect(previewPhysicalReadinessAdjustment(scope, input, f.deps)).rejects.toMatchObject({ code: "READY_PERMISSION_DENIED" });
    expect(f.write).not.toHaveBeenCalled();
  });

  test("rejects revocation or role changes during preview", async () => {
    const f = harness(); f.verify.mockResolvedValueOnce(actor).mockResolvedValueOnce(null);
    await expect(previewPhysicalReadinessAdjustment(scope, input, f.deps)).rejects.toMatchObject({ code: "NATIVE_AUTHORITY_UNVERIFIED" });
    f.verify.mockResolvedValueOnce(actor).mockResolvedValueOnce({ ...actor, organizationRole: "manager" });
    await expect(previewPhysicalReadinessAdjustment(scope, input, f.deps)).rejects.toMatchObject({ code: "NATIVE_AUTHORITY_CHANGED" });
  });

  test("GO calls exactly one canonical delta + locked native CAS + persisted retry key, then fresh sanitized read", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    const result = await executePhysicalReadinessAdjustment(scope, preview, context, f.deps);
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.write).toHaveBeenCalledWith(scope.organizationId, scope.orderId, {
      items: [{ orderLineItemId: input.orderLineItemId, quantityDelta: 2 }], reason: input.reason,
      clientRequestId: context.clientRequestId, expectedReadyByLine: { [input.orderLineItemId]: 1 },
    }, scope.userId, "employee");
    expect(result).toMatchObject({ status: "applied", receiptId: "synthetic_native_event", clientRequestId: context.clientRequestId,
      readiness: { status: "available", nativeStatus: "IN_PRODUCTION", quantities: { readyWaitingQuantity: 3, productionCompleteQuantity: 0,
        shippedQuantity: 2, pickedUpQuantity: 1, remainingQuantity: 8 }, lines: [{ quantities: { administrativelyReconciledQuantity: 1 } }] } });
    expect(physicalReadinessAdjustmentResultSchema.parse(result)).toEqual(result);
    expect(f.read).toHaveBeenCalledTimes(3);
  });

  test.each([true, false])("preserves explicit native requireProductionComplete=%s rather than overwriting it", async requireProductionComplete => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, { ...input, requireProductionComplete }, f.deps);
    await executePhysicalReadinessAdjustment(scope, preview, context, f.deps);
    expect(f.write.mock.calls[0][2]).toMatchObject({ requireProductionComplete, expectedReadyByLine: { [input.orderLineItemId]: 1 }, reason: input.reason });
  });

  test("negative physical correction stays one native delta, never a workflow or terminal reversal", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, { ...input, quantityDelta: -1 }, f.deps);
    expect(await executePhysicalReadinessAdjustment(scope, preview, context, f.deps)).toMatchObject({ status: "applied" });
    expect(f.write.mock.calls[0][2].items).toEqual([{ orderLineItemId: input.orderLineItemId, quantityDelta: -1 }]);
  });

  test.each(["organizationId", "userId", "orderId"] as const)("rejects reviewed %s mismatch before read/write", async field => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    const changed = { ...scope, [field]: field === "orderId" ? "023d4ed0-2aa4-4dc0-b4b7-0191556bb230" : "foreign" };
    await expect(executePhysicalReadinessAdjustment(changed, preview, context, f.deps)).rejects.toMatchObject({ code: "NATIVE_TARGET_MISMATCH" });
    expect(f.write).not.toHaveBeenCalled();
  });

  test("GO uses persisted role/membership, not approved old role or native permission hint", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    f.revoke(); await expect(executePhysicalReadinessAdjustment(scope, preview, context, f.deps)).rejects.toMatchObject({ code: "NATIVE_AUTHORITY_UNVERIFIED" });
    f.setRole("manager"); await expect(executePhysicalReadinessAdjustment(scope, preview, context, f.deps)).rejects.toMatchObject({ code: "NATIVE_AUTHORITY_CHANGED" });
    f.setRole("employee"); f.read.mockResolvedValueOnce({ ...fixture(), permissions: { ...fixture().permissions!, canConfirmPhysicalReadiness: false } });
    await expect(executePhysicalReadinessAdjustment(scope, preview, context, f.deps)).rejects.toMatchObject({ code: "READY_PERMISSION_DENIED" });
    expect(f.write).not.toHaveBeenCalled();
  });

  test("revocation immediately before native write fails closed", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    f.verify.mockResolvedValueOnce(actor).mockResolvedValueOnce(actor).mockResolvedValueOnce(actor).mockResolvedValueOnce(null);
    await expect(executePhysicalReadinessAdjustment(scope, preview, context, f.deps)).rejects.toMatchObject({ code: "NATIVE_AUTHORITY_UNVERIFIED" });
    expect(f.write).not.toHaveBeenCalled();
  });

  test("stale ready rejection from the injected native CAS boundary is preserved", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps); f.setReady(4);
    await expect(executePhysicalReadinessAdjustment(scope, preview, context, f.deps)).rejects.toMatchObject({ code: "READINESS_CHANGED" });
    expect(f.receipts.size).toBe(0); expect(f.write.mock.calls[0][2].expectedReadyByLine).toEqual({ [input.orderLineItemId]: 1 });
  });

  test("same stored key replays exact durable native event without another write, rereads latest state", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    await executePhysicalReadinessAdjustment(scope, preview, context, f.deps); f.setReady(5);
    const replay = await executePhysicalReadinessAdjustment(scope, preview, context, f.deps);
    expect(replay).toMatchObject({ status: "applied", readiness: { quantities: { readyWaitingQuantity: 5 } } });
    expect(f.write).toHaveBeenCalledTimes(1); expect(f.receipts.size).toBe(1);
    f.breakRead(); expect(await executePhysicalReadinessAdjustment(scope, preview, context, f.deps))
      .toEqual({ status: "applied_read_unavailable", clientRequestId: context.clientRequestId, receiptId: "synthetic_native_event" });
  });

  test("same key with another actor/reason/delta/expected quantity cannot silently replay another event", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    await executePhysicalReadinessAdjustment(scope, preview, context, f.deps);
    for (const changed of [{ ...preview, input: { ...input, reason: "Another inspected physical quantity reason" } },
      { ...preview, input: { ...input, quantityDelta: 1 } }, { ...preview, expectedReadyQuantity: 2 }])
      await expect(executePhysicalReadinessAdjustment(scope, changed, context, f.deps)).rejects.toMatchObject({ code: "READY_REQUEST_CONFLICT" });
    f.receipts.get(context.clientRequestId)!.payload.operatorUserId = "foreign";
    await expect(executePhysicalReadinessAdjustment(scope, preview, context, f.deps)).rejects.toMatchObject({ code: "READY_REQUEST_CONFLICT" });
    expect(f.write).toHaveBeenCalledTimes(1);
  });

  test("two competing stored keys retain native CAS; no stale overwrite", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    const results = await Promise.allSettled([executePhysicalReadinessAdjustment(scope, preview, context, f.deps),
      executePhysicalReadinessAdjustment(scope, preview, { clientRequestId: "other_server_key" }, f.deps)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1); expect(f.receipts.size).toBe(1);
  });

  test("native commit then hydration failure is applied_read_unavailable with durable event, not failed", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    const canonical = f.deps.adjustReadyQuantities!;
    f.deps.adjustReadyQuantities = async (...args) => { await canonical(...args); throw new Error("native postcommit hydration failed"); };
    expect(await executePhysicalReadinessAdjustment(scope, preview, context, f.deps))
      .toEqual({ status: "applied_read_unavailable", clientRequestId: context.clientRequestId, receiptId: "synthetic_native_event" });
    expect(f.receipts.size).toBe(1);
  });

  test("successful native write followed by refresh failure or revoked read authority remains applied", async () => {
    for (const revoke of [false, true]) {
      const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
      const canonical = f.deps.adjustReadyQuantities!;
      f.deps.adjustReadyQuantities = async (...args) => { const result = await canonical(...args); if (revoke) f.revoke(); else f.breakRead(); return result; };
      expect(await executePhysicalReadinessAdjustment(scope, preview, context, f.deps))
        .toEqual({ status: "applied_read_unavailable", clientRequestId: context.clientRequestId, receiptId: "synthetic_native_event" });
    }
  });

  test("ambiguous native transport failure reports outcome_unknown; no invented failure or receipt", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    f.write.mockRejectedValueOnce(new Error("connection disappeared"));
    expect(await executePhysicalReadinessAdjustment(scope, preview, context, f.deps))
      .toEqual({ status: "outcome_unknown", clientRequestId: context.clientRequestId, receiptId: null });
  });

  test("native rejection is preserved only after durable receipt absence is established", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    f.write.mockRejectedValueOnce(Object.assign(new Error("Reserved in draft shipment"), { status: 409, code: "QTY_RESERVED" }));
    await expect(executePhysicalReadinessAdjustment(scope, preview, context, f.deps)).rejects.toMatchObject({ code: "QTY_RESERVED" });
    f.receipt.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("receipt unavailable"));
    f.write.mockRejectedValueOnce(Object.assign(new Error("no certainty"), { status: 409, code: "QTY_RESERVED" }));
    expect(await executePhysicalReadinessAdjustment(scope, preview, context, f.deps)).toMatchObject({ status: "outcome_unknown" });
  });

  test("receipt precheck failure cannot trigger a write", async () => {
    const f = harness(); const preview = await previewPhysicalReadinessAdjustment(scope, input, f.deps);
    f.receipt.mockRejectedValueOnce(new Error("receipt read unavailable"));
    await expect(executePhysicalReadinessAdjustment(scope, preview, context, f.deps)).rejects.toThrow("receipt read unavailable");
    expect(f.write).not.toHaveBeenCalled();
  });

  test("default bindings use existing canonical export, persisted actor and org/order-scoped native retry ledger", async () => {
    const preview = await previewPhysicalReadinessAdjustment(scope, input);
    const result = await executePhysicalReadinessAdjustment(scope, preview, context);
    expect(result).toMatchObject({ status: "applied", receiptId: "synthetic_native_event" });
    expect(nativeWrite).toHaveBeenCalledTimes(1);
    const events = predicates.filter(row => row.event);
    expect(events.length).toBe(2);
    for (const { predicate } of events) {
      const query = new PgDialect().sqlToQuery(predicate);
      expect(query.sql).toContain('"fulfillment_events"."organization_id"');
      expect(query.sql).toContain('"fulfillment_events"."entity_id"');
      expect(query.sql).toContain("clientRequestId");
      expect(query.params).toEqual([scope.organizationId, scope.orderId, "FULFILLMENT_READY", context.clientRequestId]);
    }
    for (const { predicate } of predicates.filter(row => !row.event))
      expect(new PgDialect().sqlToQuery(predicate).params).toEqual([scope.organizationId, scope.userId]);
  });
});
