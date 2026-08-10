import { describe, expect, jest, test } from "@jest/globals";
import { productDraftIntentSchema } from "@shared/productDraftIntent";

process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

function translucentVinylIntent() {
  return productDraftIntentSchema.parse({
    contractVersion: 1, intentId: "translucent_preview", organizationId: "org_1", revision: 3, state: "ready_for_review", operation: "new_product",
    identity: { name: "Translucent Vinyl - backlit with multilayer printing", description: "", category: { state: "resolved", id: "category_roll", label: "Roll Printing" } }, lifecycle: { productStatus: "inactive", published: false },
    measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: { model: "one_dimensional_matrix", unit: "per_square_foot", optionKey: "layers", cells: [{ option: "three", priceCents: 400 }, { option: "five", priceCents: 500 }] }, material: { state: "explicitly_unset" },
    optionGroups: [
      { key: "layers", label: "Layers", required: true, selectionMode: "single", values: [{ key: "three", label: "3 Layer", isDefault: true }, { key: "five", label: "5 Layer", isDefault: false }] },
      { key: "contour", label: "Contour Cutting", required: true, selectionMode: "single", values: [{ key: "no", label: "No", isDefault: true }, { key: "yes", label: "Yes", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 10 } }] },
      { key: "weed_tape", label: "Weeding and Taping", required: false, selectionMode: "single", availableWhen: { optionGroupKey: "contour", optionValueKey: "yes" }, values: [{ key: "no", label: "No", isDefault: true }, { key: "yes", label: "Yes", isDefault: false, totalPercentOfBaseWhenEnabled: { percent: 30, prerequisite: { optionGroupKey: "contour", optionValueKey: "yes" } } }] },
    ],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [],
    fieldMetadata: { "identity.category": { source: "explicit_user" }, material: { source: "unresolved" }, "production.route": { source: "unresolved" } }, revisionMetadata: { parentRevision: 2 }, operationContext: {},
  });
}

describe("active semantic product draft pricing preview", () => {
  test("prices six label-based scenarios through PBV2 without creating a revision", async () => {
    const { ProductManagementSkillService } = await import("../services/assistant/productManagementSkill");
    const intent = translucentVinylIntent();
    const current: any = { proposalId: "proposal_1", specification: { resolutionMetadata: { architecture: "operator_business_operations" }, session: { state: "ready_for_review", revisions: [{ intent }] } } };
    const router = { loadForConversation: jest.fn(async () => current) };
    const service = new ProductManagementSkillService({ sessions: {} as any, references: async () => ({ materials: [], templates: [] }), canonicalProductIntent: router as any });
    const scenarios = [
      ["3 Layer", "No", "No"], ["3 Layer", "Yes", "No"], ["3 Layer", "Yes", "Yes"],
      ["5 Layer", "No", "No"], ["5 Layer", "Yes", "No"], ["5 Layer", "Yes", "Yes"],
    ].map(([layer, contour, weedTape]) => ({ squareFeet: 10, selections: [{ optionGroup: "Layers", value: layer }, { optionGroup: "Contour Cutting", value: contour }, { optionGroup: "Weeding and Taping", value: weedTape }] }));

    const result = await service.previewActiveSemanticProductDraftPricing({ organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", proposalId: "proposal_1", scenarios, correlationId: "correlation_preview" });

    expect(router.loadForConversation).toHaveBeenCalledWith({ organizationId: "org_1", actorUserId: "user_1", conversationId: "conversation_1" });
    expect(result).toMatchObject({ productName: "Translucent Vinyl - backlit with multilayer printing", revision: 3, scenarioCount: 6 });
    expect(result.scenarios.map((scenario) => scenario.totalCents)).toEqual([4000, 4400, 5200, 5000, 5500, 6500]);
    expect(result.scenarios.map((scenario) => scenario.optionsCents)).toEqual([0, 400, 1200, 0, 500, 1500]);
    expect(current.specification.session.revisions).toHaveLength(1);
  });
});
