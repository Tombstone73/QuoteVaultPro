import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProductDraftFormulaPricing, ProductDraftPricing } from "../api";
import { legacyFormulaCanBeAdopted, legacyFormulaCandidate, PricingEngine } from "./pricing-engine";

const pricing: ProductDraftPricing = {
  productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-08-22T00:00:00.000Z", lifecycle: "draft",
  measurementMode: "dimensions_required", mode: "simple_base", editable: false,
  base: { perPieceCents: null, perSqftCents: 300, minimumChargeCents: 500 }, tierBasis: null, tiers: [],
};
const legacyFormula: ProductDraftFormulaPricing = {
  productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-08-22T00:00:00.000Z", lifecycle: "draft",
  source: "unsupported_legacy", editable: false, expressionEditable: false, variablesEditable: false, rotationEditable: false,
  expression: "", legacyExpression: "ceil((((w+.25)*(h+.25))*q)/144)*p", canAdoptLegacyFormula: true,
  variables: {}, allowRotation: false, inputs: [], supportedRuntimeVariables: ["q", "w", "h", "p"], warnings: [],
};

assert.equal(legacyFormulaCandidate(legacyFormula), "ceil((((w+.25)*(h+.25))*q)/144)*p");
assert.equal(legacyFormulaCanBeAdopted(legacyFormula, false, true), true);
assert.equal(legacyFormulaCanBeAdopted(legacyFormula, true, true), false);
assert.equal(legacyFormulaCanBeAdopted({ ...legacyFormula, canAdoptLegacyFormula: false }, false, true), false);

const markup = renderToStaticMarkup(<PricingEngine pricing={pricing} formula={legacyFormula} onPricingChange={() => {}} onFormulaChange={() => {}} onAdoptLegacyFormula={() => {}} />);
assert.match(markup, /Legacy formula/);
assert.match(markup, /ceil\(\(\(\(w\+\.25\)/);
assert.match(markup, /Adopt into Draft/);
assert.doesNotMatch(markup, /No Formula expression/);

console.log("Product Builder legacy Formula adoption UI tests passed.");
