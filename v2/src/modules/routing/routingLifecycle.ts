import { createHash } from "node:crypto";
import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, type OrganizationId, type RouteInstanceId } from "../shared/commercialValues.js";
import type { CompleteCurrentRouteStepInput, CompleteCurrentRouteStepResult, RouteInstance, RouteInstanceStep, RouteStepKind } from "./contracts.js";

type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;
export type RoutePrerequisite = Readonly<{ satisfied: boolean; reason?: string }>;

export interface RoutingLifecycleTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string } & Actor>): Promise<Reservation>;
  succeed(organizationId: string, requestId: string, result: CompleteCurrentRouteStepResult): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string } & Actor>): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; completedStep: RouteInstanceStep; nextStep?: RouteInstanceStep } & Actor>): Promise<void>;
  lockRouteInstance(organizationId: OrganizationId, routeInstanceId: RouteInstanceId): Promise<RouteInstance | null>;
  prerequisite(organizationId: OrganizationId, route: RouteInstance, step: RouteInstanceStep): Promise<RoutePrerequisite>;
  advance(input: Readonly<{ organizationId: OrganizationId; routeInstanceId: RouteInstanceId; expectedRevision: string; nextStepId?: string }>): Promise<RouteInstance>;
}

export interface RoutingLifecycleTransactionRunner { transaction<T>(action: (tx: RoutingLifecycleTransaction) => Promise<T>): Promise<T>; }

const actor = (context: OperationContext): Actor => ({
  principalKind: context.principal.kind,
  principalSubject: principalSubject(context.principal),
  ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}),
});
const fingerprint = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/**
 * A deliberately narrow, named transition.  It consumes immutable Proofing
 * and Prepress completion facts, but never recreates either domain's rules.
 * Production opening remains the existing Production command after Routing
 * makes the frozen production step current.
 */
export class RoutingLifecycleApplicationService {
  constructor(private readonly runner: RoutingLifecycleTransactionRunner, private readonly authority = new AuthorityPolicy()) {}

  async completeCurrentStep(context: OperationContext, input: CompleteCurrentRouteStepInput): Promise<ApplicationResult<CompleteCurrentRouteStepResult>> {
    try {
      requireOperationPrincipalScope(context);
      if (!this.authority.decide(context.principal, { capability: "route.advance", resource: { organizationId: context.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to advance Routing.");
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId)
        throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!input.expectedRevision.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "The current Route revision is required.");
      return success(await this.runner.transaction(async (tx) => {
        const reserved = await tx.reserve({ organizationId: context.organizationId, operation: "routing.step.complete.v1", businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reserved.kind === "replay") return reserved.request.resultJson as CompleteCurrentRouteStepResult;
        const route = await tx.lockRouteInstance(brandedId<"OrganizationId">(context.organizationId), input.routeInstanceId);
        if (!route) throw new V2ApplicationError("NOT_FOUND", "The frozen Route was not found.");
        if (route.revision !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "The frozen Route changed; reload before advancing it.");
        if (route.state === "completed" || !route.currentStepId) throw new V2ApplicationError("CONFLICT", "The frozen Route is already complete.");
        const current = route.steps.find((step) => step.routeInstanceStepId === route.currentStepId);
        if (!current) throw new V2ApplicationError("CONFLICT", "The frozen Route has no valid current step.");
        const prerequisite = await tx.prerequisite(route.organizationId, route, current);
        if (!prerequisite.satisfied) throw new V2ApplicationError("CONFLICT", prerequisite.reason ?? "The owning domain has not completed this Route step.");
        const next = route.steps.find((step) => step.position > current.position);
        const advanced = await tx.advance({ organizationId: route.organizationId, routeInstanceId: route.routeInstanceId, expectedRevision: route.revision, ...(next ? { nextStepId: next.routeInstanceStepId } : {}) });
        const result: CompleteCurrentRouteStepResult = { routeInstance: advanced, completedStep: current, ...(next ? { nextStep: next } : {}) };
        await tx.attribute({ organizationId: context.organizationId, requestId: reserved.request.id, operation: "routing.step.complete.v1", resourceId: route.routeInstanceId, ...actor(context) });
        await tx.audit({ organizationId: context.organizationId, requestId: reserved.request.id, operation: "routing.step.complete.v1", resourceId: route.routeInstanceId, completedStep: current, ...(next ? { nextStep: next } : {}), ...actor(context) });
        await tx.succeed(context.organizationId, reserved.request.id, result);
        return result;
      }));
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("VALIDATION_ERROR", error instanceof Error ? error.message : "Routing could not be advanced."));
    }
  }
}

export const routeStepRequiresExternalCompletion = (kind: RouteStepKind): boolean => kind === "proofing" || kind === "prepress" || kind === "production" || kind === "fulfillment";
