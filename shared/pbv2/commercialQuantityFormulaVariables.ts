/**
 * Projects the one commercial line quantity into the formula scope only for
 * products that explicitly declare an hourly billing unit.  It deliberately
 * does not change quantity semantics for physical or area-priced products.
 */
export function bindCommercialQuantityToFormulaVariables(input: {
  treeJson: any;
  quantity: unknown;
  existing?: Record<string, number>;
}): Record<string, number> {
  const variables = { ...(input.existing ?? {}) };
  const billingUnit = input.treeJson?.meta?.billingUnit;
  const quantity = Number(input.quantity);
  if (
    billingUnit?.kind === "hour"
    && typeof billingUnit.selectionKey === "string"
    && billingUnit.selectionKey.trim()
    && Number.isFinite(quantity)
    && quantity > 0
  ) {
    variables[billingUnit.selectionKey] = quantity;
  }
  return variables;
}
