import assert from "node:assert/strict";
import { acceptsFormulaTesterResponse, formulaLibraryListInput } from "./FormulaLibraryWorkspace";

assert.equal(
  acceptsFormulaTesterResponse(2, 1),
  false,
  "a response from a superseded live Formula Tester request must be ignored",
);
assert.equal(
  acceptsFormulaTesterResponse(2, 2),
  true,
  "the current live Formula Tester request may update the confirmed result",
);

assert.deepEqual(
  formulaLibraryListInput("area", undefined, false),
  { query: "area", includeInactive: true },
  "a Formula viewer must use the reusable-library query without the privileged scoped projection",
);
assert.deepEqual(
  formulaLibraryListInput("area", undefined, true),
  { query: "area", includeInactive: true, includeProductScoped: true },
  "a pricing.configure actor may request the Product-scoped administration projection",
);
assert.deepEqual(
  formulaLibraryListInput("area", "product-a", false),
  { query: "area", includeInactive: true, productId: "product-a" },
  "Product Builder eligibility remains Product-specific rather than privileged administration access",
);

console.log("Formula Tester stale-response guard tests passed.");
