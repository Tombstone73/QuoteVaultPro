type ArtworkRelationshipRow = {
  id: string;
};

function uniqueRelationshipRows<T extends ArtworkRelationshipRow>(rows: T[]) {
  const seenIds = new Set<string>();
  return rows.filter((row) => {
    const id = String(row?.id ?? "").trim();
    if (!id || seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
}

/**
 * Builds the Artwork Assets response from user-manageable relationships only.
 * Prepress/proof line_item_files are deliberately excluded by the caller: they
 * mirror a file record but are not an Artwork Assets relationship or delete ID.
 */
export function buildOrderLineItemArtworkAssetsResponse<TAttachment extends ArtworkRelationshipRow, TAsset extends ArtworkRelationshipRow>(
  attachments: TAttachment[],
  assets: TAsset[],
) {
  return {
    data: uniqueRelationshipRows(attachments),
    assets: uniqueRelationshipRows(assets),
  };
}
