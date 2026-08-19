import type { OptionTreeV2 } from "../../../../shared/optionTreeV2.js";
import { resolvePbv2InventoryConsumption } from "../../../../shared/pbv2/inventoryConsumption.js";
import { resolveSheetConfiguration } from "../../../../shared/productionHydration.js";
import { normalizeMaterialReservation, type ReservationMaterial } from "../../../../shared/materialReservationNormalization.js";
import type { ProductRecipe, RecipeComponent } from "../products/productRecipes.js";
import type { SalesLineSnapshot } from "../sales/contracts.js";
import { V2ApplicationError } from "../../errors/applicationError.js";

export type MaterialRequirementSourceKind = "recipe_component" | "pbv2_inventory_consumption";
export type MaterialRequirementQuantityMode = "per_line" | "per_piece" | "per_square_foot";

export type MaterialRequirementMaterial = ReservationMaterial & Readonly<{
  id: string;
  name: string;
  sku: string | null;
}>;

export type Pbv2MaterialRequirementContext = Readonly<{
  tree: OptionTreeV2;
  materials: readonly MaterialRequirementMaterial[];
}>;

export type ResolvedMaterialRequirement = Readonly<{
  sourceKind: MaterialRequirementSourceKind;
  sourceDefinitionId: string;
  recipeId?: string;
  recipeComponentId?: string;
  productVersionId: string;
  configurationId: string;
  materialId: string;
  materialName: string;
  materialSku: string | null;
  quantity: string;
  unit: RecipeComponent["unit"];
  quantityMode: MaterialRequirementQuantityMode;
  resolutionVersion: 2;
}>;

const scale = 1_000_000n;
const parseQuantity = (value: string): bigint => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value)) throw new V2ApplicationError("VALIDATION_ERROR", "Recipe quantity is invalid.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * scale + BigInt((fraction + "000000").slice(0, 6));
};
const printQuantity = (value: bigint): string => {
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};
const printedNumber = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) throw new V2ApplicationError("VALIDATION_ERROR", "Material requirement quantity is invalid.");
  return printQuantity(parseQuantity(value.toFixed(6)));
};
const inches = (value: string, unit: "in" | "ft" | "mm"): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new V2ApplicationError("VALIDATION_ERROR", "Material requirements need valid dimensions.");
  return unit === "in" ? parsed : unit === "ft" ? parsed * 12 : parsed / 25.4;
};

const selectedValue = (value: unknown): unknown => value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value;
const nodeSelectionKey = (tree: OptionTreeV2, optionId: string): string => {
  const nodes = tree.nodes && typeof tree.nodes === "object" ? Object.values(tree.nodes as Record<string, unknown>) : [];
  const node = nodes.find((candidate) => candidate && typeof candidate === "object" && (candidate as { id?: unknown }).id === optionId) as { input?: { selectionKey?: unknown } } | undefined;
  return typeof node?.input?.selectionKey === "string" ? node.input.selectionKey : optionId;
};
const conditionIsSelected = (component: RecipeComponent, line: SalesLineSnapshot, source: Pbv2MaterialRequirementContext | undefined): boolean => {
  if (!component.condition) return true;
  if (!source) throw new V2ApplicationError("CONFLICT", "Recipe applicability needs the Product Version configuration.");
  const raw = selectedValue(line.resolvedConfiguration.selections[nodeSelectionKey(source.tree, component.condition.optionId)]
    ?? line.resolvedConfiguration.selections[component.condition.optionId]);
  return (Array.isArray(raw) ? raw : [raw]).some((value) => String(value) === component.condition!.choiceValue);
};
const staticRequirements = (recipe: ProductRecipe | null, line: SalesLineSnapshot, source: Pbv2MaterialRequirementContext | undefined): ResolvedMaterialRequirement[] => {
  if (!recipe) return [];
  if (recipe.productId !== line.productId || recipe.productVersionId !== line.resolvedConfiguration.pricingConfigurationId) throw new V2ApplicationError("CONFLICT", "The Product recipe does not match this commercial line.");
  const materials = new Map((source?.materials ?? []).map((material) => [material.id, material]));
  return recipe.components.flatMap<ResolvedMaterialRequirement>((component) => {
    if (!conditionIsSelected(component, line, source)) return [];
    const componentQuantity = parseQuantity(component.quantity);
    if (component.quantityKind === "per_area") {
      const dimensions = line.resolvedConfiguration.dimensions;
      if (!dimensions) throw new V2ApplicationError("VALIDATION_ERROR", "The Product recipe needs dimensions.");
      const widthIn = inches(dimensions.width, dimensions.unit), heightIn = inches(dimensions.height, dimensions.unit);
      const material = materials.get(component.materialId);
      if (!material) throw new V2ApplicationError("VALIDATION_ERROR", "A recipe material is unavailable.");
      const requestedQty = Number(component.quantity) * (widthIn * heightIn / 144) * line.quantity;
      const normalized = normalizeMaterialReservation({ material, requestedUom: "square_foot", requestedQty, flatSheet: { pieceWidthIn: widthIn, pieceHeightIn: heightIn, allowRotation: true } });
      if (!normalized.ok) throw new V2ApplicationError("VALIDATION_ERROR", normalized.message);
      return [Object.freeze({
        sourceKind: "recipe_component" as const, sourceDefinitionId: component.componentId,
        recipeId: recipe.recipeId, recipeComponentId: component.componentId,
        productVersionId: recipe.productVersionId, configurationId: line.resolvedConfiguration.pricingConfigurationId,
        materialId: component.materialId, materialName: component.materialName, materialSku: component.materialSku,
        quantity: printedNumber(normalized.convertedQty), unit: normalized.baseUom as RecipeComponent["unit"], quantityMode: "per_square_foot" as const,
        resolutionVersion: 2 as const,
      })];
    }
    const quantity = component.quantityKind === "per_piece" ? componentQuantity * BigInt(line.quantity) : componentQuantity;
    return [Object.freeze({
      sourceKind: "recipe_component" as const, sourceDefinitionId: component.componentId,
      recipeId: recipe.recipeId, recipeComponentId: component.componentId,
      productVersionId: recipe.productVersionId, configurationId: line.resolvedConfiguration.pricingConfigurationId,
      materialId: component.materialId, materialName: component.materialName, materialSku: component.materialSku,
      quantity: printQuantity(quantity), unit: component.unit, quantityMode: component.quantityKind === "per_piece" ? "per_piece" as const : "per_line" as const,
      resolutionVersion: 2 as const,
    })];
  });
};

/**
 * Resolves the production-proven PBV2 choice.inventoryConsumption rules.  The
 * canonical shared normalizer is deliberately used only to turn a known
 * physical request into its configured inventory unit; no pricing data is used.
 */
const pbv2Requirements = (line: SalesLineSnapshot, source: Pbv2MaterialRequirementContext | undefined): ResolvedMaterialRequirement[] => {
  if (!source) return [];
  const dimensions = line.resolvedConfiguration.dimensions;
  const widthIn = dimensions ? inches(dimensions.width, dimensions.unit) : undefined;
  const heightIn = dimensions ? inches(dimensions.height, dimensions.unit) : undefined;
  const entries = resolvePbv2InventoryConsumption({
    tree: source.tree, selections: line.resolvedConfiguration.selections, widthIn, heightIn, quantity: line.quantity,
  });
  if (entries.missingSize) throw new V2ApplicationError("VALIDATION_ERROR", "The selected Product material requirement needs dimensions.");
  const materials = new Map(source.materials.map((material) => [material.id, material]));
  const sheet = resolveSheetConfiguration({ pricingProfileConfig: (source.tree.meta as { pricingProfileConfig?: unknown } | undefined)?.pricingProfileConfig });
  return entries.entries.map((entry) => {
    const material = materials.get(entry.materialId);
    if (!material) throw new V2ApplicationError("VALIDATION_ERROR", "A selected Product material is unavailable.");
    const requestedUom = entry.uom === "sqft" ? "square_foot" : entry.uom === "ft" ? "linear_foot" : "each";
    const normalized = normalizeMaterialReservation({
      material, requestedUom, requestedQty: entry.quantity,
      flatSheet: { pieceWidthIn: widthIn, pieceHeightIn: heightIn, allowRotation: sheet.allowRotation },
    });
    if (!normalized.ok) throw new V2ApplicationError("VALIDATION_ERROR", normalized.message);
    return Object.freeze({
      sourceKind: "pbv2_inventory_consumption" as const,
      sourceDefinitionId: `pbv2:${entry.sourceId}`,
      productVersionId: line.resolvedConfiguration.pricingConfigurationId,
      configurationId: line.resolvedConfiguration.pricingConfigurationId,
      materialId: material.id, materialName: material.name, materialSku: material.sku,
      quantity: printedNumber(normalized.convertedQty), unit: normalized.baseUom as RecipeComponent["unit"],
      quantityMode: entry.quantityBasis === "area_sqft" ? "per_square_foot" as const : entry.quantityBasis === "each" ? "per_piece" as const : "per_line" as const,
      resolutionVersion: 2 as const,
    });
  });
};

/** Pure Product Recipe/PBV2 resolver; persistence and inventory remain outside this boundary. */
const replacesPbv2Source = (component: RecipeComponent, entry: ResolvedMaterialRequirement): boolean => {
  if (!component.replacesPbv2Compatibility || !component.condition || entry.sourceKind !== "pbv2_inventory_consumption" || component.materialId !== entry.materialId) return false;
  return entry.sourceDefinitionId.startsWith(`pbv2:${component.condition.optionId}:${component.condition.choiceValue}:`);
};

export const resolveMaterialRequirements = (recipe: ProductRecipe | null, line: SalesLineSnapshot, pbv2?: Pbv2MaterialRequirementContext): readonly ResolvedMaterialRequirement[] => {
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new V2ApplicationError("VALIDATION_ERROR", "Material requirements need a positive whole quantity.");
  const authored = staticRequirements(recipe, line, pbv2);
  const compatibility = pbv2Requirements(line, pbv2).filter((entry) => !(recipe?.components.some((component) => replacesPbv2Source(component, entry))));
  return Object.freeze([...authored, ...compatibility]);
};
