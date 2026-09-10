import assert from "node:assert/strict";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { ShipmentContainerApplicationService, type ShipmentContainerRunner, type ShipmentContainerTransaction } from "../../src/modules/fulfillment/shipmentContainerApplication.js";
import type { FulfillmentShipmentContainer, FulfillmentShipmentContainerDetail } from "../../src/modules/fulfillment/shipmentContainer.js";

const organizationId = "org-shipment";
const context = (requestId: string): OperationContext => ({ organizationId, operationId: `test:${requestId}`, businessRequest: { id: requestId, payloadFingerprint: "route-derived" }, principal: { kind: "staff", organizationId, userId: "operator", authority: { membershipId: "membership", capabilities: ["fulfillment.ship"] } } });
const requests = new Map<string, { fingerprint: string; result?: FulfillmentShipmentContainer; id: string }>();
let creates = 0;
let finalizationFails = false;
let finalizations = 0;
const tx: ShipmentContainerTransaction = {
  async reserve(input) { const key = `${input.operation}:${input.businessRequestId}`, existing = requests.get(key); if (existing) { if (existing.fingerprint !== input.payloadFingerprint) throw new V2ApplicationError("IDEMPOTENCY_CONFLICT", "conflict"); return { kind: "replay", request: { id: existing.id, resultJson: existing.result ?? null } }; } const request = { fingerprint: input.payloadFingerprint, id: `request-${requests.size + 1}` }; requests.set(key, request); return { kind: "new", request: { id: request.id, resultJson: null } }; },
  async succeed(_organizationId, requestId, result) { for (const request of requests.values()) if (request.id === requestId) request.result = result; },
  async create(input) { creates += 1; return { shipmentId: input.id, organizationId: input.organizationId, status: "prepared", carrier: input.carrier, createdAt: "2026-09-09T00:00:00.000Z", createdPrincipalKind: input.principalKind, createdPrincipalSubject: input.principalSubject }; },
  async markShipped() { return null; },
  async attach() { return false; },
  async finalizePrepared(input) {
    if (finalizationFails) return null;
    finalizations += 1;
    return {
      shipmentId: input.shipmentId,
      organizationId: input.organizationId,
      status: "shipped",
      preparedRevisionId: input.expectedPreparedRevisionId,
      carrier: { status: "shipped" },
      createdAt: "2026-09-09T00:00:00.000Z",
      createdPrincipalKind: input.principalKind,
      createdPrincipalSubject: input.principalSubject,
      shippedAt: "2026-09-09T01:00:00.000Z",
      shippedPrincipalKind: input.principalKind,
      shippedPrincipalSubject: input.principalSubject,
      currentPreparedRevision: {
        revisionId: input.expectedPreparedRevisionId,
        shipmentId: input.shipmentId,
        organizationId: input.organizationId,
        revisionNumber: 2,
        kind: "correction",
        carrier: { status: "prepared" },
        allocations: [
          { orderId: "order-a", orderLineId: "line-a", quantity: 2 },
          { orderId: "order-a", orderLineId: "line-b", quantity: 1 },
          { orderId: "order-b", orderLineId: "line-c", quantity: 3 },
        ],
        createdAt: "2026-09-09T00:00:00.000Z",
        createdPrincipalKind: input.principalKind,
        createdPrincipalSubject: input.principalSubject,
      },
      events: [],
    } satisfies FulfillmentShipmentContainerDetail;
  },
};
const service = new ShipmentContainerApplicationService({ transaction: async work => work(tx) } satisfies ShipmentContainerRunner);
const input = { customerId: "customer-a", carrier: { carrierName: "Manual" } };
const first = await service.create(context("same-request"), input);
const replay = await service.create(context("same-request"), input);
assert.equal(first.ok, true); assert.equal(replay.ok, true); if (first.ok && replay.ok) assert.equal(first.value.shipmentId, replay.value.shipmentId);
assert.equal(creates, 1, "exact retries must not create a second shipment container");
const conflict = await service.create(context("same-request"), { ...input, carrier: { carrierName: "Changed" } });
assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");

const reconciled: string[] = [];
const finalizationService = new ShipmentContainerApplicationService(
  { transaction: async work => work(tx) } satisfies ShipmentContainerRunner,
  undefined,
  { reconcileOrder: async (_organizationId, orderId) => { reconciled.push(orderId); }, reconcileInvoice: async () => undefined },
);
finalizationFails = true;
const failedFinalization = await finalizationService.finalize(context("finalize-failure"), { shipmentId: "shipment-final", expectedPreparedRevisionId: "revision-2" });
assert.equal(failedFinalization.ok, false, "failed finalization returns no completed shipment");
assert.deepEqual(reconciled, [], "failed finalization never invokes order lifecycle reconciliation");
finalizationFails = false;
const finalized = await finalizationService.finalize(context("finalize-success"), { shipmentId: "shipment-final", expectedPreparedRevisionId: "revision-2" });
assert.equal(finalized.ok, true, "atomic finalization succeeds before lifecycle reconciliation");
assert.equal(finalizations, 1, "one finalization materializes one immutable shipment result");
assert.deepEqual(reconciled.sort(), ["order-a", "order-b"], "only unique affected Orders reconcile after a committed finalization");
const replayedFinalization = await finalizationService.finalize(context("finalize-success"), { shipmentId: "shipment-final", expectedPreparedRevisionId: "revision-2" });
assert.equal(replayedFinalization.ok, true, "exact finalization retry replays canonical result");
assert.equal(finalizations, 1, "replay never materializes duplicate fulfillment facts");
assert.deepEqual(reconciled.sort(), ["order-a", "order-b"], "replay never invokes lifecycle reconciliation again");
console.log("Shipment container idempotency tests passed.");
