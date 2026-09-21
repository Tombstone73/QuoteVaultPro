import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductWorkspace } from "./ProductWorkspace";

const activeProduct = {
  productId: "active-product", displayName: "Published banner", category: "Signs", productUpdatedAt: "2026-09-21T12:00:00.000Z",
  lifecycle: "active" as const, measurementMode: "dimensions_required" as const, pricingSummary: "Per sq ft", workflowIntent: "standard_production" as const,
  requiresProductionJob: true, requiresProofApproval: true, configurableOptionCount: 1,
  versions: {
    active: { productVersionId: "active-version", status: "active" as const, createdAt: "2026-09-20T12:00:00.000Z", updatedAt: "2026-09-21T12:00:00.000Z", publishedAt: "2026-09-21T12:00:00.000Z", editable: false },
    draft: null, history: [], historyLimit: 25, historyHasMore: false, canCreateDraft: true,
  },
  activeDefinition: {
    options: [{ selectionKey: "finish" }], pricing: { mode: "simple_base" }, productionUnits: [{ key: "front" }],
    routing: { templateName: "Standard production", revision: "1", steps: ["proofing", "prepress", "production", "fulfillment"] },
  },
};

const render = (canEdit: boolean) => {
  const client = new QueryClient();
  client.setQueryData(["v2", "scope-a", "org-a", "products", "active-product"], activeProduct);
  return renderToStaticMarkup(<QueryClientProvider client={client}><ProductWorkspace organizationId="org-a" sessionScope="scope-a" productId="active-product" canView canEdit={canEdit} builderMode openEditor={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
};

const viewer = render(false);
for (const text of ["Published banner", "ACTIVE VERSION", "Published configuration", "simple_base pricing", "Standard production", "proofing → prepress → production → fulfillment"]) assert.match(viewer, new RegExp(text));
assert.doesNotMatch(viewer, /You do not have permission to edit this Product/);
assert.doesNotMatch(viewer, /Create editable Draft/);

const editor = render(true);
assert.match(editor, /Create editable Draft/);
console.log("Active Product read-only and explicit-draft-entry tests passed.");
