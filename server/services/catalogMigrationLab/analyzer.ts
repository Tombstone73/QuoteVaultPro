import { createHash } from "crypto";
import type {
  CatalogMigrationLabAnalyzerRequest,
  CatalogMigrationLabAnalyzerResult,
  CatalogMigrationLabSourceField,
  CatalogMigrationLabWarning,
  CatalogMigrationLabWarningCounts,
  CategorySummary,
  MaterialCandidateSummary,
  NormalizedSourceProduct,
  OptionPatternSummary,
  ProductStructureSummary,
  PricingPatternSummary,
} from "@shared/catalogMigrationLabSchemas";
import { CATALOG_MIGRATION_LAB_MAX_UPLOAD_BYTES } from "@shared/catalogMigrationLabSchemas";
import { parseInfoFloJsonSource } from "./adapters/infoFloJsonAdapter";

export const CATALOG_MIGRATION_LAB_MAX_SOURCE_BYTES = CATALOG_MIGRATION_LAB_MAX_UPLOAD_BYTES;

export type CatalogMigrationLabReferenceData = {
  materials?: Array<{ id: string; sku: string | null; name: string }>;
};

function canonicalizeForFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, innerValue) => {
    if (!innerValue || typeof innerValue !== "object" || Array.isArray(innerValue)) return innerValue;
    return Object.keys(innerValue as Record<string, unknown>)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (innerValue as Record<string, unknown>)[key];
        return acc;
      }, {});
  }) ?? "null";
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function parseSourceJson(request: CatalogMigrationLabAnalyzerRequest): { sourceJson: unknown; sourceText: string } {
  if (typeof request.jsonText === "string" && request.jsonText.trim().length > 0) {
    return { sourceJson: JSON.parse(request.jsonText), sourceText: request.jsonText };
  }
  const sourceText = canonicalizeForFingerprint(request.sourceJson);
  return { sourceJson: request.sourceJson, sourceText };
}

function productLabel(product: NormalizedSourceProduct): string {
  return product.name ?? product.sku ?? `Product #${product.sourceIndex + 1}`;
}

function samplePush(values: string[], next: string, max = 5) {
  if (!values.includes(next) && values.length < max) values.push(next);
}

function summarizeCategories(products: NormalizedSourceProduct[]): CategorySummary[] {
  const categories = new Map<string, CategorySummary>();
  for (const product of products) {
    const category = product.category ?? "(missing category)";
    const current = categories.get(category) ?? {
      category,
      count: 0,
      activeCount: 0,
      inactiveCount: 0,
      unknownCount: 0,
      sampleProducts: [],
    };
    current.count++;
    if (product.status === "active") current.activeCount++;
    else if (product.status === "inactive") current.inactiveCount++;
    else current.unknownCount++;
    samplePush(current.sampleProducts, productLabel(product));
    categories.set(category, current);
  }
  return Array.from(categories.values()).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function summarizeOptions(products: NormalizedSourceProduct[]): OptionPatternSummary[] {
  const byOption = new Map<string, OptionPatternSummary>();
  for (const product of products) {
    const sourceFieldGroups = product.sourceFields.length > 0
      ? uniqueSorted(product.sourceFields
        .filter((field) => !field.isCustomerMetadata && field.normalizedGroup !== "Other Product Field")
        .map((field) => field.normalizedGroup))
      : product.optionNames;

    for (const optionName of sourceFieldGroups) {
      const key = optionName.trim().toLowerCase();
      const current = byOption.get(key) ?? {
        optionName,
        frequency: 0,
        productCount: 0,
        sampleProducts: [],
        sampleValues: [],
        likelyReusableGroup: false,
      };
      current.frequency++;
      current.productCount++;
      samplePush(current.sampleProducts, productLabel(product));
      for (const field of product.sourceFields.filter((field) => field.normalizedGroup === optionName)) {
        if (field.optionText) samplePush(current.sampleValues, field.optionText, 10);
      }
      byOption.set(key, current);
    }
  }

  const totalProducts = Math.max(products.length, 1);
  return Array.from(byOption.values())
    .map((option) => ({
      ...option,
      likelyReusableGroup: option.productCount >= 2 || option.productCount / totalProducts >= 0.25,
    }))
    .sort((a, b) => b.productCount - a.productCount || a.optionName.localeCompare(b.optionName));
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function fieldMatches(field: CatalogMigrationLabSourceField, pattern: RegExp): boolean {
  return pattern.test(`${field.fieldLabel} ${field.normalizedFieldLabel} ${field.normalizedGroup} ${field.fieldType} ${field.inputType ?? ""} ${field.optionText ?? ""}`.toLowerCase());
}

function inferenceTextForProduct(product: NormalizedSourceProduct): string {
  return [
    productLabel(product),
    product.productType,
    product.category,
    ...product.optionNames,
    ...product.sourceFields.flatMap((field) => [field.fieldLabel, field.normalizedFieldLabel, field.normalizedGroup, field.optionText]),
  ].filter(Boolean).join(" ").toLowerCase();
}

function inferCategory(product: NormalizedSourceProduct): { category: string | null; confidence: ProductStructureSummary["categoryConfidence"] } {
  if (product.category) return { category: product.category, confidence: "source" };
  const text = inferenceTextForProduct(product);
  const rules: Array<{ category: string; confidence: ProductStructureSummary["categoryConfidence"]; pattern: RegExp }> = [
    { category: "Acrylic / Rigid Sheet", confidence: "high", pattern: /\bacrylic\b|plexi|plexiglass/ },
    { category: "Coroplast / Yard Signs", confidence: "high", pattern: /\bcoro\b|coroplast|yard sign/ },
    { category: "Foam Board", confidence: "high", pattern: /foam\s*board|foamcore|foam core/ },
    { category: "Banners", confidence: "high", pattern: /mesh\s*banner|\bbanner\b|scrim/ },
    { category: "ACM", confidence: "high", pattern: /\bacm\b|polymetal|poly metal|dibond/ },
    { category: "Stickers", confidence: "high", pattern: /sticker|decal|label/ },
    { category: "Window Graphics", confidence: "high", pattern: /window\s*perf|window graphic|perforated window/ },
    { category: "Vinyl / Roll Media", confidence: "medium", pattern: /\bvinyl\b|\bij\b|substance|avery|roll media/ },
  ];
  const match = rules.find((rule) => rule.pattern.test(text));
  return match ? { category: match.category, confidence: match.confidence } : { category: null, confidence: "unknown" };
}

function aggregateWarnings(rawWarnings: CatalogMigrationLabWarning[]): CatalogMigrationLabWarning[] {
  const byKey = new Map<string, CatalogMigrationLabWarning>();
  for (const warning of rawWarnings) {
    const key = [
      warning.productName ?? "",
      warning.code,
      warning.fieldLabel ?? "",
      warning.severity,
    ].join("\u0000");
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...warning, occurrences: warning.occurrences ?? warning.count ?? 1 });
      continue;
    }
    const nextOccurrences = (current.occurrences ?? current.count ?? 1) + (warning.occurrences ?? warning.count ?? 1);
    current.occurrences = nextOccurrences;
    current.count = Math.max(current.count ?? 0, warning.count ?? 0, nextOccurrences);
    if (warning.path && !current.path) current.path = warning.path;
  }

  return Array.from(byKey.values())
    .map((warning) => {
      if (warning.occurrences && warning.occurrences > 1) {
        const product = warning.productName ? `Product "${warning.productName}"` : "Source";
        const field = warning.fieldLabel ? ` for "${warning.fieldLabel}"` : "";
        return {
          ...warning,
          message: `${product} has ${warning.occurrences} ${warning.code.toLowerCase().replace(/_/g, " ")} notice(s)${field}.`,
        };
      }
      return warning;
    })
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (b.occurrences ?? 1) - (a.occurrences ?? 1) || a.code.localeCompare(b.code));
}

function severityRank(severity: CatalogMigrationLabWarning["severity"]): number {
  if (severity === "blocker") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function countWarnings(warnings: CatalogMigrationLabWarning[]): CatalogMigrationLabWarningCounts {
  const blockers = warnings.filter((warning) => warning.severity === "blocker").length;
  const warningCount = warnings.filter((warning) => warning.severity === "warning").length;
  const info = warnings.filter((warning) => warning.severity === "info").length;
  return {
    blockers,
    warnings: warningCount,
    info,
    actionable: blockers + warningCount,
  };
}

function warningCountsByProduct(warnings: CatalogMigrationLabWarning[]): Map<string, CatalogMigrationLabWarningCounts> {
  const byProduct = new Map<string, CatalogMigrationLabWarningCounts>();
  for (const warning of warnings) {
    const product = warning.productName ?? "";
    const current = byProduct.get(product) ?? { blockers: 0, warnings: 0, info: 0, actionable: 0 };
    if (warning.severity === "blocker") current.blockers++;
    else if (warning.severity === "warning") current.warnings++;
    else current.info++;
    current.actionable = current.blockers + current.warnings;
    byProduct.set(product, current);
  }
  return byProduct;
}

function pricingSourceStatus(product: NormalizedSourceProduct): ProductStructureSummary["pricingSourceStatus"] {
  if (product.pricingFields.length > 0) return "source_pricing_detected";
  if (product.sourceFields.length > 0) return "definition_only_no_pricing";
  return "missing_pricing";
}

function warningStringsForProduct(product: NormalizedSourceProduct, suggestedCategory: string | null): string[] {
  const warnings: string[] = [];
  if (!product.name) warnings.push("missing product_name");
  if (!product.category && !suggestedCategory) warnings.push("missing suggested category");
  if (pricingSourceStatus(product) === "missing_pricing") warnings.push("missing recognizable pricing");
  if (product.sourceFields.length === 0) warnings.push("missing form_fields");
  if (product.sourceFields.some((field) => field.conditional && !field.parentField)) warnings.push("conditional parent could not be resolved");
  return warnings;
}

function summarizeProductStructures(products: NormalizedSourceProduct[], warningsByProduct: Map<string, CatalogMigrationLabWarningCounts>): ProductStructureSummary[] {
  return products.map((product) => {
    const fields = product.sourceFields;
    const fieldLabels = uniqueSorted(fields.map((field) => field.fieldLabel));
    const optionGroups = uniqueSorted(fields.filter((field) => !field.isCustomerMetadata && field.normalizedGroup !== "Other Product Field").map((field) => field.normalizedGroup));
    const sizeFields = uniqueSorted(fields.filter((field) => field.normalizedGroup === "Size" || field.normalizedGroup === "Size / Pricing Signal").map((field) => field.normalizedFieldLabel));
    const quantityFields = fields.filter((field) => field.isQuantityCandidate);
    const finishingOptions = uniqueSorted(fields.filter((field) => fieldMatches(field, /(finish|finishing|hem|grommet|laminat|mount|pole|pocket|drill|hardware)/)).map((field) => field.optionText ?? field.fieldLabel));
    const materialSelectors = uniqueSorted(fields.filter((field) => field.normalizedGroup === "Materials").map((field) => field.normalizedFieldLabel));
    const conditionalFieldCount = fields.filter((field) => field.conditional).length;
    const category = inferCategory(product);
    const productWarningCounts = warningsByProduct.get(productLabel(product)) ?? { blockers: 0, warnings: 0, info: 0, actionable: 0 };
    const complexityScore = Math.min(
      100,
      fieldLabels.length +
        optionGroups.length * 2 +
        conditionalFieldCount * 3 +
        sizeFields.length * 2 +
        materialSelectors.length * 2 +
        finishingOptions.length,
    );

    return {
      productName: productLabel(product),
      productType: product.productType,
      suggestedCategory: category.category,
      categoryConfidence: category.confidence,
      fieldCount: fieldLabels.length,
      optionGroupCount: optionGroups.length,
      conditionalFieldCount,
      sizeFieldsDetected: sizeFields,
      quantityFieldDetected: quantityFields.length > 0,
      finishingOptionsDetected: finishingOptions,
      materialSelectorsDetected: materialSelectors,
      materialsDetected: uniqueSorted([...product.materialReferences, ...fields.filter((field) => fieldMatches(field, /(material|substrate|stock|media|paper|vinyl|banner|coroplast|foam)/)).map((field) => field.optionText)]),
      detectedOptionGroups: optionGroups,
      detectedConditionalLogic: conditionalFieldCount > 0,
      complexityScore,
      warnings: warningStringsForProduct(product, category.category),
      blockerCount: productWarningCounts.blockers,
      warningCount: productWarningCounts.warnings,
      infoCount: productWarningCounts.info,
      pricingSourceStatus: pricingSourceStatus(product),
    };
  });
}

function csvEscape(value: unknown): string {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function buildProductSummaryCsv(productStructures: ProductStructureSummary[]): string {
  const headers = [
    "product_name",
    "product_type",
    "blocker_count",
    "warning_count",
    "info_count",
    "suggested_category",
    "category_confidence",
    "field_count",
    "option_group_count",
    "conditional_field_count",
    "size_fields_detected",
    "quantity_field_detected",
    "materials_detected",
    "pricing_source_status",
    "complexity_score",
    "warnings",
  ];
  return toCsv(headers, productStructures.map((product) => ({
    product_name: product.productName,
    product_type: product.productType,
    blocker_count: product.blockerCount,
    warning_count: product.warningCount,
    info_count: product.infoCount,
    suggested_category: product.suggestedCategory,
    category_confidence: product.categoryConfidence,
    field_count: product.fieldCount,
    option_group_count: product.optionGroupCount,
    conditional_field_count: product.conditionalFieldCount,
    size_fields_detected: product.sizeFieldsDetected,
    quantity_field_detected: product.quantityFieldDetected ? "yes" : "no",
    materials_detected: product.materialsDetected,
    pricing_source_status: product.pricingSourceStatus,
    complexity_score: product.complexityScore,
    warnings: product.warnings,
  })));
}

function buildProductFieldsCsv(products: NormalizedSourceProduct[]): string {
  const headers = [
    "product_name",
    "field_label",
    "normalized_field_label",
    "field_type",
    "required",
    "option_text",
    "option_value",
    "parent_field",
    "parent_option",
    "level",
    "conditional",
    "suggested_option_group",
    "normalized_group",
    "is_quantity_candidate",
    "is_customer_metadata",
    "is_pricing_signal",
  ];
  const rows = products.flatMap((product) => product.sourceFields.map((field) => ({
    product_name: field.productName,
    field_label: field.fieldLabel,
    normalized_field_label: field.normalizedFieldLabel,
    field_type: field.fieldType,
    required: field.required ? "yes" : "no",
    option_text: field.optionText,
    option_value: field.optionValue,
    parent_field: field.parentField,
    parent_option: field.parentOption,
    level: field.level,
    conditional: field.conditional ? "yes" : "no",
    suggested_option_group: field.suggestedOptionGroup,
    normalized_group: field.normalizedGroup,
    is_quantity_candidate: field.isQuantityCandidate ? "yes" : "no",
    is_customer_metadata: field.isCustomerMetadata ? "yes" : "no",
    is_pricing_signal: field.isPricingSignal ? "yes" : "no",
  })));
  return toCsv(headers, rows);
}

function buildOptionGroupDiscoveryCsv(optionPatterns: OptionPatternSummary[]): string {
  const headers = ["option_group_name", "usage_count", "products_using_group", "sample_values"];
  return toCsv(headers, optionPatterns.map((option) => ({
    option_group_name: option.optionName,
    usage_count: option.productCount,
    products_using_group: option.sampleProducts,
    sample_values: option.sampleValues,
  })));
}

function buildMigrationWorksheets(products: NormalizedSourceProduct[], productStructures: ProductStructureSummary[], optionPatterns: OptionPatternSummary[]) {
  return {
    productSummary: buildProductSummaryCsv(productStructures),
    productFields: buildProductFieldsCsv(products),
    optionGroupDiscovery: buildOptionGroupDiscoveryCsv(optionPatterns),
  };
}

function normalizeMatchKey(value: string | null | undefined): string {
  return String(value ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function summarizeMaterials(products: NormalizedSourceProduct[], referenceData?: CatalogMigrationLabReferenceData): MaterialCandidateSummary[] {
  const materialByKey = new Map<string, { id: string; sku: string | null; name: string }>();
  for (const material of referenceData?.materials ?? []) {
    materialByKey.set(normalizeMatchKey(material.name), material);
    if (material.sku) materialByKey.set(normalizeMatchKey(material.sku), material);
  }

  const byReference = new Map<string, MaterialCandidateSummary>();
  for (const product of products) {
    for (const reference of product.materialReferences) {
      const key = normalizeMatchKey(reference);
      const current = byReference.get(key) ?? {
        reference,
        frequency: 0,
        sampleProducts: [],
        matchedMaterial: materialByKey.get(key) ?? null,
      };
      current.frequency++;
      samplePush(current.sampleProducts, productLabel(product));
      byReference.set(key, current);
    }
  }
  return Array.from(byReference.values()).sort((a, b) => b.frequency - a.frequency || a.reference.localeCompare(b.reference));
}

function pricingBucketFor(product: NormalizedSourceProduct): PricingPatternSummary["bucket"] {
  if (product.pricingFields.length === 0) return "missing_pricing";
  const fieldNames = product.pricingFields.map((field) => field.fieldName.toLowerCase());
  if (fieldNames.some((field) => field.includes("tier") || field.includes("break"))) return "tiered_pricing";
  if (fieldNames.some((field) => field.includes("qty") || field.includes("quantity"))) return "quantity_breaks";
  if (fieldNames.some((field) => ["width", "height", "area", "sqft"].some((token) => field.includes(token)))) return "size_based";
  if (fieldNames.some((field) => field.includes("formula"))) return "formula_like";
  if (fieldNames.some((field) => field.includes("price") || field.includes("rate") || field.includes("cost"))) return "flat_price";
  return "unknown_pricing";
}

function summarizePricingPatterns(products: NormalizedSourceProduct[]): PricingPatternSummary[] {
  const byBucket = new Map<PricingPatternSummary["bucket"], PricingPatternSummary>();
  for (const product of products) {
    const bucket = pricingBucketFor(product);
    const current = byBucket.get(bucket) ?? {
      bucket,
      count: 0,
      fields: [],
      sampleProducts: [],
    };
    current.count++;
    for (const field of product.pricingFields) samplePush(current.fields, field.fieldName, 20);
    samplePush(current.sampleProducts, productLabel(product));
    byBucket.set(bucket, current);
  }
  return Array.from(byBucket.values()).sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket));
}

function summarizePricingFields(products: NormalizedSourceProduct[]): CatalogMigrationLabAnalyzerResult["pricingFieldsDiscovered"] {
  const byField = new Map<string, { fieldName: string; frequency: number; sampleProducts: string[] }>();
  for (const product of products) {
    for (const field of product.pricingFields) {
      const key = field.fieldName.toLowerCase();
      const current = byField.get(key) ?? {
        fieldName: field.fieldName,
        frequency: 0,
        sampleProducts: [],
      };
      current.frequency++;
      samplePush(current.sampleProducts, productLabel(product));
      byField.set(key, current);
    }
  }
  return Array.from(byField.values()).sort((a, b) => b.frequency - a.frequency || a.fieldName.localeCompare(b.fieldName));
}

export function analyzeCatalogMigrationSource(
  request: CatalogMigrationLabAnalyzerRequest,
  referenceData: CatalogMigrationLabReferenceData = {},
): CatalogMigrationLabAnalyzerResult {
  const { sourceJson, sourceText } = parseSourceJson(request);
  const sourceBytes = byteLength(sourceText);
  if (sourceBytes > CATALOG_MIGRATION_LAB_MAX_SOURCE_BYTES) {
    throw Object.assign(new Error("Catalog source JSON is too large for Phase 1 analyzer."), {
      code: "SOURCE_TOO_LARGE",
      statusCode: 413,
    });
  }

  const adapterResult = parseInfoFloJsonSource(sourceJson);
  const products = adapterResult.products;
  const optionPatterns = summarizeOptions(products);
  const warnings = aggregateWarnings(adapterResult.warnings);
  const warningCounts = countWarnings(warnings);
  const productStructures = summarizeProductStructures(products, warningCountsByProduct(warnings));

  return {
    source: {
      adapter: "infoflo-json",
      fileName: request.fileName ?? null,
      fingerprint: createHash("sha256").update(sourceText).digest("hex"),
      byteSize: sourceBytes,
      analyzedAt: new Date().toISOString(),
      detectedProductPath: adapterResult.detectedProductPath,
      detectedRootKeys: adapterResult.detectedRootKeys,
      sourceShape: adapterResult.sourceShape,
    },
    counts: {
      totalProducts: products.length,
      activeProducts: products.filter((product) => product.status === "active").length,
      inactiveProducts: products.filter((product) => product.status === "inactive").length,
      unknownStatusProducts: products.filter((product) => product.status === "unknown").length,
    },
    products,
    categories: summarizeCategories(products),
    optionPatterns,
    likelyReusableOptionGroups: optionPatterns.filter((option) => option.likelyReusableGroup),
    materialCandidates: summarizeMaterials(products, referenceData),
    pricingPatterns: summarizePricingPatterns(products),
    pricingFieldsDiscovered: summarizePricingFields(products),
    productStructures,
    conditionalLogic: adapterResult.conditionalLogic,
    migrationWorksheets: buildMigrationWorksheets(products, productStructures, optionPatterns),
    unsupportedFields: adapterResult.unsupportedFields,
    warningCounts,
    warnings,
  };
}
