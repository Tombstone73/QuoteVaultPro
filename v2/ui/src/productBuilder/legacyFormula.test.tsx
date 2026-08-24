import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FormulaDomainListEntry, FormulaDomainRevision, ProductDraftFormulaPricing, ProductDraftPricing } from "../api";
import { inputValuesForRevision, PricingEngine } from "./pricing-engine";

const pricing: ProductDraftPricing = {
  productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-08-22T00:00:00.000Z", lifecycle: "draft",
  measurementMode: "dimensions_required", mode: "simple_base", editable: false,
  base: { perPieceCents: null, perSqftCents: 300, minimumChargeCents: 500 }, flatFeeCents: null, tierBasis: null, tiers: [], tierSets: { quantity: [], squareFoot: [], computedSheetUsage: [] },
};
const legacyFormula: ProductDraftFormulaPricing = {
  productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-08-22T00:00:00.000Z", lifecycle: "draft",
  source: "unsupported_legacy", editable: false, expressionEditable: false, variablesEditable: false, rotationEditable: false,
  expression: "", legacyExpression: "ceil((((w+.25)*(h+.25))*q)/144)*p", canAdoptLegacyFormula: true,
  variables: {}, allowRotation: false, inputs: [], supportedRuntimeVariables: ["q", "w", "h", "p"], warnings: [],
};

const markup = renderToStaticMarkup(<PricingEngine pricing={pricing} formula={legacyFormula} formulaLibrary={[]} formulaRevisions={[]} onPricingChange={() => {}} onFormulaChange={() => {}} />);
assert.match(markup, /Legacy compatibility Formula is read-only/);
assert.match(markup, /ceil\(\(\(\(w\+\.25\)/);
assert.match(markup, /Select a canonical Formula revision/);
assert.doesNotMatch(markup, /Adopt into Draft/);

const revision: FormulaDomainRevision = {
  formulaRevisionId: "revision-2", formulaId: "formula-1", organizationId: "org-1", revisionNumber: 2,
  expression: "ceil((w * h * q) / 144) * p", declaredInputs: [{ key: "roll_width", label: "Roll width", type: "number", required: true, defaultValue: 54, unit: "in", authorable: true }],
  validationEvidence: {}, createdAt: "2026-08-22T00:00:00.000Z",
};
const formulaEntry: FormulaDomainListEntry = { formulaId: "formula-1", name: "Roll material", visibility: "library", status: "active", currentRevisionId: revision.formulaRevisionId, revision };
const canonicalFormula: ProductDraftFormulaPricing = { ...legacyFormula, source: "formula_revision", formulaId: formulaEntry.formulaId, formulaRevisionId: revision.formulaRevisionId, formulaRevisionNumber: 2, formulaName: formulaEntry.name, expression: revision.expression, inputValues: { roll_width: 54 }, legacyExpression: undefined };
const canonicalMarkup = renderToStaticMarkup(<PricingEngine pricing={{ ...pricing, editable: true }} formula={canonicalFormula} formulaLibrary={[formulaEntry]} formulaRevisions={[revision]} onPricingChange={() => {}} onFormulaChange={() => {}} />);
assert.match(canonicalMarkup, /Select Formula/);
assert.match(canonicalMarkup, /Revision 2/);
assert.match(canonicalMarkup, /Product-specific Formula Inputs/);
assert.match(canonicalMarkup, /Roll width/);
assert.match(canonicalMarkup, /New Formula/);
assert.match(canonicalMarkup, /Manage Formula Library/);
assert.doesNotMatch(canonicalMarkup, /Embedded ProductVersion Formula/);

const tierPricing: ProductDraftPricing = {
  ...pricing,
  editable: true,
  mode: "advanced",
  tierBasis: "quantity",
  tiers: [{ tierId: "tier-1", minimum: 1, maximum: 24, perPieceCents: 300, perSqftCents: null, minimumChargeCents: 1500 }],
  tierSets: { quantity: [{ tierId: "tier-1", minimum: 1, maximum: 24, perPieceCents: 300, perSqftCents: null, minimumChargeCents: 1500 }], squareFoot: [], computedSheetUsage: [] },
};
const tierMarkup = renderToStaticMarkup(<PricingEngine pricing={tierPricing} formula={canonicalFormula} formulaLibrary={[formulaEntry]} formulaRevisions={[revision]} onPricingChange={() => {}} onFormulaChange={() => {}} />);
assert.match(tierMarkup, /Min charge/);
assert.match(tierMarkup, /Tier minimum charge/);

const rollRevision: FormulaDomainRevision = {
  ...revision,
  formulaRevisionId: "revision-roll",
  expression: "roll_nesting_billable_sqft(w,h,q,printable_width,piece_allowance_x,piece_allowance_y,billing_width_increment,billing_length_increment) * base_price",
};
const rollFormula: ProductDraftFormulaPricing = {
  ...canonicalFormula,
  formulaRevisionId: rollRevision.formulaRevisionId,
  expression: rollRevision.expression,
  rotationEditable: true,
};
const rollMarkup = renderToStaticMarkup(<PricingEngine pricing={{ ...pricing, editable: true }} formula={rollFormula} formulaLibrary={[formulaEntry]} formulaRevisions={[rollRevision]} options={[{ optionId: "opt-flute", selectionKey: "opt-flute", label: "Flute direction", inputType: "select", required: false, defaultValue: null, choices: [{ choiceValue: "parallel", label: "Parallel" }, { choiceValue: "perpendicular", label: "Perpendicular" }], canRemove: true }]} onPricingChange={() => {}} onFormulaChange={() => {}} />);
assert.match(rollMarkup, /Rotation policy/);
assert.match(rollMarkup, /Allow rotation/);
assert.doesNotMatch(rollMarkup, /Computed sheet usage/);

assert.deepEqual(
  inputValuesForRevision(
    [
      { key: "rate", label: "Rate", type: "number", required: true, minimum: 0, authorable: true },
      { key: "count", label: "Count", type: "integer", required: true, authorable: true },
      { key: "new_required", label: "New required", type: "number", required: true, authorable: true },
    ],
    { rate: 4, count: 1.5 },
  ),
  { rate: 4 },
  "revision adoption retains only values compatible with the new declared-input contract",
);

console.log("Product Builder legacy Formula compatibility UI tests passed.");
