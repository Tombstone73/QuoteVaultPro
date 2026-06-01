export type MaterialProductLinkCandidate = {
  id: string;
  isActive?: boolean | null;
};

export type ExistingMaterialProductLink = {
  productId: string;
  removedAt?: Date | string | null;
};

export function normalizeLinkedProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((id) => String(id || "").trim()).filter(Boolean)));
}

export function planMaterialProductLinkReplacement(
  requestedProductIds: unknown,
  candidateProducts: MaterialProductLinkCandidate[],
  existingLinks: ExistingMaterialProductLink[] = []
) {
  const requested = normalizeLinkedProductIds(requestedProductIds);
  const activeCandidateIds = new Set(
    candidateProducts
      .filter((product) => product.isActive !== false)
      .map((product) => String(product.id || "").trim())
      .filter(Boolean)
  );
  const linkedProductIds = requested.filter((id) => activeCandidateIds.has(id));
  const linkedProductIdSet = new Set(linkedProductIds);
  const activeExistingIds = new Set(
    existingLinks
      .filter((link) => !link.removedAt)
      .map((link) => String(link.productId || "").trim())
      .filter(Boolean)
  );

  return {
    linkedProductIds,
    ignoredProductIds: requested.filter((id) => !activeCandidateIds.has(id)),
    productIdsToActivate: linkedProductIds,
    productIdsToRemove: Array.from(activeExistingIds).filter((id) => !linkedProductIdSet.has(id)),
  };
}
