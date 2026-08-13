import { z } from "zod";
import { optionTreeV2Schema } from "./optionTreeV2";
import { normalizePbv2ExportOptions, type NormalizedPbv2ExportOption } from "./pbv2ExportOptionNormalizer";

// ============================================================
// Product Import/Export Schema V2 (PBV2-aware)
// ============================================================

/**
 * Export format for products including full PBV2 tree definitions.
 * Designed for cross-org portability using stable keys instead of raw IDs.
 */

// Portable product export format
export const productExportV2ItemSchema = z.object({
  // Core product identity
  name: z.string(),
  slug: z.string().optional(), // Stable key for upsert
  description: z.string(),
  category: z.string().optional(),
  
  // Product type reference (by name/key, not ID)
  productTypeName: z.string().optional(),
  
  // Pricing configuration
  pricingMode: z.enum(["area", "quantity", "flat"]).default("area"),
  pricingFormula: z.string().optional(),
  pricingEngine: z.enum(["formulaLibrary", "pricingProfile", "pricingFormula"]).default("pricingProfile"),
  /** A Formula Library UUID is tenant-local; only its code is portable. */
  pricingFormulaRef: z.object({ code: z.string().trim().min(1), name: z.string().optional() }).optional(),
  pricingProfileKey: z.string().optional(),
  pricingProfileConfig: z.record(z.any()).optional(),
  
  // Primary material reference (by SKU, not ID)
  primaryMaterialSku: z.string().optional(),
  
  // Nesting calculator config
  useNestingCalculator: z.boolean().default(false),
  sheetWidth: z.number().optional(),
  sheetHeight: z.number().optional(),
  materialType: z.enum(["sheet", "roll"]).optional(),
  minPricePerItem: z.number().optional(),
  nestingVolumePricing: z.object({
    enabled: z.boolean(),
    tiers: z.array(z.object({
      minSheets: z.number(),
      maxSheets: z.number().optional(),
      pricePerSheet: z.number(),
    })),
  }).optional(),
  
  // Price breaks
  priceBreaks: z.object({
    enabled: z.boolean(),
    type: z.enum(["quantity", "sheets", "sqft"]),
    tiers: z.array(z.object({
      minValue: z.number(),
      maxValue: z.number().optional(),
      discountType: z.enum(["percentage", "fixed", "multiplier"]),
      discountValue: z.number(),
    })),
  }).optional(),
  
  // Flags
  isService: z.boolean().default(false),
  requiresProductionJob: z.boolean().default(true),
  isTaxable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  artworkPolicy: z.enum(["not_required", "required"]).default("not_required"),
  
  // Display
  variantLabel: z.string().default("Variant"),
  storeUrl: z.string().optional(),
  showStoreLink: z.boolean().default(true),
  thumbnailUrls: z.array(z.string()).default([]),
  
  // Legacy options JSON (v1)
  optionsJson: z.array(z.any()).optional(),
  
  // Option Tree v2 (v2 inline)
  optionTreeJson: z.any().optional(),
  
  // PBV2: Complete tree version export
  pbv2: z.object({
    hasActiveTree: z.boolean(),
    activeTree: z.object({
      schemaVersion: z.number(),
      treeJson: z.record(z.any()),
      publishedAt: z.string().nullable(),
    }).optional(),
    hasDraft: z.boolean(),
    draftTree: z.object({
      schemaVersion: z.number(),
      treeJson: z.record(z.any()),
    }).optional(),
  }).optional(),

  // PBV2 transfer diagnostics. These are informational counts used by the
  // preview/import guardrails; the tree JSON remains the source of truth.
  optionGroupCount: z.number().int().min(0).optional(),
  optionCount: z.number().int().min(0).optional(),
  choiceCount: z.number().int().min(0).optional(),
  ruleCount: z.number().int().min(0).optional(),
  pricingConfigPresent: z.boolean().optional(),
  matrixCount: z.number().int().min(0).optional(),
  tierCount: z.number().int().min(0).optional(),
  exportWarnings: z.array(z.string()).optional(),
  productKind: z.enum(["option_based", "simple", "service"]).optional(),
  
  // Variants (if needed in future - not implemented in v1)
  // variants: z.array(productVariantExportSchema).optional(),
});

export const productsExportV2Schema = z.object({
  schemaVersion: z.literal("products-export/v2"),
  exportedAt: z.string(), // ISO timestamp
  orgId: z.string(), // Source org (informational)
  orgName: z.string().optional(),
  products: z.array(productExportV2ItemSchema),
  // Mapping tables for stable key resolution
  mappings: z.object({
    productTypes: z.array(z.object({
      name: z.string(),
      id: z.string(),
    })).optional(),
    materials: z.array(z.object({
      sku: z.string(),
      name: z.string(),
      id: z.string(),
    })).optional(),
    pricingFormulas: z.array(z.object({
      code: z.string().trim().min(1),
      name: z.string(),
    })).optional(),
  }).optional(),
});

export type ProductExportV2 = z.infer<typeof productsExportV2Schema>;
export type ProductExportV2Item = z.infer<typeof productExportV2ItemSchema>;

// ============================================================
// Import Schemas & Types
// ============================================================

/**
 * Import request payload - same format as export for symmetry.
 */
export const productImportV2RequestSchema = productsExportV2Schema.extend({
  // Allow schemaVersion flexibility for forward compatibility
  schemaVersion: z.string().refine(
    (v) => v.startsWith("products-export/v"),
    "Invalid schema version format"
  ),
});

export type ProductImportV2Request = z.infer<typeof productImportV2RequestSchema>;

/**
 * Import plan result (dry-run output)
 */
export const importPlanSchema = z.object({
  counts: z.object({
    total: z.number().int().min(0),
    create: z.number().int().min(0),
    update: z.number().int().min(0),
    skip: z.number().int().min(0),
  }),
  warnings: z.array(z.object({
    productIndex: z.number().int(),
    productName: z.string(),
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
  })),
  errors: z.array(z.object({
    productIndex: z.number().int(),
    productName: z.string(),
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
  })),
  preview: z.array(z.object({
    productIndex: z.number().int(),
    productName: z.string(),
    category: z.string().optional(),
    status: z.string().optional(),
    hasPbv2: z.boolean().optional(),
    hasActiveTree: z.boolean().optional(),
    optionGroupCount: z.number().int().min(0).optional(),
    optionCount: z.number().int().min(0).optional(),
    choiceCount: z.number().int().min(0).optional(),
    ruleCount: z.number().int().min(0).optional(),
    pricingConfigPresent: z.boolean().optional(),
    matrixCount: z.number().int().min(0).optional(),
    tierCount: z.number().int().min(0).optional(),
    action: z.enum(["create", "update", "skip"]),
    existingId: z.string().optional(),
    reason: z.string().optional(),
    warnings: z.array(z.string()).optional(),
  })),
});

export type ImportPlan = z.infer<typeof importPlanSchema>;

/**
 * Import result (apply mode output)
 */
export const importResultSchema = z.object({
  success: z.boolean(),
  counts: z.object({
    total: z.number().int().min(0),
    created: z.number().int().min(0),
    updated: z.number().int().min(0),
    skipped: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
  created: z.array(z.object({
    productIndex: z.number().int(),
    productName: z.string(),
    productId: z.string(),
    optionGroupCount: z.number().int().min(0).optional(),
    optionCount: z.number().int().min(0).optional(),
    choiceCount: z.number().int().min(0).optional(),
    ruleCount: z.number().int().min(0).optional(),
    pricingConfigPresent: z.boolean().optional(),
    matrixCount: z.number().int().min(0).optional(),
    tierCount: z.number().int().min(0).optional(),
  })),
  updated: z.array(z.object({
    productIndex: z.number().int(),
    productName: z.string(),
    productId: z.string(),
    optionGroupCount: z.number().int().min(0).optional(),
    optionCount: z.number().int().min(0).optional(),
    choiceCount: z.number().int().min(0).optional(),
    ruleCount: z.number().int().min(0).optional(),
    pricingConfigPresent: z.boolean().optional(),
    matrixCount: z.number().int().min(0).optional(),
    tierCount: z.number().int().min(0).optional(),
  })),
  failed: z.array(z.object({
    productIndex: z.number().int(),
    productName: z.string(),
    error: z.string(),
    code: z.string().optional(),
  })),
});

export type ImportResult = z.infer<typeof importResultSchema>;

/**
 * Import mode configuration
 */
export const importModeSchema = z.enum([
  "upsertBySlug", // If product.slug exists in org, update; else create
  "requireExplicitConflictResolution", // Error on duplicate name/slug
]);

export type ImportMode = z.infer<typeof importModeSchema>;

export interface ProductImportExportSummary {
  hasPbv2: boolean;
  hasActiveTree: boolean;
  optionGroupCount: number;
  optionCount: number;
  choiceCount: number;
  ruleCount: number;
  pricingConfigPresent: boolean;
  matrixCount: number;
  tierCount: number;
}

function getTreeNodes(treeJson: unknown): Array<Record<string, any>> {
  if (!treeJson || typeof treeJson !== "object") return [];
  const nodes = (treeJson as Record<string, any>).nodes;
  if (Array.isArray(nodes)) return nodes.filter((node): node is Record<string, any> => !!node && typeof node === "object");
  if (nodes && typeof nodes === "object") {
    return Object.values(nodes).filter((node): node is Record<string, any> => !!node && typeof node === "object");
  }
  return [];
}

function countRules(treeJson: unknown): number {
  if (!treeJson || typeof treeJson !== "object") return 0;
  const tree = treeJson as Record<string, any>;
  const ruleCollections = [
    tree.rules,
    tree.optionRules,
    tree.visibilityRules,
    tree.defaultRules,
    tree.meta?.rules,
    tree.meta?.optionRules,
  ];
  return ruleCollections.reduce((count, rules) => count + (Array.isArray(rules) ? rules.length : 0), 0);
}

function countMatrices(value: unknown, key = ""): number {
  if (!value || typeof value !== "object") return 0;
  const normalizedKey = key.toLowerCase();
  if (normalizedKey.includes("matrix")) {
    return Array.isArray(value) ? value.length : 1;
  }
  if (Array.isArray(value)) {
    return value.reduce((count, child) => count + countMatrices(child), 0);
  }
  return Object.entries(value as Record<string, unknown>).reduce(
    (count, [childKey, child]) => count + countMatrices(child, childKey),
    0,
  );
}

function countTiers(value: unknown, key = ""): number {
  if (!value || typeof value !== "object") return 0;
  const normalizedKey = key.toLowerCase();
  if (Array.isArray(value)) {
    if (normalizedKey.includes("tier")) return value.length;
    return value.reduce((count, child) => count + countTiers(child), 0);
  }
  return Object.entries(value as Record<string, unknown>).reduce(
    (count, [childKey, child]) => count + countTiers(child, childKey),
    0,
  );
}

function hasChoicePricing(options: NormalizedPbv2ExportOption[]): boolean {
  return options.some((option) =>
    Boolean(option.pricing) ||
    option.choices.some((choice) => Boolean(choice.pricing)),
  );
}

function hasPricingConfig(product: Pick<ProductExportV2Item, "pricingFormula" | "pricingProfileConfig" | "pricingProfileKey">, treeJson: unknown): boolean {
  const normalized = normalizePbv2ExportOptions(treeJson);
  if (product.pricingFormula || product.pricingProfileConfig || product.pricingProfileKey || hasChoicePricing(normalized.options)) return true;
  if (!treeJson || typeof treeJson !== "object") return false;
  const tree = treeJson as Record<string, any>;
  return Boolean(
    tree.pricingMatrix ||
    tree.pricingConfig ||
    countMatrices(treeJson) > 0 ||
    countTiers(treeJson) > 0 ||
    tree.meta?.pricingMatrix ||
    tree.meta?.pricingV2 ||
    tree.meta?.pricingFormula ||
    tree.meta?.pricingFormulaVariables,
  );
}

export function summarizeProductExportItem(item: ProductExportV2Item): ProductImportExportSummary {
  const activeTreeJson = item.pbv2?.activeTree?.treeJson ?? item.optionTreeJson;
  const nodes = getTreeNodes(activeTreeJson);
  const normalized = normalizePbv2ExportOptions(activeTreeJson);
  const optionGroupCount = nodes.filter((node) => node.kind === "group" || node.type === "GROUP").length;
  const normalizedOptionGroupCount = Math.max(optionGroupCount, normalized.diagnostics.optionGroupCount);
  const optionCount = normalized.options.length;
  const choiceCount = normalized.diagnostics.choiceCount;
  const matrixCount = countMatrices(activeTreeJson);
  const tierCount = countTiers(activeTreeJson) +
    (Array.isArray(item.priceBreaks?.tiers) ? item.priceBreaks.tiers.length : 0) +
    (Array.isArray(item.nestingVolumePricing?.tiers) ? item.nestingVolumePricing.tiers.length : 0);

  return {
    hasPbv2: Boolean(item.pbv2?.activeTree || item.optionTreeJson),
    hasActiveTree: Boolean(item.pbv2?.activeTree),
    optionGroupCount: normalizedOptionGroupCount,
    optionCount,
    choiceCount,
    ruleCount: countRules(activeTreeJson),
    pricingConfigPresent: hasPricingConfig(item, activeTreeJson),
    matrixCount,
    tierCount,
  };
}
