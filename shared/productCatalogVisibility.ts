export type ProductCatalogVisibilityInput = {
  isActive?: boolean | null;
};

export function filterProductsForCatalog<T extends ProductCatalogVisibilityInput>(
  products: T[],
  options?: { activeOnly?: boolean },
): T[] {
  if (!options?.activeOnly) return products;
  return products.filter((product) => product.isActive !== false);
}
