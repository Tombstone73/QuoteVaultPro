import { createHash, randomUUID } from "node:crypto";
import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, type ArtworkAssignmentId, type OrganizationId, type OrderLineId, type PrepressUnitId } from "../shared/commercialValues.js";
import { normalizeOperationalQueuePage, type OperationalQueuePage } from "../shared/operationalQueue.js";
import type { CompletePrepressUnitInput, OpenPrepressUnitInput, OrderLinePrepressCoverage, PrepressQueueItem, PrepressQueuePageRequest, PrepressUnit, StartPrepressUnitInput } from "./contracts.js";

type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;
export type PrepressMutationResult = Readonly<{ unit: PrepressUnit }>;

export interface PrepressTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string } & Actor>): Promise<Reservation>;
  succeed(organizationId: string, requestId: string, result: PrepressMutationResult): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string } & Actor>): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; eventType: "prepress_unit_opened" | "prepress_unit_started" | "prepress_unit_completed"; resourceId: string; summary: string } & Actor>): Promise<void>;
  findUnit(organizationId: OrganizationId, prepressUnitId: PrepressUnitId): Promise<PrepressUnit | null>;
  orderLineExists(organizationId: OrganizationId, orderLineId: OrderLineId): Promise<boolean>;
  lockUnit(organizationId: OrganizationId, prepressUnitId: PrepressUnitId): Promise<PrepressUnit | null>;
  listUnits(organizationId: OrganizationId, orderLineId: OrderLineId): Promise<readonly PrepressUnit[]>;
  listQueue(organizationId: OrganizationId, request: PrepressQueuePageRequest): Promise<OperationalQueuePage<PrepressQueueItem>>;
  coverage(organizationId: OrganizationId, orderLineId: OrderLineId): Promise<OrderLinePrepressCoverage>;
  /** Routing remains owner of this current-step eligibility projection. */
  eligibleProductionAssignment(organizationId: OrganizationId, artworkAssignmentId: ArtworkAssignmentId): Promise<boolean>;
  createOrGetUnit(input: Readonly<{ id: PrepressUnitId; organizationId: OrganizationId; artworkAssignmentId: ArtworkAssignmentId } & Actor>): Promise<PrepressUnit>;
  startUnit(input: Readonly<{ organizationId: OrganizationId; prepressUnitId: PrepressUnitId } & Actor>): Promise<PrepressUnit>;
  completeUnit(input: Readonly<{ organizationId: OrganizationId; prepressUnitId: PrepressUnitId } & Actor>): Promise<PrepressUnit>;
}
export interface PrepressTransactionRunner { transaction<T>(action: (tx: PrepressTransaction) => Promise<T>): Promise<T>; }
const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/** Prepress owns unit execution only; opening and completion never mutate Routing. */
export class PrepressApplicationService {
  constructor(private readonly runner: PrepressTransactionRunner, private readonly authority = new AuthorityPolicy()) {}
  async getUnit(context: OperationContext, prepressUnitId: PrepressUnitId): Promise<ApplicationResult<PrepressUnit>> {
    try { requireOperationPrincipalScope(context); this.require(context, "prepress.view"); const unit = await this.runner.transaction((tx) => tx.findUnit(brandedId<"OrganizationId">(context.organizationId), prepressUnitId)); if (!unit) throw new V2ApplicationError("NOT_FOUND", "Prepress unit was not found."); return success(unit); } catch (error) { return failure(this.error(error)); }
  }
  async listOrderLineUnits(context: OperationContext, orderLineId: OrderLineId): Promise<ApplicationResult<readonly PrepressUnit[]>> {
    try { requireOperationPrincipalScope(context); this.require(context, "prepress.view"); return success(await this.runner.transaction((tx) => tx.listUnits(brandedId<"OrganizationId">(context.organizationId), orderLineId))); } catch (error) { return failure(this.error(error)); }
  }
  async getOrderLineCoverage(context: OperationContext, orderLineId: OrderLineId): Promise<ApplicationResult<OrderLinePrepressCoverage>> {
    try { requireOperationPrincipalScope(context); this.require(context, "prepress.view"); return success(await this.runner.transaction(async(tx) => { const org=brandedId<"OrganizationId">(context.organizationId); if(!await tx.orderLineExists(org,orderLineId))throw new V2ApplicationError("NOT_FOUND","Order line was not found."); return tx.coverage(org,orderLineId); })); } catch (error) { return failure(this.error(error)); }
  }
  async listQueue(context: OperationContext, request: PrepressQueuePageRequest = {}): Promise<ApplicationResult<OperationalQueuePage<PrepressQueueItem>>> {
    try {
      requireOperationPrincipalScope(context); this.require(context, "prepress.view");
      const requirementState = request.requirementState ?? "all";
      if (!["all", "configured", "unconfigured"].includes(requirementState)) throw new V2ApplicationError("VALIDATION_ERROR", "requirementState must be configured, unconfigured, or all.");
      const page = { ...normalizeOperationalQueuePage(request), requirementState };
      return success(await this.runner.transaction((tx) => tx.listQueue(brandedId<"OrganizationId">(context.organizationId), page)));
    } catch (error) { return failure(this.error(error)); }
  }
  async open(context: OperationContext, input: OpenPrepressUnitInput): Promise<ApplicationResult<PrepressMutationResult>> {
    return this.mutate(context, "prepress.unit.open.v1", input, "prepress.work", "prepress_unit_opened", "Prepress unit opened for production Artwork.", async (tx) => {
      const org = brandedId<"OrganizationId">(context.organizationId);
      if (!await tx.eligibleProductionAssignment(org, input.artworkAssignmentId)) throw new V2ApplicationError("CONFLICT", "Production Artwork is not currently eligible for Prepress.");
      return { unit: await tx.createOrGetUnit({ id: brandedId<"PrepressUnitId">(randomUUID()), organizationId: org, artworkAssignmentId: input.artworkAssignmentId, ...actor(context) }) };
    });
  }
  async start(context: OperationContext, input: StartPrepressUnitInput): Promise<ApplicationResult<PrepressMutationResult>> {
    return this.mutate(context, "prepress.unit.start.v1", input, "prepress.work", "prepress_unit_started", "Prepress unit started.", async (tx) => {
      const unit = await tx.lockUnit(brandedId<"OrganizationId">(context.organizationId), input.prepressUnitId); if (!unit) throw new V2ApplicationError("NOT_FOUND", "Prepress unit was not found.");
      if (unit.completedAt) throw new V2ApplicationError("CONFLICT", "Completed Prepress evidence is immutable; create corrected Artwork and a new unit.");
      return { unit: unit.startedAt ? unit : await tx.startUnit({ organizationId: unit.organizationId, prepressUnitId: unit.prepressUnitId, ...actor(context) }) };
    });
  }
  async complete(context: OperationContext, input: CompletePrepressUnitInput): Promise<ApplicationResult<PrepressMutationResult>> {
    return this.mutate(context, "prepress.unit.complete.v1", input, "prepress.complete", "prepress_unit_completed", "Prepress unit completed; this does not advance Routing or start Production.", async (tx) => {
      const unit = await tx.lockUnit(brandedId<"OrganizationId">(context.organizationId), input.prepressUnitId); if (!unit) throw new V2ApplicationError("NOT_FOUND", "Prepress unit was not found.");
      if (unit.completedAt) return { unit };
      if (!unit.startedAt) throw new V2ApplicationError("CONFLICT", "Prepress work must be started before it can be completed.");
      return { unit: await tx.completeUnit({ organizationId: unit.organizationId, prepressUnitId: unit.prepressUnitId, ...actor(context) }) };
    });
  }
  private async mutate(context: OperationContext, operation: string, input: { businessRequestId: string }, capability: "prepress.work" | "prepress.complete", eventType: Parameters<PrepressTransaction["audit"]>[0]["eventType"], summary: string, work: (tx: PrepressTransaction) => Promise<PrepressMutationResult>): Promise<ApplicationResult<PrepressMutationResult>> {
    try { requireOperationPrincipalScope(context); this.require(context, capability); if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required."); return success(await this.runner.transaction(async (tx) => { const reserved = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) }); if (reserved.kind === "replay") return reserved.request.resultJson as PrepressMutationResult; const result = await work(tx); await tx.attribute({ organizationId: context.organizationId, requestId: reserved.request.id, operation, resourceId: result.unit.prepressUnitId, ...actor(context) }); await tx.audit({ organizationId: context.organizationId, requestId: reserved.request.id, operation, eventType, resourceId: result.unit.prepressUnitId, summary, ...actor(context) }); await tx.succeed(context.organizationId, reserved.request.id, result); return result; })); } catch (error) { return failure(this.error(error)); }
  }
  private require(context: OperationContext, capability: "prepress.view" | "prepress.work" | "prepress.complete"): void { if (!this.authority.decide(context.principal, { capability, resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority for this Prepress operation."); }
  private error(error: unknown): V2ApplicationError { return error instanceof V2ApplicationError ? error : new V2ApplicationError("VALIDATION_ERROR", error instanceof Error ? error.message : "Prepress operation could not be completed."); }
}
