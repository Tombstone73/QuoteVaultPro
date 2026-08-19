import assert from "node:assert/strict";
import { productionCompletion } from "../../src/modules/production/productionCompletion.js";
import { fulfillmentCompletion } from "../../src/modules/fulfillment/fulfillmentCompletion.js";

assert.equal(productionCompletion({requiredUnitCount:2,openedUnitCount:0,completedUnitCount:0}).state,"not_started","Production work presence is required.");
assert.equal(productionCompletion({requiredUnitCount:2,openedUnitCount:2,completedUnitCount:1}).state,"in_progress","Partial completed output cannot complete Production.");
assert.equal(productionCompletion({requiredUnitCount:2,openedUnitCount:2,completedUnitCount:2}).state,"complete","Each frozen unit needs canonical completed output.");
assert.equal(productionCompletion({requiredUnitCount:0,openedUnitCount:0,completedUnitCount:0}).state,"blocked","Missing requirements are never treated as complete.");
assert.equal(fulfillmentCompletion({orderedQuantity:10,completedQuantity:4}).state,"incomplete","Partial handoffs remain useful but cannot complete the Route.");
assert.equal(fulfillmentCompletion({orderedQuantity:10,completedQuantity:10}).state,"complete","Immutable completed pickup/shipment allocations complete the Route only at ordered quantity.");
assert.equal(fulfillmentCompletion({orderedQuantity:10,completedQuantity:11}).state,"complete","The projection does not double-count or reject existing authoritative allocations.");
console.log("[routing] operational completion contract tests passed (7 assertions).");
