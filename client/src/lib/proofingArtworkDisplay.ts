type ProofingArtworkSourceRef = {
  sourceType: "line_item_artwork" | "line_item_asset" | "line_item_file";
  sourceId: string;
};

/** Builds a tenant-authenticated, canonical artwork viewer URL for Proofing. */
export function buildProofingArtworkDisplayUrl(lineItemId: string | null | undefined, source: ProofingArtworkSourceRef) {
  const normalizedLineItemId = String(lineItemId || "").trim();
  const normalizedSourceId = String(source.sourceId || "").trim();
  if (!normalizedLineItemId || !normalizedSourceId) return null;

  return `/api/proofing/line-item/${encodeURIComponent(normalizedLineItemId)}/eligible-artwork/${encodeURIComponent(source.sourceType)}/${encodeURIComponent(normalizedSourceId)}/preview`;
}
