import {
  applyLineItemEditPriceOverride,
  hydrateLineItemEditPricingState,
  isLineItemPriceOverrideMode,
  type LineItemEffectivePricing,
  type LineItemPriceOverrideMode,
} from "@shared/lineItemPriceOverrides";

import type { QuoteLineItemDraft } from "../types";

export function mergeQuoteLineItemPriceOverrideIntoSpecsJson(
  specsJson: QuoteLineItemDraft["specsJson"] | null | undefined,
  priceOverride: unknown,
): QuoteLineItemDraft["specsJson"] {
  const base = specsJson && typeof specsJson === "object" && !Array.isArray(specsJson)
    ? { ...(specsJson as Record<string, unknown>) }
    : {};

  if (priceOverride && typeof priceOverride === "object" && !Array.isArray(priceOverride)) {
    return {
      ...base,
      priceOverride,
    };
  }

  const { priceOverride: _removedPriceOverride, priceOverrideWarnings: _removedWarnings, ...rest } = base;
  return rest;
}

export function getQuoteLineItemPriceOverrideMode(item: QuoteLineItemDraft): LineItemPriceOverrideMode | null {
  const specsOverride = (item.specsJson as any)?.priceOverride;
  const mode =
    (item.priceOverride as any)?.mode ??
    (item.priceOverride as any)?.priceOverrideMode ??
    specsOverride?.mode ??
    specsOverride?.priceOverrideMode ??
    (item as any).priceOverrideMode;
  if (isLineItemPriceOverrideMode(mode)) return mode;
  if (mode === "total") return "override_total_after_margin";
  if (mode === "unit") return "override_unit_after_margin";
  return null;
}

export function getQuoteLineItemOverrideValueCents(item: QuoteLineItemDraft, mode: LineItemPriceOverrideMode | null): number | null {
  if (!mode) return null;
  const valueCents = Number(
    (item.priceOverride as any)?.valueCents ??
      (item.priceOverride as any)?.priceOverrideValueCents ??
      (item.specsJson as any)?.priceOverride?.valueCents ??
      (item.specsJson as any)?.priceOverride?.priceOverrideValueCents ??
      (item as any).priceOverrideValueCents,
  );
  if (Number.isFinite(valueCents)) return Math.round(valueCents);
  const legacyDollarValue = Number((item.priceOverride as any)?.value);
  const specsDollarValue = Number((item.specsJson as any)?.priceOverride?.value);
  if (Number.isFinite(specsDollarValue)) return Math.max(0, Math.round(specsDollarValue * 100));
  if (Number.isFinite(legacyDollarValue)) return Math.max(0, Math.round(legacyDollarValue * 100));
  return null;
}

export function resolveQuoteLineItemOverrideUiState(
  item: QuoteLineItemDraft,
  draftMode?: LineItemPriceOverrideMode | null,
) {
  const hydratedPricing = hydrateLineItemEditPricingState(item as any);
  const persistedOverrideMode = getQuoteLineItemPriceOverrideMode(item);
  const hasOverride = Boolean(hydratedPricing.hasPriceOverride && persistedOverrideMode);
  const selectedOverrideMode = draftMode ?? persistedOverrideMode ?? null;
  const overrideValueCents = getQuoteLineItemOverrideValueCents(item, selectedOverrideMode);

  return {
    hasOverride,
    persistedOverrideMode,
    selectedOverrideMode,
    selectValue: selectedOverrideMode ?? "__none",
    overrideValueCents,
  };
}

export function resolveQuoteLineItemOverrideModeChange(input: {
  baseCalculatedTotalCents: unknown;
  quantity: unknown;
  mode: LineItemPriceOverrideMode;
  rawValue: unknown;
  fallbackValueCents?: unknown;
}): { valueCents: number; pricing: LineItemEffectivePricing; displayText: string } | null {
  const parsedValue = Number.parseFloat(String(input.rawValue ?? ""));
  const fallbackValueCents = Number(input.fallbackValueCents);
  const valueCents =
    Number.isFinite(parsedValue) && parsedValue >= 0
      ? Math.round(parsedValue * 100)
      : Number.isFinite(fallbackValueCents) && fallbackValueCents >= 0
        ? Math.round(fallbackValueCents)
        : null;

  if (valueCents === null) return null;

  const pricing = applyLineItemEditPriceOverride({
    baseCalculatedTotalCents: input.baseCalculatedTotalCents,
    quantity: input.quantity,
    mode: input.mode,
    valueCents,
  });

  return {
    valueCents,
    pricing,
    displayText: (valueCents / 100).toFixed(2),
  };
}
