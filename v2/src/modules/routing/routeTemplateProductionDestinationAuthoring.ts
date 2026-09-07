import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId, type PrincipalKind } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";

export type ProductionDestinationStation = "flatbed" | "roll";
export type RouteTemplateProductionDestination = Readonly<{
  routeTemplateId: string;
  routeTemplateStepId: string;
  stationKey: ProductionDestinationStation;
}>;
export type SetRouteTemplateProductionDestinationInput = Readonly<{
  businessRequestId: string;
  routeTemplateId: string;
  routeTemplateStepId: string;
  stationKey: ProductionDestinationStation;
}>;

type Actor = Readonly<{ principalKind: PrincipalKind; principalSubject: string; staffActorUserId?: string }>;
export interface RouteTemplateProductionDestinationTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string }> & Actor): Promise<Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>>;
  set(input: Readonly<{ organizationId: string; routeTemplateId: string; routeTemplateStepId: string; stationKey: ProductionDestinationStation; staffActorUserId?: string }>): Promise<Readonly<{ destination: RouteTemplateProductionDestination; previousStationKey?: ProductionDestinationStation }>>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string }> & Actor): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; destination: RouteTemplateProductionDestination; previousStationKey?: ProductionDestinationStation }> & Actor): Promise<void>;
  succeed(organizationId: string, requestId: string, resourceId: string, result: RouteTemplateProductionDestination): Promise<void>;
}
export interface RouteTemplateProductionDestinationTransactionRunner { transaction<T>(work: (tx: RouteTemplateProductionDestinationTransaction) => Promise<T>): Promise<T>; }

const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validStation = (value: unknown): value is ProductionDestinationStation => value === "flatbed" || value === "roll";

/**
 * Routing owns the template-step to station relationship.  A frozen order
 * captures the applicable template step and only resolves this explicit
 * configuration; labels and Product UI input are never treated as authority.
 */
export class RouteTemplateProductionDestinationApplicationService {
  constructor(private readonly runner: RouteTemplateProductionDestinationTransactionRunner, private readonly authority = new AuthorityPolicy()) {}

  async set(context: OperationContext, input: SetRouteTemplateProductionDestinationInput): Promise<ApplicationResult<RouteTemplateProductionDestination>> {
    try {
      requireOperationPrincipalScope(context);
      if (context.businessRequest?.id !== input.businessRequestId || !input.businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!input.routeTemplateId.trim() || !input.routeTemplateStepId.trim() || !validStation(input.stationKey)) throw new V2ApplicationError("VALIDATION_ERROR", "A Route Template production step and supported station are required.");
      if (!this.authority.decide(context.principal, { capability: "route.manageTemplates", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to configure Route Template destinations.");
      const principal = actor(context);
      const result = await this.runner.transaction(async (tx) => {
        const request = await tx.reserve({ organizationId: context.organizationId, operation: "route.template.production-destination.set.v1", businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...principal });
        if (request.kind === "replay") return request.request.resultJson as RouteTemplateProductionDestination;
        const saved = await tx.set({ organizationId: context.organizationId, routeTemplateId: input.routeTemplateId, routeTemplateStepId: input.routeTemplateStepId, stationKey: input.stationKey, staffActorUserId: principal.staffActorUserId });
        await tx.attribute({ organizationId: context.organizationId, requestId: request.request.id, operation: "route.template.production-destination.set.v1", resourceId: saved.destination.routeTemplateStepId, ...principal });
        await tx.audit({ organizationId: context.organizationId, requestId: request.request.id, operation: "route.template.production-destination.set.v1", resourceId: saved.destination.routeTemplateStepId, destination: saved.destination, ...(saved.previousStationKey ? { previousStationKey: saved.previousStationKey } : {}), ...principal });
        await tx.succeed(context.organizationId, request.request.id, saved.destination.routeTemplateStepId, saved.destination);
        return saved.destination;
      });
      return success(result);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Route Template destination could not be saved."));
    }
  }
}
