import assert from "node:assert/strict";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { assertStripeCardPaymentMinimum, minimumStripeCardPaymentCents, stripeRejectedBeforeCreation } from "../../src/modules/billing/stripePaymentPolicy.js";

assert.equal(minimumStripeCardPaymentCents("USD"), 50);
assert.equal(minimumStripeCardPaymentCents("usd"), 50);
assert.equal(minimumStripeCardPaymentCents("CAD"), null);
assert.doesNotThrow(() => assertStripeCardPaymentMinimum(50, "USD"));
assert.throws(() => assertStripeCardPaymentMinimum(49, "USD"), (error: unknown) => error instanceof V2ApplicationError && error.code === "VALIDATION_ERROR" && error.publicMessage.includes("$0.50"));
assert.equal(stripeRejectedBeforeCreation({ statusCode: 400 }), true);
assert.equal(stripeRejectedBeforeCreation({ raw: { statusCode: 401 } }), true);
assert.equal(stripeRejectedBeforeCreation({ statusCode: 409 }), false);
assert.equal(stripeRejectedBeforeCreation({ statusCode: 429 }), false);
assert.equal(stripeRejectedBeforeCreation({ statusCode: 500 }), false);
assert.equal(stripeRejectedBeforeCreation(new Error("network timeout")), false);
console.log("Stripe card-payment minimum and deterministic rejection policies passed.");
