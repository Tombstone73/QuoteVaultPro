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
}, timeoutMs = 30_000): Promise<ArtworkAccessResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      file.fileRecordId
        ? dependencies.readCanonical({ organizationId, fileRecordId: file.fileRecordId, variant: "original" })
        : dependencies.readLegacy({ organizationId, file }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("Proof storage retrieval timed out. Refresh file status and retry; existing versions are preserved."), { statusCode: 504, code: "PROOF_FILE_READ_TIMEOUT" })), timeoutMs); }),
    ]);
    if (!result?.buffer.length) throw new Error("missing");
    if ((file.mimeType || result.mimeType) === "application/pdf") {
      const pdf = await PDFDocument.load(result.buffer);
      if (!pdf.getPageCount()) throw new Error("empty PDF");
    }
    return result;
  } catch (error) {
    if ((error as { code?: string })?.code === "PROOF_FILE_READ_TIMEOUT") throw error;
    throw Object.assign(new Error("The proof file could not be read from storage. Retry file access; if it remains unavailable, generate a new proof draft. Existing versions are preserved."), {
      statusCode: 409, code: "PROOF_FILE_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timer);
  }
}
