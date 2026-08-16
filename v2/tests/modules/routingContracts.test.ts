import assert from "node:assert/strict";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { ProductTypeRoutePolicy } from "../../src/modules/products/contracts.js";
import type { RouteInstance, RouteStepKind, SalesOrderLineWorkReference } from "../../src/modules/routing/contracts.js";

const kinds: readonly RouteStepKind[] = ["proofing", "prepress", "production", "fulfillment"];
assert.deepEqual(kinds, ["proofing", "prepress", "production", "fulfillment"], "M1.8 intentionally keeps the route vocabulary coarse.");

const policies: readonly ProductTypeRoutePolicy[] = [
  { kind: "unconfigured" },
  { kind: "no_route" },
  { kind: "route_required", defaultRouteTemplateId: brandedId<"RouteTemplateId">("template") },
];
assert.equal(policies.filter((policy) => policy.kind === "no_route").length, 1, "No-route is an explicit Product Type policy, not a dummy Route Instance.");

const work: SalesOrderLineWorkReference = {
  kind: "sales_order_line", organizationId: brandedId<"OrganizationId">("org"),
  orderId: brandedId<"OrderId">("order"), orderLineId: brandedId<"OrderLineId">("order-line"),
};
const frozen: RouteInstance = {
  routeInstanceId: brandedId<"RouteInstanceId">("route"), organizationId: work.organizationId, work,
  sourceTemplate: { routeTemplateId: brandedId<"RouteTemplateId">("template"), revision: "1", definitionFingerprint: "sha256:fixture" },
  state: "pending", currentStepId: brandedId<"RouteInstanceStepId">("instance-step"), revision: "1",
  steps: [{ routeInstanceStepId: brandedId<"RouteInstanceStepId">("instance-step"), position: 0, kind: "fulfillment" }],
};
assert.equal(frozen.work.orderLineId, "order-line", "Routing work is an Order-line identity, never a Quote/Sales-line alias.");
assert.equal(frozen.steps[0]?.routeInstanceStepId, frozen.currentStepId, "Current position is a durable instance-step identity.");
console.log("[m1.8] Routing contract tests passed.");
