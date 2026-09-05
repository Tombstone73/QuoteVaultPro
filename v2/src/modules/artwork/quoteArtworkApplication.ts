import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { canonicalJson, brandedId, type ArtworkFileId, type OrganizationId, type QuoteArtworkAssignmentId, type QuoteId, type SalesLineId } from "../shared/commercialValues.js";
import { validateArtworkObjectReference, type ArtworkFile, type ArtworkFileInput, type ArtworkPurpose, type ArtworkSide } from "./contracts.js";

export type QuoteArtworkUsage = Readonly<{
  quoteId: QuoteId;
  quoteLineId: SalesLineId;
  purpose: ArtworkPurpose;
  side?: ArtworkSide;
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
}>;

export type QuoteArtworkAssignment = Readonly<{
  id: QuoteArtworkAssignmentId;
  organizationId: OrganizationId;
  quoteId: QuoteId;
  quoteLineId: SalesLineId;
  artworkFileId: ArtworkFileId;
  purpose: ArtworkPurpose;
  side?: ArtworkSide;
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
  createdAt: string;
}>;

export type QuoteArtworkProjection = Readonly<{ assignment: QuoteArtworkAssignment; file: ArtworkFile }>;
export type QuoteArtworkMutationResult = Readonly<{ artworkFile: ArtworkFile; assignment: QuoteArtworkAssignment; quoteRevision: string }>;
export type QuoteArtworkAdoptInput = ArtworkFileInput & Readonly<{ businessRequestId: string; expectedRevision: string; usage: QuoteArtworkUsage }>;
export type QuoteArtworkAssignInput = Readonly<{ businessRequestId: string; expectedRevision: string; artworkFileId: ArtworkFileId; usage: QuoteArtworkUsage }>;
export type RemoveQuoteArtworkInput = Readonly<{ businessRequestId: string; expectedRevision: string; quoteId: QuoteId; assignmentId: QuoteArtworkAssignmentId }>;

export type QuoteArtworkReservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;
export interface QuoteArtworkTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string; principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>): Promise<QuoteArtworkReservation>;
  succeed(organizationId: string, requestId: string, result: unknown, resourceId: string): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; eventType: string; resourceId: string; principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>): Promise<void>;
  /** Locks the quote header. A quote-artwork write and acceptance therefore cannot mix revisions. */
  lockEditableQuote(organizationId: OrganizationId, quoteId: QuoteId, expectedRevision: string): Promise<void>;
  bumpQuoteRevision(organizationId: OrganizationId, quoteId: QuoteId, expectedRevision: string): Promise<string>;
  findFile(organizationId: OrganizationId, artworkFileId: ArtworkFileId): Promise<ArtworkFile | null>;
  createOrGetFile(input: Readonly<{ id: ArtworkFileId; organizationId: OrganizationId; file: ArtworkFileInput }>): Promise<ArtworkFile>;
  createOrGetAssignment(input: Readonly<{ id: QuoteArtworkAssignmentId; organizationId: OrganizationId; artworkFileId: ArtworkFileId; usage: QuoteArtworkUsage; principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>): Promise<QuoteArtworkAssignment>;
  list(organizationId: OrganizationId, quoteId: QuoteId): Promise<readonly QuoteArtworkProjection[]>;
  remove(organizationId: OrganizationId, quoteId: QuoteId, assignmentId: QuoteArtworkAssignmentId): Promise<boolean>;
}
export interface QuoteArtworkTransactionRunner { transaction<T>(action: (tx: QuoteArtworkTransaction) => Promise<T>): Promise<T>; }

const fingerprint = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const actor = (context: OperationContext) => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });

const validateUsage = (usage: QuoteArtworkUsage): QuoteArtworkUsage => {
  if (!usage.quoteId || !usage.quoteLineId) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork requires a real Quote line.");
  // Quote artwork is customer-supplied source evidence. Production-purpose
  // evidence is deliberately selected/promoted by the Order workflow after
  // conversion; a Quote must never pre-authorize production work.
  if (usage.purpose !== "customer_supplied") throw new V2ApplicationError("VALIDATION_ERROR", "Quote artwork must be customer-supplied source evidence.");
  if (usage.side !== undefined && usage.side !== "front" && usage.side !== "back") throw new V2ApplicationError("VALIDATION_ERROR", "Artwork side is invalid.");
  if (usage.sourcePageIndex !== undefined && (!Number.isInteger(usage.sourcePageIndex) || usage.sourcePageIndex < 0)) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork source page index is invalid.");
  if ((usage.layerKey === undefined) !== (usage.layerOrder === undefined) || (usage.layerKey !== undefined && (!usage.layerKey.trim() || !Number.isInteger(usage.layerOrder) || usage.layerOrder! < 0))) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork layer metadata is invalid.");
  return usage;
};
const validateFile = (file: ArtworkFileInput): ArtworkFileInput => {
  validateArtworkObjectReference(file.objectReference);
  if (!file.originalFilename.trim() || !(file.displayFilename ?? file.originalFilename).trim() || !file.contentType.trim() || !Number.isSafeInteger(file.byteSize) || file.byteSize < 0) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork file metadata is invalid.");
  if (file.checksum && !/^[a-f0-9]{64}$/iu.test(file.checksum.value)) throw new V2ApplicationError("VALIDATION_ERROR", "Artwork checksum is invalid.");
  return file;
};

/** Quote artwork owns only mutable Quote-line associations. It reuses the one Artwork-file authority. */
export class QuoteArtworkApplicationService {
  constructor(private readonly runner: QuoteArtworkTransactionRunner, private readonly authority = new AuthorityPolicy()) {}
  async list(context: OperationContext, quoteId: QuoteId): Promise<ApplicationResult<readonly QuoteArtworkProjection[]>> {
    try { requireOperationPrincipalScope(context); this.require(context, "quote.view"); return success(await this.runner.transaction((tx) => tx.list(brandedId<"OrganizationId">(context.organizationId), quoteId))); }
    catch (cause) { return failure(this.error(cause)); }
  }
  async adopt(context: OperationContext, input: QuoteArtworkAdoptInput): Promise<ApplicationResult<QuoteArtworkMutationResult>> {
    return this.mutate(context, "artwork.quote.adopt.v1", input, "artwork.adopt", async (tx) => {
      validateFile(input); validateUsage(input.usage);
      await tx.lockEditableQuote(brandedId<"OrganizationId">(context.organizationId), input.usage.quoteId, input.expectedRevision);
      const artworkFile = await tx.createOrGetFile({ id: brandedId<"ArtworkFileId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), file: input });
      const assignment = await tx.createOrGetAssignment({ id: brandedId<"QuoteArtworkAssignmentId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), artworkFileId: artworkFile.id, usage: input.usage, ...actor(context) });
      const quoteRevision = await tx.bumpQuoteRevision(brandedId<"OrganizationId">(context.organizationId), input.usage.quoteId, input.expectedRevision);
      return { artworkFile, assignment, quoteRevision };
    });
  }
  async assign(context: OperationContext, input: QuoteArtworkAssignInput): Promise<ApplicationResult<QuoteArtworkMutationResult>> {
    return this.mutate(context, "artwork.quote.assign.v1", input, "artwork.assign", async (tx) => {
      validateUsage(input.usage);
      await tx.lockEditableQuote(brandedId<"OrganizationId">(context.organizationId), input.usage.quoteId, input.expectedRevision);
      const artworkFile = await tx.findFile(brandedId<"OrganizationId">(context.organizationId), input.artworkFileId);
      if (!artworkFile) throw new V2ApplicationError("NOT_FOUND", "Artwork file was not found.");
      const assignment = await tx.createOrGetAssignment({ id: brandedId<"QuoteArtworkAssignmentId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), artworkFileId: artworkFile.id, usage: input.usage, ...actor(context) });
      const quoteRevision = await tx.bumpQuoteRevision(brandedId<"OrganizationId">(context.organizationId), input.usage.quoteId, input.expectedRevision);
      return { artworkFile, assignment, quoteRevision };
    });
  }
  async remove(context: OperationContext, input: RemoveQuoteArtworkInput): Promise<ApplicationResult<Readonly<{ quoteRevision: string }>>> {
    return this.mutate(context, "artwork.quote.remove.v1", input, "artwork.assign", async (tx) => {
      await tx.lockEditableQuote(brandedId<"OrganizationId">(context.organizationId), input.quoteId, input.expectedRevision);
      if (!await tx.remove(brandedId<"OrganizationId">(context.organizationId), input.quoteId, input.assignmentId)) throw new V2ApplicationError("NOT_FOUND", "Quote artwork was not found.");
      return { quoteRevision: await tx.bumpQuoteRevision(brandedId<"OrganizationId">(context.organizationId), input.quoteId, input.expectedRevision) };
    });
  }
  private require(context: OperationContext, capability: "quote.view" | "quote.edit" | "artwork.adopt" | "artwork.assign") { if (!this.authority.decide(context.principal, { capability, resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority for this Quote Artwork operation."); }
  private async mutate<T extends { businessRequestId: string }>(context: OperationContext, operation: string, input: T, artworkCapability: "artwork.adopt" | "artwork.assign", work: (tx: QuoteArtworkTransaction) => Promise<unknown>): Promise<ApplicationResult<any>> {
    try {
      requireOperationPrincipalScope(context); this.require(context, "quote.edit"); this.require(context, artworkCapability);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      return success(await this.runner.transaction(async (tx) => {
        const reservation = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reservation.kind === "replay") return reservation.request.resultJson;
        const result = await work(tx);
        const resourceId = "assignment" in (result as object)
          ? (result as QuoteArtworkMutationResult).assignment.id
          : "quoteId" in input && typeof input.quoteId === "string"
            ? input.quoteId
            : input.businessRequestId;
        await tx.audit({ organizationId: context.organizationId, requestId: reservation.request.id, operation, eventType: operation.includes("remove") ? "quote_artwork_removed" : "quote_artwork_assigned", resourceId, ...actor(context) });
        await tx.succeed(context.organizationId, reservation.request.id, result, resourceId);
        return result;
      }));
    } catch (cause) { return failure(this.error(cause)); }
  }
  private error(cause: unknown): V2ApplicationError { return cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Quote artwork operation could not be completed."); }
}
