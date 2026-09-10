import type { QuoteLineItemDraft } from "./types";

function copyJson<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function copyPriceOverride(value: QuoteLineItemDraft["priceOverride"]): QuoteLineItemDraft["priceOverride"] {
  const copy = copyJson(value);
  if (copy && typeof copy === "object" && !Array.isArray(copy)) {
    delete (copy as Record<string, unknown>).appliedAt;
  }
  return copy;
}

export function createQuoteLineItemTempId(): string {
  const uuid = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `temp-${uuid}`;
}

/**
 * Make a new local quote-line draft from customer-editable configuration only.
 * Quote-line ids, grouping, artwork staging, and downstream state intentionally
 * do not transfer to the duplicate.
 */
export function cloneQuoteLineItemDraft(source: QuoteLineItemDraft, displayOrder: number): QuoteLineItemDraft {
  return {
    tempId: createQuoteLineItemTempId(),
    id: undefined,
    parentLineItemId: null,
    lineItemRole: "standalone",
    productId: source.productId,
    productName: source.productName,
    variantId: source.variantId,
    variantName: source.variantName,
    productType: source.productType,
    width: source.width,
    height: source.height,
    quantity: source.quantity,
    specsJson: copyJson(source.specsJson) ?? {},
    optionSelectionsJson: copyJson(source.optionSelectionsJson) ?? null,
    pbv2TreeVersionId: source.pbv2TreeVersionId ?? null,
    pbv2SnapshotJson: copyJson(source.pbv2SnapshotJson) ?? null,
    pricedAt: source.pricedAt ?? null,
    materialUsages: copyJson(source.materialUsages) ?? [],
    selectedOptions: copyJson(source.selectedOptions) ?? [],
    linePrice: source.linePrice,
    formulaLinePrice: source.formulaLinePrice,
    priceOverride: copyPriceOverride(source.priceOverride) ?? null,
    overridePriceCents: source.overridePriceCents ?? null,
    overrideAt: null,
    overrideByUserId: null,
    overrideReason: source.overrideReason ?? null,
    description: source.description ?? null,
    productionNotes: source.productionNotes ?? null,
    requiresDesign: source.requiresDesign,
    requiresPrepress: source.requiresPrepress ?? null,
    requiresProofApproval: source.requiresProofApproval ?? null,
    priceOverridden: source.priceOverridden ?? false,
    overriddenPrice: source.overriddenPrice ?? null,
    priceBreakdown: copyJson(source.priceBreakdown) ?? {},
    displayOrder,
    notes: source.notes,
    productOptions: copyJson(source.productOptions) ?? [],
    status: source.status === "draft" ? "draft" : "active",
  };
}
