import type { LineItemOptionSelectionsV2, OptionRuntimeSelectionContext } from "../../shared/optionTreeV2";
import { pbv2ToWeightTotal } from "./optionTreeV2Evaluator";

export type Pbv2WeightSource = "choice_material" | "product_primary_material" | "product_fallback" | "missing";

export type Pbv2WeightWarning = {
  code: string;
  message: string;
};

export type Pbv2WeightMaterialRecord = {
  id: string;
  name?: string | null;
  sku?: string | null;
  weightValue?: string | number | null;
  weightUnit?: string | null;
  weightBasis?: string | null;
  weightOzPerBasis?: string | number | null;
};

export type ResolvedPbv2WeightSource = {
  totalOz: number | null;
  source: Pbv2WeightSource;
  sourceLabel?: string;
  materialId?: string;
  materialName?: string;
  materialSku?: string | null;
  weightValue?: number | null;
  weightUnit?: string | null;
  weightBasis?: string | null;
  weightOzPerBasis?: number | null;
  basisQuantity?: number | null;
  warnings: Pbv2WeightWarning[];
};

export type ResolvePbv2WeightSourceInput = {
  treeJson: any;
  selections?: LineItemOptionSelectionsV2 | Record<string, unknown>;
  runtimeSelectionContext?: OptionRuntimeSelectionContext | null;
  productPrimaryMaterialId?: string | null;
  materialRecords?: Pbv2WeightMaterialRecord[] | Map<string, Pbv2WeightMaterialRecord>;
  widthIn?: number | null;
  heightIn?: number | null;
  quantity?: number | null;
};

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMaterialMap(
  materialRecords?: Pbv2WeightMaterialRecord[] | Map<string, Pbv2WeightMaterialRecord>,
): Map<string, Pbv2WeightMaterialRecord> {
  if (!materialRecords) return new Map();
  if (materialRecords instanceof Map) return materialRecords;

  const map = new Map<string, Pbv2WeightMaterialRecord>();
  for (const material of materialRecords) {
    if (material?.id) map.set(material.id, material);
  }
  return map;
}

function selectedMaterialOverrideIds(runtimeSelectionContext?: OptionRuntimeSelectionContext | null): string[] {
  const resolvedChoices = runtimeSelectionContext?.resolvedChoices;
  if (!resolvedChoices || typeof resolvedChoices !== "object") return [];

  const ids: string[] = [];
  for (const choice of Object.values(resolvedChoices)) {
    const materialId = choice?.material?.materialId;
    if (typeof materialId === "string" && materialId.trim()) ids.push(materialId.trim());
  }

  return Array.from(new Set(ids));
}

function calculateBasisQuantity(input: {
  basis: string | null | undefined;
  widthIn?: number | null;
  heightIn?: number | null;
  quantity?: number | null;
}): { basisQuantity: number | null; warning?: Pbv2WeightWarning } {
  const quantity = toPositiveNumber(input.quantity);
  if (quantity === null) {
    return {
      basisQuantity: null,
      warning: { code: "PBV2_W_WEIGHT_DIMENSIONS_MISSING", message: "Quantity is required to compute material weight." },
    };
  }

  switch (input.basis) {
    case "each":
      return { basisQuantity: quantity };
    case "sqft": {
      const widthIn = toPositiveNumber(input.widthIn);
      const heightIn = toPositiveNumber(input.heightIn);
      if (widthIn === null || heightIn === null) {
        return {
          basisQuantity: null,
          warning: {
            code: "PBV2_W_WEIGHT_DIMENSIONS_MISSING",
            message: "Width and height are required to compute square-foot material weight.",
          },
        };
      }
      return { basisQuantity: (widthIn * heightIn) / 144 * quantity };
    }
    case "sheet":
      return { basisQuantity: quantity };
    case "linear_ft":
    case "roll":
      return {
        basisQuantity: null,
        warning: {
          code: "PBV2_W_WEIGHT_BASIS_AMBIGUOUS",
          message: `Material weight basis "${input.basis}" is not resolved for PBV2 preview yet.`,
        },
      };
    default:
      return {
        basisQuantity: null,
        warning: {
          code: "PBV2_W_MATERIAL_WEIGHT_MISSING",
          message: "Material weight basis is not configured.",
        },
      };
  }
}

function resolveMaterialWeight(input: {
  material: Pbv2WeightMaterialRecord;
  source: Exclude<Pbv2WeightSource, "product_fallback" | "missing">;
  widthIn?: number | null;
  heightIn?: number | null;
  quantity?: number | null;
}): ResolvedPbv2WeightSource {
  const material = input.material;
  const weightOzPerBasis = toPositiveNumber(material.weightOzPerBasis);
  const weightValue = toPositiveNumber(material.weightValue);
  const warnings: Pbv2WeightWarning[] = [];

  if (weightOzPerBasis === null || !material.weightBasis) {
    warnings.push({
      code: "PBV2_W_MATERIAL_WEIGHT_MISSING",
      message: `Material ${material.name || material.id} does not have configured weight metadata.`,
    });
    return { totalOz: null, source: "missing", warnings };
  }

  const basis = calculateBasisQuantity({
    basis: material.weightBasis,
    widthIn: input.widthIn,
    heightIn: input.heightIn,
    quantity: input.quantity,
  });
  if (basis.warning) warnings.push(basis.warning);
  if (basis.basisQuantity === null) {
    return { totalOz: null, source: "missing", warnings };
  }

  return {
    totalOz: weightOzPerBasis * basis.basisQuantity,
    source: input.source,
    sourceLabel: `Material ${material.name || material.id}`,
    materialId: material.id,
    materialName: material.name ?? undefined,
    materialSku: material.sku ?? null,
    weightValue,
    weightUnit: material.weightUnit ?? null,
    weightBasis: material.weightBasis ?? null,
    weightOzPerBasis,
    basisQuantity: basis.basisQuantity,
    warnings,
  };
}

function resolveFallbackWeight(input: ResolvePbv2WeightSourceInput): ResolvedPbv2WeightSource {
  const warnings: Pbv2WeightWarning[] = [];
  const meta = input.treeJson?.meta && typeof input.treeJson.meta === "object" ? input.treeJson.meta : {};
  const shippingConfig = meta?.shippingConfig && typeof meta.shippingConfig === "object" ? meta.shippingConfig : {};
  const rawMetaBaseWeightOz = toPositiveNumber(meta?.baseWeightOz);
  const shippingConfigBaseWeight = toPositiveNumber(shippingConfig?.baseWeight);
  const shippingUnit = typeof shippingConfig?.weightUnit === "string" ? shippingConfig.weightUnit : "oz";
  const shippingBasis = typeof shippingConfig?.weightBasis === "string" ? shippingConfig.weightBasis : "per_item";
  const shippingBaseWeightOz = shippingConfigBaseWeight !== null
    ? convertWeightToOz(shippingConfigBaseWeight, shippingUnit)
    : null;
  const shippingContributionOz = rawMetaBaseWeightOz === null && shippingBaseWeightOz !== null
    ? computeShippingConfigContributionOz({
        baseWeightOz: shippingBaseWeightOz,
        basis: shippingBasis,
        widthIn: input.widthIn,
        heightIn: input.heightIn,
        quantity: input.quantity,
      })
    : 0;

  try {
    const selections = (input.selections && "schemaVersion" in input.selections)
      ? input.selections as LineItemOptionSelectionsV2
      : { schemaVersion: 2 as const, selected: (input.selections ?? {}) as Record<string, unknown> };
    const fallback = pbv2ToWeightTotal({
      tree: input.treeJson,
      selections,
      widthIn: input.widthIn ?? 0,
      heightIn: input.heightIn ?? 0,
      quantity: input.quantity ?? 0,
    });
    const combinedTotalOz = fallback.totalOz + shippingContributionOz;
    const totalOz = Number.isFinite(combinedTotalOz) && combinedTotalOz > 0 ? combinedTotalOz : null;
    if (totalOz !== null) {
      return {
        totalOz,
        source: "product_fallback",
        sourceLabel: "Product fallback",
        warnings,
      };
    }
  } catch (error: any) {
    warnings.push({
      code: "PBV2_W_FALLBACK_WEIGHT_UNAVAILABLE",
      message: typeof error?.message === "string" ? error.message : "Product fallback weight could not be evaluated.",
    });
  }

  const directFallbackOz = rawMetaBaseWeightOz ?? (shippingContributionOz > 0 ? shippingContributionOz : null);
  if (directFallbackOz !== null) {
    return {
      totalOz: directFallbackOz,
      source: "product_fallback",
      sourceLabel: "Product fallback",
      warnings,
    };
  }

  warnings.push({
    code: "PBV2_W_WEIGHT_MISSING",
    message: "No material or product fallback weight is configured.",
  });
  return { totalOz: null, source: "missing", warnings };
}

function convertWeightToOz(value: number, unit: string): number {
  switch (unit) {
    case "lb":
      return value * 16;
    case "g":
      return value * 0.03527396195;
    case "kg":
      return value * 35.27396195;
    case "oz":
    default:
      return value;
  }
}

function computeShippingConfigContributionOz(input: {
  baseWeightOz: number;
  basis: string;
  widthIn?: number | null;
  heightIn?: number | null;
  quantity?: number | null;
}): number {
  const quantity = toPositiveNumber(input.quantity) ?? 0;
  if (input.basis === "per_order") return input.baseWeightOz;
  if (input.basis === "per_sqft") {
    const widthIn = toPositiveNumber(input.widthIn) ?? 0;
    const heightIn = toPositiveNumber(input.heightIn) ?? 0;
    return input.baseWeightOz * ((widthIn * heightIn) / 144);
  }
  return input.baseWeightOz * quantity;
}

export function collectPbv2WeightMaterialIds(input: {
  runtimeSelectionContext?: OptionRuntimeSelectionContext | null;
  productPrimaryMaterialId?: string | null;
}): string[] {
  const ids = new Set<string>();
  for (const materialId of selectedMaterialOverrideIds(input.runtimeSelectionContext)) ids.add(materialId);
  if (input.productPrimaryMaterialId?.trim()) ids.add(input.productPrimaryMaterialId.trim());
  return Array.from(ids);
}

export function resolvePbv2WeightSource(input: ResolvePbv2WeightSourceInput): ResolvedPbv2WeightSource {
  const materialMap = normalizeMaterialMap(input.materialRecords);
  const warnings: Pbv2WeightWarning[] = [];
  const overrideIds = selectedMaterialOverrideIds(input.runtimeSelectionContext);

  if (overrideIds.length > 1) {
    warnings.push({
      code: "PBV2_W_MULTIPLE_MATERIAL_OVERRIDES",
      message: "Multiple selected PBV2 choices resolve different materials; product primary material or fallback weight was used.",
    });
  } else if (overrideIds.length === 1) {
    const materialId = overrideIds[0];
    const material = materialMap.get(materialId);
    if (!material) {
      warnings.push({
        code: "PBV2_W_MATERIAL_REFERENCE_MISSING",
        message: `Selected material ${materialId} could not be found.`,
      });
    } else {
      const resolved = resolveMaterialWeight({
        material,
        source: "choice_material",
        widthIn: input.widthIn,
        heightIn: input.heightIn,
        quantity: input.quantity,
      });
      if (resolved.totalOz !== null) return { ...resolved, warnings: [...warnings, ...resolved.warnings] };
      warnings.push(...resolved.warnings);
    }
  }

  const primaryMaterialId = typeof input.productPrimaryMaterialId === "string" ? input.productPrimaryMaterialId.trim() : "";
  if (primaryMaterialId) {
    const material = materialMap.get(primaryMaterialId);
    if (!material) {
      warnings.push({
        code: "PBV2_W_MATERIAL_REFERENCE_MISSING",
        message: `Primary material ${primaryMaterialId} could not be found.`,
      });
    } else {
      const resolved = resolveMaterialWeight({
        material,
        source: "product_primary_material",
        widthIn: input.widthIn,
        heightIn: input.heightIn,
        quantity: input.quantity,
      });
      if (resolved.totalOz !== null) return { ...resolved, warnings: [...warnings, ...resolved.warnings] };
      warnings.push(...resolved.warnings);
    }
  }

  const fallback = resolveFallbackWeight(input);
  return {
    ...fallback,
    warnings: [...warnings, ...fallback.warnings],
  };
}
