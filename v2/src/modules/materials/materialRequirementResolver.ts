import type { ProductRecipe, RecipeComponent } from "../products/productRecipes.js";
import type { SalesLineSnapshot } from "../sales/contracts.js";
import { V2ApplicationError } from "../../errors/applicationError.js";

export type ResolvedMaterialRequirement = Readonly<{
  recipeId: string;
  recipeComponentId: string;
  productVersionId: string;
  configurationId: string;
  materialId: string;
  materialName: string;
  materialSku: string | null;
  quantity: string;
  unit: RecipeComponent["unit"];
  quantityMode: RecipeComponent["quantityKind"];
  resolutionVersion: 1;
}>;

const scale = 1_000_000n;
const parseQuantity = (value: string): bigint => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value)) {
    throw new V2ApplicationError("VALIDATION_ERROR", "Recipe quantity is invalid.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * scale + BigInt((fraction + "000000").slice(0, 6));
};
const printQuantity = (value: bigint): string => {
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

/**
 * Resolves only the versioned, fixed recipe modes P7B can prove today. It is
 * pure: persistence and inventory consumption remain outside this boundary.
 */
export const resolveMaterialRequirements = (
  recipe: ProductRecipe | null,
  line: SalesLineSnapshot,
): readonly ResolvedMaterialRequirement[] => {
  if (!recipe) return [];
  if (recipe.productId !== line.productId
    || recipe.productVersionId !== line.resolvedConfiguration.pricingConfigurationId) {
    throw new V2ApplicationError("CONFLICT", "The Product recipe does not match this commercial line.");
  }
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    throw new V2ApplicationError("VALIDATION_ERROR", "Material requirements need a positive whole quantity.");
  }
  return recipe.components.map((component) => {
    const mode = component.quantityKind;
    const source = parseQuantity(component.quantity);
    const resolved = mode === "per_piece" ? source * BigInt(line.quantity) : source;
    return Object.freeze({
      recipeId: recipe.recipeId,
      recipeComponentId: component.componentId,
      productVersionId: recipe.productVersionId,
      configurationId: line.resolvedConfiguration.pricingConfigurationId,
      materialId: component.materialId,
      materialName: component.materialName,
      materialSku: component.materialSku,
      quantity: printQuantity(resolved),
      unit: component.unit,
      quantityMode: mode,
      resolutionVersion: 1 as const,
    });
  });
};
