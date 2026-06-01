export type QuoteCreateTaxLineItem = {
  taxAmount: number;
  isTaxableSnapshot: boolean;
};

export type JsonSanitizeChange = {
  path: string;
  reason: "undefined" | "non_finite_number" | "unsupported_type" | "date";
};

export class QuoteCreateLineItemValidationError extends Error {
  status = 422;
  code = "QUOTE_LINE_ITEM_INVALID";
  lineItemIndex: number;
  field: string;

  constructor(message: string, args: { lineItemIndex: number; field: string }) {
    super(message);
    this.name = "QuoteCreateLineItemValidationError";
    this.lineItemIndex = args.lineItemIndex;
    this.field = args.field;
  }
}

function pathJoin(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function sanitizeJsonForPostgres(
  value: unknown,
  path = "",
  changes: JsonSanitizeChange[] = [],
  seen = new WeakSet<object>(),
): { value: unknown; changes: JsonSanitizeChange[] } {
  if (value === null) return { value: null, changes };

  if (typeof value === "string" || typeof value === "boolean") {
    return { value, changes };
  }

  if (typeof value === "number") {
    if (Number.isFinite(value)) return { value, changes };
    changes.push({ path, reason: "non_finite_number" });
    return { value: null, changes };
  }

  if (value === undefined) {
    changes.push({ path, reason: "undefined" });
    return { value: null, changes };
  }

  if (value instanceof Date) {
    changes.push({ path, reason: "date" });
    return { value: Number.isNaN(value.getTime()) ? null : value.toISOString(), changes };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      changes.push({ path, reason: "unsupported_type" });
      return { value: null, changes };
    }
    seen.add(value);
    return {
      value: value.map((entry, index) =>
        sanitizeJsonForPostgres(entry, pathJoin(path, index), changes, seen).value
      ),
      changes,
    };
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      changes.push({ path, reason: "unsupported_type" });
      return { value: null, changes };
    }
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = sanitizeJsonForPostgres(entry, pathJoin(path, key), changes, seen).value;
    }
    return { value: out, changes };
  }

  changes.push({ path, reason: "unsupported_type" });
  return { value: null, changes };
}

function toFiniteNumber(raw: unknown, field: string, index: number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    throw new QuoteCreateLineItemValidationError(
      `Line item ${index + 1} has invalid ${field}. Please recalculate pricing before saving.`,
      { lineItemIndex: index, field },
    );
  }
  return value;
}

function toPositiveInteger(raw: unknown, field: string, index: number): number {
  const value = Math.trunc(toFiniteNumber(raw, field, index));
  if (value <= 0) {
    throw new QuoteCreateLineItemValidationError(
      `Line item ${index + 1} has invalid ${field}. Please recalculate pricing before saving.`,
      { lineItemIndex: index, field },
    );
  }
  return value;
}

function toValidDateOrNow(raw: unknown): Date {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === "string" || typeof raw === "number") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function hasExplicitPriceOverrideMetadata(value: any): boolean {
  const override = value?.priceOverride;
  const overrideRecord = override && typeof override === "object" && !Array.isArray(override) ? override : null;
  const mode = overrideRecord?.mode ?? overrideRecord?.priceOverrideMode ?? value?.priceOverrideMode;
  const hasMode = typeof mode === "string" && mode.trim().length > 0;
  const hasValue =
    overrideRecord?.valueCents !== undefined ||
    overrideRecord?.priceOverrideValueCents !== undefined ||
    overrideRecord?.value !== undefined ||
    value?.priceOverrideValueCents !== undefined ||
    value?.priceOverrideValuePercent !== undefined;

  return hasMode && hasValue;
}

export function normalizeQuoteCreateLineItem(
  item: any,
  index: number,
  taxData: QuoteCreateTaxLineItem,
): { lineItem: Record<string, unknown>; jsonChanges: JsonSanitizeChange[] } {
  if (!item?.productId || !item?.productName) {
    throw new QuoteCreateLineItemValidationError(
      `Line item ${index + 1} is missing a product. Please select the product again before saving.`,
      { lineItemIndex: index, field: "productId" },
    );
  }

  const width = toFiniteNumber(item.width, "width", index);
  const height = toFiniteNumber(item.height, "height", index);
  const quantity = toPositiveInteger(item.quantity, "quantity", index);
  const linePrice = toFiniteNumber(item.linePrice, "line price", index);

  if (width <= 0 || height <= 0 || linePrice < 0) {
    throw new QuoteCreateLineItemValidationError(
      `Line item ${index + 1} has invalid dimensions or price. Please recalculate pricing before saving.`,
      { lineItemIndex: index, field: "dimensions_or_price" },
    );
  }

  const jsonChanges: JsonSanitizeChange[] = [];
  const specsJson = sanitizeJsonForPostgres(item.specsJson || null, `lineItems[${index}].specsJson`, jsonChanges).value;
  const selectedOptions = sanitizeJsonForPostgres(item.selectedOptions || [], `lineItems[${index}].selectedOptions`, jsonChanges).value;
  const optionSelectionsJson = sanitizeJsonForPostgres(item.optionSelectionsJson ?? null, `lineItems[${index}].optionSelectionsJson`, jsonChanges).value;
  const priceBreakdown = sanitizeJsonForPostgres(item.priceBreakdown || {
    basePrice: linePrice,
    optionsPrice: 0,
    total: linePrice,
    formula: "",
  }, `lineItems[${index}].priceBreakdown`, jsonChanges).value;
  const materialUsages = sanitizeJsonForPostgres(item.materialUsages ?? item.priceBreakdown?.materialUsages ?? [], `lineItems[${index}].materialUsages`, jsonChanges).value;
  const pbv2SnapshotJson = sanitizeJsonForPostgres(item.pbv2SnapshotJson ?? {}, `lineItems[${index}].pbv2SnapshotJson`, jsonChanges).value;
  const hasExplicitOverride = hasExplicitPriceOverrideMetadata(item);

  return {
    lineItem: {
      productId: item.productId,
      productName: item.productName,
      variantId: item.variantId || null,
      variantName: item.variantName || null,
      productType: item.productType || "wide_roll",
      width,
      height,
      quantity,
      specsJson,
      optionSelectionsJson,
      selectedOptions,
      linePrice,
      priceBreakdown,
      priceOverride: hasExplicitOverride ? (item.priceOverride ?? null) : null,
      materialUsages,
      displayOrder: item.displayOrder || 0,
      description: item.description || null,
      productionNotes: item.productionNotes || null,
      overridePriceCents: hasExplicitOverride && Number.isFinite(Number(item.overridePriceCents)) ? Math.round(Number(item.overridePriceCents)) : null,
      overrideReason: item.overrideReason ?? null,
      requiresDesign: item.requiresDesign === true,
      requiresPrepress: typeof item.requiresPrepress === "boolean" ? item.requiresPrepress : null,
      taxAmount: taxData.taxAmount.toString(),
      isTaxableSnapshot: taxData.isTaxableSnapshot,
      pbv2TreeVersionId: typeof item.pbv2TreeVersionId === "string" && item.pbv2TreeVersionId.trim()
        ? item.pbv2TreeVersionId.trim()
        : null,
      pbv2SnapshotJson,
      pricedAt: toValidDateOrNow(item.pricedAt),
    },
    jsonChanges,
  };
}
