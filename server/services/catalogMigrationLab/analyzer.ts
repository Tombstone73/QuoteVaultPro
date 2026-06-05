import { createHash } from "crypto";
import type {
  CatalogMigrationLabAnalyzerRequest,
  CatalogMigrationLabAnalyzerResult,
  CategorySummary,
  MaterialCandidateSummary,
  NormalizedSourceProduct,
  OptionPatternSummary,
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
    unsupportedFields: adapterResult.unsupportedFields,
    warnings: adapterResult.warnings,
  };
}
