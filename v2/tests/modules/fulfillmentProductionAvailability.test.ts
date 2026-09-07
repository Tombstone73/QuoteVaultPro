import assert from "node:assert/strict";
import { FulfillmentApplicationService, type FulfillmentTransaction, type FulfillmentTransactionRunner } from "../../src/modules/fulfillment/fulfillmentApplication.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { FulfillmentAvailability, FulfillmentHandoff, FulfillmentHandoffLine } from "../../src/modules/fulfillment/contracts.js";

const org=brandedId<"OrganizationId">("fulfillment-physical-output-org"),order=brandedId<"OrderId">("fulfillment-physical-output-order"),line=brandedId<"OrderLineId">("fulfillment-physical-output-line");
const available=(produced:number,fulfilled=0):FulfillmentAvailability=>({orderId:order,orderLineId:line,orderedQuantity:100,completedPickupQuantity:fulfilled,completedShipmentQuantity:0,completedFulfillmentQuantity:fulfilled,completedProductionQuantity:produced,productionRequired:true,availableFulfillmentQuantity:Math.max(0,produced-fulfilled),remainingProductionQuantity:100-produced,remainingFulfillmentQuantity:100-fulfilled});
const context=(requestId:string)=>({organizationId:org,operationId:`test:${requestId}`,businessRequest:{id:requestId,payloadFingerprint:`test:${requestId}`},principal:{kind:"staff" as const,organizationId:org,userId:"fulfillment-physical-output-user",authority:{membershipId:"fulfillment-physical-output-membership",capabilities:["fulfillment.view","fulfillment.pickup","fulfillment.ship"] as const}}});
const runner=(projection:FulfillmentAvailability):FulfillmentTransactionRunner=>({transaction:async action=>action({
 readAvailability:async()=>({availability:[projection]}),
 lockAvailability:async()=>({availability:[projection]}),
 reserve:async()=>({kind:"new",request:{id:"request",resultJson:null}}),
 succeed:async()=>undefined,attribute:async()=>undefined,audit:async()=>undefined,
 createHandoff:async()=>{throw Error("handoff must not be created when physical output is insufficient");},
 createAllocations:async()=>{throw Error("allocations must not be created when physical output is insufficient");},
} as unknown as FulfillmentTransaction)});

const noOutput=new FulfillmentApplicationService(runner(available(0)));
const zero=await noOutput.recordPickup(context("no-output"),{businessRequestId:"no-output",orderId:order,allocations:[{orderLineId:line,quantity:1}]});
assert.equal(zero.ok,false,"a handoff cannot consume an order line with no completed Production output");

const partialOutput=new FulfillmentApplicationService(runner(available(40)));
const beyondPartial=await partialOutput.recordShipment(context("beyond-partial"),{businessRequestId:"beyond-partial",orderId:order,allocations:[{orderLineId:line,quantity:41}]});
assert.equal(beyondPartial.ok,false,"a partial handoff cannot exceed the completed physical output");

const alreadyConsumed=new FulfillmentApplicationService(runner(available(40,40)));
const duplicateUnits=await alreadyConsumed.recordPickup(context("already-consumed"),{businessRequestId:"already-consumed",orderId:order,allocations:[{orderLineId:line,quantity:1}]});
assert.equal(duplicateUnits.ok,false,"previous immutable handoffs subtract from the physical availability ceiling");

const historicalAnomaly:FulfillmentAvailability={...available(0,1),availableFulfillmentQuantity:0,physicalIntegrityAnomaly:{code:"FULFILLMENT_HISTORY_EXCEEDS_RECORDED_PRODUCTION",completedProductionQuantity:0,completedFulfillmentQuantity:1,excessFulfillmentQuantity:1}};
const anomalous=new FulfillmentApplicationService(runner(historicalAnomaly));
const anomalyRead=await anomalous.getAvailability(context("historical-anomaly-read"),order);
assert.equal(anomalyRead.ok&&anomalyRead.value[0]?.physicalIntegrityAnomaly?.excessFulfillmentQuantity,1,"historical anomaly remains safely readable with its exact derived excess");
const anomalyPickup=await anomalous.recordPickup(context("historical-anomaly-pickup"),{businessRequestId:"historical-anomaly-pickup",orderId:order,allocations:[{orderLineId:line,quantity:1}]});
const anomalyShipment=await anomalous.recordShipment(context("historical-anomaly-shipment"),{businessRequestId:"historical-anomaly-shipment",orderId:order,allocations:[{orderLineId:line,quantity:1}]});
assert.equal(anomalyPickup.ok,false,"historical fulfilled-over-produced state remains readable but blocks a new pickup before any handoff write");
assert.equal(anomalyShipment.ok,false,"historical fulfilled-over-produced state remains readable but blocks a new shipment before any handoff write");

// A fulfillment-only line has no fabricated Production record, but it still
// uses the same immutable, quantity-bounded allocation authority.
const fulfillmentOnlyLine=brandedId<"OrderLineId">("fulfillment-only-line");
let pickupQuantity=0,shipmentQuantity=0,currentMethod:"pickup"|"shipment"="pickup",handoffSequence=0,reconciliations=0;
const requests=new Map<string,{id:string;resultJson:unknown|null}>();
const fulfillmentOnlyAvailability=():FulfillmentAvailability=>{
 const fulfilled=pickupQuantity+shipmentQuantity;
 return {orderId:order,orderLineId:fulfillmentOnlyLine,orderedQuantity:100,completedPickupQuantity:pickupQuantity,completedShipmentQuantity:shipmentQuantity,completedFulfillmentQuantity:fulfilled,completedProductionQuantity:0,productionRequired:false,availableFulfillmentQuantity:100-fulfilled,remainingProductionQuantity:0,remainingFulfillmentQuantity:100-fulfilled};
};
const fulfillmentOnlyRunner:FulfillmentTransactionRunner={transaction:async action=>action({
 readAvailability:async()=>({availability:[fulfillmentOnlyAvailability()]}),
 lockAvailability:async()=>({availability:[fulfillmentOnlyAvailability()]}),
 reserve:async input=>{const existing=requests.get(input.businessRequestId);if(existing?.resultJson)return {kind:"replay" as const,request:existing};const request=existing??{id:input.businessRequestId,resultJson:null};requests.set(input.businessRequestId,request);return {kind:"new" as const,request};},
 succeed:async(_org,requestId,result)=>{requests.get(requestId)!.resultJson=result;},attribute:async()=>undefined,audit:async()=>undefined,
 createHandoff:async input=>{currentMethod=input.method;handoffSequence+=1;return {handoffId:input.id,organizationId:input.organizationId,orderId:input.orderId,method:input.method,completedAt:`2026-09-07T00:00:0${handoffSequence}.000Z`,completedPrincipalKind:input.principalKind,completedPrincipalSubject:input.principalSubject,...(input.staffActorUserId?{completedStaffActorUserId:input.staffActorUserId}:{})} satisfies FulfillmentHandoff;},
 createAllocations:async input=>input.allocations.map(item=>{if(currentMethod==="pickup")pickupQuantity+=item.quantity;else shipmentQuantity+=item.quantity;return {handoffLineId:item.id,organizationId:input.organizationId,handoffId:input.handoffId,orderId:input.orderId,orderLineId:brandedId<"OrderLineId">(item.orderLineId),quantity:item.quantity} satisfies FulfillmentHandoffLine;}),
 writeDocumentSnapshot:async()=>undefined,
} as FulfillmentTransaction)};
const fulfillmentOnly=new FulfillmentApplicationService(fulfillmentOnlyRunner,undefined,{reconcileOrder:async()=>{reconciliations+=1;},reconcileInvoice:async()=>undefined});
const partialPickup=await fulfillmentOnly.recordPickup(context("fulfillment-only-pickup-40"),{businessRequestId:"fulfillment-only-pickup-40",orderId:order,allocations:[{orderLineId:fulfillmentOnlyLine,quantity:40}]});
const partialShipment=await fulfillmentOnly.recordShipment(context("fulfillment-only-shipment-35"),{businessRequestId:"fulfillment-only-shipment-35",orderId:order,allocations:[{orderLineId:fulfillmentOnlyLine,quantity:35}]});
const finalPickup=await fulfillmentOnly.recordPickup(context("fulfillment-only-pickup-25"),{businessRequestId:"fulfillment-only-pickup-25",orderId:order,allocations:[{orderLineId:fulfillmentOnlyLine,quantity:25}]});
const retryFinalPickup=await fulfillmentOnly.recordPickup(context("fulfillment-only-pickup-25"),{businessRequestId:"fulfillment-only-pickup-25",orderId:order,allocations:[{orderLineId:fulfillmentOnlyLine,quantity:25}]});
const overFulfillment=await fulfillmentOnly.recordShipment(context("fulfillment-only-over"),{businessRequestId:"fulfillment-only-over",orderId:order,allocations:[{orderLineId:fulfillmentOnlyLine,quantity:1}]});
assert.equal(partialPickup.ok&&partialPickup.value.availability[0]?.remainingFulfillmentQuantity,60,"partial pickup preserves the remaining commercial fulfillment quantity");
assert.equal(partialShipment.ok&&partialShipment.value.availability[0]?.remainingFulfillmentQuantity,25,"a shipment may follow a pickup against the same immutable line history");
assert.equal(finalPickup.ok&&finalPickup.value.availability[0]?.remainingFulfillmentQuantity,0,"multiple fulfillment events satisfy the line only at the full allocated quantity");
assert.equal(retryFinalPickup.ok,true,"a duplicate business request replays its immutable fulfillment result");
assert.equal(pickupQuantity,65,"an idempotent retry cannot allocate pickup quantity twice");
assert.equal(shipmentQuantity,35,"mixed pickup and shipment allocations remain independently traceable");
assert.equal(overFulfillment.ok,false,"a later stale action cannot over-allocate a fully fulfilled line");
assert.equal(reconciliations,4,"every accepted or replayed terminal command asks Sales to recompute the Order lifecycle without Fulfillment closing it directly");
console.log("[m7.5G] Fulfillment Production availability guard tests passed (14 assertions).");
