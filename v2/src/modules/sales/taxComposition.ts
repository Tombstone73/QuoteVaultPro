/**
 * Sales is the single commercial-tax composer.  It deliberately accepts
 * frozen commercial facts and returns integer-cent evidence; callers must not
 * reimplement this in a workspace or in Billing.
 */
export const SALES_TAX_CALCULATOR_VERSION = "v2-sales-receipt-jurisdiction-v1";

export type TaxReceiptLocation = Readonly<{
  country: string;
  region: string;
  postalCode?: string;
}>;

export type TenantTaxJurisdiction = Readonly<{
  jurisdictionId: string;
  name: string;
  receiptLocation: TaxReceiptLocation;
  rateBasisPoints: number;
  active: boolean;
  homeBusiness: boolean;
}>;

export type FrozenTaxExemption = Readonly<{
  exempt: boolean;
  reason?: string;
  certificateReference?: string;
}>;

export type TaxableCommercialLine = Readonly<{
  lineId: string;
  amountCents: number;
  taxable: boolean;
}>;

export type CommercialCharge = Readonly<{
  /** POSTAGE is deliberately explicit: private-carrier shipping is not postage. */
  kind: "shipping" | "delivery" | "handling" | "packing" | "crating" | "postage";
  cents: number;
  description?: string;
}>;

export type TaxResolution =
  | Readonly<{ status: "resolved"; jurisdiction: TenantTaxJurisdiction; receiptLocation: TaxReceiptLocation }>
  | Readonly<{ status: "unresolved"; reason: "tax_jurisdiction_not_configured"; receiptLocation?: TaxReceiptLocation }>;

export type SalesTaxComposition =
  | Readonly<{
      status: "resolved";
      calculatorVersion: typeof SALES_TAX_CALCULATOR_VERSION;
      exemption: FrozenTaxExemption;
      jurisdiction: Readonly<{ id: string; name: string; receiptLocation: TaxReceiptLocation; rateBasisPoints: number }>;
      taxableLineCents: number;
      nonTaxableLineCents: number;
      taxableAdjustmentCents: number;
      taxableChargeCents: number;
      nonTaxableChargeCents: number;
      taxableBaseCents: number;
      taxCents: number;
      finalTotalCents: number;
      chargeAllocations: ReadonlyArray<Readonly<{ kind: CommercialCharge["kind"]; cents: number; taxableCents: number; nonTaxableCents: number }>>;
    }>
  | Readonly<{
      status: "unresolved";
      calculatorVersion: typeof SALES_TAX_CALCULATOR_VERSION;
      reason: "tax_jurisdiction_not_configured";
      finalTotalCents: number;
    }>;

const assertCents = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe whole-cent integer.`);
  return value;
};
const roundHalfUp = (numerator: number, denominator: number): number =>
  Math.floor((numerator + Math.floor(denominator / 2)) / denominator);

/**
 * Allocate an amount to taxable value proportionally. The integer remainder is
 * deterministic (taxable side receives the half-up rounded share) and both
 * allocations always reconcile exactly to the supplied cents.
 */
export const allocateProportionally = (
  cents: number,
  taxableValueCents: number,
  nonTaxableValueCents: number,
): Readonly<{ taxableCents: number; nonTaxableCents: number }> => {
  assertCents(cents, "Allocation");
  assertCents(taxableValueCents, "Taxable allocation basis");
  assertCents(nonTaxableValueCents, "Non-taxable allocation basis");
  if (taxableValueCents < 0 || nonTaxableValueCents < 0) throw new Error("Allocation basis cannot be negative.");
  const total = taxableValueCents + nonTaxableValueCents;
  if (!total) return { taxableCents: 0, nonTaxableCents: cents };
  const sign = cents < 0 ? -1 : 1;
  const allocated = roundHalfUp(Math.abs(cents) * taxableValueCents, total) * sign;
  return { taxableCents: allocated, nonTaxableCents: cents - allocated };
};

export const resolveTaxJurisdiction = (input: Readonly<{
  fulfillment: Readonly<{ method: "pickup" | "shipping" | "local_delivery"; destination?: TaxReceiptLocation }>;
  jurisdictions: readonly TenantTaxJurisdiction[];
}>): TaxResolution => {
  const receipt = input.fulfillment.method === "pickup"
    ? input.jurisdictions.find((candidate) => candidate.active && candidate.homeBusiness)?.receiptLocation
    : input.fulfillment.destination;
  if (!receipt) return { status: "unresolved", reason: "tax_jurisdiction_not_configured" };
  const norm = (value: string | undefined) => value?.trim().toUpperCase();
  const exactPostal = input.jurisdictions.find((candidate) => candidate.active && !candidate.homeBusiness
    && norm(candidate.receiptLocation.country) === norm(receipt.country)
    && norm(candidate.receiptLocation.region) === norm(receipt.region)
    && candidate.receiptLocation.postalCode && norm(candidate.receiptLocation.postalCode) === norm(receipt.postalCode));
  const regional = input.jurisdictions.find((candidate) => candidate.active && !candidate.homeBusiness
    && norm(candidate.receiptLocation.country) === norm(receipt.country)
    && norm(candidate.receiptLocation.region) === norm(receipt.region)
    && !candidate.receiptLocation.postalCode);
  const jurisdiction = input.fulfillment.method === "pickup"
    ? input.jurisdictions.find((candidate) => candidate.active && candidate.homeBusiness)
    : exactPostal ?? regional;
  return jurisdiction
    ? { status: "resolved", jurisdiction, receiptLocation: receipt }
    : { status: "unresolved", reason: "tax_jurisdiction_not_configured", receiptLocation: receipt };
};

export const composeSalesTax = (input: Readonly<{
  lines: readonly TaxableCommercialLine[];
  adjustmentCents?: number;
  charges?: readonly CommercialCharge[];
  exemption: FrozenTaxExemption;
  resolution: TaxResolution;
}>): SalesTaxComposition => {
  const taxableLineCents = input.lines.filter((line) => line.taxable).reduce((sum, line) => sum + assertCents(line.amountCents, "Line amount"), 0);
  const nonTaxableLineCents = input.lines.filter((line) => !line.taxable).reduce((sum, line) => sum + assertCents(line.amountCents, "Line amount"), 0);
  const adjustmentCents = assertCents(input.adjustmentCents ?? 0, "Commercial adjustment");
  const charges = input.charges ?? [];
  const chargeTotal = charges.reduce((sum, charge) => sum + assertCents(charge.cents, "Commercial charge"), 0);
  const finalBeforeTax = taxableLineCents + nonTaxableLineCents + adjustmentCents + chargeTotal;
  if (finalBeforeTax < 0) throw new Error("Commercial total cannot be negative.");
  if (input.resolution.status === "unresolved") return { status: "unresolved", calculatorVersion: SALES_TAX_CALCULATOR_VERSION, reason: input.resolution.reason, finalTotalCents: finalBeforeTax };
  const adjustment = allocateProportionally(adjustmentCents, taxableLineCents, nonTaxableLineCents);
  const chargeAllocations = charges.map((charge) => {
    // Actual separately-stated USPS postage has its own exempt semantic.
    if (charge.kind === "postage") return { kind: charge.kind, cents: charge.cents, taxableCents: 0, nonTaxableCents: charge.cents };
    const allocation = input.exemption.exempt
      ? { taxableCents: 0, nonTaxableCents: charge.cents }
      : allocateProportionally(charge.cents, taxableLineCents, nonTaxableLineCents);
    return { kind: charge.kind, cents: charge.cents, ...allocation };
  });
  const taxableChargeCents = chargeAllocations.reduce((sum, charge) => sum + charge.taxableCents, 0);
  const nonTaxableChargeCents = chargeAllocations.reduce((sum, charge) => sum + charge.nonTaxableCents, 0);
  const rawTaxableBase = taxableLineCents + adjustment.taxableCents + taxableChargeCents;
  const taxableBaseCents = input.exemption.exempt ? 0 : Math.max(0, rawTaxableBase);
  const rateBasisPoints = input.resolution.jurisdiction.rateBasisPoints;
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10000) throw new Error("Tax rate must be whole basis points between 0 and 10000.");
  // Aggregate-cent half-up rounding: one rate applied to the complete taxable base.
  const taxCents = roundHalfUp(taxableBaseCents * rateBasisPoints, 10000);
  return {
    status: "resolved", calculatorVersion: SALES_TAX_CALCULATOR_VERSION, exemption: input.exemption,
    jurisdiction: { id: input.resolution.jurisdiction.jurisdictionId, name: input.resolution.jurisdiction.name, receiptLocation: input.resolution.receiptLocation, rateBasisPoints },
    taxableLineCents, nonTaxableLineCents, taxableAdjustmentCents: input.exemption.exempt ? 0 : adjustment.taxableCents,
    taxableChargeCents, nonTaxableChargeCents, taxableBaseCents, taxCents, finalTotalCents: finalBeforeTax + taxCents, chargeAllocations,
  };
};
