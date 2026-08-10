import {
  applyProductDraftIntentPatch,
  productDraftIntentFingerprint,
  productDraftIntentSchema,
} from "../productDraftIntent";

const intent = productDraftIntentSchema.parse({
  contractVersion: 1, intentId: "intent_1", organizationId: "org_1", revision: 0, state: "ready_for_review", operation: "new_product",
  identity: { name: "Routed Acrylic", description: "", category: { state: "resolved", id: "category_1", label: "Print Products" } },
  lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered", minimum: 1 },
  pricing: { model: "scalar", unit: "per_square_foot", priceCents: 500 }, material: { state: "explicitly_unset" }, optionGroups: [],
  workflow: { kind: "standard_production", requiresProofApproval: true, requiresProductionJob: true }, production: { route: { state: "resolved", id: "route_1", label: "Flatbed" }, configuration: {} },
  visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: { material: { source: "explicit_user" } }, revisionMetadata: { parentRevision: null }, operationContext: {},
});

describe("ProductDraftIntent", () => {
  test("keeps explicit unset distinct from unresolved and fingerprints semantically", () => {
    expect(intent.material.state).toBe("explicitly_unset");
    expect(productDraftIntentFingerprint(intent)).toBe(productDraftIntentFingerprint({ ...intent, revision: 8, revisionMetadata: { parentRevision: 7 } }));
  });

  test("applies typed patches against only the base revision", () => {
    const updated = applyProductDraftIntentPatch(intent, {
      contractVersion: 1, baseRevision: 0, preserveUnchanged: true,
      operations: [
        { op: "set_pricing", value: { model: "scalar", unit: "per_piece", priceCents: 500 } },
        { op: "set_production", value: { route: { state: "explicitly_unset" }, configuration: {} } },
      ],
    });
    expect(updated.revision).toBe(1);
    expect(updated.pricing).toMatchObject({ unit: "per_piece" });
    expect(updated.production.route.state).toBe("explicitly_unset");
    expect(updated.workflow.requiresProofApproval).toBe(true);
    expect(() => applyProductDraftIntentPatch(intent, { contractVersion: 1, baseRevision: 1, preserveUnchanged: true, operations: [{ op: "set_visibility", value: { catalogVisible: false } }] })).toThrow("stale");
  });
});
