import {
  normalizeLineItemPriceOverride,
  resolveLineItemEffectivePricing,
  type LineItemEffectivePricing,
} from "@shared/lineItemPriceOverrides";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

export function enrichLineItemWithEffectivePricing<T extends Record<string, any>>(lineItem: T): T & LineItemEffectivePricing {
  const quantity = Number(lineItem.quantity) > 0 ? Number(lineItem.quantity) : 1;
  const effectiveTotalCents = Math.round((Number(lineItem.totalPrice) || 0) * 100);
  const baseFromSpecs = isPlainRecord(lineItem.specsJson) && isPlainRecord(lineItem.specsJson.priceOverride)
    ? Number(lineItem.specsJson.priceOverride.baseCalculatedTotalCents)
    : NaN;
  const baseFromSnapshot = Number(lineItem.pbv2SnapshotJson?.pricing?.totalCents);
  const baseCalculatedTotalCents = Number.isFinite(baseFromSpecs)
    ? Math.round(baseFromSpecs)
    : Number.isFinite(baseFromSnapshot)
      ? Math.round(baseFromSnapshot)
      : effectiveTotalCents;

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
