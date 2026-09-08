import assert from "node:assert/strict";
import { fulfillmentWorkspacePhysicalLinePredicate } from "../../infrastructure/fulfillment/postgresFulfillmentWorkspaceReads.js";
import { fulfillmentSupplyQuantity } from "../../src/modules/fulfillment/contracts.js";
import { orderCompletionEligibility } from "../../src/modules/sales/orderLifecycle.js";

assert.match(fulfillmentWorkspacePhysicalLinePredicate, /IS DISTINCT FROM 'service_fee'/);
assert.equal(
  fulfillmentSupplyQuantity({ orderedQuantity: 1, completedProductionQuantity: 0, productionRequired: false, workflowIntent: "service_fee" }),
  0,
  "a service fee has no physical fulfillment supply",
);
assert.equal(
  orderCompletionEligibility([{ orderLineId: "fee", description: "Service fee", workflowIntent: "service_fee", requiresProduction: false, orderedQuantity: 1, productionComplete: false, fulfilledQuantity: 0, routeComplete: false }]).eligible,
  true,
  "a service fee has no fulfillment or production completion obligation",
);
console.log("Fulfillment service-fee workspace projection tests passed.");
