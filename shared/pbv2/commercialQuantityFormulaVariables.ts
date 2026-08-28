/**
 * Projects the one commercial line quantity into the formula scope only for
 * products that explicitly declare an hourly billing unit.  It deliberately
 * does not change quantity semantics for physical or area-priced products.
 */
export function bindCommercialQuantityToFormulaVariables(input: {
  treeJson: any;
  quantity: unknown;
  existing?: Record<string, number>;
  /** Product-level profile is authoritative when a legacy/draft tree has not yet been hydrated. */
  pricingProfileKey?: string | null;
}): Record<string, number> {
  const variables = { ...(input.existing ?? {}) };
  const billingUnit = input.treeJson?.meta?.billingUnit;
  const quantity = Number(input.quantity);
  const isHourlyProfile = input.pricingProfileKey === "hourly";
  const selectionKey = billingUnit?.kind === "hour" && typeof billingUnit.selectionKey === "string" && billingUnit.selectionKey.trim()
    ? billingUnit.selectionKey
    : isHourlyProfile
      ? "hours"
      : null;
  if (
    selectionKey
    && Number.isFinite(quantity)
    && quantity > 0
  ) {
    variables[selectionKey] = quantity;
  }
  return variables;
}
