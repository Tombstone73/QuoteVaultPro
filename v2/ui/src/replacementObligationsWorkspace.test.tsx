import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { FulfillmentWorkspace } from "./FulfillmentWorkspace";

const order = { orderId:"order-r",number:"ORD-R",commercialState:"open" as const,customerName:"Replacement Customer",lines:[{orderId:"order-r",orderLineId:"line-r",description:"Replacement Banner",orderedQuantity:5,completedPickupQuantity:5,completedShipmentQuantity:0,completedFulfillmentQuantity:5,completedProductionQuantity:5,productionRequired:true,availableFulfillmentQuantity:0,remainingProductionQuantity:0,remainingFulfillmentQuantity:0}],handoffs:[] };
const client = new QueryClient();
client.setQueryData(["v2","scope-r","org-r","fulfillment","workspace",""],{items:[order]});
client.setQueryData(["v2","scope-r","org-r","fulfillment","order","order-r"],order);
client.setQueryData(["v2","scope-r","org-r","fulfillment","replacements","order-r"],[{obligation:{replacementObligationId:"replacement-r",orderId:"order-r",orderLineId:"line-r",replacementQuantity:2,reason:"transit_damage",responsibility:"carrier",billingTreatment:"billable",status:"open"},remainingProductionQuantity:2,remainingFulfillmentQuantity:2,billingPending:true}]);
const markup = renderToStaticMarkup(<QueryClientProvider client={client}><FulfillmentWorkspace organizationId="org-r" sessionScope="scope-r" canView canPickup canShip canReplace csrfReady orderId="order-r" onSelectOrder={()=>{}} openOrder={()=>{}} openCustomer={()=>{}} /></QueryClientProvider>);
assert.match(markup,/Replacement obligations/);
assert.match(markup,/Billable — Invoice pending/);
assert.match(markup,/Production remaining 2 · Fulfillment remaining 2/);
assert.match(markup,/Create replacement/);
console.log("replacement obligation staff workspace presentation tests passed.");
