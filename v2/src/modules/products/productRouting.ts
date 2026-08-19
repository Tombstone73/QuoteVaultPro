import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId, type PrincipalKind } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";

export type ProductRoutingPolicy =
  | Readonly<{ kind: "route_required"; routeTemplateId: string; routeTemplateName: string; sourceTemplateRevision?: string; sourceTemplateFingerprint?: string; steps: readonly Readonly<{ position: number; kind: "proofing" | "prepress" | "production" | "fulfillment" }>[] }>
  | Readonly<{ kind: "no_route" }>
  | Readonly<{ kind: "unconfigured" }>;

export type ProductDraftRouting = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  routing: ProductRoutingPolicy;
}>;

export type UpdateProductDraftRoutingInput = Readonly<{
  productId: string;
  draftVersionId: string;
  expectedDraftUpdatedAt: string;
  businessRequestId: string;
  routing: ProductRoutingPolicy;
}>;

type Actor = Readonly<{ principalKind: PrincipalKind; principalSubject: string; staffActorUserId?: string }>;
export interface ProductRoutingTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string }> & Actor): Promise<Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>>;
  replaceDraftRouting(input: Readonly<{ organizationId: string; productId: string; draftVersionId: string; expectedDraftUpdatedAt: string; routing: ProductRoutingPolicy; staffActorUserId?: string }>): Promise<ProductDraftRouting>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string }> & Actor): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string }> & Actor): Promise<void>;
  succeed(organizationId: string, requestId: string, resourceId: string, result: ProductDraftRouting): Promise<void>;
}
export interface ProductRoutingTransactionRunner { transaction<T>(work: (tx: ProductRoutingTransaction) => Promise<T>): Promise<T>; }

const operation = "product.draft.routing.update.v1";
const fingerprint = (input: UpdateProductDraftRoutingInput) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });

const valid = (routing: ProductRoutingPolicy): ProductRoutingPolicy => {
  if (routing.kind === "no_route" || routing.kind === "unconfigured") return routing;
  if (routing.kind !== "route_required" || !routing.routeTemplateId.trim())
    throw new V2ApplicationError("VALIDATION_ERROR", "A valid Routing policy is required.");
  // The client only selects a Routing-owned template; its name and steps are
  // server projections and are never trusted for persistence.
  return { kind: "route_required", routeTemplateId: routing.routeTemplateId.trim(), routeTemplateName: "", steps: [] };
};

/** Product owns Draft selection; Routing owns template validation and snapshots. */
export class ProductRoutingApplicationService {
  constructor(private readonly runner: ProductRoutingTransactionRunner) {}

  async updateDraftRouting(context: OperationContext, input: UpdateProductDraftRoutingInput): Promise<ApplicationResult<ProductDraftRouting>> {
    try {
      requireOperationPrincipalScope(context);
      if (context.businessRequest?.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!new AuthorityPolicy().decide(context.principal, { capability: "product.edit", resource: { organizationId: context.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to edit this Product Draft.");
      const routing = valid(input.routing), principal = actor(context);
      const result = await this.runner.transaction(async (tx) => {
        const request = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint({ ...input, routing }), ...principal });
        if (request.kind === "replay") return request.request.resultJson as ProductDraftRouting;
        const saved = await tx.replaceDraftRouting({ organizationId: context.organizationId, productId: input.productId, draftVersionId: input.draftVersionId, expectedDraftUpdatedAt: input.expectedDraftUpdatedAt, routing, staffActorUserId: principal.staffActorUserId });
        await tx.attribute({ organizationId: context.organizationId, requestId: request.request.id, operation, resourceId: saved.draftVersionId, ...principal });
        await tx.audit({ organizationId: context.organizationId, requestId: request.request.id, operation, resourceId: saved.draftVersionId, ...principal });
        await tx.succeed(context.organizationId, request.request.id, saved.draftVersionId, saved);
        return saved;
      });
      return success(result);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Product Draft Routing could not be saved."));
    }
  }
}
