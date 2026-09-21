import { lineItemArtworkReadResolver } from "./artwork/LineItemArtworkReadResolver";
import { readArtworkFileForOrganization } from "./artwork/ArtworkFileAccessService";
import { hydrateInvoiceLineItemsWithProductIdentity } from "./invoiceLinePresentation.service";

const MAX_PDF_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const PDF_ARTWORK_READ_TIMEOUT_MS = 5_000;

/** Artwork thumbnails are optional invoice presentation. A stalled object
 * storage read must never prevent the invoice PDF or email provider send. */
function withArtworkReadTimeout<T>(operation: Promise<T>, fileRecordId: string): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Artwork thumbnail read timed out for ${fileRecordId}`)), PDF_ARTWORK_READ_TIMEOUT_MS)),
  ]);
}

function toPdfThumbnailDataUrl(file: { buffer: Buffer; mimeType: string } | null): string | null {
  if (!file || file.buffer.length === 0 || file.buffer.length > MAX_PDF_THUMBNAIL_BYTES) return null;
  const mimeType = String(file.mimeType || "").toLowerCase();
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") return null;
  return `data:${mimeType};base64,${file.buffer.toString("base64")}`;
}

/**
 * Adds a presentation-only thumbnail to invoice snapshots without exposing a
 * storage URL or falling back to original artwork.  The canonical artwork
 * relation remains the sole source of ownership for the linked order line.
 */
export async function hydrateInvoicePdfLineItemsWithArtwork<T extends Record<string, any>>(input: {
  organizationId: string;
  lineItems: T[];
}): Promise<Array<T & { productName: string | null; thumbnailDataUrl?: string | null }>> {
  const identifiedLines = await hydrateInvoiceLineItemsWithProductIdentity(input);
  const lineItemIds = Array.from(new Set(input.lineItems
    .map((line) => typeof line.orderLineItemId === "string" ? line.orderLineItemId : null)
    .filter((id): id is string => Boolean(id))));
  if (!lineItemIds.length) return identifiedLines;

  let resolutions;
  try {
    resolutions = await withArtworkReadTimeout(lineItemArtworkReadResolver.resolveForLineItems({
      organizationId: input.organizationId,
      lineItemIds,
      purpose: "order",
    }), "artwork-resolution");
  } catch (error) {
    console.warn("[InvoicePdfArtwork] Canonical artwork resolution unavailable", { organizationId: input.organizationId, error });
    return identifiedLines;
  }

  const thumbnails = new Map<string, string | null>();
  await Promise.all(lineItemIds.map(async (lineItemId) => {
    const artwork = resolutions.get(lineItemId)?.artwork[0];
    if (!artwork) return thumbnails.set(lineItemId, null);
    try {
      const thumbnail = await withArtworkReadTimeout(readArtworkFileForOrganization({
        organizationId: input.organizationId,
        fileRecordId: artwork.fileRecordId,
        variant: "thumbnail",
      }), artwork.fileRecordId);
      thumbnails.set(lineItemId, toPdfThumbnailDataUrl(thumbnail));
    } catch (error) {
      console.warn("[InvoicePdfArtwork] Thumbnail derivative unavailable", { organizationId: input.organizationId, fileRecordId: artwork.fileRecordId, error });
      thumbnails.set(lineItemId, null);
    }
  }));

  return identifiedLines.map((line) => {
    const lineItemId = typeof line.orderLineItemId === "string" ? line.orderLineItemId : null;
    const thumbnailDataUrl = lineItemId ? thumbnails.get(lineItemId) : null;
    return thumbnailDataUrl ? { ...line, thumbnailDataUrl } : line;
  });
}
