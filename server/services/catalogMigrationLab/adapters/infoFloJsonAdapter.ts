import type {
  CatalogMigrationLabPricingField,
  CatalogMigrationLabSourceField,
  CatalogMigrationLabWarning,
  ConditionalLogicSummary,
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
  conditionalLogic: ConditionalLogicSummary[];
};

const NAME_KEYS = ["name", "productName", "product_name", "title", "itemName", "item_name", "description1"];
const SKU_KEYS = ["sku", "itemNumber", "itemNo", "item_no", "productCode", "product_code", "code"];
const CATEGORY_KEYS = ["category", "categoryName", "category_name", "productCategory", "group", "department", "type"];
const PRODUCT_TYPE_KEYS = ["product_type", "productType", "type", "productKind", "product_kind"];
const DESCRIPTION_KEYS = ["description", "desc", "longDescription", "long_description", "details"];
const STATUS_KEYS = ["isActive", "active", "enabled", "status", "inactive", "discontinued", "archived"];
const OPTION_CONTAINER_KEYS = ["options", "optionGroups", "option_groups", "attributes", "variants", "choices", "customFields", "custom_fields", "form_fields", "formFields"];
const FORM_FIELD_CONTAINER_KEYS = ["form_fields", "formFields", "fields", "customFields", "custom_fields", "input_fields", "inputFields"];
const MODAL_CONFIGURABLE_KEYS = ["modal_configurable", "modalConfigurable", "modal_config", "modalConfig", "configurable_modal", "configurableModal"];
const CONDITIONAL_MAP_KEYS = ["conditional_fields_map", "conditionalFieldsMap", "conditional_fields", "conditionalFields", "reveal_logic", "revealLogic"];
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
    ...PRODUCT_TYPE_KEYS,
    ...DESCRIPTION_KEYS,
    ...STATUS_KEYS,
    ...OPTION_CONTAINER_KEYS,
    ...FORM_FIELD_CONTAINER_KEYS,
    ...MODAL_CONFIGURABLE_KEYS,
    ...CONDITIONAL_MAP_KEYS,
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

function normalizeIdentifierPart(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "missing";
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

function booleanFromValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "yes", "y", "1", "required", "mandatory"].includes(normalized);
  }
  return false;
}

function productLikeScore(value: unknown): number {
  if (!isRecord(value)) return 0;
  let score = 0;
  if (findValue(value, NAME_KEYS) !== undefined) score += 4;
  if (findValue(value, SKU_KEYS) !== undefined) score += 2;
  if (findValue(value, CATEGORY_KEYS) !== undefined) score += 2;
  if (findValue(value, PRICING_KEYS) !== undefined) score += 2;
  if (findValue(value, OPTION_CONTAINER_KEYS) !== undefined) score += 1;
  if (findValue(value, FORM_FIELD_CONTAINER_KEYS) !== undefined) score += 3;
  if (findValue(value, CONDITIONAL_MAP_KEYS) !== undefined) score += 2;
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

type ParsedInfoFloOption = {
  text: string | null;
  value: string | null;
  raw: unknown;
  index: number;
};

type FieldParseContext = {
  productName: string;
  productType: string | null;
  productIndex: number;
  fields: CatalogMigrationLabSourceField[];
  conditionalLogic: ConditionalLogicSummary[];
  warnings: CatalogMigrationLabWarning[];
  seenIds: Set<string>;
};

type FieldParentContext = {
  parentField: string | null;
  parentOption: string | null;
  level: number;
  conditional: boolean;
  relationshipType: string;
};

function fieldLabelFromRecord(record: Record<string, unknown>, fallback: string): string {
  return stringFromValue(findValue(record, [
    "field_label",
    "fieldLabel",
    "label",
    "name",
    "field_name",
    "fieldName",
    "question",
    "title",
    "prompt",
    "text",
  ])) ?? fallback;
}

function fieldTypeFromRecord(record: Record<string, unknown>): string {
  return stringFromValue(findValue(record, [
    "field_type",
    "fieldType",
    "input_type",
    "inputType",
    "type",
    "component",
    "control_type",
    "controlType",
  ])) ?? "unknown";
}

function fieldInputTypeFromRecord(record: Record<string, unknown>): string | null {
  return stringFromValue(findValue(record, [
    "input_type",
    "inputType",
    "control_type",
    "controlType",
    "component",
    "html_input_type",
    "htmlInputType",
  ]));
}

function requiredFromRecord(record: Record<string, unknown>): boolean {
  const direct = findValue(record, ["required", "is_required", "isRequired", "mandatory", "is_mandatory"]);
  if (direct !== undefined) return booleanFromValue(direct);
  const validation = findValue(record, ["validation", "rules"]);
  if (isRecord(validation)) return booleanFromValue(findValue(validation, ["required", "mandatory"]));
  return false;
}

function suggestedOptionGroupFor(label: string, fieldType: string, optionText?: string | null): string | null {
  const text = `${label} ${fieldType} ${optionText ?? ""}`.toLowerCase();
  if (/(width|height|size|dimension|sq ?ft|length)/.test(text)) return "Size";
  if (/(qty|quantity|copies|pieces|count)/.test(text)) return "Quantity";
  if (/(material|substrate|stock|media|paper|vinyl|banner|coroplast|foam)/.test(text)) return "Materials";
  if (/(finish|finishing|hem|grommet|laminat|mount|pole|pocket|cut|drill|hardware)/.test(text)) return "Finishing";
  if (/(color|colour|ink|print|side)/.test(text)) return "Print Options";
  return label.trim() || null;
}

function analyzerIdFor(input: {
  productName: string;
  fieldLabel: string;
  fieldType: string;
  optionValue: string | null;
  level: number;
  position: number;
}): string {
  return [
    "if",
    normalizeIdentifierPart(input.productName),
    normalizeIdentifierPart(input.fieldLabel),
    normalizeIdentifierPart(input.fieldType),
    normalizeIdentifierPart(input.optionValue),
    `l${input.level}`,
    `p${input.position}`,
  ].join("-");
}

function collectionValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return Object.values(value);
  return [];
}

function parseOption(raw: unknown, index: number): ParsedInfoFloOption | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) {
    const text = stringFromValue(raw);
    return text ? { text, value: text, raw, index } : null;
  }
  const text = stringFromValue(findValue(raw, [
    "option_text",
    "optionText",
    "text",
    "label",
    "name",
    "title",
    "display",
    "display_text",
  ]));
  const value = stringFromValue(findValue(raw, [
    "option_value",
    "optionValue",
    "value",
    "key",
    "code",
    "id",
    "name",
    "label",
  ]));
  if (!text && !value) return null;
  return { text: text ?? value, value: value ?? text, raw, index };
}

function extractFieldOptions(record: Record<string, unknown>): ParsedInfoFloOption[] {
  const containers = [
    findValue(record, ["options"]),
    findValue(record, ["select_options", "selectOptions"]),
    findValue(record, ["option_values", "optionValues"]),
    findValue(record, ["values"]),
    findValue(record, ["choices"]),
    findValue(record, ["items"]),
  ];
  const options: ParsedInfoFloOption[] = [];
  const seen = new Set<string>();

  for (const container of containers) {
    collectionValues(container).forEach((raw, index) => {
      const parsed = parseOption(raw, index);
      if (!parsed) return;
      const signature = `${parsed.text ?? ""}\u0000${parsed.value ?? ""}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      options.push(parsed);
    });
  }
  return options;
}

function isUnnamedFieldId(record: Record<string, unknown>): boolean {
  const fieldId = stringFromValue(findValue(record, ["field_id", "fieldId", "id"]));
  return Boolean(fieldId && fieldId.trim().toLowerCase() === "unnamed");
}

function looksLikeFieldRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return Boolean(
    findValue(value, ["field_label", "fieldLabel", "label", "field_name", "fieldName", "question", "prompt"]) !== undefined ||
    findValue(value, ["field_type", "fieldType", "input_type", "inputType", "type", "component"]) !== undefined ||
    findValue(value, ["options", "values", "choices", "select_options", "option_values"]) !== undefined,
  );
}

function childFieldCollections(record: Record<string, unknown>): Array<{ key: string; value: unknown }> {
  return [
    { key: "children", value: findValue(record, ["children"]) },
    { key: "fields", value: findValue(record, ["fields"]) },
    { key: "questions", value: findValue(record, ["questions"]) },
    { key: "child_fields", value: findValue(record, ["child_fields", "childFields"]) },
    { key: "reveal_fields", value: findValue(record, ["reveal_fields", "revealFields"]) },
    { key: "conditional_fields", value: findValue(record, ["conditional_fields", "conditionalFields"]) },
  ].filter((entry) => entry.value !== undefined);
}

function optionRevealCollections(option: ParsedInfoFloOption): Array<{ key: string; value: unknown }> {
  if (!isRecord(option.raw)) return [];
  return [
    { key: "children", value: findValue(option.raw, ["children"]) },
    { key: "fields", value: findValue(option.raw, ["fields"]) },
    { key: "reveal_fields", value: findValue(option.raw, ["reveal_fields", "revealFields"]) },
    { key: "conditional_fields", value: findValue(option.raw, ["conditional_fields", "conditionalFields"]) },
  ].filter((entry) => entry.value !== undefined);
}

function pushFieldRow(
  ctx: FieldParseContext,
  rawField: Record<string, unknown>,
  sourcePath: string,
  parent: FieldParentContext,
  position: number,
  option: ParsedInfoFloOption | null,
): CatalogMigrationLabSourceField {
  const fieldLabel = fieldLabelFromRecord(rawField, `Field ${position + 1}`);
  const fieldType = fieldTypeFromRecord(rawField);
  const optionValue = option?.value ?? null;
  const analyzerId = analyzerIdFor({
    productName: ctx.productName,
    fieldLabel,
    fieldType,
    optionValue,
    level: parent.level,
    position,
  });
  const uniqueAnalyzerId = ctx.seenIds.has(analyzerId) ? `${analyzerId}-${ctx.fields.length}` : analyzerId;
  ctx.seenIds.add(uniqueAnalyzerId);

  const row: CatalogMigrationLabSourceField = {
    analyzerId: uniqueAnalyzerId,
    productName: ctx.productName,
    productType: ctx.productType,
    fieldLabel,
    fieldType,
    required: requiredFromRecord(rawField),
    optionText: option?.text ?? null,
    optionValue,
    parentField: parent.parentField,
    parentOption: parent.parentOption,
    level: parent.level,
    conditional: parent.conditional,
    suggestedOptionGroup: suggestedOptionGroupFor(fieldLabel, fieldType, option?.text),
    inputType: fieldInputTypeFromRecord(rawField),
    sourcePath,
  };

  ctx.fields.push(row);
  if (parent.conditional && (parent.parentField || parent.parentOption)) {
    ctx.conditionalLogic.push({
      productName: ctx.productName,
      parentField: parent.parentField,
      parentOption: parent.parentOption,
      childField: fieldLabel,
      childFieldType: fieldType,
      level: parent.level,
      relationshipType: parent.relationshipType,
      sourcePath,
    });
  }
  return row;
}

function parseFieldRecord(
  rawField: unknown,
  sourcePath: string,
  ctx: FieldParseContext,
  parent: FieldParentContext,
  position: number,
): void {
  if (!looksLikeFieldRecord(rawField)) return;
  const record = rawField;
  if (isUnnamedFieldId(record)) {
    ctx.warnings.push({
      code: "UNNAMED_FIELD_ID",
      severity: "info",
      message: `InfoFlo field_id "unnamed" ignored for stable analyzer ID generation in "${ctx.productName}".`,
      productIndex: ctx.productIndex,
      productName: ctx.productName,
      path: sourcePath,
    });
  }

  const options = extractFieldOptions(record);
  if (options.length === 0) {
    pushFieldRow(ctx, record, sourcePath, parent, position, null);
  } else {
    options.forEach((option, optionIndex) => {
      pushFieldRow(ctx, record, `${sourcePath}.options[${optionIndex}]`, parent, position + optionIndex, option);
    });
  }

  const fieldLabel = fieldLabelFromRecord(record, `Field ${position + 1}`);
  for (const option of options) {
    for (const collection of optionRevealCollections(option)) {
      collectionValues(collection.value).forEach((child, childIndex) => {
        parseFieldRecord(child, `${sourcePath}.${collection.key}[${childIndex}]`, ctx, {
          parentField: fieldLabel,
          parentOption: option.text ?? option.value,
          level: parent.level + 1,
          conditional: true,
          relationshipType: "option_reveal",
        }, childIndex);
      });
    }
  }

  for (const collection of childFieldCollections(record)) {
    collectionValues(collection.value).forEach((child, childIndex) => {
      parseFieldRecord(child, `${sourcePath}.${collection.key}[${childIndex}]`, ctx, {
        parentField: fieldLabel,
        parentOption: null,
        level: parent.level + 1,
        conditional: true,
        relationshipType: "field_reveal",
      }, childIndex);
    });
  }
}

function collectFormFieldContainers(record: Record<string, unknown>): Array<{ path: string; value: unknown }> {
  const containers: Array<{ path: string; value: unknown }> = [];
  const seenValues = new Set<unknown>();
  for (const key of FORM_FIELD_CONTAINER_KEYS) {
    const value = findValue(record, [key]);
    if (value !== undefined && !seenValues.has(value)) {
      seenValues.add(value);
      containers.push({ path: key, value });
    }
  }
  for (const key of MODAL_CONFIGURABLE_KEYS) {
    const modal = findValue(record, [key]);
    if (!isRecord(modal)) continue;
    for (const fieldKey of FORM_FIELD_CONTAINER_KEYS) {
      const value = findValue(modal, [fieldKey]);
      if (value !== undefined && !seenValues.has(value)) {
        seenValues.add(value);
        containers.push({ path: `${key}.${fieldKey}`, value });
      }
    }
  }
  return containers;
}

function parseConditionalMapBranch(
  value: unknown,
  sourcePath: string,
  ctx: FieldParseContext,
  parentField: string | null,
  parentOption: string | null,
  level: number,
  unresolvedParent = false,
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      if (looksLikeFieldRecord(child)) {
        parseFieldRecord(child, `${sourcePath}[${index}]`, ctx, {
          parentField,
          parentOption,
          level,
          conditional: true,
          relationshipType: "conditional_fields_map",
        }, index);
      } else {
        parseConditionalMapBranch(child, `${sourcePath}[${index}]`, ctx, parentField, parentOption, level, unresolvedParent);
      }
    });
    return;
  }

  if (!isRecord(value)) return;
  if (looksLikeFieldRecord(value)) {
    parseFieldRecord(value, sourcePath, ctx, {
      parentField,
      parentOption,
      level,
      conditional: true,
      relationshipType: "conditional_fields_map",
    }, 0);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const cleanKey = key.trim().toLowerCase() === "unnamed" ? null : key;
    const nextUnresolvedParent = unresolvedParent || cleanKey === null;
    const nextParentField = cleanKey === null
      ? parentField
      : unresolvedParent
        ? parentField
        : parentField ?? cleanKey;
    const nextParentOption = cleanKey === null
      ? parentOption
      : unresolvedParent
        ? cleanKey
        : parentField
          ? cleanKey
          : parentOption;
    parseConditionalMapBranch(
      child,
      `${sourcePath}.${key}`,
      ctx,
      nextParentField,
      nextParentOption,
      level + 1,
      nextUnresolvedParent && cleanKey === null,
    );
  }
}

function parseConditionalMaps(record: Record<string, unknown>, ctx: FieldParseContext): void {
  for (const key of CONDITIONAL_MAP_KEYS) {
    const value = findValue(record, [key]);
    if (value === undefined) continue;
    parseConditionalMapBranch(value, key, ctx, null, null, 1);
  }
}

function extractSourceFieldsAndConditionals(
  record: Record<string, unknown>,
  productName: string,
  productType: string | null,
  productIndex: number,
  warnings: CatalogMigrationLabWarning[],
): { fields: CatalogMigrationLabSourceField[]; conditionalLogic: ConditionalLogicSummary[] } {
  const ctx: FieldParseContext = {
    productName,
    productType,
    productIndex,
    fields: [],
    conditionalLogic: [],
    warnings,
    seenIds: new Set<string>(),
  };

  const containers = collectFormFieldContainers(record);
  containers.forEach((container) => {
    collectionValues(container.value).forEach((field, index) => {
      parseFieldRecord(field, `${container.path}[${index}]`, ctx, {
        parentField: null,
        parentOption: null,
        level: 0,
        conditional: false,
        relationshipType: "form_fields",
      }, index);
    });
  });
  parseConditionalMaps(record, ctx);

  return { fields: ctx.fields, conditionalLogic: ctx.conditionalLogic };
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
  conditionalLogic: ConditionalLogicSummary[];
} {
  const warnings: CatalogMigrationLabWarning[] = [];
  const record = isRecord(raw) ? raw : {};
  const name = stringFromValue(findValue(record, NAME_KEYS));
  const productName = name ?? `Product #${index + 1}`;
  const productType = stringFromValue(findValue(record, PRODUCT_TYPE_KEYS));
  const category = stringFromValue(findValue(record, CATEGORY_KEYS));
  const pricingFields = extractPricingFields(record);
  const structure = extractSourceFieldsAndConditionals(record, productName, productType, index, warnings);
  const optionNames = Array.from(new Set([
    ...extractOptionNames(record),
    ...structure.fields.map((field) => field.fieldLabel),
  ])).sort((a, b) => a.localeCompare(b));
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
  if (structure.fields.length === 0) {
    warnings.push({
      code: "MISSING_FORM_FIELDS",
      severity: "info",
      message: `Product "${name ?? `#${index + 1}`}" has no recognizable InfoFlo form_fields structure.`,
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
      productType,
      status: statusFromRecord(record),
      category,
      description: stringFromValue(findValue(record, DESCRIPTION_KEYS)),
      optionNames,
      materialReferences: extractMaterialReferences(record),
      pricingFields,
      sourceFields: structure.fields,
      unsupportedFieldNames: unsupported.map((entry) => entry.fieldName).sort((a, b) => a.localeCompare(b)),
    },
    unsupported,
    warnings,
    conditionalLogic: structure.conditionalLogic,
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
      conditionalLogic: [],
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
  const conditionalLogic: ConditionalLogicSummary[] = [];

  rawProducts.forEach((raw, index) => {
    const productPath = detectedProductPath ? `${detectedProductPath}[${index}]` : `$[${index}]`;
    const normalized = normalizeProduct(raw, index, productPath);
    products.push(normalized.product);
    unsupportedEntries.push(...normalized.unsupported);
    warnings.push(...normalized.warnings);
    conditionalLogic.push(...normalized.conditionalLogic);
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
    conditionalLogic,
    warnings,
  };
}
