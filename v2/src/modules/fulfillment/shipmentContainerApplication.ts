import { createHash, randomUUID } from "node:crypto";
import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, type FulfillmentHandoffId, type OrganizationId } from "../shared/commercialValues.js";
import { manualCarrierShipment, type ManualCarrierShipment } from "./carrierShipment.js";
import type { FulfillmentShipmentContainer, FulfillmentShipmentContainerDetail, ShipmentContainerStatus, ShipmentPreparedAllocation, ShipmentPreparedRevision } from "./shipmentContainer.js";
import type { OrderAutomaticLifecycle } from "../sales/orderAutomaticLifecycle.js";

type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;
type CarrierInput = Omit<ManualCarrierShipment, "status" | "shippedAt">;
export interface ShipmentContainerTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string }> & Actor): Promise<Reservation>;
  succeed(organizationId: string, requestId: string, result: FulfillmentShipmentContainer): Promise<void>;
  create(input: Readonly<{ id: string; organizationId: OrganizationId; customerId?: string; destination?: unknown; carrier: ManualCarrierShipment }> & Actor): Promise<FulfillmentShipmentContainer>;
  markShipped(input: Readonly<{ organizationId: OrganizationId; shipmentId: string; carrier: ManualCarrierShipment }> & Actor): Promise<FulfillmentShipmentContainer | null>;
  attach(input: Readonly<{ organizationId: OrganizationId; shipmentId: string; handoffIds: readonly FulfillmentHandoffId[] }>): Promise<boolean>;
  /** M7.8B recovery methods are optional only for legacy in-memory test adapters. */
  createPrepared?(input: Readonly<{ id: string; organizationId: OrganizationId; customerId?: string; destination?: unknown; carrier: ManualCarrierShipment; allocations: readonly ShipmentPreparedAllocation[] }> & Actor): Promise<FulfillmentShipmentContainerDetail>;
  /** forUpdate holds the shipment lock on this transaction's client through authorization and mutation. */
  get?(organizationId: OrganizationId, shipmentId: string, options?: Readonly<{ forUpdate?: boolean }>): Promise<FulfillmentShipmentContainerDetail | null>;
  /** Immutable evidence, scoped to exactly one tenant, shipment and revision. Required for correction replay. */
  getPreparedRevision?(organizationId: OrganizationId, shipmentId: string, revisionId: string): Promise<ShipmentPreparedRevision | null>;
  list?(organizationId: OrganizationId, request?: Readonly<{ status?: ShipmentContainerStatus; limit?: number }>): Promise<readonly FulfillmentShipmentContainer[]>;
  correctPrepared?(input: Readonly<{ organizationId: OrganizationId; shipmentId: string; carrier: ManualCarrierShipment; allocations: readonly ShipmentPreparedAllocation[]; correctionReason: string }> & Actor): Promise<FulfillmentShipmentContainerDetail | null>;
  voidPrepared?(input: Readonly<{ organizationId: OrganizationId; shipmentId: string; reason: string }> & Actor): Promise<FulfillmentShipmentContainer | null>;
  /**
   * The only production transition from a prepared container to SHIPPED.  The
   * adapter owns the single DB transaction which revalidates availability,
   * materializes handoffs/snapshots, attaches them, and transitions last.
   */
  finalizePrepared?(input: Readonly<{ organizationId: OrganizationId; shipmentId: string; expectedPreparedRevisionId: string }> & Actor): Promise<FulfillmentShipmentContainerDetail | null>;
}
export interface ShipmentContainerRunner { transaction<T>(work: (tx: ShipmentContainerTransaction) => Promise<T>): Promise<T> }
const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/** Keeps shipment container create/ship retries request-idempotent; immutable handoffs remain fulfillment authority. */
export class ShipmentContainerApplicationService {
  constructor(private readonly runner: ShipmentContainerRunner, private readonly authority = new AuthorityPolicy(), private readonly orderLifecycle?: OrderAutomaticLifecycle) {}
  private allow(context: OperationContext) { if (!this.authority.decide(context.principal, { capability: "fulfillment.ship", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have shipment authority."); }

  async create(context: OperationContext, input: Readonly<{ customerId?: string; destination?: unknown; carrier?: CarrierInput }>): Promise<ApplicationResult<FulfillmentShipmentContainer>> {
    return this.mutate(context, input, "fulfillment.shipment-container.create.v1", (tx, organizationId) => tx.create({ id: randomUUID(), organizationId, ...(input.customerId ? { customerId: input.customerId } : {}), ...(input.destination ? { destination: input.destination } : {}), carrier: manualCarrierShipment({ status: "prepared", ...(input.carrier ?? {}) }), ...actor(context) }));
  }

  /** Creates an editable prepared shipment with append-only reservation evidence. It never records a fulfillment handoff. */
  async createPrepared(context: OperationContext, input: Readonly<{ customerId?: string; destination?: unknown; carrier?: CarrierInput; allocations: readonly ShipmentPreparedAllocation[] }>): Promise<ApplicationResult<FulfillmentShipmentContainerDetail>> {
    return this.mutate(context, input, "fulfillment.shipment-container.prepare.v1", async (tx, organizationId) => {
      if (!tx.createPrepared) throw new V2ApplicationError("INTERNAL_ERROR", "Shipment recovery persistence is unavailable.");
      this.allocations(input.allocations);
      this.allowAllocations(context, input.allocations);
      return tx.createPrepared({ id: randomUUID(), organizationId, ...(input.customerId ? { customerId: input.customerId } : {}), ...(input.destination !== undefined ? { destination: input.destination } : {}), carrier: manualCarrierShipment({ status: "prepared", ...(input.carrier ?? {}) }), allocations: input.allocations, ...actor(context) });
    }, undefined, (tx, saved) => this.allowReplay(context, tx, saved, "prepare"));
  }

  /** Prepared recovery is deliberately separate from final shipment completion. */
  async correctPrepared(context: OperationContext, input: Readonly<{ shipmentId: string; carrier?: CarrierInput; allocations: readonly ShipmentPreparedAllocation[]; reason: string }>): Promise<ApplicationResult<FulfillmentShipmentContainerDetail>> {
    return this.mutate(context, input, "fulfillment.shipment-container.correct.v1", async (tx, organizationId) => {
      if (!tx.correctPrepared) throw new V2ApplicationError("INTERNAL_ERROR", "Shipment recovery persistence is unavailable.");
      this.allocations(input.allocations);
      if (!input.reason.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A prepared shipment correction reason is required.");
      const current = await this.lockedRevision(tx, organizationId, input.shipmentId);
      this.allowAllocations(context, [...current.allocations, ...input.allocations]);
      const result = await tx.correctPrepared({ organizationId, shipmentId: input.shipmentId, carrier: manualCarrierShipment({ status: "prepared", ...(input.carrier ?? {}) }), allocations: input.allocations, correctionReason: input.reason, ...actor(context) });
      if (!result) throw new V2ApplicationError("CONFLICT", "Only an existing prepared shipment can be corrected.");
      return result;
    }, undefined, (tx, saved) => this.allowReplay(context, tx, saved, "correct", input.shipmentId));
  }

  /** Cancellation transitions only PREPARED → VOIDED and preserves draft/allocation evidence. */
  async voidPrepared(context: OperationContext, input: Readonly<{ shipmentId: string; reason: string }>): Promise<ApplicationResult<FulfillmentShipmentContainerDetail>> {
    return this.mutate(context, input, "fulfillment.shipment-container.void.v1", async (tx, organizationId) => {
      if (!tx.voidPrepared || !tx.get) throw new V2ApplicationError("INTERNAL_ERROR", "Shipment recovery persistence is unavailable.");
      if (!input.reason.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A prepared shipment cancellation reason is required.");
      const current = await this.lockedRevision(tx, organizationId, input.shipmentId);
      this.allowAllocations(context, current.allocations);
      const voided = await tx.voidPrepared({ organizationId, shipmentId: input.shipmentId, reason: input.reason, ...actor(context) });
      if (!voided) throw new V2ApplicationError("CONFLICT", "Only an existing prepared shipment can be cancelled.");
      const result = await tx.get(organizationId, input.shipmentId);
      if (!result) throw new V2ApplicationError("NOT_FOUND", "Shipment was not found.");
      return result;
    }, undefined, (tx, saved) => this.allowReplay(context, tx, saved, "void", input.shipmentId));
  }

  async get(context: OperationContext, shipmentId: string): Promise<ApplicationResult<FulfillmentShipmentContainerDetail>> {
    try { requireOperationPrincipalScope(context); this.allow(context); const result = await this.runner.transaction(async tx => { if (!tx.get) throw new V2ApplicationError("INTERNAL_ERROR", "Shipment recovery persistence is unavailable."); return tx.get(context.organizationId as OrganizationId, shipmentId); }); if (!result) throw new V2ApplicationError("NOT_FOUND", "Shipment was not found."); return success(result); } catch (error) { return failure(this.error(error)); }
  }

  async list(context: OperationContext, request: Readonly<{ status?: ShipmentContainerStatus; limit?: number }> = {}): Promise<ApplicationResult<readonly FulfillmentShipmentContainer[]>> {
    try { requireOperationPrincipalScope(context); this.allow(context); const result = await this.runner.transaction(async tx => { if (!tx.list) throw new V2ApplicationError("INTERNAL_ERROR", "Shipment recovery persistence is unavailable."); return tx.list(context.organizationId as OrganizationId, request); }); return success(result); } catch (error) { return failure(this.error(error)); }
  }

  async ship(context: OperationContext, input: Readonly<{ shipmentId: string; carrier?: CarrierInput }>): Promise<ApplicationResult<FulfillmentShipmentContainer>> {
    // The legacy route is retained as a compatibility alias, but it must not
    // recreate the former unsafe "mark first, attach later" sequence. Carrier
    // facts are immutable prepared-revision facts and cannot be changed here.
    void context; void input;
    return failure(new V2ApplicationError("VALIDATION_ERROR", "Use the atomic shipment finalization command with the prepared revision identity."));
  }

  /** Atomically materialize the canonical shipment handoffs before shipping. */
  async finalize(context: OperationContext, input: Readonly<{ shipmentId: string; expectedPreparedRevisionId: string }>): Promise<ApplicationResult<FulfillmentShipmentContainerDetail>> {
    return this.mutate(context, input, "fulfillment.shipment-container.finalize.v1", async (tx, organizationId) => {
      if (!tx.finalizePrepared) throw new V2ApplicationError("INTERNAL_ERROR", "Atomic shipment finalization is unavailable.");
      if (!input.expectedPreparedRevisionId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "The active prepared revision identity is required.");
      const current = await this.lockedRevision(tx, organizationId, input.shipmentId);
      this.allowAllocations(context, current.allocations);
      const result = await tx.finalizePrepared({ organizationId, shipmentId: input.shipmentId, expectedPreparedRevisionId: input.expectedPreparedRevisionId, ...actor(context) });
      if (!result) throw new V2ApplicationError("CONFLICT", "Only an existing prepared shipment can be finalized.");
      return result;
    }, async shipment => {
      // Preserve the existing direct-fulfillment contract: lifecycle only sees
      // immutable committed handoffs, never a failed transaction or replay.
      const orderIds = [...new Set(shipment.currentPreparedRevision?.allocations.map(allocation => allocation.orderId) ?? [])];
      for (const orderId of orderIds) await this.orderLifecycle?.reconcileOrder(brandedId<"OrganizationId">(context.organizationId), brandedId<"OrderId">(orderId));
    }, (tx, saved) => this.allowReplay(context, tx, saved, "finalize", input.shipmentId, input.expectedPreparedRevisionId));
  }

  async attach(context: OperationContext, input: Readonly<{ shipmentId: string; handoffIds: readonly FulfillmentHandoffId[] }>): Promise<ApplicationResult<void>> {
    try { requireOperationPrincipalScope(context); this.allow(context); if (!input.handoffIds.length || new Set(input.handoffIds).size !== input.handoffIds.length) throw new V2ApplicationError("VALIDATION_ERROR", "Attach one or more distinct shipment handoffs."); const attached = await this.runner.transaction(tx => tx.attach({ organizationId: context.organizationId as OrganizationId, ...input })); if (!attached) throw new V2ApplicationError("CONFLICT", "Shipment is not shipped, handoffs are incompatible, or an attachment already exists."); return success(undefined); } catch (error) { return failure(this.error(error)); }
  }

  private async mutate<T extends FulfillmentShipmentContainer>(context: OperationContext, input: unknown, operation: string, work: (tx: ShipmentContainerTransaction, organizationId: OrganizationId) => Promise<T>, afterCommitted?: (result: T) => Promise<void>, authorizeReplay?: (tx: ShipmentContainerTransaction, saved: unknown) => Promise<void>): Promise<ApplicationResult<T>> {
    try {
      requireOperationPrincipalScope(context); this.allow(context);
      if (!context.businessRequest?.id.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      let committedMutation = false;
      const result = await this.runner.transaction(async tx => {
        const reservation = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: context.businessRequest!.id, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reservation.kind === "replay") {
          await authorizeReplay?.(tx, reservation.request.resultJson);
          return reservation.request.resultJson as T;
        }
        const shipment = await work(tx, context.organizationId as OrganizationId);
        await tx.succeed(context.organizationId, reservation.request.id, shipment);
        committedMutation = true;
        return shipment;
      });
      if (committedMutation) await afterCommitted?.(result);
      return success(result);
    } catch (error) { return failure(this.error(error)); }
  }
  private allowAllocations(context: OperationContext, allocations: readonly ShipmentPreparedAllocation[]) {
    if (allocations.some(allocation => allocation.replacementObligationId !== undefined) && !this.authority.decide(context.principal, { capability: "fulfillment.replace", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have replacement fulfillment authority.");
  }
  private revisionEvidence(revision: ShipmentPreparedRevision | undefined | null, organizationId: string, shipmentId: string, revisionId: string | undefined): ShipmentPreparedRevision {
    if (typeof revisionId !== "string" || !revisionId.trim() || !revision || revision.revisionId !== revisionId || revision.organizationId !== organizationId || revision.shipmentId !== shipmentId || !Number.isSafeInteger(revision.revisionNumber) || revision.revisionNumber < 1 || !Array.isArray(revision.allocations)
      || (revision.kind === "initial" ? revision.revisionNumber !== 1 || revision.supersedesRevisionId !== undefined : revision.kind !== "correction" || revision.revisionNumber < 2 || typeof revision.supersedesRevisionId !== "string" || !revision.supersedesRevisionId.trim() || revision.supersedesRevisionId === revisionId || !revision.allocations.length)
      || revision.allocations.some(allocation => !allocation || !allocation.orderId || !allocation.orderLineId || !Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0 || (allocation.replacementObligationId !== undefined && (typeof allocation.replacementObligationId !== "string" || !allocation.replacementObligationId.trim())))) {
      throw new V2ApplicationError("CONFLICT", "Shipment authorization evidence is missing or inconsistent.");
    }
    return revision;
  }
  private async lockedRevision(tx: ShipmentContainerTransaction, organizationId: OrganizationId, shipmentId: string): Promise<ShipmentPreparedRevision> {
    if (!tx.get) throw new V2ApplicationError("INTERNAL_ERROR", "Locked shipment recovery persistence is unavailable.");
    const current = await tx.get(organizationId, shipmentId, { forUpdate: true });
    if (!current) throw new V2ApplicationError("CONFLICT", "Shipment was not found.");
    if (current.organizationId !== organizationId || current.shipmentId !== shipmentId) throw new V2ApplicationError("CONFLICT", "Shipment authorization evidence is inconsistent.");
    return this.revisionEvidence(current.currentPreparedRevision, organizationId, shipmentId, current.preparedRevisionId);
  }
  private async allowReplay(context: OperationContext, tx: ShipmentContainerTransaction, saved: unknown, operation: "prepare" | "correct" | "finalize" | "void", shipmentId?: string, expectedRevisionId?: string): Promise<void> {
    const result = saved as FulfillmentShipmentContainerDetail | null;
    if (!result || typeof result.shipmentId !== "string" || !result.shipmentId || result.organizationId !== context.organizationId || (shipmentId !== undefined && result.shipmentId !== shipmentId) || result.status !== (operation === "finalize" ? "shipped" : operation === "void" ? "voided" : "prepared")) throw new V2ApplicationError("CONFLICT", "Shipment replay authorization evidence is missing or inconsistent.");
    // Replay scope is historical, not today's active allocation set. Lock the
    // container for coordination without treating later revisions as authority.
    if (!tx.get) throw new V2ApplicationError("INTERNAL_ERROR", "Locked shipment recovery persistence is unavailable.");
    const current = await tx.get(context.organizationId as OrganizationId, result.shipmentId, { forUpdate: true });
    if (!current || current.organizationId !== context.organizationId || current.shipmentId !== result.shipmentId) throw new V2ApplicationError("CONFLICT", "Shipment replay scope is unavailable.");
    const revision = this.revisionEvidence(result.currentPreparedRevision, context.organizationId, result.shipmentId, result.preparedRevisionId);
    if ((operation !== "void" && !revision.allocations.length) || (operation === "prepare" && revision.kind !== "initial") || (operation === "correct" && revision.kind !== "correction") || (expectedRevisionId !== undefined && revision.revisionId !== expectedRevisionId)) throw new V2ApplicationError("CONFLICT", "Shipment replay revision is inconsistent.");
    this.allowAllocations(context, revision.allocations);
    if (operation === "correct") {
      if (!tx.getPreparedRevision) throw new V2ApplicationError("INTERNAL_ERROR", "Shipment revision authorization evidence is unavailable.");
      const prior = this.revisionEvidence(await tx.getPreparedRevision(context.organizationId as OrganizationId, result.shipmentId, revision.supersedesRevisionId!), context.organizationId, result.shipmentId, revision.supersedesRevisionId);
      if (prior.revisionNumber !== revision.revisionNumber - 1) throw new V2ApplicationError("CONFLICT", "Shipment superseded revision is inconsistent.");
      this.allowAllocations(context, prior.allocations);
    }
  }
  private allocations(allocations: readonly ShipmentPreparedAllocation[]) { if (!allocations.length) throw new V2ApplicationError("VALIDATION_ERROR", "A prepared shipment requires one or more allocations."); const seen = new Set<string>(); for (const allocation of allocations) { if (!allocation.orderId || !allocation.orderLineId || !Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0) throw new V2ApplicationError("VALIDATION_ERROR", "Shipment reservation quantities must be positive whole numbers."); const key = `${allocation.orderId}:${allocation.orderLineId}:${allocation.replacementObligationId ?? "original"}`; if (seen.has(key)) throw new V2ApplicationError("VALIDATION_ERROR", "An OrderLine authority may appear only once in a prepared shipment."); seen.add(key); } }
  private error(error: unknown) { return error instanceof V2ApplicationError ? error : new V2ApplicationError("VALIDATION_ERROR", error instanceof Error ? error.message : "Shipment operation could not be completed."); }
}
