import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { PrepressWorkspace } from "./PrepressWorkspace";

const client = new QueryClient();
client.setQueryData(["v2", "scope-a", "org-a", "prepress", "queue", 1, 25, "", "configured"], {
  items: [{ orderId: "order-a", orderNumber: "ORD-100", customerDisplayName: "Shop customer", orderLineId: "line-a", lineDescription: "Window graphics", quantity: 2, routingStepKind: "prepress", coverage: { state: "configured", productionArtworkComplete: true, allRequiredPrepressUnitsComplete: true, requirements: [{ requirement: { key: "front", side: "front" }, artworkAssignmentIds: ["assignment-a"], productionArtworkCovered: true, prepressComplete: true, prepressUnits: [{ prepressUnitId: "unit-a", organizationId: "org-a", orderId: "order-a", orderLineId: "line-a", artworkAssignmentId: "assignment-a", artworkFileId: "file-a", createdAt: "2026-09-06", startedAt: "2026-09-06", completedAt: "2026-09-06" }] }] }, operational: { materials: ["vinyl"], sourceArtwork: [], productionArtwork: [{ artworkAssignmentId: "assignment-a", artworkFileId: "file-a", filename: "ready.pdf", contentType: "application/pdf", purpose: "production", side: "front" }], proof: { required: true, state: "approved" }, productionDestination: "flatbed", readiness: { ready: true, blockers: [] } } }],
  pagination: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 },
});

const markup = renderToStaticMarkup(<QueryClientProvider client={client}><PrepressWorkspace organizationId="org-a" sessionScope="scope-a" canView canArtworkAssign canArtworkAdopt canWork canComplete canRouteAdvance canProductionWork openOrder={() => undefined} openCustomer={() => undefined} openArtwork={() => undefined} /></QueryClientProvider>);
assert.match(markup, /PDF/);
assert.match(markup, /ready\.pdf/);
assert.match(markup, /artwork\/files\/file-a\/content/);
assert.match(markup, /Replace production Artwork/);
assert.match(markup, /Material.*vinyl/s);
assert.match(markup, /Destination.*flatbed/s);
assert.match(markup, /Proof.*approved/s);
assert.match(markup, /Readiness: Ready to send/);
assert.match(markup, /Send to flatbed/);

console.log("Prepress operational viewer, production-art revision, blocker, and handoff UI contracts passed.");
