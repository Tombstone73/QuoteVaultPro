import assert from "node:assert/strict";
import { FulfillmentApplicationService, type FulfillmentTransaction, type FulfillmentTransactionRunner } from "../../src/modules/fulfillment/fulfillmentApplication.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { FulfillmentAvailability } from "../../src/modules/fulfillment/contracts.js";

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
console.log("[m6] Fulfillment Production availability guard tests passed (6 assertions).");
