import { z } from "zod";

export const CATALOG_MIGRATION_LAB_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export const catalogMigrationLabWarningCodeValues = [
  "EMPTY_SOURCE",
  "SOURCE_TOO_LARGE",
  "MALFORMED_JSON",
  "UNKNOWN_SOURCE_SHAPE",
  "NO_PRODUCTS_FOUND",
  "MISSING_PRODUCT_NAME",
  "MISSING_CATEGORY",
  "MISSING_PRICING",
  "MISSING_OPTIONS",
  "DUPLICATE_PRODUCT_NAME",
  "UNRECOGNIZED_PRODUCT_FIELDS",
  "UNSUPPORTED_FIELD_SHAPE",
  "MISSING_FORM_FIELDS",
  "UNNAMED_FIELD_ID",
  "CONDITIONAL_FIELD_UNRESOLVED",
] as const;

export const catalogMigrationLabWarningSeverityValues = ["info", "warning", "error"] as const;

export const catalogMigrationLabWarningCodeSchema = z.enum(catalogMigrationLabWarningCodeValues);
export const catalogMigrationLabWarningSeveritySchema = z.enum(catalogMigrationLabWarningSeverityValues);

export const catalogMigrationLabAnalyzerRequestSchema = z.object({
  adapter: z.literal("infoflo-json").default("infoflo-json"),
  fileName: z.string().trim().max(255).optional(),
  jsonText: z.string().optional(),
  sourceJson: z.unknown().optional(),
}).superRefine((value, ctx) => {
  const hasJsonText = typeof value.jsonText === "string" && value.jsonText.trim().length > 0;
  const hasSourceJson = value.sourceJson !== undefined;
  if (!hasJsonText && !hasSourceJson) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide jsonText or sourceJson.",
      path: ["jsonText"],
    });
  }
});

export const catalogMigrationLabPricingFieldSchema = z.object({
  fieldName: z.string(),
  valueType: z.string(),
  sampleValue: z.string().optional(),
});

export const catalogMigrationLabSourceFieldSchema = z.object({
  analyzerId: z.string(),
  productName: z.string(),
  productType: z.string().nullable(),
  fieldLabel: z.string(),
  fieldType: z.string(),
  required: z.boolean(),
  optionText: z.string().nullable(),
  optionValue: z.string().nullable(),
  parentField: z.string().nullable(),
  parentOption: z.string().nullable(),
  level: z.number().int().min(0),
  conditional: z.boolean(),
  suggestedOptionGroup: z.string().nullable(),
  inputType: z.string().nullable(),
  sourcePath: z.string(),
});

export const normalizedSourceProductSchema = z.object({
  sourceIndex: z.number().int().min(0),
  sourcePath: z.string(),
  name: z.string().nullable(),
  sku: z.string().nullable(),
  productType: z.string().nullable(),
  status: z.enum(["active", "inactive", "unknown"]),
  category: z.string().nullable(),
  description: z.string().nullable(),
  optionNames: z.array(z.string()),
  materialReferences: z.array(z.string()),
  pricingFields: z.array(catalogMigrationLabPricingFieldSchema),
  sourceFields: z.array(catalogMigrationLabSourceFieldSchema),
  unsupportedFieldNames: z.array(z.string()),
});

export const catalogMigrationLabSourceMetadataSchema = z.object({
  adapter: z.literal("infoflo-json"),
  fileName: z.string().nullable(),
  fingerprint: z.string(),
  byteSize: z.number().int().min(0),
  analyzedAt: z.string(),
  detectedProductPath: z.string().nullable(),
  detectedRootKeys: z.array(z.string()),
  sourceShape: z.enum(["array", "object", "single-product", "unknown"]),
});

export const categorySummarySchema = z.object({
  category: z.string(),
  count: z.number().int().min(0),
  activeCount: z.number().int().min(0),
  inactiveCount: z.number().int().min(0),
  unknownCount: z.number().int().min(0),
  sampleProducts: z.array(z.string()),
});

export const optionPatternSummarySchema = z.object({
  optionName: z.string(),
  frequency: z.number().int().min(0),
  productCount: z.number().int().min(0),
  sampleProducts: z.array(z.string()),
  sampleValues: z.array(z.string()),
  likelyReusableGroup: z.boolean(),
});

export const materialCandidateSummarySchema = z.object({
  reference: z.string(),
  frequency: z.number().int().min(0),
  sampleProducts: z.array(z.string()),
  matchedMaterial: z.object({
    id: z.string(),
    sku: z.string().nullable(),
    name: z.string(),
  }).nullable(),
});

export const pricingPatternSummarySchema = z.object({
  bucket: z.enum([
    "flat_price",
    "size_based",
    "quantity_breaks",
    "tiered_pricing",
    "formula_like",
    "missing_pricing",
    "unknown_pricing",
  ]),
  count: z.number().int().min(0),
  fields: z.array(z.string()),
  sampleProducts: z.array(z.string()),
});

export const unsupportedFieldSummarySchema = z.object({
  fieldName: z.string(),
  path: z.string(),
  frequency: z.number().int().min(0),
  sampleValues: z.array(z.string()),
});

export const productStructureSummarySchema = z.object({
  productName: z.string(),
  productType: z.string().nullable(),
  suggestedCategory: z.string().nullable(),
  fieldCount: z.number().int().min(0),
  optionGroupCount: z.number().int().min(0),
  conditionalFieldCount: z.number().int().min(0),
  sizeFieldsDetected: z.array(z.string()),
  quantityFieldDetected: z.boolean(),
  finishingOptionsDetected: z.array(z.string()),
  materialSelectorsDetected: z.array(z.string()),
  materialsDetected: z.array(z.string()),
  detectedOptionGroups: z.array(z.string()),
  detectedConditionalLogic: z.boolean(),
  complexityScore: z.number().int().min(0),
  warnings: z.array(z.string()),
});

export const conditionalLogicSummarySchema = z.object({
  productName: z.string(),
  parentField: z.string().nullable(),
  parentOption: z.string().nullable(),
  childField: z.string(),
  childFieldType: z.string(),
  level: z.number().int().min(0),
  relationshipType: z.string(),
  sourcePath: z.string(),
});

export const migrationWorksheetCsvSchema = z.object({
  productSummary: z.string(),
  productFields: z.string(),
  optionGroupDiscovery: z.string(),
});

export const catalogMigrationLabWarningSchema = z.object({
  code: catalogMigrationLabWarningCodeSchema,
  severity: catalogMigrationLabWarningSeveritySchema,
  message: z.string(),
  productIndex: z.number().int().min(0).optional(),
  productName: z.string().optional(),
  path: z.string().optional(),
  count: z.number().int().min(0).optional(),
});

export const catalogMigrationLabAnalyzerResultSchema = z.object({
  source: catalogMigrationLabSourceMetadataSchema,
  counts: z.object({
    totalProducts: z.number().int().min(0),
    activeProducts: z.number().int().min(0),
    inactiveProducts: z.number().int().min(0),
    unknownStatusProducts: z.number().int().min(0),
  }),
  products: z.array(normalizedSourceProductSchema),
  categories: z.array(categorySummarySchema),
  optionPatterns: z.array(optionPatternSummarySchema),
  likelyReusableOptionGroups: z.array(optionPatternSummarySchema),
  materialCandidates: z.array(materialCandidateSummarySchema),
  pricingPatterns: z.array(pricingPatternSummarySchema),
  pricingFieldsDiscovered: z.array(z.object({
    fieldName: z.string(),
    frequency: z.number().int().min(0),
    sampleProducts: z.array(z.string()),
  })),
  productStructures: z.array(productStructureSummarySchema),
  conditionalLogic: z.array(conditionalLogicSummarySchema),
  migrationWorksheets: migrationWorksheetCsvSchema,
  unsupportedFields: z.array(unsupportedFieldSummarySchema),
  warnings: z.array(catalogMigrationLabWarningSchema),
});

export const catalogMigrationLabAnalyzeResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    data: catalogMigrationLabAnalyzerResultSchema,
  }),
  z.object({
    success: z.literal(false),
    message: z.string(),
    errorCode: catalogMigrationLabWarningCodeSchema.optional(),
  }),
]);

export type CatalogMigrationLabAnalyzerRequest = z.infer<typeof catalogMigrationLabAnalyzerRequestSchema>;
export type CatalogMigrationLabPricingField = z.infer<typeof catalogMigrationLabPricingFieldSchema>;
export type CatalogMigrationLabSourceField = z.infer<typeof catalogMigrationLabSourceFieldSchema>;
export type NormalizedSourceProduct = z.infer<typeof normalizedSourceProductSchema>;
export type CatalogMigrationLabSourceMetadata = z.infer<typeof catalogMigrationLabSourceMetadataSchema>;
export type CategorySummary = z.infer<typeof categorySummarySchema>;
export type OptionPatternSummary = z.infer<typeof optionPatternSummarySchema>;
export type MaterialCandidateSummary = z.infer<typeof materialCandidateSummarySchema>;
export type PricingPatternSummary = z.infer<typeof pricingPatternSummarySchema>;
export type UnsupportedFieldSummary = z.infer<typeof unsupportedFieldSummarySchema>;
export type ProductStructureSummary = z.infer<typeof productStructureSummarySchema>;
export type ConditionalLogicSummary = z.infer<typeof conditionalLogicSummarySchema>;
export type MigrationWorksheetCsv = z.infer<typeof migrationWorksheetCsvSchema>;
export type CatalogMigrationLabWarning = z.infer<typeof catalogMigrationLabWarningSchema>;
export type CatalogMigrationLabWarningCode = z.infer<typeof catalogMigrationLabWarningCodeSchema>;
export type CatalogMigrationLabAnalyzerResult = z.infer<typeof catalogMigrationLabAnalyzerResultSchema>;
export type CatalogMigrationLabAnalyzeResponse = z.infer<typeof catalogMigrationLabAnalyzeResponseSchema>;
