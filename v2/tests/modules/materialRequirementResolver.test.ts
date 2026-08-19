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
});
