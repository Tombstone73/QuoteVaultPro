export function normalizePbv2ProductIdentity(productId?: string | null): string | null {
  return typeof productId === "string" && productId.trim().length > 0 ? productId : null;
}

export function shouldBlockPbv2TreeHydration(input: {
  isLocalDirty: boolean;
  hasLocalTree: boolean;
  lastLoadedProductId?: string | null;
  productId?: string | null;
}): boolean {
  return (
    input.isLocalDirty &&
    input.hasLocalTree &&
    normalizePbv2ProductIdentity(input.lastLoadedProductId) === normalizePbv2ProductIdentity(input.productId)
  );
}
