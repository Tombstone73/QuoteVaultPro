import assert from "node:assert/strict";
import { ShippingEconomicsApplicationService, type ShippingEconomicsPort } from "../../src/modules/fulfillment/shippingEconomicsApplication.js";

let shipment:any={shipmentId:"shipment",customerId:"customer",estimatedCarrierCostCents:9999,customerPriceFrozen:false};
let policies:any={organizationDefault:{mode:"percent",percentageBasisPoints:1250,currency:"USD",version:1}};
const port:ShippingEconomicsPort={
  policy:async()=>policies,
  savePolicy:async()=>policies,
  shipment:async()=>shipment,
  setEstimated:async()=>shipment,
  setActual:async()=>({...shipment,actualCarrierCostCents:25_000}),
  freezeCustomerPrice:async input=>{shipment={...shipment,customerShippingPriceCents:input.customerShippingPriceCents,customerPriceFrozen:true,pricingPolicySnapshot:input.snapshot};return shipment;},
};
const service=new ShippingEconomicsApplicationService({transaction:async work=>work(port)});
const staff=(caps:string[])=>({organizationId:"org",operationId:"test",principal:{kind:"staff",organizationId:"org",userId:"staff",authority:{membershipId:"membership",capabilities:caps}}} as any);
const first=await service.establishCustomerPrice(staff(["fulfillment.shipping.price"]),{shipmentId:"shipment"});
assert.equal(first.customerShippingPriceCents,11_249,"estimated cost plus percentage uses deterministic integer-cent pricing");
assert.equal(first.pricingPolicySnapshot.source,"organization_default");
const frozen=first.customerShippingPriceCents; shipment={...shipment,actualCarrierCostCents:25_000}; policies={organizationDefault:{mode:"flat",flatAmountCents:500,currency:"USD",version:2}};
assert.equal(shipment.customerShippingPriceCents,frozen,"later actual cost does not reprice customer");
await assert.rejects(()=>service.establishCustomerPrice(staff(["fulfillment.shipping.price"]),{shipmentId:"shipment"}),/already frozen/,"policy changes do not reprice frozen shipment");
await assert.rejects(()=>service.setEstimatedCost(staff(["fulfillment.shipping.price"]),{shipmentId:"shipment",estimatedCarrierCostCents:100}),/staff-only/,"pricing authority cannot mutate carrier costs");
await assert.rejects(()=>service.establishCustomerPrice(staff(["fulfillment.shipping.cost"]),{shipmentId:"shipment"}),/staff-only/,"cost authority cannot establish a customer price");
await assert.rejects(()=>service.setEstimatedCost({organizationId:"org",operationId:"test",principal:{kind:"portal",organizationId:"org",customerId:"customer",contactId:"contact",authority:{membershipId:"portal",capabilities:["fulfillment.shipping.cost"]}}} as any,{shipmentId:"shipment",estimatedCarrierCostCents:100}),/staff-only/,"portal cannot mutate internal shipping economics");
console.log("shipping economics freeze and authority rules passed.");
