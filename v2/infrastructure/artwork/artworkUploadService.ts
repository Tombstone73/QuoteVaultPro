import { createHash } from "node:crypto";
import type { OperationContext } from "../../src/application/operation.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../src/errors/applicationError.js";
import { ArtworkApplicationService } from "../../src/modules/artwork/artworkApplication.js";
import type { ArtworkMutationResult, ArtworkPurpose, ArtworkSide } from "../../src/modules/artwork/contracts.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { ArtworkBinaryStorage } from "./artworkBinaryStorage.js";

export type ArtworkUploadInput = Readonly<{
  businessRequestId: string;
  orderId: string;
  orderLineId: string;
  purpose: ArtworkPurpose;
  side?: ArtworkSide;
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
  supersedesArtworkAssignmentId?: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}>;

const maximumBytes = 10 * 1024 * 1024;
const safeFilename = (value: string): string => {
  const filename = value.replace(/[\\/]/gu, "_").replace(/[^A-Za-z0-9._ -]/gu, "_").replace(/\s+/gu, " ").trim();
  if (!filename || filename.length > 120) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork filename is invalid.");
  return filename;
};
const validPurpose = (value: string): value is ArtworkPurpose => ["customer_supplied", "production", "proof", "reference"].includes(value);
const validSide = (value: string | undefined): value is ArtworkSide => value === "front" || value === "back";

/** Binary ingestion is deliberately thin: storage creates an object, then Artwork adopts it through its existing authority and assignment rules. */
export class ArtworkUploadService {
  constructor(private readonly artwork: ArtworkApplicationService, private readonly storage: ArtworkBinaryStorage) {}

  async upload(context: OperationContext, input: ArtworkUploadInput): Promise<ApplicationResult<ArtworkMutationResult>> {
    return this.persist(context, input, false);
  }

  async replace(context: OperationContext, input: ArtworkUploadInput & Readonly<{ supersedesArtworkAssignmentId: string }>): Promise<ApplicationResult<ArtworkMutationResult>> {
    return this.persist(context, input, true);
  }

  private async persist(context: OperationContext, input: ArtworkUploadInput, replacement: boolean): Promise<ApplicationResult<ArtworkMutationResult>> {
    try {
      const filename = safeFilename(input.filename);
      if (!input.businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
      if (replacement && !input.supersedesArtworkAssignmentId?.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "The current Artwork assignment is required for replacement.");
      if (!validPurpose(input.purpose)) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork purpose is invalid.");
      if (input.side !== undefined && !validSide(input.side)) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork side is invalid.");
      if (input.bytes.length === 0) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork file cannot be empty.");
      if (input.bytes.length > maximumBytes) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork file exceeds the 10 MB limit.");
      if (input.contentType !== "application/pdf" || input.bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
        throw new V2ApplicationError("VALIDATION_ERROR", "Only valid PDF Artwork files are supported.");
      if (input.sourcePageIndex !== undefined && (!Number.isInteger(input.sourcePageIndex) || input.sourcePageIndex < 0)) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork source page index is invalid.");
      if ((input.layerKey === undefined) !== (input.layerOrder === undefined) || (input.layerKey !== undefined && (!input.layerKey.trim() || !Number.isInteger(input.layerOrder) || input.layerOrder! < 0))) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork layer metadata is invalid.");

      const checksum = createHash("sha256").update(input.bytes).digest("hex");
      const objectKey = `v2-artwork/${context.organizationId}/${checksum}.pdf`;
      const stored = await this.storage.put({ organizationId: context.organizationId, objectKey, contentType: input.contentType, bytes: input.bytes });
      const common = {
        businessRequestId: input.businessRequestId,
        objectReference: { storageProvider: stored.storageProvider, objectKey: stored.objectKey },
        originalFilename: filename,
        displayFilename: filename,
        contentType: input.contentType,
        byteSize: input.bytes.length,
        checksum: { algorithm: "sha256", value: checksum },
        source: "customer_upload",
        usage: {
          orderId: brandedId<"OrderId">(input.orderId), orderLineId: brandedId<"OrderLineId">(input.orderLineId), purpose: input.purpose,
          ...(input.side ? { side: input.side } : {}), ...(input.sourcePageIndex !== undefined ? { sourcePageIndex: input.sourcePageIndex } : {}),
          ...(input.layerKey !== undefined ? { layerKey: input.layerKey, layerOrder: input.layerOrder! } : {}),
        },
      } as const;
      const result = replacement
        ? await this.artwork.replace(context, { ...common, supersedesArtworkAssignmentId: brandedId<"ArtworkAssignmentId">(input.supersedesArtworkAssignmentId!) })
        : await this.artwork.adopt(context, common);
      if (!result.ok && stored.created) await this.storage.remove(stored.objectKey).catch(() => undefined);
      return result;
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("RETRYABLE_FAILURE", "Artwork storage is unavailable."));
    }
  }
}
