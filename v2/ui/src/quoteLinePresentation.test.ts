import assert from "node:assert/strict";
import { quoteLineProductPresentation } from "./quoteLinePresentation";

const productId = "df00792e-ab23-4516-baa3-9f174f69c495";

assert.equal(
  quoteLineProductPresentation({ description: "Coroplast" }),
  "Coroplast",
);
// Product identity is deliberately not an input to this presentation contract.
// A missing historical description remains truthful without leaking lineage IDs.
assert.equal(quoteLineProductPresentation({ description: "  " }), "Product unavailable");
assert.doesNotMatch(
  quoteLineProductPresentation({ description: "Coroplast" }),
  new RegExp(productId, "u"),
);
console.log("Quote line product presentation tests passed.");
