import { hydrateLineItemEditPricingState } from "@shared/lineItemPriceOverrides";

export type QuoteAggregateLineItem = {
  linePrice: unknown;
  status?: string | null;
  isTaxableSnapshot?: boolean | null;
  quantity?: unknown;
  specsJson?: unknown;
  pbv2SnapshotJson?: unknown;
  overridePriceCents?: unknown;
  effectiveTotalCents?: unknown;
};

export type QuoteAggregateInput = {
  lineItems: QuoteAggregateLineItem[];
  discountAmount?: unknown;
  taxRate?: unknown;
  shippingCents?: unknown;
};

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateQuoteAggregateTotals(input: QuoteAggregateInput) {
  const activeRows = input.lineItems.filter((line) => line.status !== "canceled");
  const effectiveLineTotal = (line: QuoteAggregateLineItem) => (
    hydrateLineItemEditPricingState(line).effectiveTotalCents / 100
  );
  const subtotal = roundCurrency(
    activeRows.reduce((sum, line) => sum + effectiveLineTotal(line), 0),
  );
  const taxableLineSubtotal = roundCurrency(
    activeRows
      .filter((line) => line.isTaxableSnapshot !== false)
      .reduce((sum, line) => sum + effectiveLineTotal(line), 0),
  );
  const discountAmount = Math.min(
    Math.max(0, toFiniteNumber(input.discountAmount)),
    subtotal,
  );
  const taxableDiscount = Math.min(discountAmount, taxableLineSubtotal);
  const taxableSubtotal = roundCurrency(Math.max(0, taxableLineSubtotal - taxableDiscount));
  const taxRate = Math.max(0, toFiniteNumber(input.taxRate));
  const taxAmount = roundCurrency(taxableSubtotal * taxRate);
  const shippingAmount = roundCurrency(Math.max(0, toFiniteNumber(input.shippingCents)) / 100);
  const totalPrice = roundCurrency(Math.max(0, subtotal - discountAmount + taxAmount + shippingAmount));

  return {
    subtotal,
    taxableSubtotal,
    taxAmount,
    totalPrice,
  };
}
