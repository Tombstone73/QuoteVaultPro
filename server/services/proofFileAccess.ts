import { PDFDocument } from "pdf-lib";
import { readArtworkFileForOrganization, type ArtworkAccessResult } from "./artwork/ArtworkFileAccessService";
import { readLegacyProofOriginal } from "./proofPreviewResolver";

export type ProofFileReference = {
  fileRecordId: string | null;
  fileName: string;
  mimeType: string | null;
  fileUrl?: string | null;
  relativePath?: string | null;
  storageProvider?: string | null;
};

/** Read the actual version artifact, never an artwork thumbnail or a replacement file. */
export async function readProofFile(organizationId: string, file: ProofFileReference, dependencies = {
  readCanonical: readArtworkFileForOrganization,
  readLegacy: readLegacyProofOriginal,
}): Promise<ArtworkAccessResult> {
  try {
    const result = file.fileRecordId
      ? await dependencies.readCanonical({ organizationId, fileRecordId: file.fileRecordId, variant: "original" })
      : await dependencies.readLegacy({ organizationId, file });
    if (!result?.buffer.length) throw new Error("missing");
    if ((file.mimeType || result.mimeType) === "application/pdf") {
      const pdf = await PDFDocument.load(result.buffer);
      if (!pdf.getPageCount()) throw new Error("empty PDF");
    }
    return result;
  } catch {
    throw Object.assign(new Error("The proof file could not be read from storage. Retry file access; if it remains unavailable, generate a new proof draft. Existing versions are preserved."), {
      statusCode: 409, code: "PROOF_FILE_UNAVAILABLE",
    });
  }
}
