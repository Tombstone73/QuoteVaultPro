import assert from "node:assert/strict";
import { reconciledOrderState } from "../../src/modules/sales/orderAutomaticLifecycle.js";
import { orderCompletionEligibility, type OrderCompletionLineEvidence } from "../../src/modules/sales/orderLifecycle.js";

const standard = (overrides: Partial<OrderCompletionLineEvidence> = {}): OrderCompletionLineEvidence => ({
  orderLineId: "line-a", description: "Printed item", workflowIntent: "standard_production",
  requiresProduction: true, orderedQuantity: 10, productionComplete: true, fulfilledQuantity: 10, routeComplete: true, ...overrides,
});
const ready = orderCompletionEligibility([standard()]);
const productionOpen = orderCompletionEligibility([standard({ productionComplete: false })]);
const fulfillmentOpen = orderCompletionEligibility([standard({ fulfilledQuantity: 9 })]);

assert.equal(reconciledOrderState("open", ready, true), "completed", "production + fulfillment + settlement auto-close");
assert.equal(reconciledOrderState("open", ready, false), "open", "an unpaid or partial Invoice remains open");
assert.equal(reconciledOrderState("open", productionOpen, true), "open", "incomplete production remains open");
assert.equal(reconciledOrderState("open", fulfillmentOpen, true), "open", "incomplete fulfillment remains open");
assert.equal(reconciledOrderState("completed", ready, false), "open", "a refund or price revision reopens a closed Order");
assert.equal(reconciledOrderState("completed", productionOpen, true), "open", "new production obligations reopen a closed Order");
assert.equal(reconciledOrderState("cancelled", ready, true), "cancelled", "cancelled Orders remain distinct from derived closure");
assert.equal(reconciledOrderState("completed", ready, true), "completed", "repeated reconciliation is idempotent");

console.log("Automatic Order lifecycle policy tests passed.");
