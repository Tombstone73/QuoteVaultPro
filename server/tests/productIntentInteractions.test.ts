import { generateProductIntentCandidateActions, generateProductIntentRecommendations, productIntentCandidateActionSchema, productIntentRecommendationSchema } from "../services/productIntentCompiler/productIntentInteractions";

const fingerprint = "a".repeat(64);
function intent(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1, intentId: "intent-1", organizationId: "org-1", revision: 2, state: "ready_for_review", operation: "new_product",
    identity: { name: "Vinyl", description: "", category: { state: "resolved", id: "cat", label: "Signs" } }, lifecycle: { productStatus: "inactive", published: false },
    measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered", minimum: 1 }, pricing: { model: "scalar", unit: "per_square_foot", priceCents: 300 }, material: { state: "explicitly_unset" }, optionGroups: [],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: {}, revisionMetadata: { parentRevision: 1 }, operationContext: {}, ...overrides,
  } as any;
}

describe("canonical Product Intent interactions", () => {
  test("issues deterministic, validated, nonblocking recommendations with a small limit", () => {
    const recommendations = generateProductIntentRecommendations(intent(), fingerprint);
    expect(recommendations).toHaveLength(2);
    expect(recommendations.map((item) => item.kind)).toEqual(["enable_proof_approval", "add_minimum_charge"]);
    expect(recommendations.every((item) => productIntentRecommendationSchema.safeParse(item).success)).toBe(true);
    expect(recommendations.every((item) => item.patch.baseRevision === 2)).toBe(true);
  });

  test("suppresses production recommendations for service fees and respects dismissal", () => {
    expect(generateProductIntentRecommendations(intent({ workflow: { kind: "service_fee", requiresProofApproval: false, requiresProductionJob: false } }), fingerprint)).toEqual([]);
    const first = generateProductIntentRecommendations(intent(), fingerprint)[0]!;
    expect(generateProductIntentRecommendations(intent(), fingerprint, [first.id]).map((item) => item.id)).not.toContain(first.id);
  });

  test("issues tenant-bound material and duplicate actions without exposing client patches", () => {
    const unresolved = intent({ material: { state: "unresolved", label: "Unknown" }, identity: { name: "Vinyl", description: "", category: { state: "resolved", id: "cat", label: "Signs" } } });
    const actions = generateProductIntentCandidateActions(unresolved, fingerprint, [{ code: "MATERIAL_UNRESOLVED", path: "material", severity: "question", message: "Which material?" }, { code: "DUPLICATE_PRODUCT_NAME", path: "identity.name", severity: "blocker", message: "Duplicate" }], { categories: [], materials: [{ id: "mat-1", label: "Vinyl" }], productionRoutes: [], existingProducts: [{ id: "product-1", name: "Vinyl", isActive: true, cloneSupported: true }] });
    expect(actions.map((item) => item.kind)).toEqual(expect.arrayContaining(["select_material", "confirm_no_material", "rename_new_product", "open_existing_product", "clone_existing_product_to_inactive_draft"]));
    expect(actions.every((item) => productIntentCandidateActionSchema.safeParse(item).success)).toBe(true);
    expect(actions.find((item) => item.kind === "select_material")?.patch?.operations[0]).toMatchObject({ op: "set_material", value: { id: "mat-1" } });
  });
});
