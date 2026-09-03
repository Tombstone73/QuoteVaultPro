import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { ProductRoutingPolicy } from "./productRouting.js";

export type PublishProductDraftInput = Readonly<{
  productId: string;
  draftVersionId: string;
  expectedProductUpdatedAt: string;
  expectedDraftUpdatedAt: string;
  businessRequestId: string;
  confirmWarnings?: boolean;
  activateProduct?: boolean;
}>;

export type PublishedProductVersion = Readonly<{
  productId: string;
  productName: string;
  productVersionId: string;
  productUpdatedAt: string;
  productVersionUpdatedAt: string;
  publishedAt?: string;
  alreadyPublished: boolean;
  operationReference: "products.publish_configuration.v1";
}>;

type Actor = Readonly<{
  principalKind: OperationContext["principal"]["kind"];
  principalSubject: string;
  staffActorUserId?: string;
}>;
type Reservation = Readonly<{
  kind: "new" | "resumed" | "replay";
  request: Readonly<{ id: string; resultJson: unknown | null }>;
}>;
type DraftPublicationState = Readonly<{
  productUpdatedAt: string;
  draftUpdatedAt: string;
  lifecycle: "draft" | "active" | "historical";
  workflowIntent: "standard_production" | "fulfillment_only" | "service_fee";
  requiresProductionJob: boolean;
  /** Production-required drafts need at least one frozen unit rule. */
  hasProductionUnitRules: boolean;
  routing: ProductRoutingPolicy;
}>;

/** Thin structural port around the existing canonical V1 Product publisher. */
export interface CanonicalProductPublisher {
  propose(input: Readonly<{ organizationId: string; productId?: string; treeVersionId?: string }>): Promise<Readonly<{
    productId: string;
    productName: string;
    treeVersionId: string;
    expectedProductUpdatedAt: string;
    expectedTreeUpdatedAt: string;
    alreadyPublished: boolean;
    operationReference: "products.publish_configuration.v1";
  }>>;
  execute(input: Readonly<{
    organizationId: string;
    actorUserId: string;
    productId: string;
    treeVersionId: string;
    expectedProductUpdatedAt: string;
    expectedTreeUpdatedAt: string;
    confirmWarnings?: boolean;
    activateProduct?: boolean;
    auditContext: Readonly<{ source: "product_editor"; reference: string }>;
  }>): Promise<Readonly<{
    product: Readonly<{ id: string; name: string; updatedAt: Date | string }>;
    tree: Readonly<{ id: string; updatedAt: Date | string; publishedAt?: Date | string | null }>;
    appliedChanges: readonly unknown[];
    operationReference: "products.publish_configuration.v1";
  }>>;
}

export interface ProductPublicationTransaction {
  readDraftPublicationState(input: Readonly<{ organizationId: string; productId: string; draftVersionId: string }>): Promise<DraftPublicationState | null>;
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string }> & Actor): Promise<Reservation>;
  succeed(organizationId: string, requestId: string, result: PublishedProductVersion): Promise<void>;
  markRetryableFailure(organizationId: string, requestId: string): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string }> & Actor): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string }> & Actor): Promise<void>;
}
export interface ProductPublicationTransactionRunner {
  transaction<T>(action: (transaction: ProductPublicationTransaction) => Promise<T>): Promise<T>;
}

const operation = "product.draft.publish.v1";
const hash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const actor = (context: OperationContext): Actor => ({
  principalKind: context.principal.kind,
  principalSubject: principalSubject(context.principal),
  ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}),
});
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : undefined;
const asResult = (value: unknown): PublishedProductVersion | null => {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PublishedProductVersion>;
  return typeof row.productId === "string" && typeof row.productName === "string" && typeof row.productVersionId === "string"
    && typeof row.productUpdatedAt === "string" && typeof row.productVersionUpdatedAt === "string"
    && typeof row.alreadyPublished === "boolean" && row.operationReference === "products.publish_configuration.v1"
    ? row as PublishedProductVersion : null;
};

/**
 * Adds V2 authority and durable-request handling around the one canonical
 * publisher. The canonical publisher retains exclusive ownership of the
 * Product/PBV2 transaction; this adapter records the surrounding V2 request.
 */
export class ProductPublicationApplicationService {
  constructor(
    private readonly runner: ProductPublicationTransactionRunner,
    private readonly publisher: CanonicalProductPublisher,
    private readonly authority = new AuthorityPolicy(),
  ) {}

  async publish(context: OperationContext, input: PublishProductDraftInput): Promise<ApplicationResult<PublishedProductVersion>> {
    let request: Reservation["request"] | undefined;
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId)
        throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!this.authority.decide(context.principal, { capability: "pricing.publish", resource: { organizationId: context.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to publish this Product Draft.");
      if (!staffActorId(context.principal))
        throw new V2ApplicationError("FORBIDDEN", "An authenticated Staff actor is required to publish this Product Draft.");
      if (!input.productId.trim() || !input.draftVersionId.trim() || !input.expectedProductUpdatedAt || !input.expectedDraftUpdatedAt)
        throw new V2ApplicationError("VALIDATION_ERROR", "A Product Draft and its current revisions are required.");

      const reservation = await this.runner.transaction(async (tx) => {
        const reserved = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: hash(input), ...actor(context) });
        request = reserved.request;
        const replay = asResult(reserved.request.resultJson);
        return { reserved, replay };
      });
      if (reservation.reserved.kind === "replay" && reservation.replay) return success(reservation.replay);

      // Reserve first so an exact retry converges on the authoritative prior
      // result even though that Draft is now ACTIVE. Then verify browser
      // revisions through V2's pg boundary and obtain the canonical
      // publisher's own timestamp representation for its transaction.
      const state = await this.runner.transaction((tx) => tx.readDraftPublicationState({
        organizationId: context.organizationId,
        productId: input.productId,
        draftVersionId: input.draftVersionId,
      }));
      if (!state) throw new V2ApplicationError("NOT_FOUND", "The tenant-scoped Product Draft is unavailable.");
      if (state.lifecycle !== "draft") throw new V2ApplicationError("CONFLICT", "Only the current Product Draft can be published.");
      if (state.productUpdatedAt !== input.expectedProductUpdatedAt || state.draftUpdatedAt !== input.expectedDraftUpdatedAt)
        throw new V2ApplicationError("STALE_STATE", "The Product Draft changed before publication. Refresh and try again.");
      if (state.workflowIntent === "standard_production" && state.requiresProductionJob) {
        if (!state.hasProductionUnitRules)
          throw new V2ApplicationError("VALIDATION_ERROR", "At least one Production unit is required before this Product can be published.");
        if (state.routing.kind !== "route_required" || !state.routing.steps.some((step) => step.kind === "production"))
          throw new V2ApplicationError("VALIDATION_ERROR", "Production routing is required before this Product can be published. Select a Production Route in the Routing section.");
      }

      const canonicalPlan = await this.publisher.propose({
        organizationId: context.organizationId,
        productId: input.productId,
        treeVersionId: input.draftVersionId,
      });
      if (canonicalPlan.alreadyPublished)
        throw new V2ApplicationError("CONFLICT", "Only the current Product Draft can be published.");

      let result: PublishedProductVersion;
      try {
        const published = await this.publisher.execute({
          organizationId: context.organizationId,
          actorUserId: staffActorId(context.principal)!,
          productId: input.productId,
          treeVersionId: input.draftVersionId,
          expectedProductUpdatedAt: canonicalPlan.expectedProductUpdatedAt,
          expectedTreeUpdatedAt: canonicalPlan.expectedTreeUpdatedAt,
          confirmWarnings: input.confirmWarnings,
          activateProduct: input.activateProduct,
          auditContext: { source: "product_editor", reference: `v2:${operation}:${input.businessRequestId}` },
        });
        result = {
          productId: published.product.id,
          productName: published.product.name,
          productVersionId: published.tree.id,
          productUpdatedAt: iso(published.product.updatedAt)!,
          productVersionUpdatedAt: iso(published.tree.updatedAt)!,
          ...(iso(published.tree.publishedAt) ? { publishedAt: iso(published.tree.publishedAt) } : {}),
          alreadyPublished: published.appliedChanges.length === 0,
          operationReference: published.operationReference,
        };
      } catch (error) {
        // A process may fail after canonical publication committed but before
        // V2 request finalization. Re-propose only the exact Draft: if it is
        // now the Active pointer, safely converge the durable V2 operation.
        const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "PBV2_PUBLISH_STALE") {
          const proposal = await this.publisher.propose({ organizationId: context.organizationId, productId: input.productId, treeVersionId: input.draftVersionId });
          if (proposal.alreadyPublished) {
            result = {
              productId: proposal.productId, productName: proposal.productName, productVersionId: proposal.treeVersionId,
              productUpdatedAt: proposal.expectedProductUpdatedAt, productVersionUpdatedAt: proposal.expectedTreeUpdatedAt,
              alreadyPublished: true, operationReference: proposal.operationReference,
            };
          } else throw this.error(error);
        } else throw this.error(error);
      }

      await this.runner.transaction(async (tx) => {
        await tx.attribute({ organizationId: context.organizationId, requestId: request!.id, operation, resourceId: result.productVersionId, ...actor(context) });
        await tx.audit({ organizationId: context.organizationId, requestId: request!.id, operation, resourceId: result.productVersionId, ...actor(context) });
        await tx.succeed(context.organizationId, request!.id, result);
      });
      return success(result);
    } catch (error) {
      if (request) {
        try { await this.runner.transaction((tx) => tx.markRetryableFailure(context.organizationId, request!.id)); } catch { /* canonical state remains authoritative */ }
      }
      return failure(this.error(error));
    }
  }

  private error(error: unknown): V2ApplicationError {
    if (error instanceof V2ApplicationError) return error;
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "PRODUCT_PUBLISH_TARGET_NOT_FOUND") return new V2ApplicationError("NOT_FOUND", "The tenant-scoped Product Draft is unavailable.");
    if (code === "IDEMPOTENCY_CONFLICT") return new V2ApplicationError("IDEMPOTENCY_CONFLICT", "The business request ID was previously used with a different publication request.");
    if (code === "PBV2_PUBLISH_STALE") return new V2ApplicationError("STALE_STATE", "The Product Draft changed before publication. Refresh and try again.");
    if (code === "PBV2_DRAFT_REQUIRED") return new V2ApplicationError("CONFLICT", "Only the current Product Draft can be published.");
    if (code === "PBV2_PUBLISH_INVALID" || code === "PBV2_PUBLISH_WARNINGS_CONFIRM_REQUIRED") return new V2ApplicationError("VALIDATION_ERROR", error instanceof Error ? error.message : "The Product Draft cannot be published.");
    return new V2ApplicationError("RETRYABLE_FAILURE", "Product publication could not be completed. Retry safely.");
  }
}
