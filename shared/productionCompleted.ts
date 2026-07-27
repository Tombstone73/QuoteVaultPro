export type CompletedArtworkQuantityMode = "one_each_per_file" | "same_quantity_each" | "unspecified";

export type CompletedArtworkAllocation = {
  allocatedQuantity: number | null;
};

function finiteQuantity(value: unknown): number | null {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

export function resolveCompletedArtworkQuantityMode(specsJson: unknown): CompletedArtworkQuantityMode {
  const inbound = specsJson && typeof specsJson === "object" && !Array.isArray(specsJson)
    ? (specsJson as Record<string, unknown>).inbound
    : null;
  const mode = inbound && typeof inbound === "object" && !Array.isArray(inbound)
    ? (inbound as Record<string, unknown>).artworkQuantityMode
    : null;
  return mode === "one_each_per_file" || mode === "same_quantity_each" ? mode : "unspecified";
}

export function resolveCompletedArtworkAllocations(input: {
  totalQuantity: unknown;
  artworkCount: number;
  quantityMode: CompletedArtworkQuantityMode;
}): { allocations: CompletedArtworkAllocation[]; allocationIssue: string | null } {
  const totalQuantity = finiteQuantity(input.totalQuantity);
  const artworkCount = Math.max(0, Math.floor(Number(input.artworkCount) || 0));
  const allocationIssue = input.quantityMode === "one_each_per_file" && totalQuantity !== artworkCount
    ? `Allocation expects 1 each across ${artworkCount} artwork files, but the ordered quantity is ${totalQuantity ?? "not specified"}.`
    : null;
  const allocatedQuantity = input.quantityMode === "one_each_per_file" && !allocationIssue
    ? 1
    : input.quantityMode === "same_quantity_each"
      ? totalQuantity
      : null;
  return {
    allocations: Array.from({ length: artworkCount }, () => ({ allocatedQuantity })),
    allocationIssue,
  };
}

export function describeCompletedArtworkSummary(input: {
  totalQuantity: unknown;
  artworkCount: number;
  quantityMode: CompletedArtworkQuantityMode;
  sides: Array<string | null | undefined>;
}): string {
  const totalQuantity = finiteQuantity(input.totalQuantity);
  const artworkCount = Math.max(0, Math.floor(Number(input.artworkCount) || 0));
  const normalizedSides = new Set(input.sides.map((side) => String(side ?? "").toLowerCase()));
  const hasBothSides = normalizedSides.has("both") || (normalizedSides.has("front") && normalizedSides.has("back"));
  const sideLabel = hasBothSides ? "Front and back" : normalizedSides.has("front") ? "Front" : normalizedSides.has("back") ? "Back" : null;
  const parts = [
    totalQuantity === null ? "Quantity not specified" : `Quantity ${totalQuantity}`,
    sideLabel,
    `${artworkCount} artwork file${artworkCount === 1 ? "" : "s"}`,
    input.quantityMode === "one_each_per_file" && totalQuantity === artworkCount ? "1 each" : null,
    input.quantityMode === "same_quantity_each" && totalQuantity !== null ? `${totalQuantity} each` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.join(" • ");
}

export function completedProductionSearchText(job: {
  orderNumber?: string | null;
  customerName?: string | null;
  itemName?: string | null;
  productName?: string | null;
  mediaName?: string | null;
  dimensions?: string | null;
  artwork?: Array<{ fileName?: string | null }> | null;
}): string {
  return [
    job.orderNumber,
    job.customerName,
    job.itemName,
    job.productName,
    job.mediaName,
    job.dimensions,
    ...(job.artwork ?? []).map((file) => file.fileName),
  ].filter(Boolean).join(" ").toLowerCase();
}
