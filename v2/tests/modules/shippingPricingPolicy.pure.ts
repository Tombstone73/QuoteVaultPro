import assert from "node:assert/strict";
import { resolveShippingPricingPolicy, shippingPriceFromResolvedPolicy } from "../../src/modules/fulfillment/replacementShippingEconomics.js";

const defaultPolicy = { mode: "percent" as const, percentageBasisPoints: 1250, currency: "USD", version: 3 };
assert.deepEqual(resolveShippingPricingPolicy(defaultPolicy), { policy: defaultPolicy, source: "organization_default" });
const override = { mode: "flat" as const, flatAmountCents: 350, currency: "USD", version: 4 };
assert.deepEqual(resolveShippingPricingPolicy(defaultPolicy, override), { policy: override, source: "customer_override" });
assert.equal(shippingPriceFromResolvedPolicy({ estimatedCarrierCostCents: 1200, resolved: { policy: { mode: "pass_through", currency: "USD", version: 1 }, source: "organization_default" } }), 1200);
assert.equal(shippingPriceFromResolvedPolicy({ estimatedCarrierCostCents: 1200, resolved: { policy: override, source: "customer_override" } }), 1550);
assert.equal(shippingPriceFromResolvedPolicy({ estimatedCarrierCostCents: 9999, resolved: { policy: defaultPolicy, source: "organization_default" } }), 11249, "percentage markup uses integer half-up cents");
assert.equal(shippingPriceFromResolvedPolicy({ resolved: { policy: { mode: "no_charge", currency: "USD", version: 1 }, source: "organization_default" } }), 0);
assert.equal(shippingPriceFromResolvedPolicy({ resolved: { policy: { mode: "manual", currency: "USD", version: 1 }, source: "organization_default" }, manualCustomerPriceCents: 333 }), 333);
assert.throws(() => shippingPriceFromResolvedPolicy({ resolved: { policy: { mode: "pass_through", currency: "USD", version: 1 }, source: "organization_default" } }), /estimated carrier cost/);
assert.throws(() => resolveShippingPricingPolicy(undefined), /No organization/);
console.log("shipping pricing policy rules passed.");
