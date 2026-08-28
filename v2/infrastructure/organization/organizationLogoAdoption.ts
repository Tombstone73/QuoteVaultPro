import { createHash } from "node:crypto";
import type { Principal } from "../../src/authorization/principals.js";
import { principalSubject, staffActorId } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { OrganizationSettings } from "../../src/modules/organization/businessProfile.js";
import { storageApplicationService } from "../../../server/services/storage/StorageApplicationService.js";
import { assets } from "../../../shared/schema.js";
import type { Pool } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";

export type OrganizationLogoUpload = Readonly<{
  businessRequestId: string;
  expectedRevision: string;
  filename: string;
  contentType: "image/png" | "image/jpeg";
  bytes: Buffer;
}>;

export type OrganizationLogoSettings = Readonly<{
  read(organizationId: string): Promise<OrganizationSettings>;
  adoptLogoAsset(organizationId: string, input: Readonly<{ expectedRevision: string; assetId: string }>, principal: Principal, requestId: string): Promise<OrganizationSettings>;
}>;

const maximumBytes = 2 * 1024 * 1024;
const safeFilename = (value: string): string => {
  const result = value.replace(/[\\/]/gu, "_").replace(/[^A-Za-z0-9._ -]/gu, "_").replace(/\s+/gu, " ").trim();
  if (!result || result.length > 255) throw new V2ApplicationError("VALIDATION_ERROR", "Logo filename is invalid.");
  return result;
};

/**
 * Composition bridge for the established private file-record/asset authority.
 * The browser never receives its object key, bucket, signed URL, or token.
 */
export class OrganizationLogoAdoptionService {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly pool: Pool, private readonly settings: OrganizationLogoSettings) {}

  async adopt(organizationId: string, principal: Principal, input: OrganizationLogoUpload): Promise<OrganizationSettings> {
    if (!input.businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
    const filename = safeFilename(input.filename);
    if (!input.expectedRevision.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "expectedRevision is required.");
    if (!input.bytes.length) throw new V2ApplicationError("VALIDATION_ERROR", "Logo file cannot be empty.");
    if (input.bytes.length > maximumBytes) throw new V2ApplicationError("VALIDATION_ERROR", "Logo file exceeds the 2 MB limit.");
    if (input.contentType === "image/png" && input.bytes.subarray(0, 8).compare(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) !== 0)
      throw new V2ApplicationError("VALIDATION_ERROR", "Logo must be a valid PNG or JPG file.");
    if (input.contentType === "image/jpeg" && input.bytes.subarray(0, 3).compare(Buffer.from([0xff,0xd8,0xff])) !== 0)
      throw new V2ApplicationError("VALIDATION_ERROR", "Logo must be a valid PNG or JPG file.");

    const fingerprint = createHash("sha256").update(JSON.stringify({ expectedRevision: input.expectedRevision, filename, contentType: input.contentType, checksum: createHash("sha256").update(input.bytes).digest("hex") })).digest("hex");
    const reservation = await this.reserve(organizationId, principal, input.businessRequestId, fingerprint);
    if (reservation.replay) return reservation.replay;

    try {
      // A preflight read fails stale work before any bytes leave the process. The
      // commit below repeats the stale check at the configuration boundary.
      const current = await this.settings.read(organizationId);
      if (current.revision !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "Organization settings were changed by another request. Reload and try again.");
      const finalized = await storageApplicationService.finalizeUpload({
        organizationId,
        createdByUserId: staffActorId(principal) ?? null,
        resource: { organizationId, resourceType: "organization", resourceId: organizationId },
        source: { kind: "buffer", buffer: input.bytes, originalFilename: filename, mimeType: input.contentType },
        persistLink: async (tx, stored) => {
          const [asset] = await tx.insert(assets).values({
            organizationId, fileRecordId: stored.fileRecord.id,
            fileKey: stored.storedObject.objectKey ?? stored.storedObject.localPathRef ?? null,
            fileName: stored.storedObject.originalFilename, mimeType: stored.storedObject.mimeType,
            sizeBytes: stored.storedObject.sizeBytes, sha256: stored.storedObject.checksum,
            status: "uploaded", previewStatus: "pending",
          }).returning();
          if (!asset) throw new Error("Organization logo asset could not be recorded.");
          return asset;
        },
      });
      const result = await this.settings.adoptLogoAsset(organizationId, { expectedRevision: input.expectedRevision, assetId: finalized.linkedRecord.id }, principal, input.businessRequestId);
      return result;
    } catch (error) {
      // The storage authority removes a newly written object when its own
      // persistence callback fails. A stale settings race leaves a private,
      // unreferenced asset for normal retention/reconciliation rather than
      // deleting a potentially shared canonical file.
      await this.completeFailure(organizationId, reservation.requestId, !(error instanceof V2ApplicationError) || error.code === "RETRYABLE_FAILURE");
      throw error instanceof V2ApplicationError ? error : new V2ApplicationError("RETRYABLE_FAILURE", "Organization logo storage is unavailable.");
    }
  }

  private async reserve(organizationId: string, principal: Principal, businessRequestId: string, payloadFingerprint: string): Promise<Readonly<{ requestId: string; replay?: OrganizationSettings }>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const reservation = await this.requests.reserve(client, { organizationId, operation: "organization.documents_branding.logo.adopt.v1", businessRequestId, payloadFingerprint, principalKind: principal.kind, principalSubject: principalSubject(principal), staffActorUserId: staffActorId(principal) });
      if (reservation.kind === "replay") {
        if (reservation.request.status === "succeeded" && reservation.request.resultJson) { await client.query("COMMIT"); return { requestId: reservation.request.id, replay: reservation.request.resultJson as OrganizationSettings }; }
        throw new V2ApplicationError("CONFLICT", "This logo adoption request is already being processed.");
      }
      await client.query("COMMIT");
      return { requestId: reservation.request.id };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  private async completeFailure(organizationId: string, requestId: string, retryable: boolean): Promise<void> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); if (retryable) await this.requests.markRetryableFailure(client, organizationId, requestId); else await this.requests.markPermanentFailure(client, organizationId, requestId); await client.query("COMMIT"); }
    catch { await client.query("ROLLBACK"); } finally { client.release(); }
  }
}
