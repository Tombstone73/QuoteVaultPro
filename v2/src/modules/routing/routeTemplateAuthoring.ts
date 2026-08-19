import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId, type PrincipalKind } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { RouteStepKind, RouteTemplate } from "./contracts.js";

export type RouteTemplateStepInput = Readonly<{ position: number; kind: RouteStepKind }>;
export type CreateRouteTemplateInput = Readonly<{ businessRequestId: string; name: string; steps: readonly RouteTemplateStepInput[] }>;
export type UpdateRouteTemplateInput = Readonly<{ businessRequestId: string; routeTemplateId: string; expectedRevision: string; name: string; active: boolean; steps: readonly RouteTemplateStepInput[] }>;
type Actor = Readonly<{ principalKind: PrincipalKind; principalSubject: string; staffActorUserId?: string }>;
export interface RouteTemplateAuthoringTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string }> & Actor): Promise<Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>>;
  create(input: Readonly<{ organizationId: string; name: string; steps: readonly RouteTemplateStepInput[]; staffActorUserId?: string }>): Promise<RouteTemplate>;
  update(input: Readonly<{ organizationId: string; routeTemplateId: string; expectedRevision: string; name: string; active: boolean; steps: readonly RouteTemplateStepInput[]; staffActorUserId?: string }>): Promise<RouteTemplate>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string }> & Actor): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; event: "route_template_created" | "route_template_updated" }> & Actor): Promise<void>;
  succeed(organizationId: string, requestId: string, resourceId: string, result: RouteTemplate): Promise<void>;
}
export interface RouteTemplateAuthoringTransactionRunner { transaction<T>(work: (tx: RouteTemplateAuthoringTransaction) => Promise<T>): Promise<T>; }
const order: Record<RouteStepKind, number> = { proofing: 0, prepress: 1, production: 2, fulfillment: 3 };
const normalized = (name: string) => name.trim().toLocaleLowerCase("en-US");
const steps = (value: readonly RouteTemplateStepInput[]): readonly RouteTemplateStepInput[] => {
  if (!Array.isArray(value) || !value.length || value.length > 4) throw new V2ApplicationError("VALIDATION_ERROR", "A Route Template needs one or more valid steps.");
  const sorted = [...value].sort((a, b) => a.position - b.position);
  const allowed = (kind: unknown): kind is RouteStepKind => kind === "proofing" || kind === "prepress" || kind === "production" || kind === "fulfillment";
  if (sorted.some((step, index) => { if (!Number.isInteger(step.position) || step.position !== index || !allowed(step.kind)) return true; const previous = sorted[index - 1]; return Boolean(previous && allowed(previous.kind) && order[String(step.kind) as RouteStepKind] <= order[String(previous.kind) as RouteStepKind]); }))
    throw new V2ApplicationError("VALIDATION_ERROR", "Route steps must be unique and in the established order.");
  return sorted;
};
const name = (value: string) => { const result = value.trim(); if (!result || result.length > 160) throw new V2ApplicationError("VALIDATION_ERROR", "A Route Template name is required."); return result; };
const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Routing-owned template authoring. Products can only select its result. */
export class RouteTemplateAuthoringApplicationService {
  constructor(private readonly runner: RouteTemplateAuthoringTransactionRunner, private readonly authority = new AuthorityPolicy()) {}
  async create(context: OperationContext, input: CreateRouteTemplateInput): Promise<ApplicationResult<RouteTemplate>> { return this.run(context, input.businessRequestId, "route.template.create.v1", input, (tx, actorValue) => tx.create({ organizationId: context.organizationId, name: name(input.name), steps: steps(input.steps), staffActorUserId: actorValue.staffActorUserId }), "route_template_created"); }
  async update(context: OperationContext, input: UpdateRouteTemplateInput): Promise<ApplicationResult<RouteTemplate>> {
    if (!input.routeTemplateId.trim() || !input.expectedRevision.trim() || typeof input.active !== "boolean") return failure(new V2ApplicationError("VALIDATION_ERROR", "A current Route Template is required."));
    return this.run(context, input.businessRequestId, "route.template.update.v1", input, (tx, actorValue) => tx.update({ organizationId: context.organizationId, routeTemplateId: input.routeTemplateId, expectedRevision: input.expectedRevision, name: name(input.name), active: input.active, steps: steps(input.steps), staffActorUserId: actorValue.staffActorUserId }), "route_template_updated");
  }
  private async run(context: OperationContext, requestId: string, operation: string, input: unknown, work: (tx: RouteTemplateAuthoringTransaction, actorValue: Actor) => Promise<RouteTemplate>, event: "route_template_created" | "route_template_updated"): Promise<ApplicationResult<RouteTemplate>> {
    try {
      requireOperationPrincipalScope(context);
      if (context.businessRequest?.id !== requestId || !requestId?.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!this.authority.decide(context.principal, { capability: "route.manageTemplates", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to manage Route Templates.");
      const principal = actor(context);
      const result = await this.runner.transaction(async (tx) => {
        const request = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: requestId, payloadFingerprint: hash(input), ...principal });
        if (request.kind === "replay") return request.request.resultJson as RouteTemplate;
        const saved = await work(tx, principal);
        await tx.attribute({ organizationId: context.organizationId, requestId: request.request.id, operation, resourceId: saved.routeTemplateId, ...principal });
        await tx.audit({ organizationId: context.organizationId, requestId: request.request.id, operation, resourceId: saved.routeTemplateId, event, ...principal });
        await tx.succeed(context.organizationId, request.request.id, saved.routeTemplateId, saved);
        return saved;
      });
      return success(result);
    } catch (error) { return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Route Template could not be saved.")); }
  }
}

export const routeTemplateFingerprint = (templateName: string, templateSteps: readonly RouteTemplateStepInput[]) =>
  `sha256:${createHash("sha256").update(JSON.stringify({ name: normalized(templateName), steps: templateSteps })).digest("hex")}`;
