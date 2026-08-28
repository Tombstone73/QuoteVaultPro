import type { Product, InsertProduct } from "@shared/schema";
import { sanitizeLegacyPriceBreaksForPbv2 } from "@shared/pbv2/legacyPriceBreaks";
import {
  normalizeProductPricingRotationConfig,
  shouldPersistProductRotation,
} from "@shared/pbv2/productPricingRotation";
import { normalizePbv2ChoiceConsumptionMaterialAuthority } from "@shared/pbv2/materialAuthority";

function cloneJson<T>(value: T): T {
  const sc = (globalThis as any).structuredClone as ((v: any) => any) | undefined;
  if (typeof sc === "function") return sc(value);
  // Fallback for older runtimes; safe for JSON-serializable values.
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function withCopySuffix(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "(Copy)";
  return trimmed.endsWith("(Copy)") ? trimmed : `${trimmed} (Copy)`;
}

export function buildDuplicatedProductInsert(original: Product): Omit<InsertProduct, "organizationId"> {
  const copiedPricingConfig = original.pricingProfileConfig ? cloneJson(original.pricingProfileConfig) : null;
  const pricingProfileConfig = shouldPersistProductRotation({
    pricingProfileKey: original.pricingProfileKey,
    pricingFormula: original.pricingFormula,
    pricingProfileConfig: copiedPricingConfig,
  })
    ? normalizeProductPricingRotationConfig(copiedPricingConfig, false)
    : copiedPricingConfig;

  return sanitizeLegacyPriceBreaksForPbv2({
    name: withCopySuffix(original.name),
    shopName: original.shopName ?? null,
    description: original.description,
    aiParsingDescription: original.aiParsingDescription ?? null,
    aiParsingDescriptionLinkedToDescription: original.aiParsingDescriptionLinkedToDescription ?? false,

    productTypeId: original.productTypeId ?? null,
    category: original.category ?? null,

    pricingFormula: original.pricingFormula ?? null,
    pricingMode: original.pricingMode ?? "area",
    measurementMode: original.measurementMode ?? "dimensions_required",
    workflowIntent: original.workflowIntent ?? "standard_production",
    allowZeroPrice: original.allowZeroPrice ?? false,

    pricingProfileKey: original.pricingProfileKey ?? "default",
    pricingProfileConfig,
    pricingEngine: (original as any).pricingEngine ?? "pricingProfile",

    pricingFormulaId: original.pricingFormulaId ?? null,

    isService: original.isService ?? false,
    artworkPolicy: (original as any).artworkPolicy ?? "not_required",

    primaryMaterialId: original.primaryMaterialId ?? null,

    optionsJson: original.optionsJson ? cloneJson(original.optionsJson) : null,
    optionTreeJson: (original as any).optionTreeJson
      ? normalizePbv2ChoiceConsumptionMaterialAuthority((original as any).optionTreeJson).tree
      : null,

    storeUrl: original.storeUrl ?? null,
    showStoreLink: original.showStoreLink ?? true,

    thumbnailUrls: Array.isArray(original.thumbnailUrls) ? original.thumbnailUrls.slice() : [],
    priceBreaks: cloneJson(original.priceBreaks),

    useNestingCalculator: original.useNestingCalculator ?? false,
    sheetWidth: parseOptionalNumber(original.sheetWidth),
    sheetHeight: parseOptionalNumber(original.sheetHeight),
    materialType: original.materialType ?? "sheet",
    minPricePerItem: parseOptionalNumber(original.minPricePerItem),
    nestingVolumePricing: cloneJson(original.nestingVolumePricing),

    variantLabel: original.variantLabel ?? "Variant",

    requiresProductionJob: original.requiresProductionJob ?? true,
    requiresProofApproval: (original as any).requiresProofApproval ?? false,
    isTaxable: original.isTaxable ?? true,

    // Duplicates are created as a draft (not active) by default.
    isActive: false,
  });
}

export function deepCloneForTest<T>(value: T): T {
  return cloneJson(value);
}
