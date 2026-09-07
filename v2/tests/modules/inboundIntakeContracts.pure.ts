import assert from "node:assert/strict";
import { assertInboundReviewDraftReady, inboundIntakeStates } from "../../src/modules/inbound/contracts.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

assert.ok(inboundIntakeStates.includes("received"));
assert.ok(inboundIntakeStates.includes("converted"));
assert.ok(inboundIntakeStates.includes("duplicate"));

assert.throws(
  () => assertInboundReviewDraftReady({ lines: [{ productId: brandedId<"ProductId">("product-1"), quantity: 1 }] }, undefined),
  /canonical Customer/,
);
assert.throws(
  () => assertInboundReviewDraftReady({ lines: [{ productId: brandedId<"ProductId">("product-1"), quantity: 0 }] }, brandedId<"CustomerId">("customer-1")),
  /positive whole quantity/,
);
assert.doesNotThrow(() =>
  assertInboundReviewDraftReady(
    { lines: [{ productId: brandedId<"ProductId">("product-1"), quantity: 25, description: "Reviewed line" }] },
    brandedId<"CustomerId">("customer-1"),
  ),
);

console.log("inbound intake contract checks passed");
