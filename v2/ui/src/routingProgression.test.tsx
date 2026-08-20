import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteProgressionAction } from "./RoutingWorkspace";
import { routingApi, type RoutingWorkspaceRead } from "./api";

const base = (currentPrerequisite: { satisfied: boolean; reason?: string }): RoutingWorkspaceRead["instances"][number] => ({
  routeInstanceId: "route-a", state: "active", revision: "7", currentStepId: "proofing-a", currentPrerequisite,
  sourceTemplate: { routeTemplateId: "template-a", revision: "1", definitionFingerprint: "sha256:frozen" },
  orderId: "order-a", orderNumber: "ORD-1007", orderLineId: "line-a", lineDescription: "Sign Vinyl",
  steps: [{ routeInstanceStepId: "proofing-a", position: 0, kind: "proofing" }, { routeInstanceStepId: "prepress-a", position: 1, kind: "prepress" }],
});
const markup = (instance: RoutingWorkspaceRead["instances"][number], canAdvance = true) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><RouteProgressionAction organizationId="org-a" instance={instance} canAdvance={canAdvance} onRefresh={async () => undefined} /></QueryClientProvider>);

assert.match(markup(base({ satisfied: true })), /Proofing<\/b> prerequisite: Complete/);
assert.match(markup(base({ satisfied: true })), /Advance to Prepress/);
const blocked = markup(base({ satisfied: false, reason: "Proof approval is required." }));
assert.match(blocked, /Proofing<\/b> prerequisite: Incomplete/);
assert.match(blocked, /Proof approval is required/);
assert.match(blocked, /disabled=""/);
assert.match(markup(base({ satisfied: true }), false), /do not have permission to advance Routing/);
assert.match(markup({ ...base({ satisfied: true }), currentStepId: "prepress-a", steps: [{ routeInstanceStepId: "prepress-a", position: 1, kind: "fulfillment" }] }), /Complete Route/);

const originalFetch = globalThis.fetch;
let observed: Readonly<{ url: string; init?: RequestInit }> | undefined;
globalThis.fetch = async (url, init) => {
  observed = { url: String(url), init };
  return new Response(JSON.stringify({ ok: true, data: { routeInstance: {} } }), { headers: { "content-type": "application/json" } });
};
try {
  await routingApi.completeCurrent("org a", "route/a", "request-a", "7");
  assert.equal(observed?.url, "/v2/organizations/org%20a/routing/instances/route%2Fa/complete-current");
  assert.deepEqual(JSON.parse(String(observed?.init?.body)), { businessRequestId: "request-a", expectedRevision: "7" });
} finally { globalThis.fetch = originalFetch; }

console.log("Routing progression UI contract tests passed.");
