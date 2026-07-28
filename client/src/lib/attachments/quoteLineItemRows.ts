type QuoteLineItemRow = {
  id: string;
  fileRecordId?: string | null;
  fileName?: string | null;
  originalFilename?: string | null;
  fileSize?: number | null;
  sizeBytes?: number | null;
  originalUrl?: string | null;
  downloadUrl?: string | null;
  objectPath?: string | null;
  previewUrl?: string | null;
  thumbUrl?: string | null;
  thumbnailUrl?: string | null;
  previewThumbnailUrl?: string | null;
};

function makeMatchKey(item: QuoteLineItemRow) {
  const fileRecordId = (item?.fileRecordId ?? "").toString().trim();
  return fileRecordId ? `fr:${fileRecordId}` : null;
}

export function mergeQuoteLineItemRows<TAttachment extends QuoteLineItemRow, TAsset extends QuoteLineItemRow>(
  attachments: TAttachment[],
  assets: TAsset[],
): TAttachment[] {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  if (!Array.isArray(assets) || assets.length === 0) {
    return attachments;
  }

  const assetByKey = new Map<string, TAsset>();
  for (const asset of assets) {
    const key = makeMatchKey(asset);
    if (key) assetByKey.set(key, asset);
  }

  return attachments.map((attachment) => {
    const key = makeMatchKey(attachment);
    const matchedAsset = key ? assetByKey.get(key) : undefined;
    if (!matchedAsset) {
      return attachment;
    }

    return {
      ...attachment,
      originalUrl: attachment.originalUrl ?? matchedAsset.originalUrl ?? null,
      downloadUrl: (attachment as any).downloadUrl ?? matchedAsset.downloadUrl ?? null,
      objectPath: attachment.objectPath ?? matchedAsset.objectPath ?? null,
      previewUrl: attachment.previewUrl ?? matchedAsset.previewUrl ?? null,
      thumbUrl: attachment.thumbUrl ?? matchedAsset.thumbUrl ?? matchedAsset.thumbnailUrl ?? null,
      thumbnailUrl: (attachment as any).thumbnailUrl ?? matchedAsset.thumbnailUrl ?? matchedAsset.thumbUrl ?? null,
      previewThumbnailUrl:
        (attachment as any).previewThumbnailUrl ??
        matchedAsset.previewThumbnailUrl ??
        matchedAsset.thumbnailUrl ??
        matchedAsset.thumbUrl ??
        null,
    } as TAttachment;
  });
}
