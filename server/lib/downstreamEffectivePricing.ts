const QUICKBOOKS_PROVIDER_UNIT_PRICE_DECIMALS = 7;
const QUICKBOOKS_PROVIDER_CENTS_SCALE = 100_000n;
const TOTAL_OVERRIDE_MODES = new Set([
  'total',
  'override_total_before_margin',
  'override_total_after_margin',
]);

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

function isTotalPriceOverride(lineItem: Record<string, any>): boolean {
  const candidates = [
    lineItem?.specsJson?.priceOverride,
    lineItem?.priceOverride,
    { mode: lineItem?.priceOverrideMode },
  ];
  return candidates.some((candidate) => TOTAL_OVERRIDE_MODES.has(String(candidate?.mode ?? candidate?.priceOverrideMode ?? '').trim().toLowerCase()));
}

function getPriceOverrideMode(lineItem: Record<string, any>): string | null {
  const candidates = [
    lineItem?.specsJson?.priceOverride,
    lineItem?.priceOverride,
    { mode: lineItem?.priceOverrideMode },
  ];
  for (const candidate of candidates) {
    const mode = String(candidate?.mode ?? candidate?.priceOverrideMode ?? '').trim().toLowerCase();
    if (mode) return mode;
  }
  return null;
}

/**
 * QuickBooks keeps sales-line rates separately from customer-facing currency
 * formatting. For a total override, calculate a provider-only rate from the
 * authoritative cent total rather than reusing the rounded display unit price.
 * Seven fractional decimal places keeps the provider calculation accurate to
 * cents even for high-volume integer invoice quantities.
 */
function quickBooksUnitPriceForTotalOverride(totalCents: number, quantity: number): number {
  const safeTotalCents = BigInt(Math.max(0, Math.round(totalCents)));
  const safeQuantity = BigInt(Math.max(1, Math.round(quantity)));
  const numerator = safeTotalCents * QUICKBOOKS_PROVIDER_CENTS_SCALE;
  const roundedProviderUnits = (numerator + (safeQuantity / 2n)) / safeQuantity;
  return Number(roundedProviderUnits) / (10 ** QUICKBOOKS_PROVIDER_UNIT_PRICE_DECIMALS);
}

export type QuickBooksInvoiceLinePayloadDiagnostic = {
  lineNum: number;
  quantity: number;
  unitPrice: number;
  amount: number;
  overrideType: string | null;
  precisionReason: 'display_rate' | 'total_override' | 'authoritative_total_mismatch';
};

/**
 * Produces the provider representation and a deliberately non-sensitive
 * diagnostic summary from the same calculation.  The diagnostic is useful for
 * proving a queued retry is rebuilding from current invoice snapshots rather
 * than replaying a stale payload.
 */
export function buildQuickBooksInvoiceLinePayloadsWithDiagnostics(lineItems: any[]): {
  payloads: any[];
  diagnostics: QuickBooksInvoiceLinePayloadDiagnostic[];
} {
  const results = (lineItems || []).map((lineItem: any, index: number) => {
    const pricing = resolveOrderLineItemInvoicePricing(lineItem);
    const providerQuantity = pricing.commercialQuantity ?? pricing.quantity;
    const totalOverride = isTotalPriceOverride(lineItem);
    // Invoice snapshots intentionally retain a customer-facing, two-decimal
    // unit price.  Formula-priced and historic lines can therefore have a
    // correct authoritative total that is not representable by that display
    // rate (for example 214 × $0.54 !== $116.16).  In that case Amount is the
    // commercial authority, so derive a provider-only rate from exact cents.
    const authoritativeTotalMismatch =
      pricing.commercialQuantity === null &&
      pricing.effectiveUnitPriceCents * pricing.quantity !== pricing.effectiveTotalCents;
    const usePreciseTotalRate = pricing.commercialQuantity === null && (totalOverride || authoritativeTotalMismatch);
    const unitPrice = usePreciseTotalRate
      ? quickBooksUnitPriceForTotalOverride(pricing.effectiveTotalCents, providerQuantity)
      : Number(((pricing.commercialRateCents ?? pricing.effectiveUnitPriceCents) / 100).toFixed(2));
    const amount = Number((pricing.effectiveTotalCents / 100).toFixed(2));

    return {
      payload: {
        LineNum: index + 1,
        Amount: amount,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          Qty: providerQuantity,
          UnitPrice: unitPrice,
        },
        Description: String(lineItem.description || ""),
      },
      diagnostic: {
        lineNum: index + 1,
        quantity: providerQuantity,
        unitPrice,
        amount,
        overrideType: getPriceOverrideMode(lineItem),
        precisionReason: totalOverride
          ? 'total_override'
          : authoritativeTotalMismatch
            ? 'authoritative_total_mismatch'
            : 'display_rate',
      } satisfies QuickBooksInvoiceLinePayloadDiagnostic,
    };
  });

  return {
    payloads: results.map((result) => result.payload),
    diagnostics: results.map((result) => result.diagnostic),
  };
}

export function resolveOrderLineItemInvoicePricing(lineItem: Record<string, any>): {
  quantity: number;
  effectiveUnitPriceCents: number;
  effectiveTotalCents: number;
  commercialQuantity: number | null;
  commercialRateCents: number | null;
  billingUnit: "hour" | null;
} {
  const hourlyTerms = resolveHourlyServiceCommercialTerms(lineItem);
  // `quantity` is the pre-existing physical/document line count.  Hourly
  // commercial terms are retained separately in the immutable PBV2 snapshot.
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
    commercialQuantity: hourlyTerms?.quantity ?? null,
    commercialRateCents: hourlyTerms?.rateCents ?? null,
    billingUnit: hourlyTerms?.unit ?? null,
  };
}

export function buildQuickBooksInvoiceLinePayloads(lineItems: any[]): any[] {
  return buildQuickBooksInvoiceLinePayloadsWithDiagnostics(lineItems).payloads;
}
import { resolveHourlyServiceCommercialTerms } from '../../shared/hourlyServicePricing';
