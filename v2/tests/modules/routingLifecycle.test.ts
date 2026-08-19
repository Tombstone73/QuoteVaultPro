import assert from "node:assert/strict";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import { RoutingLifecycleApplicationService, type RoutingLifecycleTransaction, type RoutingLifecycleTransactionRunner } from "../../src/modules/routing/routingLifecycle.js";
import type { RouteInstance } from "../../src/modules/routing/contracts.js";
import type { OperationContext } from "../../src/application/operation.js";

const org = brandedId<"OrganizationId">("routing-lifecycle-org");
const routeId = brandedId<"RouteInstanceId">("routing-lifecycle-route");
const base = (): RouteInstance => ({
  routeInstanceId: routeId, organizationId: org,
  work: { kind: "sales_order_line", organizationId: org, orderId: brandedId<"OrderId">("order"), orderLineId: brandedId<"OrderLineId">("line") },
  sourceTemplate: { routeTemplateId: brandedId<"RouteTemplateId">("template"), revision: "1", definitionFingerprint: "sha256:test" },
  state: "pending", currentStepId: brandedId<"RouteInstanceStepId">("proof"), revision: "1",
  steps: [
    { routeInstanceStepId: brandedId<"RouteInstanceStepId">("proof"), position: 0, kind: "proofing" },
    { routeInstanceStepId: brandedId<"RouteInstanceStepId">("prepress"), position: 1, kind: "prepress" },
    { routeInstanceStepId: brandedId<"RouteInstanceStepId">("production"), position: 2, kind: "production" },
    { routeInstanceStepId: brandedId<"RouteInstanceStepId">("fulfillment"), position: 3, kind: "fulfillment" },
  ],
});
const context = (request: string, capabilities: readonly string[] = ["route.advance"]): OperationContext => ({ organizationId: org, operationId: `test:${request}`, businessRequest: { id: request, payloadFingerprint: "derived" }, principal: { kind: "staff", organizationId: org, userId: "staff", authority: { membershipId: "membership", capabilities: capabilities as any } } });

class FakeTransaction implements RoutingLifecycleTransaction {
  route = base(); proof = false; prepress = false; production = false; fulfillment = false; requests = new Map<string, unknown>(); advances = 0; audits = 0;
  async reserve(input: Parameters<RoutingLifecycleTransaction["reserve"]>[0]) { const prior = this.requests.get(input.businessRequestId); return prior ? { kind: "replay" as const, request: { id: input.businessRequestId, resultJson: prior } } : { kind: "new" as const, request: { id: input.businessRequestId, resultJson: null } }; }
  async succeed(_org: string, id: string, result: any) { this.requests.set(id, result); }
  async attribute() {}
  async audit() { this.audits++; }
  async lockRouteInstance(_org: typeof org, id: typeof routeId) { return id === this.route.routeInstanceId ? this.route : null; }
  async prerequisite(_org: typeof org, _route: RouteInstance, step: RouteInstance["steps"][number]) { return step.kind === "proofing" ? this.proof ? { satisfied: true } : { satisfied: false, reason: "proof incomplete" } : step.kind === "prepress" ? this.prepress ? { satisfied: true } : { satisfied: false, reason: "prepress incomplete" } : step.kind === "production" ? this.production ? { satisfied: true } : { satisfied: false, reason: "production incomplete" } : this.fulfillment ? { satisfied: true } : { satisfied: false, reason: "fulfillment incomplete" }; }
  async advance(input: Parameters<RoutingLifecycleTransaction["advance"]>[0]) { assert.equal(input.expectedRevision, this.route.revision); this.advances++; const next = input.nextStepId; this.route = { ...this.route, state: next ? "active" : "completed", ...(next ? { currentStepId: brandedId<"RouteInstanceStepId">(next) } : {}), ...(next ? {} : { currentStepId: undefined }), revision: String(Number(this.route.revision) + 1) }; return this.route; }
}
class FakeRunner implements RoutingLifecycleTransactionRunner { constructor(readonly tx: FakeTransaction) {} async transaction<T>(action: (tx: RoutingLifecycleTransaction) => Promise<T>) { return action(this.tx); } }

const tx = new FakeTransaction();
const service = new RoutingLifecycleApplicationService(new FakeRunner(tx));
const blocked = await service.completeCurrentStep(context("blocked"), { businessRequestId: "blocked", routeInstanceId: routeId, expectedRevision: "1" });
assert(!blocked.ok && blocked.error.code === "CONFLICT", "Proofing cannot be advanced before its owning approval fact exists.");
assert.equal(tx.advances, 0, "A failed prerequisite cannot move the route.");
tx.proof = true;
const proof = await service.completeCurrentStep(context("proof"), { businessRequestId: "proof", routeInstanceId: routeId, expectedRevision: "1" });
assert(proof.ok && proof.value.completedStep.kind === "proofing" && proof.value.nextStep?.kind === "prepress", "Routing derives the next frozen step without a client destination.");
const proofReplay = await service.completeCurrentStep(context("proof"), { businessRequestId: "proof", routeInstanceId: routeId, expectedRevision: "1" });
assert(proofReplay.ok && tx.advances === 1 && tx.audits === 1, "Exact replay cannot advance or audit twice.");
const stale = await service.completeCurrentStep(context("stale"), { businessRequestId: "stale", routeInstanceId: routeId, expectedRevision: "1" });
assert(!stale.ok && stale.error.code === "STALE_STATE", "An obsolete route revision is rejected.");
tx.prepress = true;
const prepress = await service.completeCurrentStep(context("prepress"), { businessRequestId: "prepress", routeInstanceId: routeId, expectedRevision: "2" });
assert(prepress.ok && prepress.value.routeInstance.currentStepId === "production", "Prepress completion makes the frozen production step eligible.");
const productionBlocked = await service.completeCurrentStep(context("production-blocked"), { businessRequestId: "production-blocked", routeInstanceId: routeId, expectedRevision: "3" });
assert(!productionBlocked.ok && productionBlocked.error.code === "CONFLICT", "Routing cannot complete Production before its domain projection is complete.");
tx.production = true;
const production = await service.completeCurrentStep(context("production"), { businessRequestId: "production", routeInstanceId: routeId, expectedRevision: "3" });
assert(production.ok && production.value.nextStep?.kind === "fulfillment", "Production completion advances only to the frozen next Route step.");
const fulfillmentBlocked = await service.completeCurrentStep(context("fulfillment-blocked"), { businessRequestId: "fulfillment-blocked", routeInstanceId: routeId, expectedRevision: "4" });
assert(!fulfillmentBlocked.ok && fulfillmentBlocked.error.code === "CONFLICT", "Partial Fulfillment cannot complete the Route.");
tx.fulfillment = true;
const fulfillment = await service.completeCurrentStep(context("fulfillment"), { businessRequestId: "fulfillment", routeInstanceId: routeId, expectedRevision: "4" });
assert(fulfillment.ok && fulfillment.value.routeInstance.state === "completed", "Fulfillment completion deterministically closes the frozen Route.");
const denied = await service.completeCurrentStep(context("denied", []), { businessRequestId: "denied", routeInstanceId: routeId, expectedRevision: "5" });
assert(!denied.ok && denied.error.code === "FORBIDDEN", "Route advance uses its dedicated narrow authority.");
console.log("[routing] lifecycle module tests passed.");
