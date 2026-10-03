import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { fulfillmentApi, type FulfillmentShipmentContainer, type FulfillmentShipmentDetail, type FulfillmentShipmentDraftAllocationInput, type FulfillmentWorkspaceOrder, type ReplacementObligationProjection } from "./api";
import { ShipmentBuilder, canonicalFulfillmentIntentBody, groupShipmentAllocations, shipmentQuantityValid, validateFulfillmentIntentRecord } from "./ShipmentBuilder";

assert.equal(shipmentQuantityValid("20", 60), true);
assert.equal(shipmentQuantityValid("61", 60), false, "operator UI does not submit beyond the server-reported available quantity");
assert.equal(shipmentQuantityValid("0", 60), false);
assert.equal(shipmentQuantityValid("1.5", 60), false);
const groups = groupShipmentAllocations([
  { orderId: "order-a", orderLineId: "line-a", quantity: "20" },
  { orderId: "order-a", orderLineId: "line-b", quantity: "5" },
  { orderId: "order-b", orderLineId: "line-c", quantity: "7" },
]);
assert.deepEqual(groups, [
  { orderId: "order-a", orderLineId: "line-a", quantity: 20 },
  { orderId: "order-a", orderLineId: "line-b", quantity: 5 },
  { orderId: "order-b", orderLineId: "line-c", quantity: 7 },
]);

const order: FulfillmentWorkspaceOrder = { orderId: "order-a", number: "ORD-100", commercialState: "open", customerName: "Customer A", customerId: "customer-a", requestedFulfillment: { method: "shipping", destination: { addressLine1: "1 Print Way", city: "Tampa" } }, lines: [{ orderId: "order-a", orderLineId: "line-a", description: "Banner", orderedQuantity: 60, completedPickupQuantity: 0, completedShipmentQuantity: 0, completedFulfillmentQuantity: 0, completedProductionQuantity: 60, availableFulfillmentQuantity: 60, remainingProductionQuantity: 0, remainingFulfillmentQuantity: 60 }], handoffs: [] };
const markup = renderToStaticMarkup(<ShipmentBuilder organizationId="org-a" sessionScope="scope-a" csrfReady canShip refresh={async () => {}} orders={[order]} />);
assert.match(markup, /Create shipment/);
assert.match(markup, /server owns allocations, compatibility, and quantity validation/i);
assert.doesNotMatch(markup, /Record selected allocations/);
assert.doesNotMatch(markup, /Mark shipped/);
assert.doesNotMatch(markup, /carrier API/i);

const requestId = "11111111-1111-4111-8111-111111111111";
const allocation = [{ orderId: "order-a", orderLineId: "line-a", quantity: 1 }];
const allocations = [allocation[0]!];
const validIntentPayloads = [
  ["fulfillment-pickup", { orderId: "order-a", method: "pickup", orderLineId: "line-a", quantity: 1 }],
  ["replacement-create", { orderId: "order-a", input: { orderLineId: "line-a", replacementQuantity: 1, reason: "print_defect", responsibility: "titan", billingTreatment: "no_charge" } }],
  ["replacement-cancel", { replacementObligationId: "replacement-a" }],
  ["replacement-pickup", { orderId: "order-a", input: { replacementObligationId: "replacement-a", orderLineId: "line-a", quantity: 1 } }],
  ["shipment-create", { input: { allocations } }],
  ["shipment-correct", { shipmentId: "shipment-a", input: { allocations, reason: "owner correction" } }],
  ["shipment-cancel", { shipmentId: "shipment-a", reason: "operator cancellation" }],
  ["shipment-finalize", { shipmentId: "shipment-a", expectedPreparedRevisionId: "revision-a" }],
] as const;
const storedIntent = (operation: string, payload: unknown, recovery: "retry" | "stale" = "retry") => ({
  version: 1, organizationId: "org-schema", sessionScope: "scope-schema", businessRequestId: requestId, operation, payload,
  bodyCanonical: canonicalFulfillmentIntentBody("org-schema", "scope-schema", operation, requestId, payload), recovery,
});
for (const [operation, payload] of validIntentPayloads) {
  const valid = storedIntent(operation, payload);
  assert.equal(validateFulfillmentIntentRecord(valid, "org-schema", "scope-schema"), true, `${operation} valid persisted payload is accepted`);
  const empty = storedIntent(operation, {}, "retry");
  assert.equal(validateFulfillmentIntentRecord(empty, "org-schema", "scope-schema"), false, `${operation} empty payload is rejected`);
}
assert.equal(validateFulfillmentIntentRecord(storedIntent("shipment-finalize", {}), "org-schema", "scope-schema"), false, "a valid-JSON finalize record with an empty payload is rejected");
assert.equal(validateFulfillmentIntentRecord(storedIntent("shipment-finalize", validIntentPayloads[7]![1], "stale"), "org-schema", "scope-schema"), true, "only a valid finalize command can carry stale-reload recovery state");
assert.equal(validateFulfillmentIntentRecord(storedIntent("shipment-create", validIntentPayloads[4]![1], "stale"), "org-schema", "scope-schema"), false, "stale-reload state is rejected for non-finalize operations");
assert.equal(validateFulfillmentIntentRecord({ ...storedIntent("shipment-finalize", validIntentPayloads[7]![1]), businessRequestId: "not-a-request-id" }, "org-schema", "scope-schema"), false, "malformed request IDs are rejected");
assert.equal(validateFulfillmentIntentRecord({ ...storedIntent("shipment-finalize", validIntentPayloads[7]![1]), businessRequestId: "33333333-3333-4333-8333-333333333333" }, "org-schema", "scope-schema"), false, "request identity is bound into the canonical command body");
assert.equal(validateFulfillmentIntentRecord({ ...storedIntent("shipment-finalize", validIntentPayloads[7]![1]), bodyCanonical: "{}" }, "org-schema", "scope-schema"), false, "non-canonical stored bodies are rejected");
assert.equal(validateFulfillmentIntentRecord(storedIntent("shipment-finalize", validIntentPayloads[7]![1]), "org-other", "scope-schema"), false, "storage-key tenant mismatch is rejected");
assert.equal(validateFulfillmentIntentRecord(storedIntent("shipment-finalize", validIntentPayloads[7]![1]), "org-schema", "scope-other"), false, "session-scope mismatch is rejected");
assert.equal(validateFulfillmentIntentRecord(storedIntent("unknown-operation", {}), "org-schema", "scope-schema"), false, "unknown operation discriminators are rejected");
assert.equal(validateFulfillmentIntentRecord(storedIntent("shipment-create", { input: { allocations: [] } }), "org-schema", "scope-schema"), false, "empty shipment allocation arrays are rejected");
assert.equal(validateFulfillmentIntentRecord(storedIntent("shipment-create", { input: { allocations: [{ orderId: "order-a", orderLineId: "line-a", quantity: 0 }] } }), "org-schema", "scope-schema"), false, "nonpositive shipment allocation quantities are rejected");
assert.equal(validateFulfillmentIntentRecord(storedIntent("shipment-create", { input: { allocations, carrier: { packageCount: 0 } } }), "org-schema", "scope-schema"), false, "invalid carrier values are rejected");
assert.equal(validateFulfillmentIntentRecord(storedIntent("shipment-correct", { shipmentId: "shipment-a", input: { allocations, reason: "" } }), "org-schema", "scope-schema"), false, "correction reason is required");

const detail = (revisionId: string, revisionNumber: number, allocations: readonly FulfillmentShipmentDraftAllocationInput[]) => ({
  shipmentId: "shipment-a", status: "prepared" as const, customerId: "customer-a", destination: order.requestedFulfillment?.destination,
  carrier: { status: "prepared" as const, carrierName: "Manual carrier" }, createdAt: "2026-09-01T00:00:00.000Z", createdPrincipalSubject: "operator-a", preparedRevisionId: revisionId,
  currentPreparedRevision: { revisionId, revisionNumber, kind: revisionNumber === 1 ? "initial" as const : "correction" as const, allocations, carrier: { status: "prepared" as const, carrierName: "Manual carrier" } },
  events: [{ type: "prepared" as const, sequenceNumber: revisionNumber }],
}) as FulfillmentShipmentDetail;

const runPreparedRevisionInteraction = async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver })) Object.defineProperty(globalThis, name, { configurable: true, value });
  const container = dom.window.document.getElementById("root")!;
  let detailReads = 0;
  const sideEffects = { create: 0, correct: 0, cancel: 0, finalize: 0 };
  const original = { listShipments: fulfillmentApi.listShipments, getShipment: fulfillmentApi.getShipment, createShipment: fulfillmentApi.createShipment, correctShipment: fulfillmentApi.correctShipment, cancelShipment: fulfillmentApi.cancelShipment, finalizeShipment: fulfillmentApi.finalizeShipment };
  const replacement: ReplacementObligationProjection = { obligation: { replacementObligationId: "replacement-b", orderId: "order-b", orderLineId: "line-unloaded", replacementQuantity: 3, reason: "print_defect", responsibility: "titan", billingTreatment: "no_charge", status: "production_complete" }, remainingProductionQuantity: 0, remainingFulfillmentQuantity: 3, billingPending: false };
  const initial = detail("revision-1", 1, [{ orderId: "order-a", orderLineId: "line-a", quantity: 2 }, { orderId: "order-b", orderLineId: "line-unloaded", quantity: 3, replacementObligationId: "replacement-b" }]);
  const latest = detail("revision-2", 2, [{ orderId: "order-a", orderLineId: "line-a", quantity: 2 }, { orderId: "order-b", orderLineId: "line-unloaded", quantity: 3, replacementObligationId: "replacement-b" }]);
  Object.assign(fulfillmentApi, {
    listShipments: async () => [{ shipmentId: "shipment-a", status: "prepared", carrier: { status: "prepared", carrierName: "Manual carrier" } }] as FulfillmentShipmentContainer[],
    getShipment: async () => { detailReads += 1; if (detailReads === 1) return initial; if (detailReads === 2) throw new TypeError("shipment detail reload unavailable"); return latest; },
    createShipment: async () => { sideEffects.create += 1; return initial; },
    correctShipment: async () => { sideEffects.correct += 1; return initial; },
    cancelShipment: async () => { sideEffects.cancel += 1; return initial; },
    finalizeShipment: async () => { sideEffects.finalize += 1; throw Object.assign(new Error("The prepared shipment revision is stale. Refresh before finalizing."), { code: "VALIDATION_ERROR" }); },
  });
  const root = createRoot(container);
  const flush = async () => { for (let index = 0; index < 3; index += 1) { await new Promise(resolve => setTimeout(resolve, 0)); flushSync(() => {}); } };
  try {
    flushSync(() => root.render(<ShipmentBuilder organizationId="org-a" sessionScope="scope-a" csrfReady canShip canReplace replacementCandidates={[replacement]} refresh={async () => {}} orders={[order]} />));
    await flush();
    const findButton = (label: string) => [...container.querySelectorAll("button")].find(button => button.textContent?.includes(label));
    flushSync(() => findButton("Create shipment")!.click()); await flush();
    flushSync(() => findButton("shipment-a")!.click()); await flush();
    assert.match(container.textContent ?? "", /revision-1/);
    assert.match(container.textContent ?? "", /2 saved allocations/);
    assert.match(container.textContent ?? "", /order-b \/ line-unloaded · quantity 3 · replacement replacement-b/);
    const finalize = findButton("Mark shipped")!;
    assert.equal(finalize.disabled, false, "the untouched persisted revision remains finalizable");
    const selectedLine = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    flushSync(() => selectedLine.click()); await flush();
    assert.equal(findButton("Mark shipped")!.disabled, true, "dirty allocation edits cannot finalize the stored revision");
    flushSync(() => findButton("Discard local edits")!.click()); await flush();
    assert.equal(findButton("Mark shipped")!.disabled, false);
    flushSync(() => findButton("Mark shipped")!.click()); await flush();
    assert.match(container.textContent ?? "", /Latest shipment detail could not be loaded/);
    assert.ok(findButton("Retry authoritative shipment reload"), "failed detail GET leaves a visible recovery action");
    const stored = JSON.parse(dom.window.sessionStorage.getItem("ph.v2.fulfillment.intent.v1:org-a") ?? "null");
    assert.equal(stored.operation, "shipment-finalize");
    assert.equal(stored.recovery, "stale", "stale CAS is retained as reload-required, not settled as success");
    assert.equal(findButton("Mark shipped")!.disabled, true);
    assert.equal(findButton("Save correction")!.disabled, true);
    assert.equal(findButton("Void prepared shipment")!.disabled, true);
    assert.equal(findButton("Start a new prepared shipment")!.disabled, true);
    for (const label of ["Mark shipped", "Save correction", "Void prepared shipment", "Start a new prepared shipment"]) findButton(label)!.click();
    assert.deepEqual(sideEffects, { create: 0, correct: 0, cancel: 0, finalize: 1 }, "no physical side effect can run while authoritative reload is unresolved");
    flushSync(() => findButton("Retry authoritative shipment reload")!.click()); await flush();
    assert.equal(detailReads, 3);
    assert.match(container.textContent ?? "", /Prepared revision 2 \(revision-2\) is loaded/);
    assert.match(container.textContent ?? "", /2 saved allocations/);
    assert.equal(findButton("Mark shipped")!.disabled, false, "a different authoritative revision clears the stale guard");
    assert.equal(dom.window.sessionStorage.getItem("ph.v2.fulfillment.intent.v1:org-a"), null);
    assert.deepEqual(sideEffects, { create: 0, correct: 0, cancel: 0, finalize: 1 });
  } finally {
    flushSync(() => root.unmount());
    dom.window.close();
    Object.assign(fulfillmentApi, original);
  }
};

const runCorruptIntentFailsClosed = async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver })) Object.defineProperty(globalThis, name, { configurable: true, value });
  const organizationId = "org-corrupt", sessionScope = "scope-corrupt", storageKey = `ph.v2.fulfillment.intent.v1:${organizationId}`;
  const corrupt = JSON.stringify({ version: 1, organizationId, sessionScope, businessRequestId: requestId, operation: "shipment-finalize", payload: {}, bodyCanonical: "{}", recovery: "retry" });
  dom.window.sessionStorage.setItem(storageKey, corrupt);
  dom.window.confirm = () => true;
  const sideEffects = { create: 0, correct: 0, cancel: 0, finalize: 0 };
  let ownerReads = 0;
  const original = { listShipments: fulfillmentApi.listShipments, createShipment: fulfillmentApi.createShipment, correctShipment: fulfillmentApi.correctShipment, cancelShipment: fulfillmentApi.cancelShipment, finalizeShipment: fulfillmentApi.finalizeShipment };
  Object.assign(fulfillmentApi, {
    listShipments: async () => { ownerReads += 1; return [] as FulfillmentShipmentContainer[]; },
    createShipment: async () => { sideEffects.create += 1; return detail("revision-1", 1, [{ orderId: "order-a", orderLineId: "line-a", quantity: 1 }]); },
    correctShipment: async () => { sideEffects.correct += 1; return detail("revision-1", 1, [{ orderId: "order-a", orderLineId: "line-a", quantity: 1 }]); },
    cancelShipment: async () => { sideEffects.cancel += 1; return detail("revision-1", 1, [{ orderId: "order-a", orderLineId: "line-a", quantity: 1 }]); },
    finalizeShipment: async () => { sideEffects.finalize += 1; return detail("revision-1", 1, [{ orderId: "order-a", orderLineId: "line-a", quantity: 1 }]); },
  });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const flush = async () => { for (let index = 0; index < 3; index += 1) { await new Promise(resolve => setTimeout(resolve, 0)); flushSync(() => {}); } };
  const findButton = (label: string) => [...container.querySelectorAll("button")].find(button => button.textContent?.includes(label));
  try {
    flushSync(() => root.render(<ShipmentBuilder organizationId={organizationId} sessionScope={sessionScope} csrfReady canShip refresh={async () => {}} orders={[order]} />)); await flush();
    flushSync(() => findButton("Create shipment")!.click()); await flush();
    assert.match(container.textContent ?? "", /operation-specific validation/);
    assert.equal(findButton("Retry exact saved shipment request"), undefined);
    assert.equal(findButton("Create prepared shipment")!.disabled, true);
    assert.equal(ownerReads, 0, "malformed storage does not automatically issue a retry or owner read");
    flushSync(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    assert.equal(findButton("Create prepared shipment")!.disabled, true, "corrupt storage prevents minting a replacement command even with a selected line");
    flushSync(() => findButton("Refresh owner shipment records")!.click()); await flush();
    assert.equal(ownerReads, 1, "owner reads happen only after explicit recovery refresh");
    assert.equal(dom.window.sessionStorage.getItem(storageKey), corrupt, "unknown request bodies are preserved for operator recovery");
    assert.deepEqual(sideEffects, { create: 0, correct: 0, cancel: 0, finalize: 0 });
    assert.ok(findButton("Resolve after authoritative owner verification"));
    flushSync(() => findButton("Resolve after authoritative owner verification")!.click()); await flush();
    assert.equal(dom.window.sessionStorage.getItem(storageKey), null, "only the explicit owner-verified resolution clears malformed storage");
    flushSync(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await flush();
    assert.equal(findButton("Create prepared shipment")!.disabled, false, "a new intent is enabled only after refresh and explicit resolution");
    assert.deepEqual(sideEffects, { create: 0, correct: 0, cancel: 0, finalize: 0 }, "operator resolution does not send a replacement request automatically");
  } finally {
    flushSync(() => root.unmount());
    dom.window.close();
    Object.assign(fulfillmentApi, original);
  }
};

await runPreparedRevisionInteraction();
await runCorruptIntentFailsClosed();
console.log("Shipment builder revision reload guard, intent schema, and corrupt-storage tests passed.");
