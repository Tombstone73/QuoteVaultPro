import {
  hydrateLineItemEditPricingState,
  isLineItemPriceOverrideMode,
  type LineItemPriceOverrideMode,
} from "@shared/lineItemPriceOverrides";

import type { QuoteLineItemDraft } from "../types";

export function getQuoteLineItemPriceOverrideMode(item: QuoteLineItemDraft): LineItemPriceOverrideMode | null {
  const mode =
    (item.priceOverride as any)?.mode ??
    (item.priceOverride as any)?.priceOverrideMode ??
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
      (item as any).priceOverrideValueCents,
  );
  if (Number.isFinite(valueCents)) return Math.round(valueCents);
  const legacyDollarValue = Number((item.priceOverride as any)?.value);
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
