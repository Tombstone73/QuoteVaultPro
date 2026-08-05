import {
  applyProductDraftIntentPatch,
  productDraftIntentFingerprint,
  productDraftIntentSchema,
} from "../productDraftIntent";

const intent = productDraftIntentSchema.parse({
  contractVersion: 1,
  operation: "create",
  revision: 1,
  identity: {
    name: { label: "Routed Acrylic", source: "explicit_user", confidence: null },
    category: { label: "Print Products", source: "selected_template", confidence: 1 },
  },
  lifecycle: { inactive: true, published: false },
  measurement: { mode: "dimensions_required", fixedDimensions: null, source: "explicit_user", confidence: 1 },
  quantity: { behavior: "customer_entered", fixedQuantity: null, source: "canonical_default", confidence: null },
  pricing: { model: "per_square_foot", perPieceCents: null, perSquareFootCents: 500, minimumChargeCents: null, matrix: null, tiers: [], source: "explicit_user", confidence: 1 },
  material: { state: "explicitly_unset", source: "explicit_user", confidence: null },
  optionGroups: [],
  workflow: { proofRequired: true, productionJobRequired: true, productionRoute: { label: "Flatbed", source: "explicit_user", confidence: 1 }, source: "explicit_user", confidence: 1 },
  visibility: { customerVisible: false, source: "canonical_default" },
  unresolvedFields: [],
  explicitConstraints: ["Do not select a material"],
  compatibility: { productBuilder: "pbv2", archetype: "standard_dimensions" },
});

describe("ProductDraftIntent", () => {
  test("keeps explicit unset distinct from unresolved and fingerprints semantically", () => {
    expect(intent.material.state).toBe("explicitly_unset");
    expect(productDraftIntentFingerprint(intent)).toBe(productDraftIntentFingerprint({ ...intent, optionGroups: [] }));
  });

  test("applies typed patches only against the displayed revision", () => {
    const updated = applyProductDraftIntentPatch(intent, {
      baseRevision: 1,
      preserveUnspecifiedFields: true,
      changes: { pricing: { set: { ...intent.pricing, model: "per_piece", perPieceCents: 500, perSquareFootCents: null } }, workflow: { set: { ...intent.workflow, productionRoute: null } } },
    });
    expect(updated.revision).toBe(2);
    expect(updated.pricing.model).toBe("per_piece");
    expect(updated.workflow.proofRequired).toBe(true);
    expect(updated.workflow.productionRoute).toBeNull();
    expect(() => applyProductDraftIntentPatch(intent, { baseRevision: 2, preserveUnspecifiedFields: true, changes: { optionGroups: { set: [] } } })).toThrow("PRODUCT_INTENT_STALE_REVISION");
  });
});
