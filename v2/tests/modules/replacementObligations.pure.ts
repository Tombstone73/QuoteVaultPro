import assert from "node:assert/strict";
import { replacementReasons, validReplacementInput } from "../../src/modules/fulfillment/replacementObligations.js";
import { replacementRemainingQuantity } from "../../src/modules/fulfillment/replacementShippingEconomics.js";

assert.deepEqual(replacementReasons, ["production_delay","print_defect","finishing_defect","wrong_material","transit_damage","lost_in_transit","customer_rejection","customer_change","internal_shipping_error","carrier_issue","other"]);
const base = { businessRequestId:"replacement-1",orderId:"order-1" as any,orderLineId:"line-1" as any,replacementQuantity:2,reason:"transit_damage" as const,responsibility:"carrier" as const,billingTreatment:"no_charge" as const };
assert.equal(validReplacementInput(base),true,"positive structured replacement requests are valid");
assert.equal(validReplacementInput({...base,replacementQuantity:0}),false,"zero quantity fails closed");
assert.equal(validReplacementInput({...base,reason:"free-form" as any}),false,"unstructured reasons fail closed");
assert.deepEqual(replacementRemainingQuantity(2,2,0),{remainingProductionQuantity:0,remainingFulfillmentQuantity:2,satisfied:false},"accepted output creates fulfillment authority without rewriting original fulfillment");
assert.deepEqual(replacementRemainingQuantity(2,2,2),{remainingProductionQuantity:0,remainingFulfillmentQuantity:0,satisfied:true},"only replacement fulfillment closes the obligation");
console.log("replacement obligations: OK");
