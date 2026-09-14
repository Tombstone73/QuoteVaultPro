import assert from "node:assert/strict";
import { absorbedFreightCents, assertShippingAllocations, equalShippingAllocation, replacementRemainingQuantity, shippingCustomerPrice } from "../../src/modules/fulfillment/replacementShippingEconomics.js";

const orgPolicy = { mode: "pass_through", currency: "USD", version: 1 } as const;
assert.equal(shippingCustomerPrice({ estimatedCarrierCostCents: 1_500, policy: orgPolicy }), 1_500);
assert.equal(shippingCustomerPrice({ estimatedCarrierCostCents: 1_500, policy: { mode: "flat", flatAmountCents: 250, currency: "USD", version: 2 } }), 1_750);
assert.equal(shippingCustomerPrice({ estimatedCarrierCostCents: 1_500, policy: { mode: "percent", percentageBasisPoints: 1_000, currency: "USD", version: 3 } }), 1_650);
assert.equal(shippingCustomerPrice({ estimatedCarrierCostCents: 1_500, policy: { mode: "no_charge", currency: "USD", version: 4 } }), 0);
assert.equal(shippingCustomerPrice({ estimatedCarrierCostCents: 1_500, policy: { mode: "manual", currency: "USD", version: 5 }, manualCustomerPriceCents: 321 }), 321);

const split = equalShippingAllocation(10_000, ["6789", "1235", "12902"]);
assert.deepEqual([...split], [["1235", 3334], ["12902", 3333], ["6789", 3333]]);
assert.deepEqual([...equalShippingAllocation(2, ["200", "100", "300"])], [["100", 1], ["200", 1], ["300", 0]], "penny remainder is deterministic and zero-share Orders remain represented");
assertShippingAllocations(10_000, [...split].map(([orderId, customerShippingPriceCents]) => ({ orderId, customerShippingPriceCents })));
assert.throws(() => assertShippingAllocations(10_000, [{ orderId: "1235", customerShippingPriceCents: 9_999 }]));
assert.equal(absorbedFreightCents(8_000, 2_000), 6_000);

assert.deepEqual(replacementRemainingQuantity(100, 0, 0), { remainingProductionQuantity: 100, remainingFulfillmentQuantity: 100, satisfied: false });
assert.deepEqual(replacementRemainingQuantity(100, 100, 100), { remainingProductionQuantity: 0, remainingFulfillmentQuantity: 0, satisfied: true });
console.log("replacement shipping economics: OK");
