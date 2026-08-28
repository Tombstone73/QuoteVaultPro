/** Sales owns the sole commercial-tax composer; callers supply frozen facts. */
export const SALES_TAX_CALCULATOR_VERSION = "v2-sales-receipt-jurisdiction-v1";
export type TaxReceiptLocation = Readonly<{ country: string; region: string; postalCode?: string }>;
export type DestinationTaxMethod = "shipping" | "local_delivery";
export type TenantTaxJurisdiction = Readonly<{ jurisdictionId: string; name: string; receiptLocation: TaxReceiptLocation; rateBasisPoints: number; active: boolean; homeBusiness: boolean; /** Omitted for old rows/fixtures: applies to both destination methods. */ destinationMethods?: readonly DestinationTaxMethod[] }>;
export type FrozenTaxExemption = Readonly<{ exempt: boolean; reason?: string; certificateReference?: string }>;
export type TaxableCommercialLine = Readonly<{ lineId: string; amountCents: number; taxable: boolean }>;
export type CommercialCharge = Readonly<{ /** Actual separately-stated postage is handled explicitly. */ kind: "shipping" | "delivery" | "handling" | "packing" | "crating" | "postage"; cents: number; description?: string }>;
export type TaxResolution = Readonly<{ status: "resolved"; jurisdiction: TenantTaxJurisdiction; receiptLocation: TaxReceiptLocation }> | Readonly<{ status: "unresolved"; reason: "tax_jurisdiction_not_configured" | "tax_jurisdiction_conflict"; receiptLocation?: TaxReceiptLocation }>;
export type SalesTaxComposition = Readonly<{ status: "resolved"; calculatorVersion: typeof SALES_TAX_CALCULATOR_VERSION; exemption: FrozenTaxExemption; jurisdiction: Readonly<{ id: string; name: string; receiptLocation: TaxReceiptLocation; rateBasisPoints: number }>; taxableLineCents: number; nonTaxableLineCents: number; taxableAdjustmentCents: number; taxableChargeCents: number; nonTaxableChargeCents: number; taxableBaseCents: number; taxCents: number; finalTotalCents: number; chargeAllocations: ReadonlyArray<Readonly<{ kind: CommercialCharge["kind"]; cents: number; taxableCents: number; nonTaxableCents: number }>> }> | Readonly<{ status: "unresolved"; calculatorVersion: typeof SALES_TAX_CALCULATOR_VERSION; reason: "tax_jurisdiction_not_configured" | "tax_jurisdiction_conflict"; finalTotalCents: number }>;

const assertCents = (value: number, field: string): number => { if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe whole-cent integer.`); return value; };
const roundHalfUp = (numerator: number, denominator: number): number => Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
const norm = (value: string | undefined) => value?.trim().toUpperCase();
const applies = (candidate: TenantTaxJurisdiction, method: DestinationTaxMethod) => !candidate.destinationMethods || candidate.destinationMethods.includes(method);

/** Allocate an amount proportionally with deterministic integer-cent rounding. */
export const allocateProportionally = (cents: number, taxableValueCents: number, nonTaxableValueCents: number): Readonly<{ taxableCents: number; nonTaxableCents: number }> => {
  assertCents(cents, "Allocation"); assertCents(taxableValueCents, "Taxable allocation basis"); assertCents(nonTaxableValueCents, "Non-taxable allocation basis");
  if (taxableValueCents < 0 || nonTaxableValueCents < 0) throw new Error("Allocation basis cannot be negative.");
  const total = taxableValueCents + nonTaxableValueCents;
  if (!total) return { taxableCents: 0, nonTaxableCents: cents };
  const sign = cents < 0 ? -1 : 1;
  const taxableCents = roundHalfUp(Math.abs(cents) * taxableValueCents, total) * sign;
  return { taxableCents, nonTaxableCents: cents - taxableCents };
};
const select = (candidates: readonly TenantTaxJurisdiction[], receipt: TaxReceiptLocation): TaxResolution => candidates.length === 1 ? { status: "resolved", jurisdiction: candidates[0]!, receiptLocation: receipt } : { status: "unresolved", reason: candidates.length ? "tax_jurisdiction_conflict" : "tax_jurisdiction_not_configured", receiptLocation: receipt };

/** Postal-specific destination rules outrank regional rules; equal priority is never arbitrary. */
export const resolveTaxJurisdiction = (input: Readonly<{ fulfillment: Readonly<{ method: "pickup" | DestinationTaxMethod; destination?: TaxReceiptLocation }>; jurisdictions: readonly TenantTaxJurisdiction[] }>): TaxResolution => {
  if (input.fulfillment.method === "pickup") {
    const homes = input.jurisdictions.filter((candidate) => candidate.active && candidate.homeBusiness);
    return homes[0] ? select(homes, homes[0].receiptLocation) : { status: "unresolved", reason: "tax_jurisdiction_not_configured" };
  }
  const receipt = input.fulfillment.destination;
  if (!receipt) return { status: "unresolved", reason: "tax_jurisdiction_not_configured" };
  const method: DestinationTaxMethod = input.fulfillment.method;
  const regional = input.jurisdictions.filter((candidate) => candidate.active && !candidate.homeBusiness && applies(candidate, method) && norm(candidate.receiptLocation.country) === norm(receipt.country) && norm(candidate.receiptLocation.region) === norm(receipt.region));
  const exactPostal = regional.filter((candidate) => candidate.receiptLocation.postalCode && norm(candidate.receiptLocation.postalCode) === norm(receipt.postalCode));
  return select(exactPostal.length ? exactPostal : regional.filter((candidate) => !candidate.receiptLocation.postalCode), receipt);
};

export const composeSalesTax = (input: Readonly<{ lines: readonly TaxableCommercialLine[]; adjustmentCents?: number; charges?: readonly CommercialCharge[]; exemption: FrozenTaxExemption; resolution: TaxResolution }>): SalesTaxComposition => {
  const taxableLineCents = input.lines.filter((line) => line.taxable).reduce((sum, line) => sum + assertCents(line.amountCents, "Line amount"), 0);
  const nonTaxableLineCents = input.lines.filter((line) => !line.taxable).reduce((sum, line) => sum + assertCents(line.amountCents, "Line amount"), 0);
  const adjustmentCents = assertCents(input.adjustmentCents ?? 0, "Commercial adjustment");
  const charges = input.charges ?? [];
  const finalBeforeTax = taxableLineCents + nonTaxableLineCents + adjustmentCents + charges.reduce((sum, charge) => sum + assertCents(charge.cents, "Commercial charge"), 0);
  if (finalBeforeTax < 0) throw new Error("Commercial total cannot be negative.");
  if (input.resolution.status === "unresolved") return { status: "unresolved", calculatorVersion: SALES_TAX_CALCULATOR_VERSION, reason: input.resolution.reason, finalTotalCents: finalBeforeTax };
  const adjustment = allocateProportionally(adjustmentCents, taxableLineCents, nonTaxableLineCents);
  const chargeAllocations = charges.map((charge) => {
    if (charge.kind === "postage") return { kind: charge.kind, cents: charge.cents, taxableCents: 0, nonTaxableCents: charge.cents };
    const allocation = input.exemption.exempt ? { taxableCents: 0, nonTaxableCents: charge.cents } : allocateProportionally(charge.cents, taxableLineCents, nonTaxableLineCents);
    return { kind: charge.kind, cents: charge.cents, ...allocation };
  });
  const taxableChargeCents = chargeAllocations.reduce((sum, charge) => sum + charge.taxableCents, 0);
  const nonTaxableChargeCents = chargeAllocations.reduce((sum, charge) => sum + charge.nonTaxableCents, 0);
  const taxableBaseCents = input.exemption.exempt ? 0 : Math.max(0, taxableLineCents + adjustment.taxableCents + taxableChargeCents);
  const rateBasisPoints = input.resolution.jurisdiction.rateBasisPoints;
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10000) throw new Error("Tax rate must be whole basis points between 0 and 10000.");
  const taxCents = roundHalfUp(taxableBaseCents * rateBasisPoints, 10000);
  return { status: "resolved", calculatorVersion: SALES_TAX_CALCULATOR_VERSION, exemption: input.exemption, jurisdiction: { id: input.resolution.jurisdiction.jurisdictionId, name: input.resolution.jurisdiction.name, receiptLocation: input.resolution.receiptLocation, rateBasisPoints }, taxableLineCents, nonTaxableLineCents, taxableAdjustmentCents: input.exemption.exempt ? 0 : adjustment.taxableCents, taxableChargeCents, nonTaxableChargeCents, taxableBaseCents, taxCents, finalTotalCents: finalBeforeTax + taxCents, chargeAllocations };
};
