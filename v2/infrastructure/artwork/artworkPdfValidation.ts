import { PDFDocument } from "pdf-lib";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

export const canonicalArtworkPdfContentType = "application/pdf";

/**
 * Browser-provided multipart MIME labels are advisory: operating systems may
 * report a valid PDF as application/octet-stream.  Require both a bounded PDF
 * header and a successful structural parse of the exact received bytes.
 */
export const validateArtworkPdf = async (bytes: Buffer): Promise<void> => {
  if (!bytes.length) throw new V2ApplicationError("EMPTY_FILE", "Artwork file cannot be empty.");
  if (bytes.subarray(0, Math.min(bytes.length, 1024)).indexOf("%PDF-", 0, "ascii") < 0)
    throw new V2ApplicationError("NOT_PDF", "Artwork must be a PDF file.");
  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false, throwOnInvalidObject: true });
    if (document.getPageCount() < 1) throw new Error("PDF has no pages.");
  } catch {
    throw new V2ApplicationError("CORRUPT_PDF", "Artwork PDF could not be read.");
  }
};
