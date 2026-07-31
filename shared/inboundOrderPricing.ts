import {
  resolveLineItemEffectivePricing,
  type LineItemPriceOverrideMode,
} from "./lineItemPriceOverrides";

export const inboundPriceOverrideModes = [
  "override_unit_after_margin",
  "override_total_after_margin",
] as const;

export type InboundPriceOverrideMode = (typeof inboundPriceOverrideModes)[number];
export type InboundPriceOverrideSource = "staff" | "po";

export type InboundPricingReviewLike = {
  status?: "not_available" | "matched" | "mismatch" | "resolved" | null;
  message?: string | null;
  acknowledged?: boolean | null;
  resolution?: "accept_system_price" | "honor_po_price" | "pricing_exception" | null;
  resolutionNote?: string | null;
  systemPriceCents?: number | null;
  systemUnitPriceCents?: number | null;
  poPriceCents?: number | null;
  poUnitPriceCents?: number | null;
  poExtendedPriceCents?: number | null;
  poTotalPriceCents?: number | null;
  comparisonType?: "total" | "unit" | "approved" | "extended" | null;
  priceOverrideMode?: InboundPriceOverrideMode | null;
  priceOverrideValueCents?: number | null;
  priceOverrideSource?: InboundPriceOverrideSource | null;
  effectiveUnitPriceCents?: number | null;
  effectiveTotalCents?: number | null;
};

function positiveCents(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

export function getInboundPoPriceSuggestion(review: InboundPricingReviewLike | null | undefined): {
  mode: InboundPriceOverrideMode;
  valueCents: number;
} | null {
  if (!review) return null;
  const unitCents = positiveCents(review.poUnitPriceCents);
  if (review.comparisonType === "unit" && unitCents !== null) {
    return { mode: "override_unit_after_margin", valueCents: unitCents };
  }

  const totalCents = positiveCents(review.poTotalPriceCents)
    ?? positiveCents(review.poExtendedPriceCents)
    ?? (review.comparisonType !== "unit" ? positiveCents(review.poPriceCents) : null);
  if (totalCents !== null) {
    return { mode: "override_total_after_margin", valueCents: totalCents };
  }
  if (unitCents !== null) {
    return { mode: "override_unit_after_margin", valueCents: unitCents };
  }
  return null;
}

export function resolveInboundLineEffectivePricing(
  review: InboundPricingReviewLike | null | undefined,
  quantity: unknown,
) {
  const mode = review?.priceOverrideMode ?? null;
  const valueCents = positiveCents(review?.priceOverrideValueCents);
  return resolveLineItemEffectivePricing({
    baseCalculatedTotalCents: review?.systemPriceCents ?? 0,
    quantity,
    override: mode && valueCents !== null
      ? {
          mode: mode as LineItemPriceOverrideMode,
          valueCents,
          valuePercent: null,
        }
      : null,
  });
}

export function hasUsableInboundLinePrice(
  review: InboundPricingReviewLike | null | undefined,
  quantity: unknown,
) {
  return resolveInboundLineEffectivePricing(review, quantity).effectiveTotalCents > 0;
}

export function preserveInboundPricingResolution<T extends InboundPricingReviewLike>(
  previous: T | null | undefined,
  next: T,
  quantity: unknown,
): T {
  const withOverride = {
    ...next,
    priceOverrideMode: previous?.priceOverrideMode ?? null,
    priceOverrideValueCents: previous?.priceOverrideValueCents ?? null,
    priceOverrideSource: previous?.priceOverrideSource ?? null,
  };
  const effective = resolveInboundLineEffectivePricing(withOverride, quantity);
  const withEffective = {
    ...withOverride,
    effectiveUnitPriceCents: effective.effectiveUnitPriceCents,
    effectiveTotalCents: effective.effectiveTotalCents,
  };
  if (!previous?.acknowledged || !previous.resolution) return withEffective as T;
  const sameComparison = previous.poPriceCents === next.poPriceCents
    && previous.systemPriceCents === next.systemPriceCents
    && previous.differenceCents === next.differenceCents
    && previous.comparisonType === next.comparisonType;
  if (!sameComparison) return withEffective as T;
  return {
    ...withEffective,
    status: next.status === "mismatch" ? "resolved" : next.status,
    acknowledged: true,
    resolution: previous.resolution,
    resolutionNote: previous.resolutionNote ?? null,
  } as T;
}
