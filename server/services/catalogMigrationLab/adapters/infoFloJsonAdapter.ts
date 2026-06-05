import type {
  CatalogMigrationLabPricingField,
  CatalogMigrationLabWarning,
  NormalizedSourceProduct,
  UnsupportedFieldSummary,
} from "@shared/catalogMigrationLabSchemas";

type ProductCandidate = {
  path: string;
  products: unknown[];
  score: number;
};

export type InfoFloAdapterParseResult = {
  products: NormalizedSourceProduct[];
  detectedProductPath: string | null;
  sourceShape: "array" | "object" | "single-product" | "unknown";
  detectedRootKeys: string[];
  unsupportedFields: UnsupportedFieldSummary[];
  warnings: CatalogMigrationLabWarning[];
};

const NAME_KEYS = ["name", "productName", "product_name", "title", "itemName", "item_name", "description1"];
const SKU_KEYS = ["sku", "itemNumber", "itemNo", "item_no", "productCode", "product_code", "code"];
const CATEGORY_KEYS = ["category", "categoryName", "category_name", "productCategory", "group", "department", "type"];
const DESCRIPTION_KEYS = ["description", "desc", "longDescription", "long_description", "details"];
const STATUS_KEYS = ["isActive", "active", "enabled", "status", "inactive", "discontinued", "archived"];
const OPTION_CONTAINER_KEYS = ["options", "optionGroups", "option_groups", "attributes", "variants", "choices", "customFields", "custom_fields"];
const MATERIAL_KEYS = ["material", "materials", "substrate", "media", "stock", "stockName", "stock_name", "paper", "vendorMaterial"];
const PRICING_KEYS = [
  "price",
  "unitPrice",
  "unit_price",
  "basePrice",
  "base_price",
  "retailPrice",
  "retail_price",
  "cost",
  "markup",
  "rate",
  "priceBreaks",
  "price_breaks",
  "tiers",
  "pricing",
  "pricingFormula",
  "pricing_formula",
  "width",
  "height",
  "area",
  "sqft",
  "quantity",
  "qty",
];

const RECOGNIZED_FIELD_KEYS = new Set(
  [
    ...NAME_KEYS,
    ...SKU_KEYS,
    ...CATEGORY_KEYS,
    ...DESCRIPTION_KEYS,
    ...STATUS_KEYS,
    ...OPTION_CONTAINER_KEYS,
    ...MATERIAL_KEYS,
    ...PRICING_KEYS,
    "id",
    "guid",
    "created",
    "createdAt",
    "updated",
    "updatedAt",
    "image",
    "images",
    "taxable",
    "notes",
  ].map(normalizeKey)
);

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valuePreview(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === "string") return value.slice(0, 120);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
  if (isRecord(value)) return `{${Object.keys(value).slice(0, 4).join(", ")}}`;
  return typeof value;
}

function findValue(record: Record<string, unknown>, keys: string[]): unknown {
  const byNormalizedKey = new Map(Object.keys(record).map((key) => [normalizeKey(key), key]));
  for (const key of keys) {
    const actualKey = byNormalizedKey.get(normalizeKey(key));
    if (actualKey) return record[actualKey];
  }
  return undefined;
}

function stringFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function productLikeScore(value: unknown): number {
  if (!isRecord(value)) return 0;
  let score = 0;
  if (findValue(value, NAME_KEYS) !== undefined) score += 4;
  if (findValue(value, SKU_KEYS) !== undefined) score += 2;
  if (findValue(value, CATEGORY_KEYS) !== undefined) score += 2;
  if (findValue(value, PRICING_KEYS) !== undefined) score += 2;
  if (findValue(value, OPTION_CONTAINER_KEYS) !== undefined) score += 1;
  if (findValue(value, MATERIAL_KEYS) !== undefined) score += 1;
  return score;
}

function scoreProductArray(values: unknown[]): number {
  if (values.length === 0) return 0;
  const inspected = values.slice(0, 25);
  const productish = inspected.filter((item) => productLikeScore(item) >= 4);
  if (productish.length === 0) return 0;
  let score = 0;
  for (const item of productish) {
    score += productLikeScore(item);
  }
  return score + Math.min(values.length, 100);
}

function collectProductArrays(value: unknown, path = "$", depth = 0, out: ProductCandidate[] = []): ProductCandidate[] {
  if (depth > 6) return out;
  if (Array.isArray(value)) {
    const score = scoreProductArray(value);
    if (score > 0) out.push({ path, products: value, score });
    value.slice(0, 10).forEach((item, index) => collectProductArrays(item, `${path}[${index}]`, depth + 1, out));
    return out;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectProductArrays(child, `${path}.${key}`, depth + 1, out);
    }
  }
  return out;
}

function statusFromRecord(record: Record<string, unknown>): "active" | "inactive" | "unknown" {
  const inactiveValue = findValue(record, ["inactive", "discontinued", "archived"]);
  if (typeof inactiveValue === "boolean") return inactiveValue ? "inactive" : "active";

  const activeValue = findValue(record, ["isActive", "active", "enabled"]);
  if (typeof activeValue === "boolean") return activeValue ? "active" : "inactive";

  const statusValue = stringFromValue(findValue(record, ["status"]));
  if (!statusValue) return "unknown";
  const normalized = statusValue.toLowerCase();
  if (["active", "enabled", "available", "published"].includes(normalized)) return "active";
  if (["inactive", "disabled", "archived", "discontinued", "deleted"].includes(normalized)) return "inactive";
  return "unknown";
}

function collectOptionNames(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectOptionNames(item, out);
    return out;
  }
  if (!isRecord(value)) return out;

  const optionName = stringFromValue(findValue(value, ["name", "optionName", "option_name", "label", "fieldName", "field_name", "attribute"]));
  if (optionName) out.add(optionName);

  for (const [key, child] of Object.entries(value)) {
    if (["values", "choices", "items", "options", "attributes", "children"].includes(normalizeKey(key))) {
      collectOptionNames(child, out);
    }
  }
  return out;
}

function extractOptionNames(record: Record<string, unknown>): string[] {
  const found = new Set<string>();
  for (const key of OPTION_CONTAINER_KEYS) {
    const value = findValue(record, [key]);
    if (value !== undefined) collectOptionNames(value, found);
  }
  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

function collectMaterialRefs(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string" || typeof value === "number") {
    const text = stringFromValue(value);
    if (text) out.add(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMaterialRefs(item, out);
    return out;
  }
  if (isRecord(value)) {
    const name = stringFromValue(findValue(value, ["name", "materialName", "material_name", "sku", "code", "label"]));
    if (name) out.add(name);
  }
  return out;
}

function extractMaterialReferences(record: Record<string, unknown>): string[] {
  const found = new Set<string>();
  for (const key of MATERIAL_KEYS) {
    const value = findValue(record, [key]);
    if (value !== undefined) collectMaterialRefs(value, found);
  }
  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

function extractPricingFields(record: Record<string, unknown>): CatalogMigrationLabPricingField[] {
  const fields: CatalogMigrationLabPricingField[] = [];
  const byNormalizedKey = new Map(Object.keys(record).map((key) => [normalizeKey(key), key]));
  for (const key of PRICING_KEYS) {
    const actualKey = byNormalizedKey.get(normalizeKey(key));
    if (!actualKey) continue;
    const value = record[actualKey];
    fields.push({
      fieldName: actualKey,
      valueType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
      sampleValue: valuePreview(value),
    });
  }
  return fields.sort((a, b) => a.fieldName.localeCompare(b.fieldName));
}

function unsupportedFieldsForRecord(record: Record<string, unknown>): Array<{ fieldName: string; value: unknown }> {
  return Object.entries(record)
    .filter(([key]) => !RECOGNIZED_FIELD_KEYS.has(normalizeKey(key)))
    .map(([fieldName, value]) => ({ fieldName, value }));
}

function summarizeUnsupportedFields(entries: Array<{ fieldName: string; value: unknown }>): UnsupportedFieldSummary[] {
  const byKey = new Map<string, UnsupportedFieldSummary>();
  for (const entry of entries) {
    const key = normalizeKey(entry.fieldName);
    const current = byKey.get(key) ?? {
      fieldName: entry.fieldName,
      path: "$.products[]",
      frequency: 0,
      sampleValues: [],
    };
    current.frequency++;
    const preview = valuePreview(entry.value);
    if (!current.sampleValues.includes(preview) && current.sampleValues.length < 5) {
      current.sampleValues.push(preview);
    }
    byKey.set(key, current);
  }
  return Array.from(byKey.values()).sort((a, b) => b.frequency - a.frequency || a.fieldName.localeCompare(b.fieldName));
}

function normalizeProduct(raw: unknown, index: number, sourcePath: string): {
  product: NormalizedSourceProduct;
  unsupported: Array<{ fieldName: string; value: unknown }>;
  warnings: CatalogMigrationLabWarning[];
} {
  const warnings: CatalogMigrationLabWarning[] = [];
  const record = isRecord(raw) ? raw : {};
  const name = stringFromValue(findValue(record, NAME_KEYS));
  const category = stringFromValue(findValue(record, CATEGORY_KEYS));
  const pricingFields = extractPricingFields(record);
  const optionNames = extractOptionNames(record);
  const unsupported = unsupportedFieldsForRecord(record);

  if (!name) {
    warnings.push({
      code: "MISSING_PRODUCT_NAME",
      severity: "warning",
      message: `Product at ${sourcePath} is missing a recognizable name.`,
      productIndex: index,
      path: sourcePath,
    });
  }
  if (!category) {
    warnings.push({
      code: "MISSING_CATEGORY",
      severity: "info",
      message: `Product "${name ?? `#${index + 1}`}" is missing a recognizable category.`,
      productIndex: index,
      productName: name ?? undefined,
      path: sourcePath,
    });
  }
  if (pricingFields.length === 0) {
    warnings.push({
      code: "MISSING_PRICING",
      severity: "warning",
      message: `Product "${name ?? `#${index + 1}`}" has no recognizable pricing fields.`,
      productIndex: index,
      productName: name ?? undefined,
      path: sourcePath,
    });
  }
  if (optionNames.length === 0) {
    warnings.push({
      code: "MISSING_OPTIONS",
      severity: "info",
      message: `Product "${name ?? `#${index + 1}`}" has no recognizable options.`,
      productIndex: index,
      productName: name ?? undefined,
      path: sourcePath,
    });
  }
  if (unsupported.length > 0) {
    warnings.push({
      code: "UNRECOGNIZED_PRODUCT_FIELDS",
      severity: "info",
      message: `Product "${name ?? `#${index + 1}`}" has ${unsupported.length} unrecognized field(s).`,
      productIndex: index,
      productName: name ?? undefined,
      path: sourcePath,
      count: unsupported.length,
    });
  }

  return {
    product: {
      sourceIndex: index,
      sourcePath,
      name,
      sku: stringFromValue(findValue(record, SKU_KEYS)),
      status: statusFromRecord(record),
      category,
      description: stringFromValue(findValue(record, DESCRIPTION_KEYS)),
      optionNames,
      materialReferences: extractMaterialReferences(record),
      pricingFields,
      unsupportedFieldNames: unsupported.map((entry) => entry.fieldName).sort((a, b) => a.localeCompare(b)),
    },
    unsupported,
    warnings,
  };
}

export function parseInfoFloJsonSource(sourceJson: unknown): InfoFloAdapterParseResult {
  const warnings: CatalogMigrationLabWarning[] = [];
  const detectedRootKeys = isRecord(sourceJson) ? Object.keys(sourceJson).sort((a, b) => a.localeCompare(b)).slice(0, 50) : [];

  if (sourceJson == null || (Array.isArray(sourceJson) && sourceJson.length === 0) || (isRecord(sourceJson) && Object.keys(sourceJson).length === 0)) {
    return {
      products: [],
      detectedProductPath: null,
      sourceShape: "unknown",
      detectedRootKeys,
      unsupportedFields: [],
      warnings: [{
        code: "EMPTY_SOURCE",
        severity: "error",
        message: "The uploaded JSON is empty.",
      }],
    };
  }

  let rawProducts: unknown[] = [];
  let detectedProductPath: string | null = null;
  let sourceShape: InfoFloAdapterParseResult["sourceShape"] = "unknown";

  if (Array.isArray(sourceJson)) {
    rawProducts = sourceJson;
    detectedProductPath = "$";
    sourceShape = "array";
  } else {
    const candidates = collectProductArrays(sourceJson).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const best = candidates[0];
    if (best) {
      rawProducts = best.products;
      detectedProductPath = best.path;
      sourceShape = "object";
    } else if (productLikeScore(sourceJson) >= 4) {
      rawProducts = [sourceJson];
      detectedProductPath = "$";
      sourceShape = "single-product";
    }
  }

  if (rawProducts.length === 0) {
    warnings.push({
      code: "NO_PRODUCTS_FOUND",
      severity: "error",
      message: "No product-like records were found in the uploaded JSON.",
    });
    warnings.push({
      code: "UNKNOWN_SOURCE_SHAPE",
      severity: "warning",
      message: "The source shape did not match known InfoFlo product export patterns.",
    });
  }

  const products: NormalizedSourceProduct[] = [];
  const unsupportedEntries: Array<{ fieldName: string; value: unknown }> = [];

  rawProducts.forEach((raw, index) => {
    const productPath = detectedProductPath ? `${detectedProductPath}[${index}]` : `$[${index}]`;
    const normalized = normalizeProduct(raw, index, productPath);
    products.push(normalized.product);
    unsupportedEntries.push(...normalized.unsupported);
    warnings.push(...normalized.warnings);
  });

  const names = new Map<string, { count: number; sampleName: string }>();
  for (const product of products) {
    if (!product.name) continue;
    const key = product.name.trim().toLowerCase();
    const current = names.get(key) ?? { count: 0, sampleName: product.name };
    current.count++;
    names.set(key, current);
  }
  for (const duplicate of Array.from(names.values()).filter((entry) => entry.count > 1)) {
    warnings.push({
      code: "DUPLICATE_PRODUCT_NAME",
      severity: "warning",
      message: `Duplicate product name found: "${duplicate.sampleName}" appears ${duplicate.count} times.`,
      productName: duplicate.sampleName,
      count: duplicate.count,
    });
  }

  return {
    products,
    detectedProductPath,
    sourceShape,
    detectedRootKeys,
    unsupportedFields: summarizeUnsupportedFields(unsupportedEntries),
    warnings,
  };
}
