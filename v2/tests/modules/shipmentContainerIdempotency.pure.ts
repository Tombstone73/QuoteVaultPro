import assert from "node:assert/strict";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { ShipmentContainerApplicationService, type ShipmentContainerRunner, type ShipmentContainerTransaction } from "../../src/modules/fulfillment/shipmentContainerApplication.js";
import type { FulfillmentShipmentContainer } from "../../src/modules/fulfillment/shipmentContainer.js";

const organizationId = "org-shipment";
const context = (requestId: string): OperationContext => ({ organizationId, operationId: `test:${requestId}`, businessRequest: { id: requestId, payloadFingerprint: "route-derived" }, principal: { kind: "staff", organizationId, userId: "operator", authority: { membershipId: "membership", capabilities: ["fulfillment.ship"] } } });
const requests = new Map<string, { fingerprint: string; result?: FulfillmentShipmentContainer; id: string }>();
let creates = 0;
const tx: ShipmentContainerTransaction = {
  async reserve(input) { const key = `${input.operation}:${input.businessRequestId}`, existing = requests.get(key); if (existing) { if (existing.fingerprint !== input.payloadFingerprint) throw new V2ApplicationError("IDEMPOTENCY_CONFLICT", "conflict"); return { kind: "replay", request: { id: existing.id, resultJson: existing.result ?? null } }; } const request = { fingerprint: input.payloadFingerprint, id: `request-${requests.size + 1}` }; requests.set(key, request); return { kind: "new", request: { id: request.id, resultJson: null } }; },
  async succeed(_organizationId, requestId, result) { for (const request of requests.values()) if (request.id === requestId) request.result = result; },
  async create(input) { creates += 1; return { shipmentId: input.id, organizationId: input.organizationId, status: "prepared", carrier: input.carrier, createdAt: "2026-09-09T00:00:00.000Z", createdPrincipalKind: input.principalKind, createdPrincipalSubject: input.principalSubject }; },
  async markShipped() { return null; },
  async attach() { return false; },
};
const service = new ShipmentContainerApplicationService({ transaction: async work => work(tx) } satisfies ShipmentContainerRunner);
const input = { customerId: "customer-a", carrier: { carrierName: "Manual" } };
const first = await service.create(context("same-request"), input);
const replay = await service.create(context("same-request"), input);
assert.equal(first.ok, true); assert.equal(replay.ok, true); if (first.ok && replay.ok) assert.equal(first.value.shipmentId, replay.value.shipmentId);
assert.equal(creates, 1, "exact retries must not create a second shipment container");
const conflict = await service.create(context("same-request"), { ...input, carrier: { carrierName: "Changed" } });
assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
console.log("Shipment container idempotency tests passed.");
