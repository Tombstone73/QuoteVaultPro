import { createHash } from "node:crypto";
import type { OperationContext } from "../../src/application/operation.js";
import { failure, success, V2ApplicationError, type ApplicationResult } from "../../src/errors/applicationError.js";
import type { WorkspaceArtworkResult, WorkspaceArtworkUploadInput, WorkspaceArtworkUploads } from "../../src/modules/artwork/workspaceArtwork.js";
import type { ArtworkBinaryStorage } from "./artworkBinaryStorage.js";
import { canonicalArtworkPdfContentType, validateArtworkPdf } from "./artworkPdfValidation.js";
import type { PostgresWorkspaceArtwork } from "./postgresWorkspaceArtwork.js";

/** Only validated bytes reach durable staging. Canonical adoption is a separate,
 * transaction-local Artwork owner operation, never an upload side effect. */
export class WorkspaceArtworkUploadService implements WorkspaceArtworkUploads {
  constructor(private readonly claims: PostgresWorkspaceArtwork, private readonly storage: ArtworkBinaryStorage) {}

  async upload(context: OperationContext, input: WorkspaceArtworkUploadInput): Promise<ApplicationResult<WorkspaceArtworkResult>> {
    try {
      const filename = input.filename.replace(/[\\/]/gu, "_").replace(/[^A-Za-z0-9._ -]/gu, "_").replace(/\s+/gu, " ").trim();
      if (!filename || filename.length > 120) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork filename is invalid.");
      if (input.bytes.byteLength > 10 * 1024 * 1024) throw new V2ApplicationError("SIZE_LIMIT", "Artwork file exceeds the 10 MB limit.");
      const bytes = Buffer.from(input.bytes);
      await validateArtworkPdf(bytes);
      const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
      return success(await this.claims.storeUpload(context, {
        workspaceId: input.workspaceId, workspaceLineId: input.workspaceLineId, requestId: input.requestId,
        expectedRevision: input.expectedRevision, filename, contentType: canonicalArtworkPdfContentType, byteSize: bytes.length, checksumSha256,
      }, (objectKey) => this.storage.put({ organizationId: context.organizationId, objectKey, contentType: canonicalArtworkPdfContentType, bytes })));
    } catch (cause) {
      return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("RETRYABLE_FAILURE", "Workspace Artwork storage is unavailable."));
    }
  }
}
