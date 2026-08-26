import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrderRead } from "./api";
import { OrderRouting } from "./OrderWorkspace";
import { orderRoutePresentation } from "./orderRoutingPresentation";

const steps = [{ routeInstanceStepId: "proof", kind: "proofing" }, { routeInstanceStepId: "prepress", kind: "prepress" }, { routeInstanceStepId: "production", kind: "production" }];
assert.deepEqual(orderRoutePresentation(), { tone: "neutral", summary: "No route" });
assert.deepEqual(orderRoutePresentation({ state: "completed", steps }), { tone: "neutral", summary: "Route complete" });
assert.deepEqual(orderRoutePresentation({ state: "pending", currentStepId: "proof", steps, currentPrerequisite: { satisfied: false, reason: "Proof approval is required." } }), { tone: "blocked", summary: "Proofing · Pending", prerequisite: "Prerequisite: Incomplete", reason: "Proof approval is required." });
assert.deepEqual(orderRoutePresentation({ state: "active", currentStepId: "prepress", steps, currentPrerequisite: { satisfied: true } }), { tone: "active", summary: "Prepress · Active", prerequisite: "Prerequisite: Complete" });
assert.deepEqual(orderRoutePresentation({ state: "active", currentStepId: "production", steps }), { tone: "active", summary: "Production · Active" });
assert.deepEqual(orderRoutePresentation({ state: "pending", steps: [] }), { tone: "active", summary: "Routing · Pending" });
const markup = renderToStaticMarkup(React.createElement(OrderRouting, { order: { order: { lines: [{ lineId: "line-a", position: 1, description: "Sign Vinyl" }] }, routes: [{ routeInstanceId: "route-a", work: { orderLineId: "line-a" }, state: "pending", currentStepId: "proof", currentPrerequisite: { satisfied: false, reason: "Proof approval is required." }, steps }] } as unknown as OrderRead, onOpen: () => undefined }));
assert.match(markup, /Line 1: Sign Vinyl.*Proofing · Pending.*Prerequisite: Incomplete.*Proof approval is required/s);
assert.match(markup, /Open Routing/);
assert.doesNotMatch(markup, /Advance to|Complete Route|Routing Active/);
console.log("Order Routing presentation tests passed.");
