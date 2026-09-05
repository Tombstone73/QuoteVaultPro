import assert from "node:assert/strict";
import { OrderWorkflowApplicationService, type WorkflowTransitionTransaction } from "../../src/modules/sales/workflowApplication.js";
import { decideWorkflowBypass, effectiveProductionRequirement, organizationWorkflowPolicyFromSettings } from "../../src/modules/sales/workflowPolicy.js";
import { orderCompletionEligibility } from "../../src/modules/sales/orderLifecycle.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { OperationContext } from "../../src/application/operation.js";

assert.equal(organizationWorkflowPolicyFromSettings({}), "strict", "missing tenant policy fails closed to STRICT");
assert.equal(organizationWorkflowPolicyFromSettings({ preferences: { workflow: { policy: "flexible" } } }), "flexible");
assert.equal(organizationWorkflowPolicyFromSettings({ preferences: { workflow: { policy: "unexpected" } } }), "strict");
assert.deepEqual(decideWorkflowBypass({ policy: "flexible", hasWorkflowOverride: true, action: "direct_production" }), { allowed: true, confirmationRequired: false });
assert.deepEqual(decideWorkflowBypass({ policy: "guided", hasWorkflowOverride: true, action: "direct_production" }), { allowed: true, confirmationRequired: true });
assert.equal(decideWorkflowBypass({ policy: "strict", hasWorkflowOverride: false, action: "production_not_required" }).allowed, false, "the policy never grants a bypass by itself");
assert.equal(effectiveProductionRequirement({ frozenRequiresProduction: true, override: "not_required" }), "not_required");
assert.equal(orderCompletionEligibility([{ orderLineId: "line", description: "Fulfillment only by exception", workflowIntent: "fulfillment_only", requiresProduction: true, productionRequirement: "not_required", orderedQuantity: 1, productionComplete: false, fulfilledQuantity: 1, routeComplete: true }]).eligible, true, "a Not Required fact is not fake Production completion");

const org = brandedId<"OrganizationId">("org-a"), order = brandedId<"OrderId">("order-a"), line = brandedId<"OrderLineId">("line-a");
const context = (id: string, capabilities: readonly string[] = ["workflow.override"]): OperationContext => ({ organizationId: org, operationId: "test", businessRequest: { id, payloadFingerprint: "derived" }, principal: { kind: "staff", organizationId: org, userId: "staff-a", authority: { membershipId: "membership-a", capabilities: capabilities as any } } });
class Harness implements WorkflowTransitionTransaction {
  policyValue: "flexible" | "guided" | "strict" = "guided";
  result: unknown = null;
  direct = 0; noProduction = 0; auditEvents: string[] = [];
  async reserve(input: any) { return this.result ? { kind: "replay" as const, request: { id: input.businessRequestId, resultJson: this.result } } : { kind: "new" as const, request: { id: input.businessRequestId, resultJson: null } }; }
  async succeed(_org: string, _request: string, result: any) { this.result = result; }
  async attribute() {}
  async policy() { return this.policyValue; }
  async eligibleActions() { return []; }
  async directProduction(input: any) { if (input.destination !== "flatbed" && input.destination !== "roll") throw new Error("missing destination"); this.direct++; }
  async productionNotRequired() { this.noProduction++; }
  async audit(input: any) { this.auditEvents.push(input.eventType); }
}
const harness = new Harness();
const service = new OrderWorkflowApplicationService({ transaction: async (work) => work(harness) });
const unconfirmed = await service.directProduction(context("direct-a"), { businessRequestId: "direct-a", orderId: order, orderLineId: line, destination: "flatbed" });
assert.equal(!unconfirmed.ok && unconfirmed.error.code, "CONFLICT", "GUIDED requires explicit bypass confirmation");
const direct = await service.directProduction(context("direct-b"), { businessRequestId: "direct-b", orderId: order, orderLineId: line, destination: "flatbed", confirmed: true });
assert.equal(direct.ok && direct.value.destination, "flatbed");
assert.equal(harness.direct, 1, "one direct transition is performed");
const replay = await service.directProduction(context("direct-b"), { businessRequestId: "direct-b", orderId: order, orderLineId: line, destination: "flatbed", confirmed: true });
assert.equal(replay.ok, true); assert.equal(harness.direct, 1, "durable replay does not repeat direct routing");
const denied = await service.productionNotRequired(context("no-production", []), { businessRequestId: "no-production", orderId: order, orderLineId: line, reason: "Service line", confirmed: true });
assert.equal(!denied.ok && denied.error.code, "FORBIDDEN", "missing override capability is rejected before persistence");
console.log("Order workflow exception policy tests passed.");
