import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { FulfillmentWorkspace } from "./FulfillmentWorkspace";

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
console.log("Fulfillment integrity-anomaly presentation tests passed.");
