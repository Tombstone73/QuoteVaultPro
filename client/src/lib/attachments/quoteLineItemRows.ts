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
  if (fileRecordId) return `fr:${fileRecordId}`;

  const fileName = (item?.originalFilename ?? item?.fileName ?? "").toString().trim().toLowerCase();
  const size = Number(item?.fileSize ?? item?.sizeBytes ?? 0);
  return `legacy:${fileName}:${Number.isFinite(size) ? size : 0}`;
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
    assetByKey.set(makeMatchKey(asset), asset);
  }

  return attachments.map((attachment) => {
    const matchedAsset = assetByKey.get(makeMatchKey(attachment));
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