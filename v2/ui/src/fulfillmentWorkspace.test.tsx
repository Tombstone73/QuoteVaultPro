import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { fulfillmentApi, type FulfillmentShipmentContainer, type FulfillmentShipmentDetail, type FulfillmentWorkspaceOrder } from "./api";
import type { ReplacementFulfillmentProjection } from "../../src/modules/fulfillment/contracts";
import { FulfillmentWorkspace, preferredHandoffMethod } from "./FulfillmentWorkspace";
import { canonicalFulfillmentIntentBody, validateFulfillmentIntentRecord } from "./ShipmentBuilder";

const order={orderId:"order-anomaly",number:"ORD-1000",commercialState:"open" as const,customerName:"3 Alarm Graphics",customerId:"customer-a",lines:[{orderId:"order-anomaly",orderLineId:"line-anomaly",description:"Retractable Banner",orderedQuantity:1,completedPickupQuantity:1,completedShipmentQuantity:0,completedFulfillmentQuantity:1,completedProductionQuantity:0,productionRequired:true,availableFulfillmentQuantity:0,remainingProductionQuantity:1,remainingFulfillmentQuantity:0,physicalIntegrityAnomaly:{code:"FULFILLMENT_HISTORY_EXCEEDS_RECORDED_PRODUCTION" as const,completedProductionQuantity:0,completedFulfillmentQuantity:1,excessFulfillmentQuantity:1}}],handoffs:[{handoff:{handoffId:"handoff-a",method:"pickup" as const,completedAt:"2026-08-20T16:32:52.000Z",completedPrincipalSubject:"operator"},allocations:[{orderLineId:"line-anomaly",quantity:1}]}]};
const client=new QueryClient();
client.setQueryData(["v2","scope-a","org-a","fulfillment","workspace",""],{items:[order]});
client.setQueryData(["v2","scope-a","org-a","fulfillment","order","order-anomaly"],order);
const markup=renderToStaticMarkup(<QueryClientProvider client={client}><FulfillmentWorkspace organizationId="org-a" sessionScope="scope-a" canView canPickup canShip csrfReady orderId="order-anomaly" onSelectOrder={()=>{}} openOrder={()=>{}} openCustomer={()=>{}} /></QueryClientProvider>);
assert.match(markup,/Integrity anomaly/);
assert.match(markup,/Physical fulfillment history exceeds recorded Production output/);
assert.match(markup,/Additional handoffs are blocked until this historical integrity anomaly is resolved/);
assert.match(markup,/Handoff history/);
assert.match(markup,/Open Order/);
assert.match(markup,/Open Customer/);
assert.match(markup,/Fulfillment method not set/);
assert.doesNotMatch(markup,/Record partial|Hand off available|Fulfillment quantity/);

const completedOrder={...order,orderId:"order-completed",commercialState:"completed" as const,lines:[{...order.lines[0]!,orderId:"order-completed",physicalIntegrityAnomaly:undefined,completedProductionQuantity:1,availableFulfillmentQuantity:1,remainingProductionQuantity:0}]};
const completedClient=new QueryClient();
completedClient.setQueryData(["v2","scope-a","org-a","fulfillment","workspace",""],{items:[completedOrder]});
completedClient.setQueryData(["v2","scope-a","org-a","fulfillment","order","order-completed"],completedOrder);
const completedMarkup=renderToStaticMarkup(<QueryClientProvider client={completedClient}><FulfillmentWorkspace organizationId="org-a" sessionScope="scope-a" canView canPickup canShip csrfReady orderId="order-completed" onSelectOrder={()=>{}} openOrder={()=>{}} openCustomer={()=>{}} /></QueryClientProvider>);
assert.match(completedMarkup,/This terminal Order is read-only/);
assert.doesNotMatch(completedMarkup,/Record partial|Hand off available|Fulfillment quantity/);

const shippingOrder={...order,orderId:"order-shipping",requestedFulfillment:{method:"shipping" as const,destination:{addressLine1:"10 Print Way",city:"Tampa",region:"FL",country:"US"}},lines:[{...order.lines[0]!,orderId:"order-shipping",physicalIntegrityAnomaly:undefined,completedProductionQuantity:8,completedPickupQuantity:2,completedShipmentQuantity:3,completedFulfillmentQuantity:5,availableFulfillmentQuantity:3,remainingProductionQuantity:0,remainingFulfillmentQuantity:3}]};
const shippingClient=new QueryClient();
shippingClient.setQueryData(["v2","scope-a","org-a","fulfillment","workspace",""],{items:[shippingOrder]});
shippingClient.setQueryData(["v2","scope-a","org-a","fulfillment","order","order-shipping"],shippingOrder);
const shippingMarkup=renderToStaticMarkup(<QueryClientProvider client={shippingClient}><FulfillmentWorkspace organizationId="org-a" sessionScope="scope-a" canView canPickup canShip csrfReady orderId="order-shipping" onSelectOrder={()=>{}} openOrder={()=>{}} openCustomer={()=>{}} /></QueryClientProvider>);
assert.equal(preferredHandoffMethod(shippingOrder),"shipment");
assert.equal(preferredHandoffMethod({...shippingOrder,requestedFulfillment:{method:"pickup"}}),"pickup");
assert.match(shippingMarkup,/Picked up/);
assert.match(shippingMarkup,/Shipped/);
assert.match(shippingMarkup,/Requested by Sales:.*shipping/i);
assert.match(shippingMarkup,/Record partial pickup/);
assert.match(shippingMarkup,/Pick up all available on this line/);
assert.match(shippingMarkup,/Create shipment/);
assert.match(shippingMarkup,/Pickup creates an immutable handoff/);

const runUnknownPickupRecovery = async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver })) Object.defineProperty(globalThis, name, { configurable: true, value });
  const recoveredOrder = { ...shippingOrder, orderId: "order-recovery", commercialState: "open" as const, lines: [{ ...shippingOrder.lines[0]!, orderId: "order-recovery", completedPickupQuantity: 0, completedShipmentQuantity: 0, completedFulfillmentQuantity: 0, availableFulfillmentQuantity: 4, remainingFulfillmentQuantity: 4 }] } as FulfillmentWorkspaceOrder;
  const otherScopeOrder = { ...recoveredOrder, orderId: "order-other-scope", number: "ORD-OTHER", customerName: "Other Session Customer", lines: [{ ...recoveredOrder.lines[0]!, orderId: "order-other-scope", orderLineId: "line-other-scope", availableFulfillmentQuantity: 7, remainingFulfillmentQuantity: 7 }] } as FulfillmentWorkspaceOrder;
  const sessionScope = "scope-recovery", organizationId = "org-recovery", storageKey = `ph.v2.fulfillment.intent.v1:${organizationId}`;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(["v2", sessionScope, organizationId, "fulfillment", "workspace", ""], { items: [recoveredOrder] });
  client.setQueryData(["v2", sessionScope, organizationId, "fulfillment", "order", recoveredOrder.orderId], recoveredOrder);
  client.setQueryData(["v2", "scope-other", organizationId, "fulfillment", "workspace", ""], { items: [otherScopeOrder] });
  client.setQueryData(["v2", "scope-other", organizationId, "fulfillment", "order", otherScopeOrder.orderId], otherScopeOrder);
  const calls: Parameters<typeof fulfillmentApi.complete>[] = [];
  const original = { complete: fulfillmentApi.complete, list: fulfillmentApi.list, get: fulfillmentApi.get };
  const complete = async (...args: Parameters<typeof fulfillmentApi.complete>) => {
    calls.push(args);
    if (calls.length === 1) throw new TypeError("network response was lost after submission");
    return {} as Awaited<ReturnType<typeof fulfillmentApi.complete>>;
  };
  Object.assign(fulfillmentApi, {
    complete: complete as typeof fulfillmentApi.complete,
    list: (async () => ({ items: [recoveredOrder], totalMatching: 1 })) as unknown as typeof fulfillmentApi.list,
    get: (async () => recoveredOrder) as typeof fulfillmentApi.get,
  });
  const container = dom.window.document.getElementById("root")!;
  let root = createRoot(container);
  const render = (scope = sessionScope, selectedOrderId = recoveredOrder.orderId) => <QueryClientProvider client={client}><FulfillmentWorkspace organizationId={organizationId} sessionScope={scope} canView canPickup canShip={false} csrfReady orderId={selectedOrderId} onSelectOrder={() => {}} openOrder={() => {}} openCustomer={() => {}} /></QueryClientProvider>;
  const flush = async () => { for (let index = 0; index < 3; index += 1) { await new Promise(resolve => setTimeout(resolve, 0)); flushSync(() => {}); } };
  const findButton = (label: string) => [...container.querySelectorAll("button")].find(button => button.textContent?.includes(label));
  try {
    flushSync(() => root.render(render())); await flush();
    flushSync(() => findButton("Record partial pickup")!.click()); await flush();
    assert.equal(calls.length, 1);
    const stored = JSON.parse(dom.window.sessionStorage.getItem(storageKey) ?? "null");
    assert.equal(stored.operation, "fulfillment-pickup");
    assert.equal(stored.sessionScope, sessionScope);
    const firstRequestId = calls[0]![3];
    assert.equal(stored.businessRequestId, firstRequestId);
    assert.match(container.textContent ?? "", /exact request identity and body remain saved/);
    flushSync(() => root.render(render("scope-other", otherScopeOrder.orderId)));
    assert.match(container.textContent ?? "", /ORD-OTHER.*Other Session Customer/);
    const changedScopeText = container.textContent ?? "";
    assert.doesNotMatch(changedScopeText, /ORD-1000|order-recovery|line-anomaly|quantity 4/);
    assert.equal(changedScopeText.includes(firstRequestId), false, "old retry identity is never rendered after the scope changes");
    assert.notEqual(container.querySelector<HTMLInputElement>('[aria-label="Fulfillment quantity"]')?.value, "4");
    assert.match(container.textContent ?? "", /different authenticated session/);
    assert.equal(findButton("Retry exact Pickup request"), undefined, "a different session cannot read or replay the retained body");
    assert.equal(findButton("Record partial pickup")?.disabled, true, "the changed scope cannot act on the previous session's selected line");
    assert.equal(calls.length, 1, "a different session cannot mint a second Pickup while the prior intent is unresolved");
    flushSync(() => root.render(render())); await flush();
    assert.equal(calls.length, 1, "remount recovery never automatically creates another Pickup");
    assert.ok(findButton("Retry exact Pickup request"));
    flushSync(() => findButton("Retry exact Pickup request")!.click()); await flush();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]![3], firstRequestId, "owner retry reuses the exact durable request identity");
    assert.deepEqual(calls[1]![4], calls[0]![4], "owner retry reuses the exact allocation body");
    assert.equal(dom.window.sessionStorage.getItem(storageKey), null, "the owner receipt clears the pending intent");
  } finally {
    flushSync(() => root.unmount());
    client.clear();
    dom.window.close();
    Object.assign(fulfillmentApi, original);
  }
};

const runUnknownReplacementRecovery = async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver })) Object.defineProperty(globalThis, name, { configurable: true, value });
  const organizationId = "org-replacement", sessionScope = "scope-replacement", orderId = shippingOrder.orderId, orderLineId = shippingOrder.lines[0]!.orderLineId;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(["v2", sessionScope, organizationId, "fulfillment", "workspace", ""], { items: [shippingOrder] });
  client.setQueryData(["v2", sessionScope, organizationId, "fulfillment", "order", shippingOrder.orderId], shippingOrder);
  client.setQueryData(["v2", sessionScope, organizationId, "fulfillment", "replacements", shippingOrder.orderId], []);
  const calls: Parameters<typeof fulfillmentApi.createReplacement>[] = [];
  const original = { createReplacement: fulfillmentApi.createReplacement, replacements: fulfillmentApi.replacements, list: fulfillmentApi.list, get: fulfillmentApi.get };
  const created = { obligation: { replacementObligationId: "replacement-new", orderId, orderLineId, replacementQuantity: 1, reason: "print_defect", responsibility: "titan" as const, billingTreatment: "no_charge" as const, status: "open" as const }, remainingProductionQuantity: 1, remainingFulfillmentQuantity: 0, billingPending: false };
  const createReplacement = async (...args: Parameters<typeof fulfillmentApi.createReplacement>) => {
    calls.push(args);
    if (calls.length === 1) throw new TypeError("response lost after replacement submission");
    return created;
  };
  Object.assign(fulfillmentApi, {
    createReplacement: createReplacement as typeof fulfillmentApi.createReplacement,
    replacements: (async () => []) as typeof fulfillmentApi.replacements,
    list: (async () => ({ items: [shippingOrder], totalMatching: 1 })) as unknown as typeof fulfillmentApi.list,
    get: (async () => shippingOrder) as typeof fulfillmentApi.get,
  });
  const container = dom.window.document.getElementById("root")!;
  let root = createRoot(container);
  const render = () => <QueryClientProvider client={client}><FulfillmentWorkspace organizationId={organizationId} sessionScope={sessionScope} canView canPickup={false} canShip={false} canReplace csrfReady orderId={shippingOrder.orderId} onSelectOrder={() => {}} openOrder={() => {}} openCustomer={() => {}} /></QueryClientProvider>;
  const flush = async () => { for (let index = 0; index < 3; index += 1) { await new Promise(resolve => setTimeout(resolve, 0)); flushSync(() => {}); } };
  const findButton = (label: string) => [...container.querySelectorAll("button")].find(button => button.textContent?.includes(label));
  try {
    flushSync(() => root.render(render())); await flush();
    const createButton = [...container.querySelectorAll('[data-testid="replacement-obligations"] button')].find(button => /create/i.test(button.textContent ?? ""));
    assert.ok(createButton, "replacement create intent is available to the authorized operator");
    flushSync(() => (createButton as HTMLButtonElement).click()); await flush();
    assert.equal(calls.length, 1);
    const storageKey = `ph.v2.fulfillment.intent.v1:${organizationId}`;
    const stored = JSON.parse(dom.window.sessionStorage.getItem(storageKey) ?? "null");
    assert.equal(stored.operation, "replacement-create");
    assert.equal(stored.payload.orderId, orderId);
    flushSync(() => root.unmount());
    root = createRoot(container);
    flushSync(() => root.render(render())); await flush();
    assert.equal(calls.length, 1, "uncertain replacement creation is not automatically repeated");
    flushSync(() => findButton("Retry exact replacement request")!.click()); await flush();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]![2], calls[0]![2], "replacement retry uses the same business request identity");
    assert.deepEqual(calls[1]![3], calls[0]![3], "replacement retry reuses the exact original input body");
    assert.equal(dom.window.sessionStorage.getItem(storageKey), null);
  } finally {
    flushSync(() => root.unmount());
    client.clear();
    dom.window.close();
    Object.assign(fulfillmentApi, original);
  }
};

const runStaleShipmentGuardBlocksWorkspace = async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver })) Object.defineProperty(globalThis, name, { configurable: true, value });
  const organizationId = "org-stale-guard", sessionScope = "scope-stale-guard", storageKey = `ph.v2.fulfillment.intent.v1:${organizationId}`;
  const payload = { shipmentId: "shipment-stale", expectedPreparedRevisionId: "revision-old" };
  const staleRequestId = "22222222-2222-4222-8222-222222222222";
  const staleIntent = { version: 1, organizationId, sessionScope, businessRequestId: staleRequestId, operation: "shipment-finalize", payload, bodyCanonical: canonicalFulfillmentIntentBody(organizationId, sessionScope, "shipment-finalize", staleRequestId, payload), recovery: "stale" };
  assert.equal(validateFulfillmentIntentRecord(staleIntent, organizationId, sessionScope), true);
  dom.window.sessionStorage.setItem(storageKey, JSON.stringify(staleIntent));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(["v2", sessionScope, organizationId, "fulfillment", "workspace", ""], { items: [shippingOrder] });
  client.setQueryData(["v2", sessionScope, organizationId, "fulfillment", "order", shippingOrder.orderId], shippingOrder);
  const replacement = { obligation: { replacementObligationId: "replacement-stale", orderId: shippingOrder.orderId, orderLineId: shippingOrder.lines[0]!.orderLineId, replacementQuantity: 1, reason: "print_defect", responsibility: "titan", billingTreatment: "no_charge", status: "production_complete" }, remainingProductionQuantity: 0, remainingFulfillmentQuantity: 1, availableFulfillmentQuantity: 1, billingPending: false, events: [] } as unknown as ReplacementFulfillmentProjection;
  client.setQueryData(["v2", sessionScope, organizationId, "fulfillment", "replacements", shippingOrder.orderId], [replacement]);
  const calls = { pickup: 0, replacementCreate: 0, replacementCancel: 0, replacementPickup: 0, shipmentCreate: 0, shipmentCorrect: 0, shipmentCancel: 0, shipmentFinalize: 0 };
  const original = { complete: fulfillmentApi.complete, createReplacement: fulfillmentApi.createReplacement, cancelReplacement: fulfillmentApi.cancelReplacement, pickupReplacement: fulfillmentApi.pickupReplacement, listShipments: fulfillmentApi.listShipments, createShipment: fulfillmentApi.createShipment, correctShipment: fulfillmentApi.correctShipment, cancelShipment: fulfillmentApi.cancelShipment, finalizeShipment: fulfillmentApi.finalizeShipment };
  const emptyDetail = { shipmentId: "shipment-stale", status: "prepared", carrier: { status: "prepared" }, createdAt: "2026-10-02T00:00:00.000Z", createdPrincipalSubject: "operator" } as FulfillmentShipmentDetail;
  Object.assign(fulfillmentApi, {
    complete: (async () => { calls.pickup += 1; return {}; }) as unknown as typeof fulfillmentApi.complete,
    createReplacement: (async () => { calls.replacementCreate += 1; return {}; }) as unknown as typeof fulfillmentApi.createReplacement,
    cancelReplacement: (async () => { calls.replacementCancel += 1; return {}; }) as unknown as typeof fulfillmentApi.cancelReplacement,
    pickupReplacement: (async () => { calls.replacementPickup += 1; return {}; }) as unknown as typeof fulfillmentApi.pickupReplacement,
    listShipments: (async () => [] as FulfillmentShipmentContainer[]),
    createShipment: (async () => { calls.shipmentCreate += 1; return emptyDetail; }) as typeof fulfillmentApi.createShipment,
    correctShipment: (async () => { calls.shipmentCorrect += 1; return emptyDetail; }) as typeof fulfillmentApi.correctShipment,
    cancelShipment: (async () => { calls.shipmentCancel += 1; return emptyDetail; }) as typeof fulfillmentApi.cancelShipment,
    finalizeShipment: (async () => { calls.shipmentFinalize += 1; return emptyDetail; }) as typeof fulfillmentApi.finalizeShipment,
  });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const flush = async () => { for (let index = 0; index < 3; index += 1) { await new Promise(resolve => setTimeout(resolve, 0)); flushSync(() => {}); } };
  const findButton = (label: string) => [...container.querySelectorAll("button")].find(button => button.textContent?.includes(label));
  try {
    flushSync(() => root.render(<QueryClientProvider client={client}><FulfillmentWorkspace organizationId={organizationId} sessionScope={sessionScope} canView canPickup canShip canReplace csrfReady orderId={shippingOrder.orderId} onSelectOrder={() => {}} openOrder={() => {}} openCustomer={() => {}} /></QueryClientProvider>)); await flush();
    assert.match(container.textContent ?? "", /shipment finalize request is retained/);
    assert.equal(findButton("Record partial pickup")?.disabled, true, "pending stale finalize blocks affected-order Pickup");
    const replacementButtons = [...container.querySelectorAll('[data-testid="replacement-obligations"] button')];
    assert.equal(replacementButtons.length > 0, true, "the replacement create action remains visible for the authorized operator");
    assert.equal((replacementButtons[0] as HTMLButtonElement).disabled, true, "pending stale finalize blocks replacement creation");
    const replacementPickup = [...container.querySelectorAll(".v2-fulfillment-replacement-pickup button")].find(button => /replacement pickup/i.test(button.textContent ?? ""));
    assert.equal((replacementPickup as HTMLButtonElement | undefined)?.disabled, true, "pending stale finalize blocks replacement Pickup for the affected order");
    flushSync(() => findButton("Create shipment")!.click()); await flush();
    assert.equal(findButton("Retry authoritative shipment reload")?.disabled, false, "only a read-only authoritative reload is available");
    assert.equal(findButton("Create prepared shipment")?.disabled, true);
    assert.deepEqual(calls, { pickup: 0, replacementCreate: 0, replacementCancel: 0, replacementPickup: 0, shipmentCreate: 0, shipmentCorrect: 0, shipmentCancel: 0, shipmentFinalize: 0 });
    assert.equal(dom.window.sessionStorage.getItem(storageKey), JSON.stringify(staleIntent), "the stale finalize identity remains preserved until a new revision is read");
  } finally {
    flushSync(() => root.unmount());
    client.clear();
    dom.window.close();
    Object.assign(fulfillmentApi, original);
  }
};

await runUnknownPickupRecovery();
await runUnknownReplacementRecovery();
await runStaleShipmentGuardBlocksWorkspace();
console.log("Fulfillment session fence, stale shipment side-effect guard, and exact operation replay tests passed.");
