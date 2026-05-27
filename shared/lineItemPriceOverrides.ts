export const lineItemPriceOverrideModes = [
  "override_total_before_margin",
  "override_unit_before_margin",
  "override_total_after_margin",
  "override_unit_after_margin",
  "apply_discount",
  "append_value",
] as const;

export type LineItemPriceOverrideMode = (typeof lineItemPriceOverrideModes)[number];

export type NormalizedLineItemPriceOverride = {
  mode: LineItemPriceOverrideMode;
  valueCents: number | null;
  valuePercent: number | null;
};

export type LineItemEffectivePricing = {
  baseCalculatedUnitPriceCents: number;
  baseCalculatedTotalCents: number;
  effectiveUnitPriceCents: number;
  effectiveTotalCents: number;
  priceOverrideMode: LineItemPriceOverrideMode | null;
  priceOverrideValueCents: number | null;
  priceOverrideValuePercent: number | null;
  hasPriceOverride: boolean;
  warnings: string[];
};

export type LineItemEditPricingState = LineItemEffectivePricing & {
  persistedEffectiveTotalCents: number;
  persistedEffectiveUnitPriceCents: number;
};

const modeSet = new Set<string>(lineItemPriceOverrideModes);

export function isLineItemPriceOverrideMode(value: unknown): value is LineItemPriceOverrideMode {
  return typeof value === "string" && modeSet.has(value);
}

export function getLineItemPriceOverrideLabel(mode: LineItemPriceOverrideMode | null | undefined): string {
  switch (mode) {
    case "override_total_before_margin":
      return "Total before margin";
    case "override_unit_before_margin":
      return "Unit before margin";
    case "override_total_after_margin":
      return "Total override";
    case "override_unit_after_margin":
      return "Unit override";
    case "apply_discount":
      return "Discount";
    case "append_value":
      return "Add value";
    default:
      return "Override";
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function toCents(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  return Math.max(0, Math.round(n));
}

function toDollarsAsCents(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  return Math.max(0, Math.round(n * 100));
}

function toPercent(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  return Math.max(0, Math.min(100, n));
}

function normalizeMode(value: unknown): LineItemPriceOverrideMode | null {
  if (isLineItemPriceOverrideMode(value)) return value;
  if (value === "total") return "override_total_after_margin";
  if (value === "unit") return "override_unit_after_margin";
  return null;
}

function getObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getLineItemPriceOverrideRecord(lineItem: unknown): Record<string, unknown> {
  const record = getObjectRecord(lineItem);
  const specs = getObjectRecord(record.specsJson);
  const specsOverride = getObjectRecord(specs.priceOverride);
  const topLevelOverride = {
    priceOverrideMode: record.priceOverrideMode,
    priceOverrideValueCents: record.priceOverrideValueCents,
    priceOverrideValuePercent: record.priceOverrideValuePercent,
    overridePriceCents: record.overridePriceCents,
  };
  return { ...specsOverride, ...topLevelOverride };
}

function getPbv2SnapshotTotalCents(lineItem: unknown): number | null {
  const record = getObjectRecord(lineItem);
  const snapshot = getObjectRecord(record.pbv2SnapshotJson);
  const pricing = getObjectRecord(snapshot.pricing);
  return toCents(pricing.totalCents);
}

function getLineItemQuantity(lineItem: unknown): number {
  const record = getObjectRecord(lineItem);
  const quantityRaw = toFiniteNumber(record.quantity);
  return quantityRaw !== null && quantityRaw > 0 ? quantityRaw : 1;
}

export function hydrateLineItemEditPricingState(lineItem: unknown): LineItemEditPricingState {
  const record = getObjectRecord(lineItem);
  const quantity = getLineItemQuantity(record);
  const overrideRecord = getLineItemPriceOverrideRecord(record);
  const topLevelHasOverride = typeof record.hasPriceOverride === "boolean" ? record.hasPriceOverride : null;
  const hasExplicitOverrideShape =
    normalizeMode(overrideRecord.priceOverrideMode ?? overrideRecord.mode) !== null ||
    toCents(overrideRecord.priceOverrideValueCents ?? overrideRecord.valueCents) !== null ||
    toPercent(overrideRecord.priceOverrideValuePercent ?? overrideRecord.valuePercent) !== null;

  const allowLegacyOverride = topLevelHasOverride !== false && (topLevelHasOverride === true || hasExplicitOverrideShape);
  const normalized = topLevelHasOverride === false
    ? { override: null, warnings: [] as string[] }
    : normalizeLineItemPriceOverride(
        overrideRecord,
        allowLegacyOverride ? overrideRecord.overridePriceCents : null,
      );

  const persistedEffectiveTotalCents =
    toCents(record.effectiveTotalCents) ??
    toCents(overrideRecord.effectiveTotalCents) ??
    toDollarsAsCents(record.totalPrice) ??
    0;

  const baseCalculatedTotalCents =
    toCents(record.baseCalculatedTotalCents) ??
    toCents(overrideRecord.baseCalculatedTotalCents) ??
    getPbv2SnapshotTotalCents(record) ??
    (normalized.override ? persistedEffectiveTotalCents : persistedEffectiveTotalCents);

  const resolved = resolveLineItemEffectivePricing({
    baseCalculatedTotalCents,
    quantity,
    override: normalized.override,
  });
  resolved.warnings.push(...normalized.warnings);

  const effectiveTotalCents =
    toCents(record.effectiveTotalCents) ??
    toCents(overrideRecord.effectiveTotalCents) ??
    (resolved.hasPriceOverride ? resolved.effectiveTotalCents : persistedEffectiveTotalCents);
  const effectiveUnitPriceCents =
    toCents(record.effectiveUnitPriceCents) ??
    toCents(overrideRecord.effectiveUnitPriceCents) ??
    Math.round(effectiveTotalCents / quantity);

  return {
    ...resolved,
    effectiveTotalCents,
    effectiveUnitPriceCents,
    persistedEffectiveTotalCents: effectiveTotalCents,
    persistedEffectiveUnitPriceCents: effectiveUnitPriceCents,
    hasPriceOverride: normalized.override !== null,
    priceOverrideMode: normalized.override?.mode ?? null,
    priceOverrideValueCents: normalized.override?.valueCents ?? null,
    priceOverrideValuePercent: normalized.override?.valuePercent ?? null,
  };
}

export function applyLineItemEditPriceOverride(input: {
  baseCalculatedTotalCents: unknown;
  quantity: unknown;
  mode: LineItemPriceOverrideMode;
  valueCents?: unknown;
  valuePercent?: unknown;
}): LineItemEffectivePricing {
  return resolveLineItemEffectivePricing({
    baseCalculatedTotalCents: input.baseCalculatedTotalCents,
    quantity: input.quantity,
    override: {
      mode: input.mode,
      valueCents: toCents(input.valueCents),
      valuePercent: toPercent(input.valuePercent),
    },
  });
}

export function normalizeLineItemPriceOverride(
  raw: unknown,
  legacyOverridePriceCents?: unknown,
): { override: NormalizedLineItemPriceOverride | null; warnings: string[] } {
  const warnings: string[] = [];
  const record = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const nested = record.priceOverride && typeof record.priceOverride === "object" && !Array.isArray(record.priceOverride)
    ? (record.priceOverride as Record<string, unknown>)
    : {};

  const mode = normalizeMode(
    record.priceOverrideMode ??
      record.mode ??
      nested.priceOverrideMode ??
      nested.mode,
  );
  const legacyCents = toCents(legacyOverridePriceCents ?? record.overridePriceCents ?? nested.overridePriceCents);

  if (!mode && legacyCents !== null) {
    return {
      override: {
        mode: "override_total_after_margin",
        valueCents: legacyCents,
        valuePercent: null,
      },
      warnings,
    };
  }

  if (!mode) return { override: null, warnings };

  const explicitCents = toCents(
    record.priceOverrideValueCents ??
      record.valueCents ??
      nested.priceOverrideValueCents ??
      nested.valueCents,
  );
  const percent = toPercent(
    record.priceOverrideValuePercent ??
      record.valuePercent ??
      nested.priceOverrideValuePercent ??
      nested.valuePercent,
  );

  let valueCents = explicitCents;
  if (valueCents === null && (mode === "override_total_after_margin" || mode === "override_unit_after_margin")) {
    valueCents = legacyCents;
  }
  if (valueCents === null && ((record.mode === "total" || record.mode === "unit") || (nested.mode === "total" || nested.mode === "unit"))) {
    valueCents = toDollarsAsCents(record.value ?? nested.value);
  }

  if (mode === "apply_discount") {
    if (percent === null && valueCents === null) {
      warnings.push("PRICE_OVERRIDE_MISSING_VALUE");
      return { override: null, warnings };
    }
    return { override: { mode, valueCents, valuePercent: percent }, warnings };
  }

  if (valueCents === null) {
    warnings.push("PRICE_OVERRIDE_MISSING_VALUE");
    return { override: null, warnings };
  }

  return { override: { mode, valueCents, valuePercent: null }, warnings };
}

export function resolveLineItemEffectivePricing(input: {
  baseCalculatedTotalCents: unknown;
  quantity: unknown;
  override?: NormalizedLineItemPriceOverride | null;
  rawOverride?: unknown;
  legacyOverridePriceCents?: unknown;
}): LineItemEffectivePricing {
  const warnings: string[] = [];
  const baseInput = toCents(input.baseCalculatedTotalCents);
  const baseCalculatedTotalCents = baseInput ?? 0;
  const quantityRaw = toFiniteNumber(input.quantity);
  const quantity = quantityRaw !== null && quantityRaw > 0 ? quantityRaw : 1;
  const baseCalculatedUnitPriceCents = Math.round(baseCalculatedTotalCents / quantity);

  const normalized = input.override
    ? { override: input.override, warnings: [] as string[] }
    : normalizeLineItemPriceOverride(input.rawOverride, input.legacyOverridePriceCents);
  warnings.push(...normalized.warnings);

  const override = normalized.override;
  if (!override) {
    return {
      baseCalculatedUnitPriceCents,
      baseCalculatedTotalCents,
      effectiveUnitPriceCents: baseCalculatedUnitPriceCents,
      effectiveTotalCents: baseCalculatedTotalCents,
      priceOverrideMode: null,
      priceOverrideValueCents: null,
      priceOverrideValuePercent: null,
      hasPriceOverride: false,
      warnings,
    };
  }

  let effectiveTotalCents = baseCalculatedTotalCents;
  switch (override.mode) {
    case "override_total_before_margin":
    case "override_total_after_margin":
      effectiveTotalCents = override.valueCents ?? baseCalculatedTotalCents;
      break;
    case "override_unit_before_margin":
    case "override_unit_after_margin":
      effectiveTotalCents = Math.round((override.valueCents ?? baseCalculatedUnitPriceCents) * quantity);
      break;
    case "append_value":
      effectiveTotalCents = baseCalculatedTotalCents + (override.valueCents ?? 0);
      break;
    case "apply_discount":
      if (override.valuePercent !== null) {
        effectiveTotalCents = Math.round(baseCalculatedTotalCents * (1 - override.valuePercent / 100));
      } else {
        effectiveTotalCents = baseCalculatedTotalCents - (override.valueCents ?? 0);
      }
      break;
  }

  effectiveTotalCents = Math.max(0, Math.round(effectiveTotalCents));
  const effectiveUnitPriceCents = Math.round(effectiveTotalCents / quantity);

  return {
    baseCalculatedUnitPriceCents,
    baseCalculatedTotalCents,
    effectiveUnitPriceCents,
    effectiveTotalCents,
    priceOverrideMode: override.mode,
    priceOverrideValueCents: override.valueCents,
    priceOverrideValuePercent: override.valuePercent,
    hasPriceOverride: true,
    warnings,
  };
}
