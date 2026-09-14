/** Pure, server-owned rules for M7.8I. Currency is always integer cents. */
export type ShippingPricingMode = "pass_through" | "flat" | "percent" | "no_charge" | "manual";
export type ShippingResponsibility = "titan" | "customer" | "carrier" | "pending";
export type ReplacementBillingTreatment = "no_charge" | "billable" | "pending";
export type ShippingPricingPolicy = Readonly<{ mode: ShippingPricingMode; flatAmountCents?: number; percentageBasisPoints?: number; currency: string; version: number }>;
export type ResolvedShippingPricingPolicy = Readonly<{ policy: ShippingPricingPolicy; source: "organization_default" | "customer_override" }>;

const cents = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative whole-cent amount.`);
  return value;
};

export const shippingCustomerPrice = (input: Readonly<{ estimatedCarrierCostCents: number; policy: ShippingPricingPolicy; manualCustomerPriceCents?: number }>): number => {
  const estimated = cents(input.estimatedCarrierCostCents, "Estimated carrier cost");
  switch (input.policy.mode) {
    case "pass_through": return estimated;
    case "flat": return estimated + cents(input.policy.flatAmountCents ?? -1, "Flat shipping amount");
    case "percent": {
      const rate = input.policy.percentageBasisPoints ?? -1;
      if (!Number.isSafeInteger(rate) || rate < 0) throw new Error("Shipping percentage must be non-negative basis points.");
      const markup = (BigInt(estimated) * BigInt(rate) + 5_000n) / 10_000n;
      const total = BigInt(estimated) + markup;
      if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Shipping price is outside the safe whole-cent range.");
      return Number(total);
    }
    case "no_charge": return 0;
    case "manual": return cents(input.manualCustomerPriceCents ?? -1, "Manual customer shipping price");
  }
};

/** Customer policy is an explicit override; absence is inheritance, never a copied default. */
export const resolveShippingPricingPolicy = (organizationDefault: ShippingPricingPolicy | undefined, customerOverride?: ShippingPricingPolicy): ResolvedShippingPricingPolicy => {
  if (customerOverride) return { policy: customerOverride, source: "customer_override" };
  if (!organizationDefault) throw new Error("No organization shipping pricing policy is configured.");
  return { policy: organizationDefault, source: "organization_default" };
};

export const shippingPriceFromResolvedPolicy = (input: Readonly<{ estimatedCarrierCostCents?: number; resolved: ResolvedShippingPricingPolicy; manualCustomerPriceCents?: number }>): number => {
  const { policy } = input.resolved;
  if (policy.mode === "manual") return shippingCustomerPrice({ estimatedCarrierCostCents: 0, policy, manualCustomerPriceCents: input.manualCustomerPriceCents });
  if (policy.mode === "no_charge") return 0;
  if (input.estimatedCarrierCostCents === undefined) throw new Error("A valid estimated carrier cost is required before customer shipping price can be established.");
  return shippingCustomerPrice({ estimatedCarrierCostCents: input.estimatedCarrierCostCents, policy });
};

/** Stable lexical Order-number ordering receives any unavoidable penny remainder. */
export const equalShippingAllocation = (totalCents: number, orderNumbers: readonly string[]): ReadonlyMap<string, number> => {
  const total = cents(totalCents, "Customer shipping price");
  const ordered = [...new Set(orderNumbers)].sort((a, b) => a.localeCompare(b));
  if (!ordered.length) throw new Error("Shipping allocation requires one or more Orders.");
  const base = Math.floor(total / ordered.length), remainder = total % ordered.length;
  return new Map(ordered.map((number, index) => [number, base + (index < remainder ? 1 : 0)]));
};

export const assertShippingAllocations = (totalCents: number, allocations: readonly Readonly<{ orderId: string; customerShippingPriceCents: number }>[]) => {
  const total = cents(totalCents, "Customer shipping price");
  if (!allocations.length || new Set(allocations.map(value => value.orderId)).size !== allocations.length) throw new Error("Shipping allocations require each participating Order exactly once.");
  const allocated = allocations.reduce((sum, value) => sum + cents(value.customerShippingPriceCents, "Shipping allocation"), 0);
  if (allocated !== total) throw new Error("Shipping allocations must equal the total customer shipping price exactly.");
};

export const absorbedFreightCents = (actualCarrierCostCents: number, customerShippingPriceCents: number) => Math.max(0, cents(actualCarrierCostCents, "Actual carrier cost") - cents(customerShippingPriceCents, "Customer shipping price"));

/** Historical handoffs remain untouched: only a separate operational obligation is created. */
export const replacementRemainingQuantity = (replacementQuantity: number, replacementUsableGoodQuantity: number, replacementFulfilledQuantity: number) => {
  const required = cents(replacementQuantity, "Replacement quantity");
  const produced = cents(replacementUsableGoodQuantity, "Replacement usable output");
  const fulfilled = cents(replacementFulfilledQuantity, "Replacement fulfilled quantity");
  return { remainingProductionQuantity: Math.max(0, required - produced), remainingFulfillmentQuantity: Math.max(0, required - fulfilled), satisfied: produced >= required && fulfilled >= required };
};
