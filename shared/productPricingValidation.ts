export type ProductPricingValidationPolicyInput = {
  workflowIntent?: string | null;
  pricingProfileKey?: string | null;
  isService?: boolean | null;
};

/** Service/billing products do not participate in print-option validation. */
export function skipsRequiredPrintOptionValidation(
  product: ProductPricingValidationPolicyInput | null | undefined,
): boolean {
  return Boolean(
    product?.workflowIntent === "service_fee" ||
      product?.pricingProfileKey === "fee" ||
      product?.isService === true,
  );
}
