import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";

export type ProductVersionStatus = "active" | "draft" | "deprecated" | "archived";
export type ProductVersionSummary = Readonly<{
  status: ProductVersionStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  editable: boolean;
}>;
export type ProductVersionLifecycle = Readonly<{
  active?: ProductVersionSummary;
  draft?: ProductVersionSummary;
  history: readonly ProductVersionSummary[];
  historyLimit: number;
  historyHasMore: boolean;
  canCreateDraft: boolean;
}>;

export type CreateProductDraftInput = Readonly<{
  productId: string;
  businessRequestId: string;
  expectedActiveVersionUpdatedAt: string;
}>;
type DraftCreateReservation = Readonly<{
  kind: "new" | "resumed" | "replay";
  request: Readonly<{ id: string; resultJson: unknown | null }>;
}>;
export interface ProductVersionTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string }>): Promise<DraftCreateReservation>;
  createDraftFromActive(input: Readonly<{ organizationId: string; productId: string; expectedActiveVersionUpdatedAt: string; staffActorUserId?: string }>): Promise<Readonly<{ draftId: string; lifecycle: ProductVersionLifecycle }>>;
  succeed(organizationId: string, requestId: string, draftId: string, lifecycle: ProductVersionLifecycle): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string }>): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string }>): Promise<void>;
}
export interface ProductVersionTransactionRunner { transaction<T>(action: (tx: ProductVersionTransaction) => Promise<T>): Promise<T>; }

const operation = "product.version.createDraft.v1";
const actor = (context: OperationContext) => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (input: CreateProductDraftInput) => createHash("sha256").update(JSON.stringify({ productId: input.productId, expectedActiveVersionUpdatedAt: input.expectedActiveVersionUpdatedAt })).digest("hex");

/** Product configuration drafts are a PBV2 lifecycle concern. This service never changes an ACTIVE tree or Product pointer. */
export class ProductVersionLifecycleApplicationService {
  constructor(private readonly runner: ProductVersionTransactionRunner, private readonly authority = new AuthorityPolicy()) {}

  async createDraft(context: OperationContext, input: CreateProductDraftInput): Promise<ApplicationResult<ProductVersionLifecycle>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId)
        throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!input.productId || !input.businessRequestId || Number.isNaN(Date.parse(input.expectedActiveVersionUpdatedAt)))
        throw new V2ApplicationError("VALIDATION_ERROR", "A Product, business request, and current Active version state are required.");
      if (!this.authority.decide(context.principal, { capability: "product.edit", resource: { organizationId: context.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to create a Product Draft.");
      const value = await this.runner.transaction(async (tx) => {
        const request = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (request.kind === "replay") return request.request.resultJson as ProductVersionLifecycle;
        const created = await tx.createDraftFromActive({ organizationId: context.organizationId, productId: input.productId, expectedActiveVersionUpdatedAt: input.expectedActiveVersionUpdatedAt, staffActorUserId: staffActorId(context.principal) });
        await tx.attribute({ organizationId: context.organizationId, requestId: request.request.id, operation, resourceId: created.draftId, ...actor(context) });
        await tx.audit({ organizationId: context.organizationId, requestId: request.request.id, operation, resourceId: created.draftId, ...actor(context) });
        await tx.succeed(context.organizationId, request.request.id, created.draftId, created.lifecycle);
        return created.lifecycle;
      });
      return success(value);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", error instanceof Error ? error.message : "Product Draft could not be created."));
    }
  }
}
