import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { FulfillmentWorkspace } from "./FulfillmentWorkspace";

const order = {
  orderId: "order-r", number: "ORD-R", commercialState: "open" as const, customerName: "Replacement Customer",
  lines: [{ orderId: "order-r", orderLineId: "line-r", description: "Replacement Banner", orderedQuantity: 5, completedPickupQuantity: 5, completedShipmentQuantity: 0, completedFulfillmentQuantity: 5, completedProductionQuantity: 5, productionRequired: true, availableFulfillmentQuantity: 0, remainingProductionQuantity: 0, remainingFulfillmentQuantity: 0 }],
  handoffs: [
    { handoff: { handoffId: "original-pickup", method: "pickup" as const, completedAt: "2026-09-29T12:00:00.000Z", completedPrincipalSubject: "operator" }, allocations: [{ orderLineId: "line-r", quantity: 5 }] },
    { handoff: { handoffId: "replacement-pickup", method: "pickup" as const, completedAt: "2026-09-29T13:00:00.000Z", completedPrincipalSubject: "operator", replacementObligationId: "replacement-complete" }, allocations: [{ orderLineId: "line-r", quantity: 1 }] },
  ],
};

const render = (replacements: readonly unknown[], canPickup = true) => {
  const client = new QueryClient();
  client.setQueryData(["v2", "scope-r", "org-r", "fulfillment", "workspace", ""], { items: [order] });
  client.setQueryData(["v2", "scope-r", "org-r", "fulfillment", "order", "order-r"], order);
  client.setQueryData(["v2", "scope-r", "org-r", "fulfillment", "replacements", "order-r"], replacements);
  return renderToStaticMarkup(<QueryClientProvider client={client}><FulfillmentWorkspace organizationId="org-r" sessionScope="scope-r" canView canPickup={canPickup} canShip canReplace canInvoiceView csrfReady orderId="order-r" onSelectOrder={() => {}} openOrder={() => {}} openCustomer={() => {}} openInvoice={() => {}} /></QueryClientProvider>);
};

const actionableReplacements = [
  { obligation: { replacementObligationId: "replacement-r", orderId: "order-r", orderLineId: "line-r", replacementQuantity: 2, reason: "transit_damage", responsibility: "carrier", billingTreatment: "no_charge", status: "production_complete" }, remainingProductionQuantity: 0, remainingFulfillmentQuantity: 2, billingPending: false },
  { obligation: { replacementObligationId: "replacement-billable", orderId: "order-r", orderLineId: "line-r", replacementQuantity: 2, reason: "transit_damage", responsibility: "carrier", billingTreatment: "billable", status: "open" }, remainingProductionQuantity: 2, remainingFulfillmentQuantity: 2, billingPending: false, billingInvoice: { invoiceId: "invoice-r", invoiceNumber: "ORD-R-B", lifecycle: "draft", currency: "USD", totalCents: 1250 } },
];
const actionable = render(actionableReplacements);
assert.match(actionable, /Replacement Pickup/);
assert.match(actionable, /0\/2 fulfilled · 2 available/);
assert.match(actionable, /Record Replacement Pickup/);
assert.match(actionable, /Replacement pickup quantity for Replacement Banner/);
assert.match(actionable, /Invoice ORD-R-B · draft/);
assert.match(actionable, /Open Invoice ORD-R-B/);
assert.match(actionable, /Replacement pickup/);
assert.match(actionable, /Replacement fulfillment/);
assert.match(actionable, /Create replacement/);

const unauthorized = render(actionableReplacements, false);
assert.doesNotMatch(unauthorized, /Record Replacement Pickup/);

const fulfilled = render([
  { obligation: { replacementObligationId: "replacement-complete", orderId: "order-r", orderLineId: "line-r", replacementQuantity: 2, reason: "transit_damage", responsibility: "carrier", billingTreatment: "no_charge", status: "fulfilled" }, remainingProductionQuantity: 0, remainingFulfillmentQuantity: 0, billingPending: false },
]);
assert.doesNotMatch(fulfilled, /Record Replacement Pickup/);
console.log("replacement obligation pickup presentation tests passed.");
