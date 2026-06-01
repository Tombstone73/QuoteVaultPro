import {
  normalizeLineItemPriceOverride,
  resolveLineItemEffectivePricing,
  type LineItemEffectivePricing,
} from "@shared/lineItemPriceOverrides";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function withoutUndefined<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function nullableString(value: unknown): string | null {
  if (value === undefined || value === null || value === "" || value === "_none") return null;
  return String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;
}

function toFiniteCents(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return isPlainRecord(value) ? value : {};
}

function getSelectedOptionsForFingerprint(lineItem: Record<string, unknown>): unknown {
  if (lineItem.optionSelectionsJson !== undefined) {
    const optionSelectionsJson = lineItem.optionSelectionsJson;
    if (isPlainRecord(optionSelectionsJson) && isPlainRecord(optionSelectionsJson.selected)) {
      return optionSelectionsJson.selected;
    }
    if (optionSelectionsJson !== null) return optionSelectionsJson;
  }

  if (lineItem.selectedOptions !== undefined) return lineItem.selectedOptions ?? null;

  const specs = getNestedRecord(lineItem, "specsJson");
  return specs.selectedOptions ?? null;
}

export function getPersistedBaseCalculatedTotalCents(lineItem: Record<string, any>): number {
  const effectiveTotalCents = Math.round((Number(lineItem.totalPrice) || 0) * 100);
  const specsJson = isPlainRecord(lineItem.specsJson) ? lineItem.specsJson : {};
  const specsOverride = isPlainRecord(specsJson.priceOverride) ? specsJson.priceOverride : {};
  const snapshotPricing = isPlainRecord(lineItem.pbv2SnapshotJson?.pricing) ? lineItem.pbv2SnapshotJson.pricing : {};
  const repairBase =
    toFiniteCents(specsOverride.originalBaseCalculatedTotalCents) ??
    toFiniteCents(specsOverride.previousBaseCalculatedTotalCents) ??
    toFiniteCents(specsOverride.lastKnownBaseCalculatedTotalCents) ??
    toFiniteCents(specsJson.originalBaseCalculatedTotalCents) ??
    toFiniteCents(snapshotPricing.originalTotalCents) ??
    toFiniteCents(snapshotPricing.previousTotalCents);
  if (repairBase !== null) return repairBase;

  const baseFromSpecs = isPlainRecord(lineItem.specsJson) && isPlainRecord(lineItem.specsJson.priceOverride)
    ? Number(lineItem.specsJson.priceOverride.baseCalculatedTotalCents)
    : NaN;
  const baseFromSnapshot = Number(lineItem.pbv2SnapshotJson?.pricing?.totalCents);

  if (Number.isFinite(baseFromSpecs)) return Math.round(baseFromSpecs);
  if (Number.isFinite(baseFromSnapshot)) return Math.round(baseFromSnapshot);
  return effectiveTotalCents;
}

export function buildLineItemPricingDriverFingerprint(lineItem: Record<string, unknown>): string {
  const snapshot = getNestedRecord(lineItem, "pbv2SnapshotJson");
  return stableStringify({
    productId: nullableString(lineItem.productId),
    productVariantId: nullableString(lineItem.productVariantId ?? lineItem.variantId),
    materialId: nullableString(lineItem.materialId),
    width: nullableNumber(lineItem.width),
    height: nullableNumber(lineItem.height),
    quantity: nullableNumber(lineItem.quantity),
    pbv2TreeVersionId: nullableString(lineItem.pbv2TreeVersionId ?? snapshot.treeVersionId),
    selectedOptions: getSelectedOptionsForFingerprint(lineItem),
  });
}

export function haveLineItemPricingDriversChanged(input: {
  existingLineItem: Record<string, unknown>;
  incomingUpdate: Record<string, unknown>;
  pbv2ExplicitSelections?: unknown;
}): boolean {
  const incomingUpdate = withoutUndefined(input.incomingUpdate);
  const merged = {
    ...input.existingLineItem,
    ...incomingUpdate,
  };

  if (input.pbv2ExplicitSelections !== undefined && input.pbv2ExplicitSelections !== null) {
    merged.optionSelectionsJson = {
      schemaVersion: 2,
      selected: input.pbv2ExplicitSelections,
    };
  }

  return buildLineItemPricingDriverFingerprint(input.existingLineItem) !== buildLineItemPricingDriverFingerprint(merged);
}

export function getPersistedPriceOverrideSource(input: {
  body?: unknown;
  specsJson?: unknown;
  legacyOverridePriceCents?: unknown;
}) {
  const body = isPlainRecord(input.body) ? input.body : {};
  const specsJson = isPlainRecord(input.specsJson) ? input.specsJson : {};
  const clearsOverride =
    body.priceOverride === null ||
    body.priceOverrideMode === null ||
    body.overridePriceCents === null;
  const specsOverride = !clearsOverride && isPlainRecord(specsJson.priceOverride) ? specsJson.priceOverride : {};

  if (clearsOverride) {
    return {
      ...body,
      priceOverride: null,
      overridePriceCents: null,
    };
  }

  return {
    ...specsOverride,
    ...body,
    priceOverride: isPlainRecord(body.priceOverride) ? body.priceOverride : specsOverride,
    overridePriceCents: body.overridePriceCents ?? specsOverride.overridePriceCents ?? input.legacyOverridePriceCents,
  };
}

export function resolvePersistedLineItemPricing(input: {
  baseCalculatedTotalCents: unknown;
  quantity: unknown;
  body?: unknown;
  specsJson?: unknown;
  legacyOverridePriceCents?: unknown;
}): LineItemEffectivePricing {
  const rawOverride = getPersistedPriceOverrideSource(input);
  const legacyOverridePriceCents = isPlainRecord(rawOverride) ? rawOverride.overridePriceCents : input.legacyOverridePriceCents;
  const { override, warnings } = normalizeLineItemPriceOverride(rawOverride, legacyOverridePriceCents);
  const resolved = resolveLineItemEffectivePricing({
    baseCalculatedTotalCents: input.baseCalculatedTotalCents,
    quantity: input.quantity,
    override,
  });

  return {
    ...resolved,
    warnings: [...warnings, ...resolved.warnings],
  };
}

export function mergePricingIntoSpecsJson(input: {
  specsJson: unknown;
  pricing: LineItemEffectivePricing;
  appliedAt?: string;
}): Record<string, unknown> | null {
  const base = isPlainRecord(input.specsJson) ? { ...input.specsJson } : {};
  const pricing = input.pricing;

  if (!pricing.hasPriceOverride) {
    const { priceOverride: _removedPriceOverride, priceOverrideWarnings: _removedWarnings, ...rest } = base;
    return Object.keys(rest).length ? rest : null;
  }

  return {
    ...base,
    priceOverride: {
      schemaVersion: 1,
      mode: pricing.priceOverrideMode,
      valueCents: pricing.priceOverrideValueCents,
      valuePercent: pricing.priceOverrideValuePercent,
      baseCalculatedUnitPriceCents: pricing.baseCalculatedUnitPriceCents,
      baseCalculatedTotalCents: pricing.baseCalculatedTotalCents,
      effectiveUnitPriceCents: pricing.effectiveUnitPriceCents,
      effectiveTotalCents: pricing.effectiveTotalCents,
      appliedAt: input.appliedAt ?? new Date().toISOString(),
    },
    ...(pricing.warnings.length ? { priceOverrideWarnings: pricing.warnings } : {}),
  };
}

function toDollars(cents: number): number {
  return Math.round(cents) / 100;
}

function getLinePriceBaseTotalCents(lineItem: Record<string, any>): number | null {
  const linePrice = Number(lineItem.linePrice);
  return Number.isFinite(linePrice) ? Math.round(linePrice * 100) : null;
}

function mergePriceBreakdownTotal(priceBreakdown: unknown, totalDollars: number, baseTotalCents: number): Record<string, unknown> {
  const base = isPlainRecord(priceBreakdown) ? { ...priceBreakdown } : {};
  return {
    ...base,
    basePrice: typeof base.basePrice === "number" ? base.basePrice : toDollars(baseTotalCents),
    total: totalDollars,
  };
}

export function buildQuoteLineItemPriceOverridePersistencePatch(input: {
  existingLineItem: Record<string, any>;
  incomingUpdate: Record<string, any>;
  baseCalculatedTotalCents?: number | null;
  appliedAt?: string;
}): {
  linePrice: number;
  formulaLinePrice: number | null;
  overridePriceCents: number | null;
  specsJson: Record<string, unknown> | null;
  priceBreakdown: Record<string, unknown>;
  pricing: LineItemEffectivePricing;
} {
  const persistedBaseCalculatedTotalCents = getPersistedBaseCalculatedTotalCents(input.existingLineItem);
  const linePriceBaseTotalCents = getLinePriceBaseTotalCents(input.existingLineItem);
  const baseCalculatedTotalCents =
    input.baseCalculatedTotalCents ??
    (persistedBaseCalculatedTotalCents > 0 ? persistedBaseCalculatedTotalCents : linePriceBaseTotalCents ?? persistedBaseCalculatedTotalCents) ??
    0;
  const quantity = input.incomingUpdate.quantity ?? input.existingLineItem.quantity;
  const pricing = resolvePersistedLineItemPricing({
    baseCalculatedTotalCents,
    quantity,
    body: input.incomingUpdate,
    specsJson: input.existingLineItem.specsJson,
    legacyOverridePriceCents: input.existingLineItem.overridePriceCents,
  });
  const effectiveTotalDollars = toDollars(pricing.effectiveTotalCents);

  return {
    linePrice: effectiveTotalDollars,
    formulaLinePrice: pricing.hasPriceOverride ? toDollars(pricing.baseCalculatedTotalCents) : null,
    overridePriceCents: pricing.hasPriceOverride ? pricing.effectiveTotalCents : null,
    specsJson: mergePricingIntoSpecsJson({
      specsJson: input.existingLineItem.specsJson,
      pricing,
      appliedAt: input.appliedAt,
    }),
    priceBreakdown: mergePriceBreakdownTotal(
      input.existingLineItem.priceBreakdown,
      effectiveTotalDollars,
      pricing.baseCalculatedTotalCents,
    ),
    pricing,
  };
}

export function enrichLineItemWithEffectivePricing<T extends Record<string, any>>(lineItem: T): T & LineItemEffectivePricing {
  const quantity = Number(lineItem.quantity) > 0 ? Number(lineItem.quantity) : 1;
  const effectiveTotalCents = Math.round((Number(lineItem.totalPrice) || 0) * 100);
  const baseCalculatedTotalCents = getPersistedBaseCalculatedTotalCents(lineItem);

  const pricing = resolvePersistedLineItemPricing({
    baseCalculatedTotalCents,
    quantity,
    specsJson: lineItem.specsJson,
    legacyOverridePriceCents: lineItem.overridePriceCents,
  });

  return {
    ...lineItem,
    ...pricing,
    effectiveTotalCents,
    effectiveUnitPriceCents: Math.round(effectiveTotalCents / quantity),
  };
}
