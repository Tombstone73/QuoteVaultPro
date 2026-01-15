import type { Product, InsertProduct } from "@shared/schema";

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
  return {
    name: withCopySuffix(original.name),
    description: original.description,

    productTypeId: original.productTypeId ?? null,
    category: original.category ?? null,

    pricingFormula: original.pricingFormula ?? null,
    pricingMode: original.pricingMode ?? "area",

    pricingProfileKey: original.pricingProfileKey ?? "default",
    pricingProfileConfig: original.pricingProfileConfig ? cloneJson(original.pricingProfileConfig) : null,

    pricingFormulaId: original.pricingFormulaId ?? null,

    isService: original.isService ?? false,
    artworkPolicy: (original as any).artworkPolicy ?? "not_required",

    primaryMaterialId: original.primaryMaterialId ?? null,

    optionsJson: original.optionsJson ? cloneJson(original.optionsJson) : null,
    optionTreeJson: (original as any).optionTreeJson ? cloneJson((original as any).optionTreeJson) : null,

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
    isTaxable: original.isTaxable ?? true,

    // Duplicates are created as a draft (not active) by default.
    isActive: false,
  };
}

export function deepCloneForTest<T>(value: T): T {
  return cloneJson(value);
}
