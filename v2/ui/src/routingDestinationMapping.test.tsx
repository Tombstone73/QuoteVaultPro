import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { RoutingWorkspace } from "./RoutingWorkspace";

const client = new QueryClient();
client.setQueryData(["v2", "scope-a", "org-a", "routing", "workspace"], {
  templates: [{ routeTemplateId: "template-a", name: "Large format", active: true, revision: "1", definitionFingerprint: "sha256:a", steps: [
    { routeTemplateStepId: "step-prepress", position: 0, kind: "prepress" },
    { routeTemplateStepId: "step-production", position: 1, kind: "production" },
  ] }],
  instances: [],
});

const markup = renderToStaticMarkup(<QueryClientProvider client={client}><RoutingWorkspace organizationId="org-a" sessionScope="scope-a" canView canAdvance={false} canManageTemplates openOrder={() => undefined} /></QueryClientProvider>);
assert.match(markup, /Production destination/);
assert.match(markup, /Flatbed/);
assert.match(markup, /Roll/);
assert.match(markup, /Unconfigured: Direct Production and Prepress handoff remain blocked/);
assert.match(markup, /Explicit station authority for Direct Production and Prepress handoff/);

const readOnly = renderToStaticMarkup(<QueryClientProvider client={client}><RoutingWorkspace organizationId="org-a" sessionScope="scope-a" canView canAdvance={false} canManageTemplates={false} openOrder={() => undefined} /></QueryClientProvider>);
assert.match(readOnly, /You do not have permission to configure Route Template destinations/);
assert.doesNotMatch(readOnly, /New Route Template/);

console.log("Routing production-destination mapping UI tests passed.");
