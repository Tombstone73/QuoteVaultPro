import { createHash, randomUUID } from "node:crypto";
import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { canonicalJson, brandedId, type ArtworkAssignmentId, type ArtworkFileId, type OrganizationId } from "../shared/commercialValues.js";
import {
  validateArtworkObjectReference, validateArtworkUsage,
  type AdoptArtworkInput, type ReplaceArtworkInput, type ArtworkAssignment, type ArtworkFile, type ArtworkFileInput,
  type ArtworkMutationResult, type AssignArtworkInput, type DeriveArtworkInput,
  type OrderLineArtworkProjection,
} from "./contracts.js";

export type ArtworkReservation = Readonly<{
  kind: "new" | "resumed" | "replay";
  request: Readonly<{ id: string; resultJson: unknown | null }>;
}>;

export interface ArtworkTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string; principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>): Promise<ArtworkReservation>;
  succeed(organizationId: string, requestId: string, result: ArtworkMutationResult): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceType: "artwork_file" | "artwork_assignment"; resourceId: string; principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; eventType: "artwork_file_adopted" | "artwork_file_derived" | "artwork_assignment_added"; resourceId: string; changes: readonly Readonly<{ kind: string; summary: string }>[]; principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>): Promise<void>;
  findFile(organizationId: OrganizationId, artworkFileId: ArtworkFileId): Promise<ArtworkFile | null>;
  findOrderLineArtwork(organizationId: OrganizationId, orderLineId: string): Promise<readonly OrderLineArtworkProjection[]>;
  findOrderArtwork(organizationId: OrganizationId, orderId: string): Promise<readonly OrderLineArtworkProjection[]>;
  createOrGetFile(input: Readonly<{ id: ArtworkFileId; organizationId: OrganizationId; file: ArtworkFileInput; derivedFromArtworkFileId?: ArtworkFileId }>): Promise<ArtworkFile>;
  createOrGetAssignment(input: Readonly<{ id: ArtworkAssignmentId; organizationId: OrganizationId; artworkFileId: ArtworkFileId; usage: AdoptArtworkInput["usage"] }>): Promise<ArtworkAssignment>;
  createOrGetReplacementAssignment(input: Readonly<{ id: ArtworkAssignmentId; organizationId: OrganizationId; artworkFileId: ArtworkFileId; usage: ReplaceArtworkInput["usage"]; supersedesArtworkAssignmentId: ArtworkAssignmentId }>): Promise<ArtworkAssignment>;
}

export interface ArtworkTransactionRunner { transaction<T>(action: (transaction: ArtworkTransaction) => Promise<T>): Promise<T>; }

const fingerprint = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

const validateFile = (file: ArtworkFileInput): ArtworkFileInput => {
  validateArtworkObjectReference(file.objectReference);
  if (!file.originalFilename.trim() || !(file.displayFilename ?? file.originalFilename).trim()) throw new Error("Artwork filenames are required.");
  if (!file.contentType.trim()) throw new Error("Artwork content type is required.");
  if (!Number.isSafeInteger(file.byteSize) || file.byteSize < 0) throw new Error("Artwork byte size must be a non-negative safe integer.");
  if (file.pageCount !== undefined && (!Number.isInteger(file.pageCount) || file.pageCount <= 0)) throw new Error("Artwork page count must be a positive integer.");
  for (const dimension of [file.detectedWidthMicrons, file.detectedHeightMicrons]) if (dimension !== undefined && (!Number.isInteger(dimension) || dimension <= 0)) throw new Error("Artwork dimensions must be positive whole microns.");
  if (file.checksum && (!/^[a-f0-9]{64}$/iu.test(file.checksum.value))) throw new Error("Artwork SHA-256 checksum must be hexadecimal.");
  return file;
};

const actor = (context: OperationContext) => ({
  principalKind: context.principal.kind,
  principalSubject: principalSubject(context.principal),
  ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}),
});

/** State-light Artwork coordinator. It owns no Proofing, Prepress, Production, Sales, or storage workflow state. */
export class ArtworkApplicationService {
  constructor(private readonly runner: ArtworkTransactionRunner, private readonly authority = new AuthorityPolicy()) {}

  async readFile(context: OperationContext, artworkFileId: ArtworkFileId): Promise<ApplicationResult<ArtworkFile>> {
    try {
      requireOperationPrincipalScope(context); this.require(context, "artwork.view");
      const found = await this.runner.transaction((tx) => tx.findFile(brandedId<"OrganizationId">(context.organizationId), artworkFileId));
      if (!found) throw new V2ApplicationError("NOT_FOUND", "Artwork file was not found.");
      return success(found);
    } catch (error) { return failure(this.error(error)); }
  }

  async listForOrderLine(context: OperationContext, orderLineId: string): Promise<ApplicationResult<readonly OrderLineArtworkProjection[]>> {
    try {
      requireOperationPrincipalScope(context); this.require(context, "artwork.view");
      return success(await this.runner.transaction((tx) => tx.findOrderLineArtwork(brandedId<"OrganizationId">(context.organizationId), orderLineId)));
    } catch (error) { return failure(this.error(error)); }
  }

  async listForOrder(context: OperationContext, orderId: string): Promise<ApplicationResult<readonly OrderLineArtworkProjection[]>> {
    try {
      requireOperationPrincipalScope(context); this.require(context, "artwork.view");
      return success(await this.runner.transaction((tx) => tx.findOrderArtwork(brandedId<"OrganizationId">(context.organizationId), orderId)));
    } catch (error) { return failure(this.error(error)); }
  }

  async adopt(context: OperationContext, input: AdoptArtworkInput): Promise<ApplicationResult<ArtworkMutationResult>> {
    return this.mutate(context, "artwork.adopt.v1", input, "artwork.adopt", async (tx) => {
      validateFile(input); validateArtworkUsage(input.usage);
      const file = await tx.createOrGetFile({ id: brandedId<"ArtworkFileId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), file: input });
      const assignment = await tx.createOrGetAssignment({ id: brandedId<"ArtworkAssignmentId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), artworkFileId: file.id, usage: input.usage });
      return { artworkFile: file, assignment };
    }, "artwork_file_adopted", "Artwork file adopted for OrderLine work.");
  }

  async replace(context: OperationContext, input: ReplaceArtworkInput): Promise<ApplicationResult<ArtworkMutationResult>> {
    return this.mutate(context, "artwork.replace.v1", input, "artwork.adopt", async (tx) => {
      validateFile(input); validateArtworkUsage(input.usage);
      if (!input.supersedesArtworkAssignmentId) throw new V2ApplicationError("VALIDATION_ERROR", "The current Artwork assignment is required for replacement.");
      const file = await tx.createOrGetFile({ id: brandedId<"ArtworkFileId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), file: input });
      const assignment = await tx.createOrGetReplacementAssignment({ id: brandedId<"ArtworkAssignmentId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), artworkFileId: file.id, usage: input.usage, supersedesArtworkAssignmentId: input.supersedesArtworkAssignmentId });
      return { artworkFile: file, assignment };
    }, "artwork_file_adopted", "Replacement Artwork file adopted for OrderLine work.");
  }

  async assign(context: OperationContext, input: AssignArtworkInput): Promise<ApplicationResult<ArtworkMutationResult>> {
    return this.mutate(context, "artwork.assign.v1", input, "artwork.assign", async (tx) => {
      validateArtworkUsage(input.usage);
      const file = await tx.findFile(brandedId<"OrganizationId">(context.organizationId), input.artworkFileId);
      if (!file) throw new V2ApplicationError("NOT_FOUND", "Artwork file was not found.");
      const assignment = await tx.createOrGetAssignment({ id: brandedId<"ArtworkAssignmentId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), artworkFileId: file.id, usage: input.usage });
      return { artworkFile: file, assignment };
    }, "artwork_assignment_added", "Artwork file assigned to OrderLine work.");
  }

  async derive(context: OperationContext, input: DeriveArtworkInput): Promise<ApplicationResult<ArtworkMutationResult>> {
    return this.mutate(context, "artwork.derive.v1", input, "artwork.adopt", async (tx) => {
      validateFile(input); validateArtworkUsage(input.usage);
      if (input.source !== "prepress_derived") throw new V2ApplicationError("VALIDATION_ERROR", "Derived Artwork must declare prepress_derived provenance.");
      const source = await tx.findFile(brandedId<"OrganizationId">(context.organizationId), input.derivedFromArtworkFileId);
      if (!source) throw new V2ApplicationError("NOT_FOUND", "Derived Artwork source file was not found.");
      const file = await tx.createOrGetFile({ id: brandedId<"ArtworkFileId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), file: input, derivedFromArtworkFileId: source.id });
      const assignment = await tx.createOrGetAssignment({ id: brandedId<"ArtworkAssignmentId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), artworkFileId: file.id, usage: input.usage });
      return { artworkFile: file, assignment };
    }, "artwork_file_derived", "Derived Artwork file adopted for OrderLine work.");
  }

  private require(context: OperationContext, capability: "artwork.view" | "artwork.adopt" | "artwork.assign"): void {
    if (!this.authority.decide(context.principal, { capability, resource: { organizationId: context.organizationId } }).allowed)
      throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority for this Artwork operation.");
  }

  private async mutate<T extends { businessRequestId: string }>(context: OperationContext, operation: "artwork.adopt.v1" | "artwork.replace.v1" | "artwork.assign.v1" | "artwork.derive.v1", input: T, capability: "artwork.adopt" | "artwork.assign", work: (tx: ArtworkTransaction) => Promise<ArtworkMutationResult>, eventType: "artwork_file_adopted" | "artwork_file_derived" | "artwork_assignment_added", summary: string): Promise<ApplicationResult<ArtworkMutationResult>> {
    try {
      requireOperationPrincipalScope(context); this.require(context, capability);
      if (!context.businessRequest || input.businessRequestId !== context.businessRequest.id) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      return success(await this.runner.transaction(async (tx) => {
        const reservation = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reservation.kind === "replay") return reservation.request.resultJson as ArtworkMutationResult;
        const result = await work(tx);
        await tx.attribute({ organizationId: context.organizationId, requestId: reservation.request.id, operation, resourceType: "artwork_file", resourceId: result.artworkFile.id, ...actor(context) });
        await tx.audit({ organizationId: context.organizationId, requestId: reservation.request.id, operation, eventType, resourceId: result.artworkFile.id, changes: [{ kind: eventType, summary }], ...actor(context) });
        await tx.succeed(context.organizationId, reservation.request.id, result);
        return result;
      }));
    } catch (error) { return failure(this.error(error)); }
  }

  private error(error: unknown): V2ApplicationError {
    if (error instanceof V2ApplicationError) return error;
    return new V2ApplicationError("VALIDATION_ERROR", error instanceof Error ? error.message : "Artwork operation could not be completed.");
  }
}
