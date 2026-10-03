import assert from "node:assert/strict";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { FulfillmentWorkspace } from "./FulfillmentWorkspace";
import type { FulfillmentWorkspaceOrder } from "./api";
import type { ReplacementFulfillmentProjection } from "../../src/modules/fulfillment/contracts";
import { brandedId } from "../../src/modules/shared/commercialValues";

const order: FulfillmentWorkspaceOrder = { orderId: "m5-ui-order", number: "ORD-1019", commercialState: "open", customerName: "Synthetic Customer",
  lines: [{ orderId: "m5-ui-order", orderLineId: "m5-ui-line", description: "Synthetic Banner", orderedQuantity: 2,
    completedPickupQuantity: 2, completedShipmentQuantity: 0, completedFulfillmentQuantity: 2, completedProductionQuantity: 2,
    availableFulfillmentQuantity: 0, remainingProductionQuantity: 0, remainingFulfillmentQuantity: 0 }],
  handoffs: [{ handoff: { handoffId: "m5-original-handoff", method: "pickup", completedAt: "2026-10-01T00:00:00.000Z", completedPrincipalSubject: "synthetic-operator" },
    allocations: [{ orderLineId: "m5-ui-line", quantity: 2 }] }] };
const replacement = (id: string, quantity: number, remainingProduction: number, remainingFulfillment: number, available: number): ReplacementFulfillmentProjection => ({
  obligation: { replacementObligationId: brandedId<"ReplacementObligationId">(id), organizationId: brandedId<"OrganizationId">("m5-ui-org"),
    orderId: brandedId<"OrderId">(order.orderId), orderLineId: brandedId<"OrderLineId">("m5-ui-line"), replacementQuantity: quantity,
    reason: "print_defect", responsibility: "titan", billingTreatment: "no_charge", status: remainingProduction ? "open" : "production_complete",
    successorProductionWorkIds: [], createdAt: "2026-10-01T00:00:00.000Z", createdPrincipalKind: "staff", createdPrincipalSubject: "synthetic-operator" },
  remainingProductionQuantity: remainingProduction, remainingFulfillmentQuantity: remainingFulfillment, availableFulfillmentQuantity: available,
  billingPending: false, events: [] });
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const root = createRoot(document.getElementById("root")!);
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const replacementKey = ["v2", "m5-ui-scope", "m5-ui-org", "fulfillment", "replacements", order.orderId] as const;
const requests: { url: string; method: string; body?: unknown; rawBody?: string }[] = [];
const originalFetch = globalThis.fetch;
let items: readonly ReplacementFulfillmentProjection[] = [];
globalThis.fetch = async (input, init) => {
  const url = String(input), method = init?.method ?? "GET";
  const rawBody = init?.body ? String(init.body) : undefined;
  const body = rawBody ? JSON.parse(rawBody) : undefined;
  requests.push({ url, method, body, rawBody });
  assert.ok(url.startsWith("/v2/organizations/m5-ui-org/fulfillment/"), "UI must use canonical Fulfillment routes only");
  let data: unknown;
  if (method === "POST") {
    assert.equal(url, `/v2/organizations/m5-ui-org/fulfillment/orders/${order.orderId}/pickups`);
    data = { handoff: { handoffId: "m5-replacement-handoff", replacementObligationId: "m5-A", method: "pickup", completedAt: "2026-10-01T01:00:00.000Z", completedPrincipalSubject: "synthetic-operator" },
      allocations: [{ orderLineId: "m5-ui-line", quantity: 1 }], availability: order.lines };
    items = items.map(item => item.obligation.replacementObligationId === "m5-A" ? { ...item,
      obligation: { ...item.obligation, status: "fulfilled" }, remainingFulfillmentQuantity: 0, availableFulfillmentQuantity: 0 } : item);
  } else if (url.endsWith("/shipments")) data = [];
  else if (url.endsWith("/replacements")) data = items;
  else if (url.includes(`/orders/${order.orderId}`)) data = order;
  else data = { items: [order] };
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "content-type": "application/json" } });
};
const render = async (next: readonly ReplacementFulfillmentProjection[], overrides: Partial<React.ComponentProps<typeof FulfillmentWorkspace>> = {}) => {
  items = next;
  await act(async () => {
    client.setQueryData(["v2", "m5-ui-scope", "m5-ui-org", "fulfillment", "workspace", ""], { items: [order] });
    client.setQueryData(["v2", "m5-ui-scope", "m5-ui-org", "fulfillment", "order", order.orderId], order);
    client.setQueryData(replacementKey, items);
    root.render(<QueryClientProvider client={client}><FulfillmentWorkspace organizationId="m5-ui-org" sessionScope="m5-ui-scope" canView canPickup
      canShip={false} canReplace csrfReady orderId={order.orderId} onSelectOrder={() => {}} openOrder={() => {}} openCustomer={() => {}} {...overrides} /></QueryClientProvider>);
  });
};
const controls = () => [...document.querySelectorAll<HTMLElement>(".v2-fulfillment-replacement-pickup")];
const button = (index = 0) => controls()[index]?.querySelector<HTMLButtonElement>("button");
const quantity = (index = 0) => controls()[index]?.querySelector<HTMLInputElement>("input");

try {
  await render([replacement("m5-A", 1, 0, 1, 1), replacement("m5-B", 3, 3, 3, 0)]);
  assert.equal(button()?.textContent, "Record Replacement Pickup");
  assert.equal(button()?.disabled, false, "replacement1 is available even when original availability is zero");
  assert.equal(quantity()?.max, "1");
  assert.equal(quantity()?.value, "1");
  assert.match(document.body.textContent ?? "", /Ordered 2.*Produced 2.*Available 0.*Fulfilled 2/);
  assert.doesNotMatch(document.body.textContent ?? "", /Integrity anomaly|Record partial pickup/);
  assert.equal(requests.length, 0, "rendering cached facts cannot write financial or physical history");

  await render([replacement("m5-A", 2, 1, 2, 1)]);
  assert.equal(button()?.disabled, false, "partially produced replacement exposes the owner's exact available supply");
  assert.equal(quantity()?.max, "1", "replacement remaining commercial quantity2 is not physical availability1");
  assert.equal(quantity()?.value, "1");

  await render([{ ...replacement("m5-A", 2, 0, 1, 0), reservedShipmentQuantity: 1 }, replacement("m5-B", 3, 0, 3, 3)]);
  assert.equal(button(0)?.disabled, true, "prepared A reservation cannot be consumed by a pickup");
  assert.equal(quantity(0)?.max, "0");
  assert.equal(button(1)?.disabled, false, "A reservation cannot disable independently available B");
  assert.equal(quantity(1)?.max, "3");
  assert.match(controls()[0].textContent ?? "", /1\/2 fulfilled.*0 available/);

  const ambiguous = { ...replacement("m5-A", 2, 1, 2, 0), productionAuthorityIssue: {
    kind: "AMBIGUOUS_REPLACEMENT_PRODUCTION" as const, requirementKeys: ["front"] } };
  await render([ambiguous, replacement("m5-B", 3, 0, 3, 3)]);
  assert.equal(controls().length, 1, "ambiguous A exposes a read-only reason, not pickup controls");
  assert.match(document.querySelector('[data-testid="replacement-production-authority-issue"]')?.textContent ?? "", /ambiguous.*front.*unavailable pending owner review/);
  assert.match(document.body.textContent ?? "", /Production quantity unresolved/);
  assert.equal(quantity()?.max, "3", "independent B remains actionable");
  assert.equal(button()?.disabled, false);
  await render([{ ...ambiguous, availableFulfillmentQuantity: 2 }]);
  assert.equal(controls().length, 0, "an explicit ambiguity blocker wins over inconsistent cached availability");
  assert.doesNotMatch(document.body.textContent ?? "", /Record Replacement Pickup/);
  assert.equal(requests.length, 0, "ambiguous Production evidence cannot cause a handoff mutation");

  await render([replacement("m5-A", 1, 0, 1, 1)], { csrfReady: false });
  assert.equal(button()?.disabled, true);
  await render([replacement("m5-A", 1, 0, 1, 1)], { canPickup: false });
  assert.equal(controls().length, 0);
  await render([replacement("m5-A", 1, 0, 1, 1)], { canReplace: false });
  assert.equal(controls().length, 0);
  assert.equal(requests.length, 0, "permission/CSRF presentation changes perform no mutations");

  await render([{ ...ambiguous, remainingProductionQuantity: 0 }, replacement("m5-B", 3, 0, 3, 3)], { canShip: true });
  const builder = document.querySelector<HTMLElement>(".v2-fulfillment-shipment-builder")!;
  await act(async () => { builder.querySelector<HTMLButtonElement>("header button")!.click(); });
  const shipmentChoices = builder.querySelectorAll<HTMLInputElement>('.v2-fulfillment-shipment-selection input[type="checkbox"]');
  assert.equal(shipmentChoices.length, 1, "ambiguous A is not offered for shipment even if its minimum witness meets requested quantity");
  assert.equal(shipmentChoices[0].disabled, false, "independent B remains an eligible shipment choice");
  assert.ok(requests.every(request => request.method === "GET"), "opening read-only choices cannot prepare an ambiguous handoff");
  await act(async () => { builder.querySelector<HTMLButtonElement>("header button")!.click(); });

  await render([replacement("m5-A", 1, 0, 1, 1), replacement("m5-B", 3, 3, 3, 0)]);
  await act(async () => { button()!.click(); });
  for (let attempt = 0; attempt < 30 && !document.body.textContent?.includes("Replacement pickup recorded"); attempt++) {
    await act(async () => { await new Promise(done => setTimeout(done, 5)); });
  }
  const mutations = requests.filter(request => request.method !== "GET");
  assert.equal(mutations.length, 1, "one click invokes one existing canonical replacement pickup request");
  const payload = mutations[0].body as { businessRequestId: string; replacementObligationId: string; allocations: unknown };
  assert.ok(payload.businessRequestId);
  assert.equal(payload.replacementObligationId, "m5-A", "canonical backend receives A, never a line-only or B handoff");
  assert.deepEqual(payload.allocations, [{ orderLineId: "m5-ui-line", quantity: 1 }]);
  assert.equal(mutations[0].rawBody, JSON.stringify({ businessRequestId: payload.businessRequestId, allocations: [{ orderLineId: "m5-ui-line", quantity: 1 }], replacementObligationId: "m5-A" }), "replacement pickup request bytes retain the original canonical body ordering");
  assert.match(document.body.textContent ?? "", /Original pickup history and Invoice\/payment records remain unchanged/);
  assert.match(document.body.textContent ?? "", /Ordered 2.*Produced 2.*Available 0.*Fulfilled 2/);
  assert.ok(requests.every(request => !/billing|invoice|payment|refund|pricing|product/i.test(request.url)));
} finally {
  await act(async () => { root.unmount(); });
  globalThis.fetch = originalFetch;
  client.clear();
  dom.window.close();
}
console.log("replacementFulfillmentIsolation.test: physical availability, ambiguity blockers, A/B isolation, permissions and canonical pickup PASS, zero skipped");
