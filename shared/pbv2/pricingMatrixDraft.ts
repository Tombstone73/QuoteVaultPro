import type { ProductOptionPricingMatrix } from "../productOptionPricingMatrix";

export function setPricingMatrixDimension(
  pricingMatrix: ProductOptionPricingMatrix,
  dimension: string,
  checked: boolean,
): ProductOptionPricingMatrix {
  const dimensions = checked
    ? Array.from(new Set([...pricingMatrix.dimensions, dimension]))
    : pricingMatrix.dimensions.filter((entry) => entry !== dimension);

  return {
    ...pricingMatrix,
    dimensions,
    rows: pricingMatrix.rows,
  };
}
