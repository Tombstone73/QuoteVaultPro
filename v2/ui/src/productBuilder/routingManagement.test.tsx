import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoutingSection } from "./production-routing";

const markup = renderToStaticMarkup(<RoutingSection
  routing={{
    kind: "route_required",
    routeTemplateId: "route-template-a",
    routeTemplateName: "Production route",
    sourceTemplateRevision: "7",
    sourceTemplateFingerprint: "sha256:template-a",
    steps: [{ position: 0, kind: "proofing" }, { position: 1, kind: "production" }],
  }}
  templates={[{
    routeTemplateId: "route-template-a", name: "Production route", active: true,
    revision: "7", definitionFingerprint: "sha256:template-a",
    steps: [{ position: 0, kind: "proofing" }, { position: 1, kind: "production" }],
  }]}
  onChange={() => {}}
  onManageRoutes={() => {}}
/>);

assert.match(markup, /Route preview/);
assert.match(markup, /Read-only/);
assert.match(markup, /Revision 7/);
assert.match(markup, /Manage routes/);
assert.match(markup, /Editing steps happens in the Routing module/);
assert.doesNotMatch(markup, /Add route step|Remove route step|Route step editor/);

console.log("Product Builder Routing-management presentation tests passed.");
