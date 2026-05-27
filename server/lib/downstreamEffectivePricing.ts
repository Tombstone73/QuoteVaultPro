function toPositiveQuantity(value: unknown): number {
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function toOptionalCents(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const cents = Number(value);
  return Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : null;
}

function toCentsFromDecimal(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

export function resolveOrderLineItemInvoicePricing(lineItem: Record<string, any>): {
  quantity: number;
  effectiveUnitPriceCents: number;
  effectiveTotalCents: number;
} {
  const quantity = Math.round(toPositiveQuantity(lineItem.quantity));
  const effectiveTotalCents =
    toOptionalCents(lineItem.effectiveTotalCents) ??
    toOptionalCents(lineItem.lineTotalCents) ??
    toCentsFromDecimal(lineItem.totalPrice);
  const explicitUnitCents =
    toOptionalCents(lineItem.effectiveUnitPriceCents) ??
    toOptionalCents(lineItem.unitPriceCents) ??
    toCentsFromDecimal(lineItem.unitPrice);

  return {
    quantity,
    effectiveUnitPriceCents: explicitUnitCents > 0 ? explicitUnitCents : Math.round(effectiveTotalCents / quantity),
    effectiveTotalCents,
  };
}

export function buildQuickBooksInvoiceLinePayloads(lineItems: any[]): any[] {
  return (lineItems || []).map((lineItem: any, index: number) => {
    const pricing = resolveOrderLineItemInvoicePricing(lineItem);

    return {
      LineNum: index + 1,
      Amount: Number((pricing.effectiveTotalCents / 100).toFixed(2)),
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        Qty: pricing.quantity,
        UnitPrice: Number((pricing.effectiveUnitPriceCents / 100).toFixed(2)),
      },
      Description: String(lineItem.description || ""),
    };
  });
}
