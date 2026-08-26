import type { PrincipalKind } from "../../authorization/principals.js";
import type { ContactId, CustomerId, FulfillmentHandoffId, FulfillmentHandoffLineId, OrderId, OrderLineId, OrganizationId } from "../shared/commercialValues.js";

export type FulfillmentMethod = "pickup" | "shipment";

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
  /** Physical output not yet consumed by an immutable pickup or shipment handoff. */
  availableFulfillmentQuantity: number;
  /** Commercial quantity still not produced. */
  remainingProductionQuantity: number;
  /** Commercial quantity not yet handed off. This can exceed the currently available physical quantity. */
  remainingFulfillmentQuantity: number;
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
  orderId: OrderId; number: string; commercialState: "open" | "cancelled"; customerName: string; customerId?: CustomerId; contactId?: ContactId;
  requestedDueDate?: string; lines: readonly Readonly<{ orderLineId: OrderLineId; description: string } & FulfillmentAvailability>[];
  handoffs: readonly Readonly<{ handoff: FulfillmentHandoff; allocations: readonly FulfillmentHandoffLine[] }> [];
}>;

export type FulfillmentWorkspacePage = Readonly<{ items: readonly FulfillmentOrderWorkspace[]; nextCursor?: string }>;

export interface FulfillmentWorkspaceReadPort {
  list(organizationId: OrganizationId, request: Readonly<{ limit?: number; search?: string; cursor?: string }>): Promise<FulfillmentWorkspacePage>;
  get(organizationId: OrganizationId, orderId: OrderId): Promise<FulfillmentOrderWorkspace | null>;
}
