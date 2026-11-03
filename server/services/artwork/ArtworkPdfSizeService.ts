import { promises as fs } from "fs";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { orderAttachments, orders, quoteAttachments } from "@shared/schema";
import { isInboundPdfAttachment, type InboundPdfSizeAnalysis } from "@shared/inboundPdfSizeAnalysis";
import { loadUploadSessionMeta } from "../chunkedUploads";
import { resolveLocalStoragePath } from "../localStoragePath";
import { fileRecordRepository } from "../../storage/fileRecord.repo";
import { readArtworkFileForOrganization } from "./ArtworkFileAccessService";
import { analyzePdfBytes, withAnalysisTimeout } from "./analyzePdfSize";

const MAX_BYTES = 25 * 1024 * 1024;
export type ArtworkPdfSource = { uploadId: string } | { fileRecordId: string };

async function attachedFile(organizationId: string, fileRecordId: string) {
  // A bare canonical ID must not expose quarantined, unlinked inbound evidence.
  const [orderLinks, quoteLinks] = await Promise.all([
    db.select({ id: orderAttachments.id }).from(orderAttachments).innerJoin(orders, eq(orderAttachments.orderId, orders.id)).where(and(eq(orders.organizationId, organizationId), eq(orderAttachments.fileRecordId, fileRecordId))).limit(1),
    db.select({ id: quoteAttachments.id }).from(quoteAttachments).where(and(eq(quoteAttachments.organizationId, organizationId), eq(quoteAttachments.fileRecordId, fileRecordId))).limit(1),
  ]);
  if (!orderLinks.length && !quoteLinks.length) return null;
  return fileRecordRepository.getByIdForOrganization(organizationId, fileRecordId);
}

const defaultDependencies = {
  loadUpload: loadUploadSessionMeta,
  attachedFile,
  readArtwork: readArtworkFileForOrganization,
  readLocal: async (relativePath: string) => {
    const absolutePath = resolveLocalStoragePath(relativePath);
    if ((await fs.stat(absolutePath)).size > MAX_BYTES) throw new Error("PDF size limit");
    return fs.readFile(absolutePath);
  },
};

/** Read-only adapter to the same detector used by inbound intake. Never changes file ownership. */
export async function inspectArtworkPdfSize(
  args: { organizationId: string; userId: string; source: ArtworkPdfSource },
  dependencies = defaultDependencies,
): Promise<InboundPdfSizeAnalysis | null> {
  return withAnalysisTimeout((async () => {
    let bytes: Uint8Array;
    let identity: string;
    if ("uploadId" in args.source) {
      const upload = await dependencies.loadUpload(args.source.uploadId);
      if (upload.organizationId !== args.organizationId || upload.createdByUserId !== args.userId
        || upload.purpose !== "order-attachment" || upload.status !== "finalized" || !upload.relativePath
        || upload.linkedAt || Date.parse(upload.expiresAt) <= Date.now()
        || upload.sizeBytes > MAX_BYTES || !isInboundPdfAttachment({ mimeType: upload.mimeType, sourceFilename: upload.originalFilename })) return null;
      bytes = await dependencies.readLocal(upload.relativePath);
      identity = `upload:${upload.uploadId}:${upload.checksum ?? ""}`;
    } else {
      const file = await dependencies.attachedFile(args.organizationId, args.source.fileRecordId);
      if (!file || Number(file.sizeBytes) > MAX_BYTES || !isInboundPdfAttachment({ mimeType: file.mimeType, sourceFilename: file.originalFilename })) return null;
      const artwork = await dependencies.readArtwork({ organizationId: args.organizationId, fileRecordId: file.id, variant: "original" });
      if (!artwork) return null;
      bytes = artwork.buffer;
      identity = `${file.id}:${file.checksum ?? ""}`;
    }
    if (bytes.byteLength > MAX_BYTES) return null;
    return analyzePdfBytes(bytes, identity);
  })());
}
