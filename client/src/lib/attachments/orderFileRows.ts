type OrderFileRow = {
  id: string;
  fileRecordId?: string | null;
  fileName?: string | null;
  originalFilename?: string | null;
  fileSize?: number | null;
  sizeBytes?: number | null;
  mimeType?: string | null;
  createdAt?: string | null;
  originalUrl?: string | null;
  downloadUrl?: string | null;
  objectPath?: string | null;
  previewUrl?: string | null;
  thumbUrl?: string | null;
  thumbnailUrl?: string | null;
  previewThumbnailUrl?: string | null;
  pageCount?: number | null;
  pages?: any[];
};

function makeMatchKey(item: OrderFileRow) {
  const fileRecordId = String(item?.fileRecordId ?? "").trim();
  return fileRecordId ? `fr:${fileRecordId}` : null;
}

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function uniqueRelationshipRows<T extends OrderFileRow>(rows: T[]) {
  const seenIds = new Set<string>();
  return rows.filter((row) => {
    const id = String(row?.id ?? "").trim();
    if (!id || seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
}

export function normalizeOrderFileRows<TAttachment extends OrderFileRow, TAsset extends OrderFileRow>(
  attachments: TAttachment[],
  assets: TAsset[],
): Array<(TAttachment & { __source: "attachment"; source: "attachment" }) | (TAsset & { __source: "asset"; source: "asset" })> {
  const attachmentList = uniqueRelationshipRows(Array.isArray(attachments) ? attachments : []);
  const assetList = uniqueRelationshipRows(Array.isArray(assets) ? assets : []);

  if (attachmentList.length === 0 && assetList.length === 0) {
    return [];
  }

  const assetIndexesByKey = new Map<string, number[]>();
  for (let index = 0; index < assetList.length; index += 1) {
    const key = makeMatchKey(assetList[index]);
    if (!key) continue;
    const existing = assetIndexesByKey.get(key) ?? [];
    existing.push(index);
    assetIndexesByKey.set(key, existing);
  }

  const usedAssetIndexes = new Set<number>();

  const takeMatchedAsset = (attachment: TAttachment) => {
    const key = makeMatchKey(attachment);
    if (!key) return null;
    const indexes = assetIndexesByKey.get(key) ?? [];
    while (indexes.length > 0) {
      const index = indexes.shift();
      if (typeof index === "number" && !usedAssetIndexes.has(index)) {
        usedAssetIndexes.add(index);
        return assetList[index];
      }
    }
    return null;
  };

  const mergedAttachments = attachmentList.map((attachment) => {
    const matchedAsset = takeMatchedAsset(attachment);

    return {
      ...attachment,
      originalUrl: attachment.originalUrl ?? matchedAsset?.originalUrl ?? null,
      downloadUrl: (attachment as any).downloadUrl ?? matchedAsset?.downloadUrl ?? null,
      objectPath: attachment.objectPath ?? matchedAsset?.objectPath ?? null,
      previewUrl: attachment.previewUrl ?? matchedAsset?.previewUrl ?? null,
      thumbUrl: attachment.thumbUrl ?? matchedAsset?.thumbUrl ?? matchedAsset?.thumbnailUrl ?? null,
      thumbnailUrl:
        (attachment as any).thumbnailUrl ??
        matchedAsset?.thumbnailUrl ??
        matchedAsset?.thumbUrl ??
        null,
      previewThumbnailUrl:
        (attachment as any).previewThumbnailUrl ??
        matchedAsset?.previewThumbnailUrl ??
        matchedAsset?.thumbnailUrl ??
        matchedAsset?.thumbUrl ??
        null,
      pageCount: (attachment as any).pageCount ?? matchedAsset?.pageCount ?? null,
      pages: (attachment as any).pages ?? matchedAsset?.pages ?? [],
      __source: "attachment" as const,
      source: "attachment" as const,
    };
  });

  const unmatchedAssets = assetList
    .filter((_, index) => !usedAssetIndexes.has(index))
    .map((asset) => ({
      ...asset,
      originalFilename: asset.originalFilename ?? asset.fileName ?? null,
      fileSize: asset.fileSize ?? asset.sizeBytes ?? null,
      thumbUrl: asset.thumbUrl ?? asset.thumbnailUrl ?? null,
      thumbnailUrl: asset.thumbnailUrl ?? asset.thumbUrl ?? null,
      previewThumbnailUrl: asset.previewThumbnailUrl ?? asset.thumbnailUrl ?? asset.thumbUrl ?? null,
      __source: "asset" as const,
      source: "asset" as const,
    }));

  return [...mergedAttachments, ...unmatchedAssets].sort((a, b) => {
    const timestampDifference = toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
    return timestampDifference || String(a.id).localeCompare(String(b.id));
  });
}
