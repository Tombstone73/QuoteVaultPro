import fs from "node:fs";
import path from "node:path";

describe("order detail action contracts", () => {
  const root = process.cwd();
  const detail = fs.readFileSync(path.join(root, "client/src/pages/order-detail.tsx"), "utf8");
  const hooks = fs.readFileSync(path.join(root, "client/src/hooks/useOrders.ts"), "utf8");
  const routes = fs.readFileSync(path.join(root, "server/routes/orders.routes.ts"), "utf8");

  test("uses backend cancellation eligibility instead of frontend lifecycle guesses", () => {
    expect(detail).toContain("useOrderCancellationEligibility(orderId)");
    expect(detail).toContain("cancellationEligibilityQuery.data?.canCancel");
    expect(detail).toContain("const canShowCancelOrder = Boolean(order && !orderIsCanceled)");
    expect(detail).not.toContain('order.canonicalState !== "completed"');
    expect(detail).not.toContain("order.canonicalState !== \"completed\"");
    expect(hooks).toContain("/cancellation-eligibility");
    expect(routes).toContain("assessOrderCancellationEligibility");
  });

  test("keeps cancellation mutation protected by backend owner/admin middleware", () => {
    expect(routes).toContain('app.post("/api/orders/:id/cancel", isAuthenticated, tenantContext, isAdminOrOwner');
  });

  test("keeps route action semantics clear and unchanged", () => {
    expect(detail).toContain("handleSaveOrder(true)");
    expect(detail).not.toContain("Save & Route Eligible");
  });

  test("opens the existing Order fulfillment workspace through the unsaved navigation guard", () => {
    const action = detail.slice(detail.indexOf("onClick={() => guardedNavigate(ROUTES.fulfillment.order(order.id)"), detail.indexOf("<OrderDetailPrimaryActions"));
    expect(action).toContain("state: { referrer: buildReferrer(location), orderReturnState: location.state }");
    expect(action).toContain("Fulfillment");
    expect(action).not.toMatch(/createShipment|handleAddShipment|handleSaveOrder|mutate|production/i);
  });

  test("reuses one Traveler button before the fulfillment-method-specific content", () => {
    expect(detail.match(/<PrintTicketButton\b/g)).toHaveLength(1);
    expect(detail).toContain("{!orderIsCanceled && <PrintTicketButton orderId={order.id} />}");
    expect(detail.indexOf("<PrintTicketButton")).toBeLessThan(detail.indexOf("currentFulfillmentMethod !== \"pickup\""));
  });

  test("opens the authoritative existing timeline panel from the fulfillment history link", () => {
    expect(detail).toContain('const requestedPanel = searchParams.get("panel")');
    expect(detail).toContain('if (requestedPanel === "timeline") setRightPanel("timeline")');
    expect(detail).toContain('[orderId, requestedPanel]');
  });
});
