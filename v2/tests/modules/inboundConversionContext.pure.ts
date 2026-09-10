import assert from "node:assert/strict";
import { InboundIntakeApplicationService, type InboundIntakeStore } from "../../src/modules/inbound/inboundIntakeApplication.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const organizationId = brandedId<"OrganizationId">("org-a");
const intakeId = brandedId<"InboundIntakeId">("intake-a");
const customerId = brandedId<"CustomerId">("customer-a");
const productId = brandedId<"ProductId">("product-a");
const orderId = brandedId<"OrderId">("order-a");
let stored = {
  id: intakeId, organizationId, sourceProvider: "imported" as const, receivedAt: new Date().toISOString(), rawSource: {}, extractedDraft: {},
  reviewDraft: { lines: [{ productId, quantity: 1 }] }, state: "ready" as const, matchedCustomerId: customerId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const store: InboundIntakeStore = {
  list: async () => ({ records: [] }), detail: async () => ({ intake: stored, attachments: [], events: [] }), ingest: async () => stored,
  transaction: async (action) => action({
    detail: async () => ({ intake: stored, attachments: [], events: [] }), hasEvent: async () => false,
    saveReview: async () => stored, transition: async () => stored,
    reserveConversion: async () => stored,
    completeConversion: async () => ({ ...stored, state: "converted" as const, convertedOrderId: orderId, convertedAt: new Date().toISOString() }),
    recordEvent: async () => ({ id: "event-a", intakeId, type: "converted", detail: {}, actor: { principalKind: "staff", principalSubject: "staff-a" }, createdAt: new Date().toISOString() }),
  }),
};
let captured: { contextId?: string; commandId?: string } = {};
const service = new InboundIntakeApplicationService(store, { createOrder: async (context, input) => {
  captured = { contextId: context.businessRequest?.id, commandId: input.businessRequestId };
  return { ok: true, value: { order: { order: { orderId } } } } as any;
} });
const result = await service.convert({ principal: { kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "staff-a", source: "permission_set", capabilities: ["inbound.review", "order.create"] } }, organizationId, operationId: "test", businessRequest: { id: "operator-request", payloadFingerprint: "test" } }, intakeId, "operator-request");
assert.equal(result.ok, true);
assert.equal(captured.contextId, captured.commandId, "Sales receives the deterministic conversion identity in both command and context");
assert.match(captured.contextId!, /^inbound-convert:/u);
console.log("Inbound conversion context identity test passed.");
