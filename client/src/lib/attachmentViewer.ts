import type { AttachmentData, AttachmentPage } from "@/components/AttachmentViewerDialog";

type RawAttachmentRecord = Record<string, any>;

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function normalizeAttachmentPage(page: RawAttachmentRecord, index: number): AttachmentPage {
  return {
    ...page,
    id: firstString(page?.id, page?.pageId, `page-${index + 1}`) ?? `page-${index + 1}`,
    pageIndex: firstNumber(page?.pageIndex, page?.index, index + 1) ?? index + 1,
    thumbStatus: page?.thumbStatus,
    thumbKey: firstString(page?.thumbKey),
    previewKey: firstString(page?.previewKey),
    thumbError: firstString(page?.thumbError),
    thumbUrl: firstString(page?.thumbUrl, page?.thumbnailUrl, page?.previewThumbnailUrl),
    previewUrl: firstString(page?.previewUrl, page?.originalUrl, page?.url),
  };
}

export function toAttachmentViewerAttachment<T extends RawAttachmentRecord>(raw: T): AttachmentData & T {
  const fileName =
    firstString(raw?.fileName, raw?.filename, raw?.originalFilename, raw?.name, raw?.title) ?? "Attachment";
  const originalUrl = firstString(raw?.originalUrl, raw?.url, raw?.href, raw?.fileUrl);
  const previewUrl = firstString(raw?.previewUrl, raw?.viewerUrl, raw?.viewUrl, originalUrl);
  const downloadUrl = firstString(raw?.downloadUrl, raw?.originalDownloadUrl, originalUrl);
  const pages = Array.isArray(raw?.pages)
    ? raw.pages.map((page: RawAttachmentRecord, index: number) => normalizeAttachmentPage(page, index))
    : undefined;

  return {
    ...raw,
    id: firstString(raw?.id, raw?.attachmentId, raw?.fileId, fileName) ?? fileName,
    fileName,
    originalFilename: firstString(raw?.originalFilename, raw?.filename, raw?.fileName),
    mimeType: firstString(raw?.mimeType, raw?.contentType, raw?.type),
    fileUrl: firstString(raw?.fileUrl, previewUrl, originalUrl, downloadUrl) ?? undefined,
    fileSize: firstNumber(raw?.fileSize, raw?.sizeBytes, raw?.size, raw?.bytes),
    createdAt: firstString(raw?.createdAt, raw?.created_at, raw?.uploadedAt, raw?.updatedAt) ?? undefined,
    thumbStatus: raw?.thumbStatus,
    thumbKey: firstString(raw?.thumbKey),
    previewKey: firstString(raw?.previewKey),
    thumbError: firstString(raw?.thumbError),
    originalUrl,
    downloadUrl,
    thumbUrl: firstString(raw?.thumbUrl, raw?.thumbnailUrl, raw?.previewThumbnailUrl),
    previewUrl,
    objectPath: firstString(raw?.objectPath, raw?.object_key, raw?.filePath),
    pageCount: firstNumber(raw?.pageCount, pages?.length),
    pages,
  };
}

export function toAttachmentViewerAttachments<T extends RawAttachmentRecord>(items: T[] | null | undefined): Array<AttachmentData & T> {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.map((item) => toAttachmentViewerAttachment(item));
}
