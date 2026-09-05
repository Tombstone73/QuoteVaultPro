import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderWorkflowActions } from "./OrderWorkspace";

const actions = [
  {
    action: "direct_production" as const,
    orderLineId: "line-flatbed",
    confirmationRequired: true,
    allowedDestinations: ["flatbed", "roll"] as const,
    reasonRequired: false,
    eligibilityReason: "Frozen route, Artwork, and Proof evidence allow this handoff.",
  },
  {
    action: "production_not_required" as const,
    orderLineId: "line-service",
    confirmationRequired: false,
    reasonRequired: true,
    eligibilityReason: "No Production work exists and the frozen route can proceed to Fulfillment.",
  },
];

const markup = renderToStaticMarkup(
  <OrderWorkflowActions
    actions={actions}
    lines={[
      { lineId: "line-flatbed", description: "Panel" },
      { lineId: "line-service", description: "Design service" },
    ] as never}
    loading={false}
    busy={false}
    csrfReady
    onDirectProduction={() => undefined}
    onProductionNotRequired={() => undefined}
  />,
);
for (const value of [
  "Only actions currently authorized by the canonical workflow are shown.",
  "Panel",
  "Send to Flatbed",
  "Send to Roll",
  "Design service",
  "Production not required",
]) assert.match(markup, new RegExp(value));
assert.doesNotMatch(markup, /Send to Prepress|Mark Order Complete|All workflow actions/);

const none = renderToStaticMarkup(
  <OrderWorkflowActions
    actions={[]}
    lines={[]}
    loading={false}
    busy={false}
    csrfReady
    onDirectProduction={() => undefined}
    onProductionNotRequired={() => undefined}
  />,
);
assert.equal(none, "", "the UI does not invent unavailable workflow actions");
console.log("Order workflow action presentation tests passed.");
