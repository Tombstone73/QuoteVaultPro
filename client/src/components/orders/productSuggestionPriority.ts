export type ProductSuggestionLike = {
  id: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  isActive?: boolean | null;
  primaryMaterialId?: string | null;
  linkedMaterialIds?: string[] | null;
};

function productMatchesSearch(product: ProductSuggestionLike, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    product.name.toLowerCase().includes(q) ||
    String(product.sku || "").toLowerCase().includes(q) ||
    String(product.category || "").toLowerCase().includes(q)
  );
}

function isLinkedToKnownMaterial(product: ProductSuggestionLike, materialId: string): boolean {
  if (!materialId) return false;
  if (product.primaryMaterialId === materialId) return true;
  return Array.isArray(product.linkedMaterialIds) && product.linkedMaterialIds.includes(materialId);
}

export function filterAndPrioritizeProductsForMaterial<T extends ProductSuggestionLike>(
  products: T[],
  searchQuery: string,
  materialId?: string | null
): T[] {
  const q = searchQuery.trim();
  const knownMaterialId = String(materialId || "").trim();
  const activeMatches = products.filter((product) => product.isActive !== false && productMatchesSearch(product, q));

  if (!knownMaterialId) return activeMatches;

  return [...activeMatches].sort((left, right) => {
    const leftLinked = isLinkedToKnownMaterial(left, knownMaterialId);
    const rightLinked = isLinkedToKnownMaterial(right, knownMaterialId);
    if (leftLinked !== rightLinked) return leftLinked ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}
