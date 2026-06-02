import type { QuoteLineItemDraft } from "./types";

export function hasExplicitLineItemPriceOverride(item: any): boolean {
  const override = item?.priceOverride ?? item?.specsJson?.priceOverride;
  const overrideRecord = override && typeof override === "object" && !Array.isArray(override) ? override : null;
  const mode = overrideRecord?.mode ?? overrideRecord?.priceOverrideMode ?? item?.priceOverrideMode;
  const hasMode = typeof mode === "string" && mode.trim().length > 0;
  const hasValue =
    overrideRecord?.valueCents !== undefined ||
    overrideRecord?.priceOverrideValueCents !== undefined ||
    overrideRecord?.value !== undefined ||
    item?.priceOverrideValueCents !== undefined ||
    item?.priceOverrideValuePercent !== undefined;

  return hasMode && hasValue;
}

function clearsLineItemPriceOverride(item: any): boolean {
  return item?.priceOverride === null || item?.priceOverrideMode === null || item?.overridePriceCents === null;
}

export function buildQuoteLineItemSavePayload(item: QuoteLineItemDraft, overrides: Partial<QuoteLineItemDraft> = {}) {
  const mergedItem = { ...item, ...overrides } as QuoteLineItemDraft;
  const hasExplicitOverride = !clearsLineItemPriceOverride(overrides) && hasExplicitLineItemPriceOverride(mergedItem);
  const priceOverride = hasExplicitOverride
    ? ((mergedItem as any).priceOverride ?? (mergedItem as any).specsJson?.priceOverride ?? null)
    : null;

  return {
    productId: mergedItem.productId,
    productName: mergedItem.productName,
    variantId: mergedItem.variantId ?? null,
    variantName: mergedItem.variantName ?? null,
    productType: mergedItem.productType || "wide_roll",
    width: mergedItem.width,
    height: mergedItem.height,
    quantity: mergedItem.quantity,
    specsJson: mergedItem.specsJson || {},
    optionSelectionsJson: (mergedItem as any).optionSelectionsJson ?? null,
    pbv2TreeVersionId: mergedItem.pbv2TreeVersionId ?? null,
    pbv2SnapshotJson: mergedItem.pbv2SnapshotJson ?? undefined,
    pricedAt: mergedItem.pricedAt ?? undefined,
    materialUsages: mergedItem.materialUsages ?? [],
    selectedOptions: mergedItem.selectedOptions || [],
    linePrice: mergedItem.linePrice ?? 0,
    priceOverride,
    priceOverrideMode: hasExplicitOverride ? ((priceOverride as any)?.mode ?? (mergedItem as any).priceOverrideMode ?? null) : null,
    priceOverrideValueCents: hasExplicitOverride ? ((priceOverride as any)?.valueCents ?? (mergedItem as any).priceOverrideValueCents ?? null) : null,
    priceOverrideValuePercent: hasExplicitOverride ? ((priceOverride as any)?.valuePercent ?? (mergedItem as any).priceOverrideValuePercent ?? null) : null,
    overridePriceCents: hasExplicitOverride ? (mergedItem.overridePriceCents ?? null) : null,
    overrideAt: mergedItem.overrideAt ?? null,
    overrideByUserId: mergedItem.overrideByUserId ?? null,
    overrideReason: mergedItem.overrideReason ?? null,
    priceBreakdown: mergedItem.priceBreakdown || {
      basePrice: mergedItem.linePrice ?? 0,
      optionsPrice: 0,
      total: mergedItem.linePrice ?? 0,
      formula: "",
    },
    displayOrder: mergedItem.displayOrder ?? 0,
    status: mergedItem.status === "canceled" ? "canceled" : "active",
    requiresDesign: mergedItem.requiresDesign,
    requiresPrepress: mergedItem.requiresPrepress,
    requiresProofApproval: mergedItem.requiresProofApproval,
  };
}

