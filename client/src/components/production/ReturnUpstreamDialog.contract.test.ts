import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Prepress shows a single role-gated return menu and shared dialog", () => {
  const page = read("client/src/pages/PrepressProductionPageV2.tsx");
  expect(page).toContain("canReturnUpstream(selectedItem, isAdminOrOwner)");
  expect(page).toContain("Return to Proofing");
  expect(page).toContain("Return to Design");
  expect(page).toContain("<ReturnUpstreamDialog");
});

test("dialog requires a reason, refreshes canonical queues and disables stale resubmission", () => {
  const dialog = read("client/src/components/production/ReturnUpstreamDialog.tsx");
  expect(dialog).toContain("disabled={!reason.trim() || mutation.isPending || needsReview}");
  expect(dialog).toContain("retry: false");
  for (const key of ["/api/prepress/queue", "/api/proofing/queue", "/api/design/queue", "/api/operational-summary"]) {
    expect(dialog).toContain(key);
  }
  expect(dialog).toContain("UPSTREAM_STALE_STATE");
  expect(dialog).toContain("failure.message");
});

test("Order editor warns only after a successful false-to-true downstream line save", () => {
  const section = read("client/src/components/orders/OrderLineItemsSection.tsx");
  expect(section).toContain("shouldWarnAfterProofRequirementSave({");
  expect(section).toContain("requiresExplicitProofReturn");
  expect(section).toContain("Line {lineNumber}: Proofing is now required.");
  expect(section).toContain("canReturnUpstream(currentReturnTarget, isAdminOrOwner)");
  expect(section).toContain("onProofRequirementAdded?.(itemId)");
  const order = read("client/src/pages/order-detail.tsx");
  expect(order).toContain("newProofRequirementLineItemIds={newlyRequiredProofLineIds}");
  expect(order).toContain("...newlyRequiredProofLineIdsRef.current,");
});

test("the Prepress read projection supplies the canonical line timestamp", () => {
  const route = read("server/routes/prepress.routes.ts");
  expect(route).toContain("lineItemUpdatedAt: orderLineItems.updatedAt");
  expect(route).toContain("lineItemUpdatedAt: new Date(item.lineItemUpdatedAt).toISOString()");
});
