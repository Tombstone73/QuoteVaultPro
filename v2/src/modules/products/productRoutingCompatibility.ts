import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";

export type ProductRoutingReadiness = "ROUTABLE_VERSION_ROUTE" | "ROUTABLE_COMPATIBILITY_ROUTE" | "UNROUTABLE_NO_PRODUCT_TYPE" | "UNROUTABLE_PRODUCT_TYPE_NO_DEFAULT_ROUTE" | "UNROUTABLE_INVALID_ROUTE" | "UNROUTABLE_PRODUCTION_UNITS_MISSING" | "NON_PRODUCTION_ROUTING_NOT_REQUIRED";
export type RouteTemplateChoice = Readonly<{ routeTemplateId: string; name: string; steps: readonly ("proofing" | "prepress" | "production" | "fulfillment")[] }>;
export type ProductTypeRoutingChoice = Readonly<{ productTypeId: string; name: string; updatedAt: string; defaultRoute?: Readonly<{ routeTemplateId: string; name: string }> }>;
export type ProductRoutingCompatibility = Readonly<{
  productId: string; productName: string; productUpdatedAt: string;
  workflowIntent: "standard_production" | "fulfillment_only" | "service_fee";
  requiresProductionJob: boolean; activeProductVersionId?: string;
  readiness: ProductRoutingReadiness; productTypeId?: string; productTypeName?: string;
  versionRouteName?: string; compatibilityRouteName?: string;
  productTypes: readonly ProductTypeRoutingChoice[];
  routeTemplates: readonly RouteTemplateChoice[];
}>;
export type ProductRoutingDebtItem = Readonly<{ productId: string; productName: string; workflowIntent: "standard_production"; productTypeName?: string; exactVersionRouteStatus: "missing" | "configured" | "invalid"; productTypeDefaultRouteStatus: "not_assigned" | "configured" | "missing" | "invalid"; readiness: Extract<ProductRoutingReadiness, `UNROUTABLE_${string}`>; reason: string; remediation: "compatibility" | "version_routing" }>;
export type ProductRoutingReadinessAudit = Readonly<{ products: ReadonlyArray<Omit<ProductRoutingCompatibility, "productTypes" | "routeTemplates">>; worklist: readonly ProductRoutingDebtItem[]; routeTemplates: readonly RouteTemplateChoice[]; counts: Readonly<{ activeProducts: number; activeStandardProduction: number; routableByVersion: number; routableByCompatibility: number; unroutable: number }> }>;
export type AssignProductTypeCompatibilityInput = Readonly<{ productId: string; productTypeId: string | null; expectedProductUpdatedAt: string; businessRequestId: string }>;
export type UpdateProductTypeDefaultRouteInput = Readonly<{ productTypeId: string; routeTemplateId: string; expectedProductTypeUpdatedAt: string; businessRequestId: string }>;
type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;

export interface ProductRoutingCompatibilityTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string }> & Actor): Promise<Reservation>;
  assignProductType(input: Readonly<{ organizationId: string; productId: string; productTypeId: string | null; expectedProductUpdatedAt: string; staffActorUserId?: string }>): Promise<ProductRoutingCompatibility>;
  updateProductTypeDefaultRoute(input: Readonly<{ organizationId: string; productTypeId: string; routeTemplateId: string; expectedProductTypeUpdatedAt: string; staffActorUserId?: string }>): Promise<ProductTypeRoutingChoice>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string }> & Actor): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; event: string; changes: unknown }> & Actor): Promise<void>;
  succeed(organizationId: string, requestId: string, resourceId: string, result: unknown): Promise<void>;
}
export interface ProductRoutingCompatibilityRunner { transaction<T>(work: (tx: ProductRoutingCompatibilityTransaction) => Promise<T>): Promise<T>; }
export interface ProductRoutingCompatibilityReadPort { read(organizationId: string, productId: string): Promise<ProductRoutingCompatibility | null>; audit(organizationId: string): Promise<ProductRoutingReadinessAudit>; }

const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (input: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
const allowed = (context: OperationContext) => new AuthorityPolicy().decide(context.principal, { capability: "product.edit", resource: { organizationId: context.organizationId } }).allowed;

/** Product Type is current compatibility metadata; it never rewrites a ProductVersion. */
export class ProductRoutingCompatibilityApplicationService {
  constructor(private readonly runner: ProductRoutingCompatibilityRunner) {}
  async assign(context: OperationContext, input: AssignProductTypeCompatibilityInput): Promise<ApplicationResult<ProductRoutingCompatibility>> {
    return this.run(context, "product.compatibility_type.assign.v1", input, async (tx, a, request) => {
      const saved = await tx.assignProductType({ organizationId: context.organizationId, productId: input.productId, productTypeId: input.productTypeId, expectedProductUpdatedAt: input.expectedProductUpdatedAt, staffActorUserId: a.staffActorUserId });
      await tx.attribute({ organizationId: context.organizationId, requestId: request.id, operation: "product.compatibility_type.assign.v1", resourceId: input.productId, ...a });
      await tx.audit({ organizationId: context.organizationId, requestId: request.id, operation: "product.compatibility_type.assign.v1", resourceId: input.productId, event: "product_compatibility_type_assigned", changes: [{ kind: "product_type_assignment", productTypeName: saved.productTypeName ?? null, compatibilityRouteName: saved.compatibilityRouteName ?? null }], ...a });
      await tx.succeed(context.organizationId, request.id, input.productId, saved);
      return saved;
    });
  }
  async setDefaultRoute(context: OperationContext, input: UpdateProductTypeDefaultRouteInput): Promise<ApplicationResult<ProductTypeRoutingChoice>> {
    return this.run(context, "product_type.compatibility_route.update.v1", input, async (tx, a, request) => {
      const saved = await tx.updateProductTypeDefaultRoute({ organizationId: context.organizationId, productTypeId: input.productTypeId, routeTemplateId: input.routeTemplateId, expectedProductTypeUpdatedAt: input.expectedProductTypeUpdatedAt, staffActorUserId: a.staffActorUserId });
      await tx.attribute({ organizationId: context.organizationId, requestId: request.id, operation: "product_type.compatibility_route.update.v1", resourceId: input.productTypeId, ...a });
      await tx.audit({ organizationId: context.organizationId, requestId: request.id, operation: "product_type.compatibility_route.update.v1", resourceId: input.productTypeId, event: "product_type_compatibility_route_updated", changes: [{ kind: "default_route", routeTemplateName: saved.defaultRoute?.name ?? null }], ...a });
      await tx.succeed(context.organizationId, request.id, input.productTypeId, saved);
      return saved;
    });
  }
  private async run<T>(context: OperationContext, operation: string, input: { businessRequestId: string }, work: (tx: ProductRoutingCompatibilityTransaction, a: Actor, request: Reservation["request"]) => Promise<T>): Promise<ApplicationResult<T>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId || !input.businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!allowed(context)) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to configure Product routing compatibility.");
      const a = actor(context);
      const result = await this.runner.transaction(async (tx) => {
        const reservation = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...a });
        if (reservation.kind === "replay") return reservation.request.resultJson as T;
        return work(tx, a, reservation.request);
      });
      return success(result);
    } catch (error) { return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Product routing compatibility could not be saved.")); }
  }
}
