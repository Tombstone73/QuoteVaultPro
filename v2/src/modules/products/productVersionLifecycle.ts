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
export type ProductMeasurementMode = "dimensions_required" | "quantity_only";
export type ProductWorkflowIntent = "standard_production" | "fulfillment_only" | "service_fee";
export type ProductDraftGeneral = Readonly<{
  displayName: string;
  category: string | null;
  description: string | null;
  storefrontVisible: boolean;
  measurementMode: ProductMeasurementMode;
  workflowIntent: ProductWorkflowIntent;
  requiresProofApproval: boolean;
  requiresProductionJob: boolean;
}>;
export type ProductDraftGeneralRead = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  general: ProductDraftGeneral;
}>;
export type UpdateProductDraftGeneralInput = Readonly<{
  productId: string;
  draftVersionId: string;
  expectedDraftUpdatedAt: string;
  businessRequestId: string;
  general: ProductDraftGeneral;
}>;
type DraftCreateReservation = Readonly<{
  kind: "new" | "resumed" | "replay";
  request: Readonly<{ id: string; resultJson: unknown | null }>;
}>;
export interface ProductVersionTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string }>): Promise<DraftCreateReservation>;
  createDraftFromActive(input: Readonly<{ organizationId: string; productId: string; expectedActiveVersionUpdatedAt: string; staffActorUserId?: string }>): Promise<Readonly<{ draftId: string; lifecycle: ProductVersionLifecycle }>>;
  succeed(organizationId: string, requestId: string, draftId: string, result: unknown): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string }>): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string }>): Promise<void>;
  updateDraftGeneral?(input: Readonly<{ organizationId: string; productId: string; draftVersionId: string; expectedDraftUpdatedAt: string; general: ProductDraftGeneral; staffActorUserId?: string }>): Promise<ProductDraftGeneralRead>;
  auditDraftGeneral?(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string; changedFields: readonly string[] }>): Promise<void>;
}
export interface ProductVersionTransactionRunner { transaction<T>(action: (tx: ProductVersionTransaction) => Promise<T>): Promise<T>; }

const operation = "product.version.createDraft.v1";
const updateGeneralOperation = "product.draft.general.update.v1";
const actor = (context: OperationContext) => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (input: CreateProductDraftInput) => createHash("sha256").update(JSON.stringify({ productId: input.productId, expectedActiveVersionUpdatedAt: input.expectedActiveVersionUpdatedAt })).digest("hex");
const generalFingerprint = (input: UpdateProductDraftGeneralInput) => createHash("sha256").update(JSON.stringify({ productId: input.productId, draftVersionId: input.draftVersionId, expectedDraftUpdatedAt: input.expectedDraftUpdatedAt, general: input.general })).digest("hex");
const validGeneral = (general: ProductDraftGeneral): ProductDraftGeneral => {
  const text = (value: unknown, label: string, max: number, nullable = false): string | null => {
    if (nullable && (value === null || value === undefined || value === "")) return null;
    if (typeof value !== "string") throw new V2ApplicationError("VALIDATION_ERROR", `${label} is invalid.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max) throw new V2ApplicationError("VALIDATION_ERROR", `${label} is invalid.`);
    return normalized;
  };
  const displayName = text(general.displayName, "Product name", 160)!;
  const category = text(general.category, "Category", 100, true);
  const description = text(general.description, "Description", 2000, true);
  if (typeof general.storefrontVisible !== "boolean" || typeof general.requiresProofApproval !== "boolean" || typeof general.requiresProductionJob !== "boolean")
    throw new V2ApplicationError("VALIDATION_ERROR", "Product settings are invalid.");
  if (general.measurementMode !== "dimensions_required" && general.measurementMode !== "quantity_only") throw new V2ApplicationError("VALIDATION_ERROR", "Measurement mode is invalid.");
  if (general.workflowIntent !== "standard_production" && general.workflowIntent !== "fulfillment_only" && general.workflowIntent !== "service_fee") throw new V2ApplicationError("VALIDATION_ERROR", "Workflow is invalid.");
  if (general.workflowIntent !== "standard_production" && (general.requiresProofApproval || general.requiresProductionJob)) throw new V2ApplicationError("VALIDATION_ERROR", "This workflow cannot require proofing or production.");
  return { displayName, category, description, storefrontVisible: general.storefrontVisible, measurementMode: general.measurementMode, workflowIntent: general.workflowIntent, requiresProofApproval: general.requiresProofApproval, requiresProductionJob: general.requiresProductionJob };
};

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

  async updateDraftGeneral(context: OperationContext, input: UpdateProductDraftGeneralInput): Promise<ApplicationResult<ProductDraftGeneralRead>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!input.productId || !input.draftVersionId || !input.businessRequestId || Number.isNaN(Date.parse(input.expectedDraftUpdatedAt))) throw new V2ApplicationError("VALIDATION_ERROR", "A Draft and its current revision are required.");
      if (!this.authority.decide(context.principal, { capability: "product.edit", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to edit this Product Draft.");
      const general = validGeneral(input.general);
      const value = await this.runner.transaction(async (tx) => {
        if (!tx.updateDraftGeneral || !tx.auditDraftGeneral) throw new V2ApplicationError("CONFLICT", "Product Draft editing is unavailable.");
        const request = await tx.reserve({ organizationId: context.organizationId, operation: updateGeneralOperation, businessRequestId: input.businessRequestId, payloadFingerprint: generalFingerprint({ ...input, general }), ...actor(context) });
        if (request.kind === "replay") return request.request.resultJson as ProductDraftGeneralRead;
        const updated = await tx.updateDraftGeneral({ organizationId: context.organizationId, productId: input.productId, draftVersionId: input.draftVersionId, expectedDraftUpdatedAt: input.expectedDraftUpdatedAt, general, staffActorUserId: staffActorId(context.principal) });
        const changedFields = Object.keys(general);
        await tx.attribute({ organizationId: context.organizationId, requestId: request.request.id, operation: updateGeneralOperation, resourceId: updated.draftVersionId, ...actor(context) });
        await tx.auditDraftGeneral({ organizationId: context.organizationId, requestId: request.request.id, operation: updateGeneralOperation, resourceId: updated.draftVersionId, changedFields, ...actor(context) });
        await this.succeedGeneral(tx, context.organizationId, request.request.id, updated.draftVersionId, updated);
        return updated;
      });
      return success(value);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", error instanceof Error ? error.message : "Product Draft could not be saved."));
    }
  }

  private async succeedGeneral(tx: ProductVersionTransaction, organizationId: string, requestId: string, draftVersionId: string, result: ProductDraftGeneralRead) {
    await tx.succeed(organizationId, requestId, draftVersionId, result);
  }
}
