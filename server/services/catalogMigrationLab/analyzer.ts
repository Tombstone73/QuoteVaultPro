import { createHash } from "crypto";
import type {
  CatalogMigrationLabAnalyzerRequest,
  CatalogMigrationLabAnalyzerResult,
  CatalogMigrationLabSourceField,
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
    for (const optionName of product.optionNames) {
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
      for (const field of product.sourceFields.filter((field) => field.fieldLabel === optionName)) {
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
  return pattern.test(`${field.fieldLabel} ${field.fieldType} ${field.inputType ?? ""} ${field.optionText ?? ""}`.toLowerCase());
}

function warningStringsForProduct(product: NormalizedSourceProduct): string[] {
  const warnings: string[] = [];
  if (!product.name) warnings.push("missing product_name");
  if (!product.category) warnings.push("missing suggested category");
  if (product.pricingFields.length === 0) warnings.push("missing recognizable pricing");
  if (product.sourceFields.length === 0) warnings.push("missing form_fields");
  if (product.sourceFields.some((field) => field.fieldLabel.toLowerCase().startsWith("field "))) warnings.push("generic field labels detected");
  if (product.sourceFields.some((field) => field.conditional && !field.parentField)) warnings.push("conditional parent could not be resolved");
  return warnings;
}

function summarizeProductStructures(products: NormalizedSourceProduct[]): ProductStructureSummary[] {
  return products.map((product) => {
    const fields = product.sourceFields;
    const fieldLabels = uniqueSorted(fields.map((field) => field.fieldLabel));
    const optionGroups = uniqueSorted(fields.map((field) => field.suggestedOptionGroup));
    const sizeFields = uniqueSorted(fields.filter((field) => fieldMatches(field, /(width|height|size|dimension|sq ?ft|length)/)).map((field) => field.fieldLabel));
    const quantityFields = fields.filter((field) => fieldMatches(field, /(qty|quantity|copies|pieces|count)/));
    const finishingOptions = uniqueSorted(fields.filter((field) => fieldMatches(field, /(finish|finishing|hem|grommet|laminat|mount|pole|pocket|drill|hardware)/)).map((field) => field.optionText ?? field.fieldLabel));
    const materialSelectors = uniqueSorted(fields.filter((field) => fieldMatches(field, /(material|substrate|stock|media|paper|vinyl|banner|coroplast|foam)/)).map((field) => field.fieldLabel));
    const conditionalFieldCount = fields.filter((field) => field.conditional).length;
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
      suggestedCategory: product.category,
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
      warnings: warningStringsForProduct(product),
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
    "suggested_category",
    "field_count",
    "option_group_count",
    "conditional_field_count",
    "size_fields_detected",
    "quantity_field_detected",
    "materials_detected",
    "complexity_score",
    "warnings",
  ];
  return toCsv(headers, productStructures.map((product) => ({
    product_name: product.productName,
    product_type: product.productType,
    suggested_category: product.suggestedCategory,
    field_count: product.fieldCount,
    option_group_count: product.optionGroupCount,
    conditional_field_count: product.conditionalFieldCount,
    size_fields_detected: product.sizeFieldsDetected,
    quantity_field_detected: product.quantityFieldDetected ? "yes" : "no",
    materials_detected: product.materialsDetected,
    complexity_score: product.complexityScore,
    warnings: product.warnings,
  })));
}

function buildProductFieldsCsv(products: NormalizedSourceProduct[]): string {
  const headers = [
    "product_name",
    "field_label",
    "field_type",
    "required",
    "option_text",
    "option_value",
    "parent_field",
    "parent_option",
    "level",
    "conditional",
    "suggested_option_group",
  ];
  const rows = products.flatMap((product) => product.sourceFields.map((field) => ({
    product_name: field.productName,
    field_label: field.fieldLabel,
    field_type: field.fieldType,
    required: field.required ? "yes" : "no",
    option_text: field.optionText,
    option_value: field.optionValue,
    parent_field: field.parentField,
    parent_option: field.parentOption,
    level: field.level,
    conditional: field.conditional ? "yes" : "no",
    suggested_option_group: field.suggestedOptionGroup,
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
  const productStructures = summarizeProductStructures(products);

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
    warnings: adapterResult.warnings,
  };
}
