import { productDraftIntentFingerprint } from "@shared/productDraftIntent";
import { ProductIntentProjectionError, projectProductDraftIntentToProductBuilderDraft } from "../services/productIntentCompiler/productIntentProjection";

function intent(overrides: Record<string, unknown> = {}) {
  const base = {
    contractVersion: 1, intentId: "intent-1", organizationId: "org-1", revision: 1, state: "ready_for_review", operation: "new_product",
    identity: { name: "Yard Signs", description: "", category: { state: "resolved", id: "category-1", label: "Signs" } },
    lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: { model: "scalar", unit: "per_square_foot", priceCents: 500 }, material: { state: "explicitly_unset" }, optionGroups: [],
    workflow: { kind: "standard_production", requiresProofApproval: true, requiresProductionJob: true }, production: { route: { state: "resolved", id: "route-1", label: "Flatbed" }, configuration: {} },
    visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: { "pricing.unit": { source: "explicit_user", confidence: 1 } }, revisionMetadata: { parentRevision: 0 }, operationContext: {},
  };
  return { ...base, ...overrides };
}

describe("projectProductDraftIntentToProductBuilderDraft", () => {
  it("projects a deterministic scalar PBV2 draft with resolved relationships", () => {
    const source = intent();
    const first = projectProductDraftIntentToProductBuilderDraft(source);
    const second = projectProductDraftIntentToProductBuilderDraft(structuredClone(source));
    expect(first).toEqual(second);
    expect(first.product).toMatchObject({ pricingMode: "area", isActive: false, requiresProofApproval: true });
    expect(first.relationships.productionRoute).toEqual({ id: "route-1", label: "Flatbed" });
    expect(first.audit.fingerprint).toBe(productDraftIntentFingerprint(source));
    expect((first.treeJson.meta as any).pricingV2.base).toEqual({ perSqftCents: 500, perPieceCents: null, minimumChargeCents: null });
  });

  it("projects an exact two-dimensional matrix without recreating its prices", () => {
    const source = intent({
      pricing: { model: "two_dimensional_matrix", unit: "per_piece", rowOptionKey: "thickness", columnOptionKey: "sides", cells: [
        { row: "3mm", column: "single", priceCents: 1200 }, { row: "3mm", column: "double", priceCents: 1800 },
        { row: "6mm", column: "single", priceCents: 1600 }, { row: "6mm", column: "double", priceCents: 2200 },
      ] },
      optionGroups: [
        { key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }, { key: "6mm", label: "6mm", isDefault: false }] },
        { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }, { key: "double", label: "Double-sided", isDefault: false }] },
      ],
    });
    const result = projectProductDraftIntentToProductBuilderDraft(source);
    const matrix = result.treeJson.pricingMatrix as any;
    expect(matrix.dimensions).toEqual(["thickness", "sides"]);
    expect(matrix.rows).toHaveLength(4);
    expect(matrix.rows.map((row: any) => row.variables.base_price).sort((a: number, b: number) => a - b)).toEqual([1200, 1600, 1800, 2200]);
    expect((result.treeJson.meta as any).pricingV2.optionMatrixPricingUnit).toBe("per_piece");
  });

  it("projects continuous quantity tiers into PBV2 lower-bound tiers", () => {
    const source = intent({ measurement: { mode: "quantity_only" }, pricing: { model: "quantity_tiers", unit: "per_piece", tiers: [
      { minimumQuantity: 1, maximumQuantity: 24, priceCents: 300 }, { minimumQuantity: 25, maximumQuantity: 49, priceCents: 250 }, { minimumQuantity: 50, maximumQuantity: null, priceCents: 200 },
    ] } });
    const result = projectProductDraftIntentToProductBuilderDraft(source);
    expect((result.treeJson.meta as any).pricingV2.qtyTiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ minQty: 1, maxQty: 24, perPieceCents: 300 }), expect.objectContaining({ minQty: 50, maxQty: null, perPieceCents: 200 }),
    ]));
  });

  it("rejects unresolved operational state before returning any draft", () => {
    expect(() => projectProductDraftIntentToProductBuilderDraft(intent({ material: { state: "unresolved", label: "Acrylic" } }))).toThrow(ProductIntentProjectionError);
  });

  it("preserves an unresolved matrix unit in the contract but blocks PBV2 projection", () => {
    const source = intent({
      state: "needs_answers",
      pricing: { model: "two_dimensional_matrix", unit: "unresolved", rowOptionKey: "thickness", columnOptionKey: "sides", cells: [{ row: "3mm", column: "single", priceCents: 1200 }] },
      optionGroups: [
        { key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }] },
        { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }] },
      ],
      unresolvedFields: [{ path: "pricing.unit", code: "PRICING_UNIT_UNRESOLVED", question: "Are these matrix prices per piece or per square foot?" }],
    });
    try {
      projectProductDraftIntentToProductBuilderDraft(source);
      throw new Error("Expected projection to reject an unresolved intent.");
    } catch (error) {
      expect(error).toMatchObject({ code: "INTENT_NOT_READY" });
    }
    try {
      projectProductDraftIntentToProductBuilderDraft({ ...source, state: "ready_for_review", unresolvedFields: [] });
      throw new Error("Expected projection to reject an unresolved pricing unit.");
    } catch (error) {
      expect(error).toMatchObject({ code: "PRICING_UNIT_UNRESOLVED" });
    }
  });
});
