import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UiBootstrap } from "./api";
import { V2VisualShell, visibleNavigationSections } from "./VisualShell";
import { defaultVisualAppearance } from "./appearance";

Object.assign(globalThis, { window: { location: { pathname: "/" } } });

const labels = (capabilities?: UiBootstrap["capabilities"]) =>
  visibleNavigationSections(capabilities).flatMap((section) => section.items.map((item) => item.label));

const operationalCapabilities: UiBootstrap["capabilities"] = {
  quoteOverridePrice: false,
  proofView: true,
  productionView: true,
  inboundView: true,
  fulfillmentView: true,
  permissionsView: true,
};

const permitted = labels(operationalCapabilities);
for (const label of ["Inbound Orders", "Proofing", "Production", "Flatbed", "Roll", "Fulfillment", "Users & Permissions", "Themes / Appearance"]) {
  assert.ok(permitted.includes(label), `${label} should be exposed when permitted`);
}
for (const label of ["Quotes", "Orders", "Products", "Inventory", "QuickBooks", "Formula Library"]) {
  assert.ok(!permitted.includes(label), `${label} should not be exposed without its capability`);
}

for (const label of ["Nesting", "Materials", "Procurement", "Design", "Shipping", "Reports", "AI Assistant", "Communications", "Integrations", "Bug Reports"]) {
  assert.ok(!labels().includes(label), `${label} is not an operational V2 destination`);
}

const markup = renderToStaticMarkup(
  <V2VisualShell
    page="home"
    onNavigate={() => undefined}
    appearance={defaultVisualAppearance}
    setAppearance={() => undefined}
    capabilities={operationalCapabilities}
  >
    <div />
  </V2VisualShell>,
);
assert.match(markup, /href="\/production\/flatbed"/);
assert.match(markup, /href="\/production\/roll"/);
assert.match(markup, /href="\/settings\?section=staff"/);
assert.doesNotMatch(markup, /New Quote|New Order/);

console.log("Visual shell navigation capability tests passed.");
