import sharp from "sharp";

export const ASSISTANT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MIME_BY_FORMAT = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" } as const;
export type ImageMime = typeof MIME_BY_FORMAT[keyof typeof MIME_BY_FORMAT];
export class AssistantImageError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}

export async function normalizeAssistantImageSource(source: { fileName: string; buffer: Buffer }) {
  if (!source.buffer.length || source.buffer.length > ASSISTANT_IMAGE_MAX_BYTES) {
    throw new AssistantImageError(413, "Choose an image up to 5 MB.");
  }
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(source.buffer, { limitInputPixels: 40_000_000 }).metadata();
    await sharp(source.buffer, { limitInputPixels: 40_000_000 }).resize(1, 1).toBuffer();
  } catch {
    throw new AssistantImageError(415, "This file is not a readable image. Use JPG, PNG, GIF, or WebP.");
  }
  let buffer = source.buffer;
  let mimeType = MIME_BY_FORMAT[metadata.format as keyof typeof MIME_BY_FORMAT];
  let fileName = source.fileName.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 240) || "image";
  if (metadata.format === "heif") {
    try {
      buffer = await sharp(source.buffer, { limitInputPixels: 40_000_000 }).rotate().jpeg({ quality: 86 }).toBuffer();
      mimeType = "image/jpeg";
      fileName = fileName.replace(/\.(heic|heif)$/i, "") + ".jpg";
    } catch {
      throw new AssistantImageError(415, "This server cannot convert HEIC photos. Choose JPG or PNG from your phone.");
    }
  }
  if (!mimeType || buffer.length > ASSISTANT_IMAGE_MAX_BYTES) {
    throw new AssistantImageError(415, "Use a JPG, PNG, GIF, or WebP image up to 5 MB.");
  }
  return { buffer, mimeType, fileName };
}


export function assertAssistantImageOwnership<T extends { id: string; orgId: string; conversationId: string; uploadedByUserId: string; removedAt: Date | null }>(
  scope: { organizationId: string; conversationId: string; userId: string }, ids: readonly string[], rows: readonly T[],
): T[] {
  if (ids.length > 4 || new Set(ids).size !== ids.length) throw new AssistantImageError(400, "Attach at most four different images.");
  const byId = new Map(rows.map(row => [row.id, row]));
  const authorized = ids.map(id => byId.get(id));
  if (authorized.some(row => !row || row.orgId !== scope.organizationId || row.conversationId !== scope.conversationId ||
    row.uploadedByUserId !== scope.userId || row.removedAt !== null)) {
    throw new AssistantImageError(404, "One or more images are unavailable in this conversation.");
  }
  return authorized as T[];
}
