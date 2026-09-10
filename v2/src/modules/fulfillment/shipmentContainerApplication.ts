import { createHash, randomUUID } from "node:crypto";
import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, type FulfillmentHandoffId, type OrganizationId } from "../shared/commercialValues.js";
import { manualCarrierShipment, type ManualCarrierShipment } from "./carrierShipment.js";
import type { FulfillmentShipmentContainer, FulfillmentShipmentContainerDetail, ShipmentContainerStatus, ShipmentPreparedAllocation } from "./shipmentContainer.js";
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
  get?(organizationId: OrganizationId, shipmentId: string): Promise<FulfillmentShipmentContainerDetail | null>;
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
      return tx.createPrepared({ id: randomUUID(), organizationId, ...(input.customerId ? { customerId: input.customerId } : {}), ...(input.destination !== undefined ? { destination: input.destination } : {}), carrier: manualCarrierShipment({ status: "prepared", ...(input.carrier ?? {}) }), allocations: input.allocations, ...actor(context) });
    });
  }

  /** Prepared recovery is deliberately separate from final shipment completion. */
  async correctPrepared(context: OperationContext, input: Readonly<{ shipmentId: string; carrier?: CarrierInput; allocations: readonly ShipmentPreparedAllocation[]; reason: string }>): Promise<ApplicationResult<FulfillmentShipmentContainerDetail>> {
    return this.mutate(context, input, "fulfillment.shipment-container.correct.v1", async (tx, organizationId) => {
      if (!tx.correctPrepared) throw new V2ApplicationError("INTERNAL_ERROR", "Shipment recovery persistence is unavailable.");
      this.allocations(input.allocations);
      if (!input.reason.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A prepared shipment correction reason is required.");
      const result = await tx.correctPrepared({ organizationId, shipmentId: input.shipmentId, carrier: manualCarrierShipment({ status: "prepared", ...(input.carrier ?? {}) }), allocations: input.allocations, correctionReason: input.reason, ...actor(context) });
      if (!result) throw new V2ApplicationError("CONFLICT", "Only an existing prepared shipment can be corrected.");
      return result;
    });
  }

  /** Cancellation transitions only PREPARED → VOIDED and preserves draft/allocation evidence. */
  async voidPrepared(context: OperationContext, input: Readonly<{ shipmentId: string; reason: string }>): Promise<ApplicationResult<FulfillmentShipmentContainerDetail>> {
    return this.mutate(context, input, "fulfillment.shipment-container.void.v1", async (tx, organizationId) => {
      if (!tx.voidPrepared || !tx.get) throw new V2ApplicationError("INTERNAL_ERROR", "Shipment recovery persistence is unavailable.");
      if (!input.reason.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A prepared shipment cancellation reason is required.");
      const voided = await tx.voidPrepared({ organizationId, shipmentId: input.shipmentId, reason: input.reason, ...actor(context) });
      if (!voided) throw new V2ApplicationError("CONFLICT", "Only an existing prepared shipment can be cancelled.");
      const result = await tx.get(organizationId, input.shipmentId);
      if (!result) throw new V2ApplicationError("NOT_FOUND", "Shipment was not found.");
      return result;
    });
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
      const result = await tx.finalizePrepared({ organizationId, shipmentId: input.shipmentId, expectedPreparedRevisionId: input.expectedPreparedRevisionId, ...actor(context) });
      if (!result) throw new V2ApplicationError("CONFLICT", "Only an existing prepared shipment can be finalized.");
      return result;
    }, async shipment => {
      // Preserve the existing direct-fulfillment contract: lifecycle only sees
      // immutable committed handoffs, never a failed transaction or replay.
      const orderIds = [...new Set(shipment.currentPreparedRevision?.allocations.map(allocation => allocation.orderId) ?? [])];
      for (const orderId of orderIds) await this.orderLifecycle?.reconcileOrder(brandedId<"OrganizationId">(context.organizationId), brandedId<"OrderId">(orderId));
    });
  }

  async attach(context: OperationContext, input: Readonly<{ shipmentId: string; handoffIds: readonly FulfillmentHandoffId[] }>): Promise<ApplicationResult<void>> {
    try { requireOperationPrincipalScope(context); this.allow(context); if (!input.handoffIds.length || new Set(input.handoffIds).size !== input.handoffIds.length) throw new V2ApplicationError("VALIDATION_ERROR", "Attach one or more distinct shipment handoffs."); const attached = await this.runner.transaction(tx => tx.attach({ organizationId: context.organizationId as OrganizationId, ...input })); if (!attached) throw new V2ApplicationError("CONFLICT", "Shipment is not shipped, handoffs are incompatible, or an attachment already exists."); return success(undefined); } catch (error) { return failure(this.error(error)); }
  }

  private async mutate<T extends FulfillmentShipmentContainer>(context: OperationContext, input: unknown, operation: string, work: (tx: ShipmentContainerTransaction, organizationId: OrganizationId) => Promise<T>, afterCommitted?: (result: T) => Promise<void>): Promise<ApplicationResult<T>> {
    try {
      requireOperationPrincipalScope(context); this.allow(context);
      if (!context.businessRequest?.id.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      let committedMutation = false;
      const result = await this.runner.transaction(async tx => {
        const reservation = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: context.businessRequest!.id, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reservation.kind === "replay") return reservation.request.resultJson as T;
        const shipment = await work(tx, context.organizationId as OrganizationId);
        await tx.succeed(context.organizationId, reservation.request.id, shipment);
        committedMutation = true;
        return shipment;
      });
      if (committedMutation) await afterCommitted?.(result);
      return success(result);
    } catch (error) { return failure(this.error(error)); }
  }
  private allocations(allocations: readonly ShipmentPreparedAllocation[]) { if (!allocations.length) throw new V2ApplicationError("VALIDATION_ERROR", "A prepared shipment requires one or more allocations."); const seen = new Set<string>(); for (const allocation of allocations) { if (!allocation.orderId || !allocation.orderLineId || !Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0) throw new V2ApplicationError("VALIDATION_ERROR", "Shipment reservation quantities must be positive whole numbers."); const key = `${allocation.orderId}:${allocation.orderLineId}`; if (seen.has(key)) throw new V2ApplicationError("VALIDATION_ERROR", "An OrderLine may appear only once in a prepared shipment."); seen.add(key); } }
  private error(error: unknown) { return error instanceof V2ApplicationError ? error : new V2ApplicationError("VALIDATION_ERROR", error instanceof Error ? error.message : "Shipment operation could not be completed."); }
}
