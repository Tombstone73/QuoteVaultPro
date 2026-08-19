import { describe, expect, test } from "@jest/globals";
import { resolveMaterialRequirements } from "../../src/modules/materials/materialRequirementResolver";
import type { ProductRecipe } from "../../src/modules/products/productRecipes";

const recipe: ProductRecipe = {
  recipeId: "recipe-a", productId: "product-a", productVersionId: "version-a", draftUpdatedAt: "2026-08-18T12:00:00.000Z", lifecycle: "active",
  components: [
    { componentId: "setup", materialId: "material-setup", materialName: "Setup", materialSku: null, quantity: "1", unit: "each", quantityKind: "per_line" },
    { componentId: "grommets", materialId: "material-grommet", materialName: "Grommet", materialSku: "GROM", quantity: "2", unit: "each", quantityKind: "per_piece" },
  ],
};
const line = (quantity: number) => ({
  productId: "product-a", quantity, lineId: "line-a",
  resolvedConfiguration: { pricingConfigurationId: "version-a", productId: "product-a" },
}) as any;

const pbv2 = {
  schemaVersion: 2,
  meta: {},
  nodes: {
    laminate: {
      id: "laminate", kind: "question", label: "Lamination", input: { selectionKey: "lamination" },
      choices: [{ value: "matte", label: "Matte", inventoryConsumption: [{ materialId: "laminate-roll", quantityBasis: "area_sqft", multiplier: 1 }] }],
    },
    thickness: {
      id: "thickness", kind: "question", label: "Thickness", input: { selectionKey: "thickness" },
      choices: [{ value: "4mm", label: "4mm", inventoryConsumption: [{ materialId: "coroplast", quantityBasis: "area_sqft", multiplier: 1 }] }],
    },
  },
} as any;
const materials = [
  { id: "laminate-roll", name: "Laminate", sku: "LAM", materialForm: "roll", inventoryUnit: "square_foot", consumptionUnit: "square_foot", width: 54 },
  { id: "coroplast", name: "Coroplast", sku: "CORO", materialForm: "sheet", inventoryUnit: "sheet", consumptionUnit: "square_foot", width: 48, height: 96 },
] as any;
const dimensionalLine = (selections: Record<string, unknown>, quantity = 2) => ({
  ...line(quantity),
  resolvedConfiguration: {
    pricingConfigurationId: "version-a", productId: "product-a", selections,
    dimensions: { width: "24", height: "36", unit: "in" },
  },
}) as any;

describe("P7B material requirement resolver", () => {
  test("resolves deterministic per-line and per-piece requirements without floating point drift", () => {
    expect(resolveMaterialRequirements(recipe, line(100))).toEqual([
      expect.objectContaining({ recipeComponentId: "setup", quantity: "1", quantityMode: "per_line" }),
      expect.objectContaining({ recipeComponentId: "grommets", quantity: "200", quantityMode: "per_piece", materialSku: "GROM" }),
    ]);
  });

  test("preserves explicit no-recipe behavior and rejects incompatible lineage or invalid quantities", () => {
    expect(resolveMaterialRequirements(null, line(1))).toEqual([]);
    expect(() => resolveMaterialRequirements(recipe, { ...line(1), resolvedConfiguration: { pricingConfigurationId: "new-version", productId: "product-a" } })).toThrow("does not match");
    expect(() => resolveMaterialRequirements(recipe, line(0))).toThrow("positive whole quantity");
  });

  test("freezes production-proven PBV2 choice area consumption in the configured physical inventory unit", () => {
    const resolved = resolveMaterialRequirements(null, dimensionalLine({ lamination: "matte", thickness: "4mm" }, 2), { tree: pbv2, materials });
    expect(resolved).toEqual([
      expect.objectContaining({ sourceKind: "pbv2_inventory_consumption", sourceDefinitionId: "pbv2:laminate:matte:0", materialId: "laminate-roll", quantity: "12", unit: "square_foot", quantityMode: "per_square_foot" }),
      expect.objectContaining({ sourceKind: "pbv2_inventory_consumption", sourceDefinitionId: "pbv2:thickness:4mm:0", materialId: "coroplast", quantity: "1", unit: "sheet", quantityMode: "per_square_foot" }),
    ]);
  });

  test("uses the frozen selected configuration, rejects missing dimensions, and leaves unselected PBV2 materials absent", () => {
    expect(resolveMaterialRequirements(null, dimensionalLine({ lamination: "gloss" }), { tree: pbv2, materials: materials.filter((material) => material.id === "laminate-roll") })).toEqual([]);
    expect(() => resolveMaterialRequirements(null, dimensionalLine({ thickness: "4mm" }), { tree: pbv2, materials: materials.filter((material) => material.id !== "coroplast") })).toThrow("unavailable");
    expect(() => resolveMaterialRequirements(null, { ...dimensionalLine({ lamination: "matte" }), resolvedConfiguration: { pricingConfigurationId: "version-a", productId: "product-a", selections: { lamination: "matte" } } }, { tree: pbv2, materials })).toThrow("needs dimensions");
  });
});
