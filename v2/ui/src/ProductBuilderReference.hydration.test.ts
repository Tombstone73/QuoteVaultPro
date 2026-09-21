import assert from "node:assert/strict";
import { hydrateProductBuilderDraft, type ProductBuilderDraftReads } from "./ProductBuilderReference";

const reads: ProductBuilderDraftReads = {
  general: {
    productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-09-21T12:00:00.000Z", lifecycle: "draft",
    general: {
      displayName: "Hydrated window decal", category: "Signs", description: "Loaded existing Product", storefrontVisible: true,
      measurementMode: "dimensions_required", workflowIntent: "standard_production", requiresProofApproval: true, requiresProductionJob: true,
      productionUnitSpecification: { schemaVersion: 1, rules: [{ key: "front", side: "front" }] },
    },
  },
  options: {
    productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-09-21T12:00:00.000Z", lifecycle: "draft",
    options: [{ optionId: "option-finish", selectionKey: "finish", label: "Finish", inputType: "select", required: true, defaultValue: "matte", choices: [{ choiceValue: "matte", label: "Matte" }], canRemove: true }],
    optionRules: [],
  },
  pricing: {
    productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-09-21T12:00:00.000Z", lifecycle: "draft",
    measurementMode: "dimensions_required", mode: "simple_with_tiers", editable: true,
    base: { perPieceCents: null, perSqftCents: 125, minimumChargeCents: 500 }, flatFeeCents: 75, tierBasis: "quantity",
    tiers: [{ tierId: "tier-1", minimum: 10, maximum: null, perPieceCents: null, perSqftCents: 100, minimumChargeCents: 500 }],
    tierSets: { quantity: [{ tierId: "tier-1", minimum: 10, maximum: null, perPieceCents: null, perSqftCents: 100, minimumChargeCents: 500 }], squareFoot: [], computedSheetUsage: [] },
  },
  formula: {
    productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-09-21T12:00:00.000Z", lifecycle: "draft",
    source: "formula_revision", editable: true, expressionEditable: false, variablesEditable: false, rotationEditable: true,
    inputs: [], formulaId: "formula-1", formulaRevisionId: "formula-revision-1", expression: "width * height", variables: {}, inputValues: { waste: 1.1 }, allowRotation: true, supportedRuntimeVariables: [], warnings: [],
  },
  matrix: null,
  impacts: {
    productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-09-21T12:00:00.000Z", lifecycle: "draft",
    options: [{ optionId: "option-finish", selectionKey: "finish", label: "Finish", nodeImpact: null, nodeImpacts: [], choices: [{ choiceValue: "matte", label: "Matte", impact: { type: "fixed", value: 25 }, impacts: [{ type: "fixed", value: 25 }], override: null, editable: true }] }],
  },
  recipe: {
    recipeId: "recipe-1", productId: "product-1", productVersionId: "draft-1", draftUpdatedAt: "2026-09-21T12:00:00.000Z", lifecycle: "draft",
    components: [{ componentId: "component-1", materialId: "material-1", materialName: "Vinyl", quantity: "1", unit: "square_foot", quantityKind: "per_area" }],
  },
  routing: {
    productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-09-21T12:00:00.000Z", lifecycle: "draft",
    routing: { kind: "route_required", routeTemplateId: "route-1", routeTemplateName: "M78I-FIXTURE-ROUTE", sourceTemplateRevision: "1", steps: [{ position: 0, kind: "proofing" }, { position: 1, kind: "prepress" }, { position: 2, kind: "production" }, { position: 3, kind: "fulfillment" }] },
  },
};

const hydrated = hydrateProductBuilderDraft(reads);
assert.equal(hydrated.general.displayName, "Hydrated window decal");
assert.equal(hydrated.general.productionUnitSpecification?.rules[0]?.key, "front");
assert.equal(hydrated.options[0]?.defaultValue, "matte");
assert.equal(hydrated.pricing.perSqftCents, 125);
assert.equal(hydrated.pricing.tierSets.quantity[0]?.minimum, 10);
assert.equal(hydrated.formula.formulaRevisionId, "formula-revision-1");
assert.equal(hydrated.impacts[0]?.choices[0]?.impacts[0]?.type, "fixed");
assert.equal(hydrated.recipe[0]?.materialName, "Vinyl");
assert.deepEqual(hydrated.routing, reads.routing.routing);

(reads.general.general as { displayName: string }).displayName = "Mutated source";
assert.equal(hydrated.general.displayName, "Hydrated window decal");
console.log("Product Builder existing-Product hydration tests passed.");
