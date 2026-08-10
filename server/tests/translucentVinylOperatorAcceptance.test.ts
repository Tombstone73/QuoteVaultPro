import { describe, expect, test } from "@jest/globals";
import { productDraftIntentSchema } from "@shared/productDraftIntent";
import { projectProductDraftIntentToProductBuilderDraft } from "../services/productIntentCompiler/productIntentProjection";
import { evaluatePricingPreviewFromTree } from "../services/pricing/PricingService";

describe("Translucent Vinyl semantic PBV2 projection", () => {
  test("projects the exact one-axis layer-rate request without inventing a Surface option", () => {
    const intent = productDraftIntentSchema.parse({
      contractVersion: 1, intentId: "translucent_live_shape", organizationId: "org_1", revision: 0, state: "ready_for_review", operation: "new_product",
      identity: { name: "Translucent Vinyl - backlit with multilayer printing", description: "", category: { state: "resolved", id: "category_1", label: "Print Products" } }, lifecycle: { productStatus: "inactive", published: false },
      measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered", minimum: 1 },
      pricing: { model: "one_dimensional_matrix", unit: "per_square_foot", optionKey: "layers", cells: [{ option: "three", priceCents: 400 }, { option: "five", priceCents: 500 }] }, material: { state: "explicitly_unset" },
      optionGroups: [
        { key: "layers", label: "Layers", required: true, selectionMode: "single", values: [{ key: "three", label: "3 Layer", isDefault: true }, { key: "five", label: "5 Layer", isDefault: false }] },
        { key: "contour", label: "Contour Cutting", required: true, selectionMode: "single", values: [{ key: "no", label: "No", isDefault: true }, { key: "yes", label: "Yes", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 10 } }] },
        { key: "weed_tape", label: "Weeding and Taping", required: false, selectionMode: "single", availableWhen: { optionGroupKey: "contour", optionValueKey: "yes" }, values: [{ key: "no", label: "No", isDefault: true }, { key: "yes", label: "Yes", isDefault: false, totalPercentOfBaseWhenEnabled: { percent: 30, prerequisite: { optionGroupKey: "contour", optionValueKey: "yes" } } }] },
      ], workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: { "identity.category": { source: "structured_candidate" }, material: { source: "unresolved" }, "production.route": { source: "unresolved" }, "optionGroups.layers.default": { source: "explicit_user" }, "optionGroups.contour.default": { source: "explicit_user" } }, revisionMetadata: { parentRevision: null }, operationContext: {},
    });
    const projected = projectProductDraftIntentToProductBuilderDraft(intent);
    const tree = projected.treeJson as any;
    expect(tree.pricingMatrix.dimensions).toEqual(["layers"]);
    expect(tree.pricingMatrix.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ when: { layers: "three" }, variables: { base_price: 400 } }),
      expect.objectContaining({ when: { layers: "five" }, variables: { base_price: 500 } }),
    ]));
    expect(Object.values(tree.nodes).some((node: any) => node.key === "surface")).toBe(false);
    const contour = Object.values(tree.nodes).find((node: any) => node.key === "contour") as any;
    const weed = Object.values(tree.nodes).find((node: any) => node.key === "weed_tape") as any;
    expect(weed.visibility.rules).toEqual([{ type: "equals", selectionKey: "contour", value: "yes" }]);
    expect(contour.choices.find((choice: any) => choice.value === "yes").pricingImpact[0].percent).toBe(10);
    expect(weed.choices.find((choice: any) => choice.value === "yes").pricingImpact[0].percent).toBe(20);
    const price = (layers: string, contour: string, weedTape: string) => evaluatePricingPreviewFromTree({ treeJson: tree, widthIn: 120, heightIn: 12, quantity: 1, pbv2ExplicitSelections: { layers: { value: layers }, contour: { value: contour }, weed_tape: { value: weedTape } } }).totalPrice;
    expect(price("three", "no", "no")).toBe(40);
    expect(price("three", "yes", "no")).toBe(44);
    expect(price("three", "yes", "yes")).toBe(52);
    expect(price("five", "no", "no")).toBe(50);
    expect(price("five", "yes", "no")).toBe(55);
    expect(price("five", "yes", "yes")).toBe(65);
  });

  test("enforces the Contour → Weed/Tape dependency and derives +30% total, never +40%", () => {
    const intent = productDraftIntentSchema.parse({
      contractVersion: 1, intentId: "translucent_1", organizationId: "org_1", revision: 0, state: "ready_for_review", operation: "new_product",
      identity: { name: "Translucent Vinyl - Multilayer Print", description: "", category: { state: "resolved", id: "category_1", label: "Print Products" } }, lifecycle: { productStatus: "inactive", published: false },
      measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered", minimum: 1 },
      pricing: { model: "two_dimensional_matrix", unit: "per_square_foot", rowOptionKey: "surface", columnOptionKey: "layers", cells: [
        { row: "first", column: "three", priceCents: 500 }, { row: "first", column: "five", priceCents: 600 }, { row: "second", column: "three", priceCents: 500 }, { row: "second", column: "five", priceCents: 600 },
      ] }, material: { state: "explicitly_unset" },
      optionGroups: [
        { key: "surface", label: "Surface", required: true, selectionMode: "single", values: [{ key: "first", label: "1st surface (right reading)", isDefault: true }, { key: "second", label: "2nd surface (reverse printed)", isDefault: false }] },
        { key: "layers", label: "Layers", required: true, selectionMode: "single", values: [{ key: "three", label: "3 Layers", isDefault: true }, { key: "five", label: "5 Layers", isDefault: false }] },
        { key: "contour", label: "Contour Cutting", required: false, selectionMode: "single", values: [{ key: "none", label: "None", isDefault: true }, { key: "yes", label: "Contour Cutting", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 10 } }] },
        { key: "weed_tape", label: "Weed and Tape", required: false, selectionMode: "single", availableWhen: { optionGroupKey: "contour", optionValueKey: "yes" }, values: [{ key: "none", label: "None", isDefault: true }, { key: "yes", label: "Weed and Tape", isDefault: false, totalPercentOfBaseWhenEnabled: { percent: 30, prerequisite: { optionGroupKey: "contour", optionValueKey: "yes" } } }] },
      ], workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: {}, revisionMetadata: { parentRevision: null }, operationContext: {},
    });
    const projected = projectProductDraftIntentToProductBuilderDraft(intent);
    expect(projected.product).toMatchObject({ name: "Translucent Vinyl - Multilayer Print", pricingMode: "area", measurementMode: "dimensions_required", isActive: false });
    expect(projected.relationships).toEqual({ productionRoute: null, material: { state: "explicitly_unset" } });
    const nodes = projected.treeJson.nodes as Record<string, any>;
    const contour = Object.values(nodes).find((node: any) => node.key === "contour") as any;
    const weed = Object.values(nodes).find((node: any) => node.key === "weed_tape") as any;
    expect(weed.visibility.rules).toEqual([{ type: "equals", selectionKey: "contour", value: "yes" }]);
    expect(contour.choices.find((choice: any) => choice.value === "yes").pricingImpact[0].percent).toBe(10);
    expect(weed.choices.find((choice: any) => choice.value === "yes").pricingImpact[0].percent).toBe(20);
    expect(10 + 20).toBe(30);
    const matrix = projected.treeJson.pricingMatrix as any;
    expect(matrix.rows).toEqual(expect.arrayContaining([expect.objectContaining({ when: { surface: "first", layers: "three" }, variables: { base_price: 500 } }), expect.objectContaining({ when: { surface: "second", layers: "five" }, variables: { base_price: 600 } })]));
  });
});
