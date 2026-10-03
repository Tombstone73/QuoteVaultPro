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
    expect(detail).toContain('{!orderIsCanceled && <PrintTicketButton orderId={order.id} label="Print Traveler"');
    expect(detail).toContain('label="Print Traveler" showIcon={false}');
    expect(detail.indexOf("<PrintTicketButton")).toBeLessThan(detail.indexOf("currentFulfillmentMethod !== \"pickup\""));
  });

  test("opens the authoritative existing timeline panel from the fulfillment history link", () => {
    expect(detail).toContain('const requestedPanel = searchParams.get("panel")');
    expect(detail).toContain('if (requestedPanel === "timeline") setRightPanel("timeline")');
    expect(detail).toContain('[orderId, requestedPanel]');
  });

  test("keeps invoice navigation in the header and removes the persistent invoice summary", () => {
    expect(detail).toContain('>\n                  Invoice\n                </Link>');
    expect(detail).toContain('Invoices for Order {titleText}');
    expect(detail).not.toContain('Invoice Summary');
    expect(detail).not.toContain('Take Payment');
  });

  test("keeps header action controls text-first without inline action icons", () => {
    const actionStart = detail.indexOf('aria-label="Order controls"');
    const actionEnd = detail.indexOf('</header>', actionStart);
    const actions = detail.slice(actionStart, actionEnd);
    expect(actions).not.toContain('<FileText');
    expect(actions).not.toContain('<Truck');
    expect(actions).toContain('showIcon={false}');
  });

  test("uses the shared dark-mode secondary-action surface for the Order header", () => {
    expect(detail).toContain("ORDER_DETAIL_SECONDARY_ACTION_CLASS");
  });

  test("keeps identity and action controls in one responsive header region", () => {
    expect(detail).toContain('className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center"');
    expect(detail).toContain('aria-label="Order controls"');
    expect(detail).toContain('className="flex w-fit max-w-full min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-1 xl:ml-auto"');
    expect(detail).not.toContain('xl:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)]');
  });

  test("keeps specialist Order controls reachable through compact disclosure", () => {
    expect(detail).toContain('title="Attachments"');
    expect(detail).toContain('title="Secondary Actions"');
    expect(detail).toContain('Design billing diagnostics');
    expect(detail).toContain('aria-label="Preview Order"');
    expect(detail).toContain('aria-label="Download Order PDF"');
    expect(detail).toContain('aria-label="Email Order"');
    expect(detail).toContain('aria-label="Print Order"');
    expect(detail).toContain('title="Order Documents"');
    expect(detail).not.toContain('aria-label="Generate packing slip in Fulfillment"');
    expect(detail).not.toContain('Shipment administration');
  });

  test("places totals before fulfillment on desktop while preserving the existing mobile source order", () => {
    expect(detail).toContain('xl:grid-cols-[minmax(240px,0.75fr)_minmax(280px,1fr)_minmax(320px,1fr)]');
    expect(detail).toContain('className="xl:order-2"');
    expect(detail).toContain('className="h-fit xl:order-1"');
    expect(detail).toContain('className="space-y-2 xl:order-3"');
  });

  test("keeps structured internal-note removal tenant-scoped and auditable", () => {
    expect(detail).toContain('internal-notes/${encodeURIComponent(noteId)}');
    expect(detail).toContain('Delete internal note?');
    expect(routes).toContain("app.delete('/api/orders/:orderId/internal-notes/:noteId', isAuthenticated, tenantContext");
    expect(routes).toContain("order.internal_note_deleted");
  });
});
