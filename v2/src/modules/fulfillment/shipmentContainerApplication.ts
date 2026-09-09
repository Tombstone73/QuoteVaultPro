import { createHash, randomUUID } from "node:crypto";
import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { canonicalJson, type FulfillmentHandoffId, type OrganizationId } from "../shared/commercialValues.js";
import { manualCarrierShipment, type ManualCarrierShipment } from "./carrierShipment.js";
import type { FulfillmentShipmentContainer } from "./shipmentContainer.js";

type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;
type CarrierInput = Omit<ManualCarrierShipment, "status" | "shippedAt">;
export interface ShipmentContainerTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string }> & Actor): Promise<Reservation>;
  succeed(organizationId: string, requestId: string, result: FulfillmentShipmentContainer): Promise<void>;
  create(input: Readonly<{ id: string; organizationId: OrganizationId; customerId?: string; destination?: unknown; carrier: ManualCarrierShipment }> & Actor): Promise<FulfillmentShipmentContainer>;
  markShipped(input: Readonly<{ organizationId: OrganizationId; shipmentId: string; carrier: ManualCarrierShipment }> & Actor): Promise<FulfillmentShipmentContainer | null>;
  attach(input: Readonly<{ organizationId: OrganizationId; shipmentId: string; handoffIds: readonly FulfillmentHandoffId[] }>): Promise<boolean>;
}
export interface ShipmentContainerRunner { transaction<T>(work: (tx: ShipmentContainerTransaction) => Promise<T>): Promise<T> }
const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/** Keeps shipment container create/ship retries request-idempotent; immutable handoffs remain fulfillment authority. */
export class ShipmentContainerApplicationService {
  constructor(private readonly runner: ShipmentContainerRunner, private readonly authority = new AuthorityPolicy()) {}
  private allow(context: OperationContext) { if (!this.authority.decide(context.principal, { capability: "fulfillment.ship", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have shipment authority."); }

  async create(context: OperationContext, input: Readonly<{ customerId?: string; destination?: unknown; carrier?: CarrierInput }>): Promise<ApplicationResult<FulfillmentShipmentContainer>> {
    return this.mutate(context, input, "fulfillment.shipment-container.create.v1", (tx, organizationId) => tx.create({ id: randomUUID(), organizationId, ...(input.customerId ? { customerId: input.customerId } : {}), ...(input.destination ? { destination: input.destination } : {}), carrier: manualCarrierShipment({ status: "prepared", ...(input.carrier ?? {}) }), ...actor(context) }));
  }

  async ship(context: OperationContext, input: Readonly<{ shipmentId: string; carrier?: CarrierInput }>): Promise<ApplicationResult<FulfillmentShipmentContainer>> {
    return this.mutate(context, input, "fulfillment.shipment-container.ship.v1", async (tx, organizationId) => {
      const result = await tx.markShipped({ organizationId, shipmentId: input.shipmentId, carrier: manualCarrierShipment({ status: "shipped", shippedAt: new Date().toISOString(), ...(input.carrier ?? {}) }), ...actor(context) });
      if (!result) throw new V2ApplicationError("NOT_FOUND", "Shipment was not found.");
      return result;
    });
  }

  async attach(context: OperationContext, input: Readonly<{ shipmentId: string; handoffIds: readonly FulfillmentHandoffId[] }>): Promise<ApplicationResult<void>> {
    try { requireOperationPrincipalScope(context); this.allow(context); if (!input.handoffIds.length || new Set(input.handoffIds).size !== input.handoffIds.length) throw new V2ApplicationError("VALIDATION_ERROR", "Attach one or more distinct shipment handoffs."); const attached = await this.runner.transaction(tx => tx.attach({ organizationId: context.organizationId as OrganizationId, ...input })); if (!attached) throw new V2ApplicationError("CONFLICT", "Shipment is not shipped, handoffs are incompatible, or an attachment already exists."); return success(undefined); } catch (error) { return failure(this.error(error)); }
  }

  private async mutate(context: OperationContext, input: unknown, operation: string, work: (tx: ShipmentContainerTransaction, organizationId: OrganizationId) => Promise<FulfillmentShipmentContainer>): Promise<ApplicationResult<FulfillmentShipmentContainer>> {
    try {
      requireOperationPrincipalScope(context); this.allow(context);
      if (!context.businessRequest?.id.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      const result = await this.runner.transaction(async tx => {
        const reservation = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: context.businessRequest!.id, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reservation.kind === "replay") return reservation.request.resultJson as FulfillmentShipmentContainer;
        const shipment = await work(tx, context.organizationId as OrganizationId);
        await tx.succeed(context.organizationId, reservation.request.id, shipment);
        return shipment;
      });
      return success(result);
    } catch (error) { return failure(this.error(error)); }
  }
  private error(error: unknown) { return error instanceof V2ApplicationError ? error : new V2ApplicationError("VALIDATION_ERROR", error instanceof Error ? error.message : "Shipment operation could not be completed."); }
}
