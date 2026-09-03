import type { PrincipalKind } from "../../authorization/principals.js";
import type { ContactId, CustomerId, FulfillmentHandoffId, FulfillmentHandoffLineId, OrderId, OrderLineId, OrganizationId } from "../shared/commercialValues.js";

export type FulfillmentMethod = "pickup" | "shipment";

/** Derived only: immutable handoff history exceeds the Production evidence now recorded for the same line. */
export type FulfillmentPhysicalIntegrityAnomaly = Readonly<{
  code: "FULFILLMENT_HISTORY_EXCEEDS_RECORDED_PRODUCTION";
  completedProductionQuantity: number;
  completedFulfillmentQuantity: number;
  excessFulfillmentQuantity: number;
}>;
export const fulfillmentPhysicalIntegrityAnomaly=(completedProductionQuantity:number,completedFulfillmentQuantity:number):FulfillmentPhysicalIntegrityAnomaly|undefined=>completedFulfillmentQuantity>completedProductionQuantity?{code:"FULFILLMENT_HISTORY_EXCEEDS_RECORDED_PRODUCTION",completedProductionQuantity,completedFulfillmentQuantity,excessFulfillmentQuantity:completedFulfillmentQuantity-completedProductionQuantity}:undefined;
export const fulfillmentSupplyQuantity = (input: Readonly<{
  orderedQuantity: number;
  completedProductionQuantity: number;
  productionRequired: boolean;
  workflowIntent: "standard_production" | "fulfillment_only" | "service_fee" | null;
}>): number => input.productionRequired
  ? Math.min(input.orderedQuantity, Math.max(0, input.completedProductionQuantity))
  : input.workflowIntent === "standard_production" || input.workflowIntent === "fulfillment_only"
    ? input.orderedQuantity
    : 0;

/** Immutable completed customer-handoff fact. Carrier mechanics deliberately are not modeled here. */
export type FulfillmentHandoff = Readonly<{
  handoffId: FulfillmentHandoffId; organizationId: OrganizationId; orderId: OrderId; method: FulfillmentMethod;
  completedAt: string; customerId?: CustomerId; contactId?: ContactId;
  completedPrincipalKind: PrincipalKind; completedPrincipalSubject: string; completedStaffActorUserId?: string;
}>;

export type FulfillmentHandoffLine = Readonly<{
  handoffLineId: FulfillmentHandoffLineId; organizationId: OrganizationId; handoffId: FulfillmentHandoffId;
  orderId: OrderId; orderLineId: OrderLineId; quantity: number;
}>;

export type FulfillmentAvailability = Readonly<{
  orderId: OrderId; orderLineId: OrderLineId; orderedQuantity: number; completedPickupQuantity: number;
  completedShipmentQuantity: number; completedFulfillmentQuantity: number;
  /** Production-owned output, capped to the commercial line quantity for this read-only projection. */
  completedProductionQuantity: number;
  productionRequired: boolean;
  /** Physical output not yet consumed by an immutable pickup or shipment handoff. */
  availableFulfillmentQuantity: number;
  /** Commercial quantity still not produced. */
  remainingProductionQuantity: number;
  /** Commercial quantity not yet handed off. This can exceed the currently available physical quantity. */
  remainingFulfillmentQuantity: number;
  /** Present only for historical facts that cannot be reconciled with recorded Production output. */
  physicalIntegrityAnomaly?: FulfillmentPhysicalIntegrityAnomaly;
}>;

export type CompleteFulfillmentInput = Readonly<{
  businessRequestId: string; orderId: OrderId; allocations: readonly Readonly<{ orderLineId: OrderLineId; quantity: number }> [];
  customerId?: CustomerId; contactId?: ContactId;
}>;

export type FulfillmentTerminalResult = Readonly<{
  handoff: FulfillmentHandoff; allocations: readonly FulfillmentHandoffLine[]; availability: readonly FulfillmentAvailability[];
}>;

/** Bounded operator projection; Sales supplies commercial context, Fulfillment supplies quantities/history. */
export type FulfillmentOrderWorkspace = Readonly<{
  orderId: OrderId; number: string; commercialState: "open" | "completed" | "cancelled"; customerName: string; customerId?: CustomerId; contactId?: ContactId;
  requestedDueDate?: string; lines: readonly Readonly<{ orderLineId: OrderLineId; description: string } & FulfillmentAvailability>[];
  /** Sales-owned plan, projected read-only. It is not an actual handoff method. */
  requestedFulfillment?: Readonly<{ method: "pickup" | "shipping" | "local_delivery"; destination?: Readonly<{ recipient?: string; company?: string; addressLine1: string; addressLine2?: string; city: string; region?: string; postalCode?: string; country?: string; phone?: string }>; instructions?: string }>;
  handoffs: readonly Readonly<{ handoff: FulfillmentHandoff; allocations: readonly FulfillmentHandoffLine[]; /** Present only when the immutable handoff snapshot exists. */ documentAvailable?: boolean }> [];
}>;

export type FulfillmentWorkspacePage = Readonly<{ items: readonly FulfillmentOrderWorkspace[]; nextCursor?: string }>;

export interface FulfillmentWorkspaceReadPort {
  list(organizationId: OrganizationId, request: Readonly<{ limit?: number; search?: string; cursor?: string }>): Promise<FulfillmentWorkspacePage>;
  get(organizationId: OrganizationId, orderId: OrderId): Promise<FulfillmentOrderWorkspace | null>;
}
