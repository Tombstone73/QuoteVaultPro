import { createHash, randomUUID } from "node:crypto";
import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, type ArtworkAssignmentId, type OrderId, type OrderLineId, type OrganizationId, type ProofVersionId, type ProofWorkId } from "../shared/commercialValues.js";
import { normalizeOperationalQueuePage, type OperationalQueuePage, type OperationalQueuePageRequest } from "../shared/operationalQueue.js";
import { type CreateProofVersionInput, type ProofResponse, type ProofVersion, type ProofVersionProjection, type ProofWork, type ProofWorkProjection, type ProofWorkQueueItem, type RespondToProofInput, type RetryProofDeliveryInput, type StartProofWorkInput, type IssueProofVersionInput, validateProofComment } from "./contracts.js";

type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;
type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
export type ProofingMutationResult = Readonly<{ work: ProofWork; version?: ProofVersion; response?: ProofResponse }>;

export interface ProofingTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string } & Actor>): Promise<Reservation>;
  succeed(organizationId: string, requestId: string, result: ProofingMutationResult): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceType: "proof_work" | "proof_version" | "proof_response"; resourceId: string } & Actor>): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; eventType: "proof_work_started" | "proof_version_created" | "proof_issued" | "proof_delivery_retried" | "proof_approved" | "proof_revision_requested"; resourceId: string; summary: string } & Actor>): Promise<void>;
  findWork(organizationId: OrganizationId, proofWorkId: ProofWorkId): Promise<ProofWork | null>;
  lockWork(organizationId: OrganizationId, proofWorkId: ProofWorkId): Promise<ProofWork | null>;
  createOrGetWork(input: Readonly<{ id: ProofWorkId; organizationId: OrganizationId; orderId: OrderId; orderLineId: OrderLineId } & Actor>): Promise<ProofWork>;
  readWork(organizationId: OrganizationId, proofWorkId: ProofWorkId): Promise<ProofWorkProjection | null>;
  listWorkQueue(organizationId: OrganizationId, request: OperationalQueuePageRequest): Promise<OperationalQueuePage<ProofWorkQueueItem>>;
  listOrderWorks(organizationId: OrganizationId, orderId: OrderId): Promise<readonly ProofWorkProjection[]>;
  latestVersion(organizationId: OrganizationId, proofWorkId: ProofWorkId): Promise<ProofVersionProjection | null>;
  findVersion(organizationId: OrganizationId, proofVersionId: ProofVersionId): Promise<ProofVersionProjection | null>;
  createVersion(input: Readonly<{ id: ProofVersionId; organizationId: OrganizationId; proofWorkId: ProofWorkId; sequence: number; artworkAssignmentIds: readonly ArtworkAssignmentId[] } & Actor>): Promise<ProofVersion>;
  issueVersion(input: Readonly<{ organizationId: OrganizationId; proofVersionId: ProofVersionId; recipientContactId: string } & Actor>): Promise<ProofVersion>;
  retryDelivery(input: Readonly<{ organizationId: OrganizationId; proofVersionId: ProofVersionId } & Actor>): Promise<ProofVersion>;
  createResponse(input: Readonly<{ id: string; organizationId: OrganizationId; proofVersionId: ProofVersionId; outcome: "approved" | "revision_requested"; comment?: string; origin: "direct" | "staff_recorded_customer"; recordedCustomerId?: string } & Actor>): Promise<ProofResponse>;
  workCustomerId(organizationId: OrganizationId, proofWorkId: ProofWorkId): Promise<string | null>;
}
export interface ProofingTransactionRunner { transaction<T>(action: (tx: ProofingTransaction) => Promise<T>): Promise<T>; }
const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/** Durable Proofing coordinator. Approval deliberately has no Routing side effect in M2.1. */
export class ProofingApplicationService {
  constructor(private readonly runner: ProofingTransactionRunner, private readonly authority = new AuthorityPolicy()) {}
  async getWork(context: OperationContext, proofWorkId: ProofWorkId): Promise<ApplicationResult<ProofWorkProjection>> {
    try { requireOperationPrincipalScope(context); this.require(context, "proof.view"); const value = await this.runner.transaction((tx) => tx.readWork(brandedId<"OrganizationId">(context.organizationId), proofWorkId)); if (!value) throw new V2ApplicationError("NOT_FOUND", "Proof work was not found."); return success(value); } catch (error) { return failure(this.error(error)); }
  }
  async listWorkQueue(context: OperationContext, request: OperationalQueuePageRequest = {}): Promise<ApplicationResult<OperationalQueuePage<ProofWorkQueueItem>>> {
    try { requireOperationPrincipalScope(context); this.require(context, "proof.view"); const page = normalizeOperationalQueuePage(request); return success(await this.runner.transaction((tx) => tx.listWorkQueue(brandedId<"OrganizationId">(context.organizationId), page))); } catch (error) { return failure(this.error(error)); }
  }
  async listOrderWorks(context: OperationContext, orderId: OrderId): Promise<ApplicationResult<readonly ProofWorkProjection[]>> {
    try { requireOperationPrincipalScope(context); this.require(context, "proof.view"); return success(await this.runner.transaction((tx) => tx.listOrderWorks(brandedId<"OrganizationId">(context.organizationId), orderId))); } catch (error) { return failure(this.error(error)); }
  }
  async start(context: OperationContext, input: StartProofWorkInput): Promise<ApplicationResult<ProofingMutationResult>> {
    return this.mutate(context, "proof.start.v1", input, "proof.prepare", "proof_work_started", "Proof work started for OrderLine.", async (tx) => ({ work: await tx.createOrGetWork({ id: brandedId<"ProofWorkId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), orderId: input.orderId, orderLineId: input.orderLineId, ...actor(context) }) }));
  }
  async createVersion(context: OperationContext, input: CreateProofVersionInput): Promise<ApplicationResult<ProofingMutationResult>> {
    return this.mutate(context, "proof.version.create.v1", input, "proof.prepare", "proof_version_created", "Proof Version created from Artwork assignments.", async (tx) => {
      if (!input.artworkAssignmentIds.length || new Set(input.artworkAssignmentIds).size !== input.artworkAssignmentIds.length) throw new V2ApplicationError("VALIDATION_ERROR", "A Proof Version requires one or more distinct Artwork assignments.");
      const work = await tx.lockWork(brandedId<"OrganizationId">(context.organizationId), input.proofWorkId); if (!work) throw new V2ApplicationError("NOT_FOUND", "Proof work was not found.");
      const latest = await tx.latestVersion(work.organizationId, work.proofWorkId);
      if (latest && latest.response?.outcome !== "revision_requested") throw new V2ApplicationError("CONFLICT", "The current Proof Version must receive a revision request before another Version is created.");
      const version = await tx.createVersion({ id: brandedId<"ProofVersionId">(randomUUID()), organizationId: work.organizationId, proofWorkId: work.proofWorkId, sequence: (latest?.version.sequence ?? 0) + 1, artworkAssignmentIds: input.artworkAssignmentIds, ...actor(context) });
      return { work, version };
    });
  }
  async issue(context: OperationContext, input: IssueProofVersionInput): Promise<ApplicationResult<ProofingMutationResult>> {
    return this.mutate(context, "proof.issue.v1", input, "proof.issue", "proof_issued", "Proof Version issued for response.", async (tx) => {
      const found = await tx.findVersion(brandedId<"OrganizationId">(context.organizationId), input.proofVersionId); if (!found) throw new V2ApplicationError("NOT_FOUND", "Proof Version was not found.");
      const work = await tx.lockWork(found.version.organizationId, found.version.proofWorkId); if (!work) throw new V2ApplicationError("NOT_FOUND", "Proof work was not found.");
      const version = await tx.findVersion(work.organizationId, input.proofVersionId); if (!version || version.version.issuedAt) throw new V2ApplicationError("CONFLICT", "Proof Version has already been issued.");
      if (!version.version.artwork.length) throw new V2ApplicationError("VALIDATION_ERROR", "Proof Version needs Artwork before it can be issued.");
      return { work, version: await tx.issueVersion({ organizationId: work.organizationId, proofVersionId: input.proofVersionId, recipientContactId: input.recipientContactId, ...actor(context) }) };
    });
  }
  async retryDelivery(context: OperationContext, input: RetryProofDeliveryInput): Promise<ApplicationResult<ProofingMutationResult>> {
    return this.mutate(context, "proof.delivery.retry.v1", input, "proof.issue", "proof_delivery_retried", "Proof notification intentionally requeued.", async (tx) => {
      const found = await tx.findVersion(brandedId<"OrganizationId">(context.organizationId), input.proofVersionId); if (!found) throw new V2ApplicationError("NOT_FOUND", "Proof Version was not found.");
      const work = await tx.lockWork(found.version.organizationId, found.version.proofWorkId); if (!work) throw new V2ApplicationError("NOT_FOUND", "Proof work was not found.");
      return { work, version: await tx.retryDelivery({ organizationId: work.organizationId, proofVersionId: input.proofVersionId, ...actor(context) }) };
    });
  }
  async respond(context: OperationContext, input: RespondToProofInput): Promise<ApplicationResult<ProofingMutationResult>> {
    return this.mutate(context, "proof.respond.v1", input, "proof.respond", input.outcome === "approved" ? "proof_approved" : "proof_revision_requested", input.outcome === "approved" ? "Proof approval recorded." : "Proof revision request recorded.", async (tx) => {
      const found = await tx.findVersion(brandedId<"OrganizationId">(context.organizationId), input.proofVersionId); if (!found) throw new V2ApplicationError("NOT_FOUND", "Proof Version was not found.");
      const work = await tx.lockWork(found.version.organizationId, found.version.proofWorkId); if (!work) throw new V2ApplicationError("NOT_FOUND", "Proof work was not found.");
      const current = await tx.latestVersion(work.organizationId, work.proofWorkId);
      if (!current || current.version.proofVersionId !== input.proofVersionId) throw new V2ApplicationError("CONFLICT", "Only the current Proof Version can receive a response.");
      if (!current.version.issuedAt) throw new V2ApplicationError("CONFLICT", "A Proof Version must be issued before it can receive a response.");
      if (current.response) throw new V2ApplicationError("CONFLICT", "This Proof Version already has an authoritative response.");
      const customerId = await tx.workCustomerId(work.organizationId, work.proofWorkId); this.require(context, "proof.respond", customerId ?? undefined);
      const comment = validateProofComment(input.comment);
      const staffRecorded = input.recordedCustomerId !== undefined;
      if (staffRecorded && context.principal.kind !== "staff" && context.principal.kind !== "delegated_ai") throw new V2ApplicationError("FORBIDDEN", "Only a Staff actor may record a customer Proof response.");
      if (staffRecorded && input.recordedCustomerId !== customerId) throw new V2ApplicationError("VALIDATION_ERROR", "Recorded customer must match the Proof Work customer.");
      const response = await tx.createResponse({ id: randomUUID(), organizationId: work.organizationId, proofVersionId: input.proofVersionId, outcome: input.outcome, ...(comment ? { comment } : {}), origin: staffRecorded ? "staff_recorded_customer" : "direct", ...(input.recordedCustomerId ? { recordedCustomerId: input.recordedCustomerId } : {}), ...actor(context) });
      return { work, version: current.version, response };
    }, async (tx) => {
      const version = await tx.findVersion(brandedId<"OrganizationId">(context.organizationId), input.proofVersionId);
      if (!version) throw new V2ApplicationError("NOT_FOUND", "Proof Version was not found.");
      this.require(context, "proof.respond", await tx.workCustomerId(version.version.organizationId, version.version.proofWorkId) ?? undefined);
    });
  }
  private async mutate(context: OperationContext, operation: string, input: { businessRequestId: string }, capability: "proof.prepare" | "proof.issue" | "proof.respond", eventType: Parameters<ProofingTransaction["audit"]>[0]["eventType"], summary: string, work: (tx: ProofingTransaction) => Promise<ProofingMutationResult>, resourceScopedAuthority?: (tx: ProofingTransaction) => Promise<void>): Promise<ApplicationResult<ProofingMutationResult>> {
    try { requireOperationPrincipalScope(context); if (!resourceScopedAuthority) this.require(context, capability); if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required."); return success(await this.runner.transaction(async (tx) => { await resourceScopedAuthority?.(tx); const reserved = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) }); if (reserved.kind === "replay") return reserved.request.resultJson as ProofingMutationResult; const result = await work(tx); const target = result.response ? ["proof_response", result.response.proofResponseId] as const : result.version ? ["proof_version", result.version.proofVersionId] as const : ["proof_work", result.work.proofWorkId] as const; await tx.attribute({ organizationId: context.organizationId, requestId: reserved.request.id, operation, resourceType: target[0], resourceId: target[1], ...actor(context) }); await tx.audit({ organizationId: context.organizationId, requestId: reserved.request.id, operation, eventType, resourceId: target[1], summary, ...actor(context) }); await tx.succeed(context.organizationId, reserved.request.id, result); return result; })); } catch (error) { return failure(this.error(error)); }
  }
  private require(context: OperationContext, capability: "proof.view" | "proof.prepare" | "proof.issue" | "proof.respond", customerId?: string): void { if (!this.authority.decide(context.principal, { capability, resource: { organizationId: context.organizationId, ...(customerId ? { customerId } : {}) } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority for this Proofing operation."); }
  private error(error: unknown): V2ApplicationError { return error instanceof V2ApplicationError ? error : new V2ApplicationError("VALIDATION_ERROR", error instanceof Error ? error.message : "Proofing operation could not be completed."); }
}
