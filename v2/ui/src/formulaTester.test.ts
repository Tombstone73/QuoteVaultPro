import assert from "node:assert/strict";
import { acceptsFormulaTesterResponse, editorFromFormula, formulaDetailResolution, formulaLibraryListInput, formulaVisibilityDescription, resolveEligibleFormula } from "./FormulaLibraryWorkspace";

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

const scopedFormula = {
  formulaId: "formula-a", name: "Scoped Formula", visibility: "product_scoped" as const, scopeProductName: "QA Product", status: "active" as const, currentRevisionId: "revision-a",
  revision: { formulaRevisionId: "revision-a", formulaId: "formula-a", organizationId: "org-a", revisionNumber: 1, expression: "base_price", declaredInputs: [], validationEvidence: {}, createdAt: "2026-08-24T00:00:00.000Z" },
};
assert.equal(editorFromFormula(scopedFormula).visibility, "product_scoped", "Builder revise context initializes the actual Formula visibility rather than a library default");
assert.match(formulaVisibilityDescription(scopedFormula, "library"), /Only QA Product can select this Formula/);
assert.doesNotMatch(formulaVisibilityDescription(scopedFormula, "library"), /Any eligible Product/);
assert.equal(formulaVisibilityDescription({ ...scopedFormula, visibility: "library" }, "product_scoped"), "Any eligible Product in this organization can select this Formula.");
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

assert.equal(
  formulaDetailResolution(undefined, "formula-a", true),
  "loading",
  "a direct Builder revise route must not report a Formula unavailable while its Product-eligibility list is still loading",
);
assert.equal(
  resolveEligibleFormula([scopedFormula], "formula-a"),
  scopedFormula,
  "a Product-scoped Formula returned by the owning Product eligibility list resolves into the direct Builder detail/editor",
);
assert.equal(formulaDetailResolution(scopedFormula, "formula-a", false), "ready");
assert.equal(
  formulaDetailResolution(resolveEligibleFormula([], "formula-a"), "formula-a", false),
  "unavailable",
  "an unrelated Product remains unavailable after its canonical eligibility list settles without the Formula",
);

console.log("Formula Tester stale-response guard tests passed.");
