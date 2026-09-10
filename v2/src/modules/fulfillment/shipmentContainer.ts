import type { PrincipalKind } from "../../authorization/principals.js";
import type { CustomerId, FulfillmentHandoffId, OrganizationId } from "../shared/commercialValues.js";
import { manualCarrierShipment, type ManualCarrierShipment } from "./carrierShipment.js";

export type ShipmentContainerStatus = "prepared" | "shipped" | "voided";

/** Proposed quantity for one append-only prepared-shipment revision. It is not a fulfillment handoff. */
export type ShipmentPreparedAllocation = Readonly<{
  orderId: string;
  orderLineId: string;
  quantity: number;
}>;

/** One immutable operator snapshot of an editable prepared container. */
export type ShipmentPreparedRevision = Readonly<{
  revisionId: string;
  shipmentId: string;
  organizationId: OrganizationId;
  revisionNumber: number;
  kind: "initial" | "correction";
  supersedesRevisionId?: string;
  correctionReason?: string;
  customerId?: CustomerId;
  destination?: unknown;
  carrier: ManualCarrierShipment;
  allocations: readonly ShipmentPreparedAllocation[];
  createdAt: string;
  createdPrincipalKind: PrincipalKind;
  createdPrincipalSubject: string;
}>;

/** Immutable transition evidence; a prepared revision is referenced rather than rewritten. */
export type ShipmentContainerEvent = Readonly<{
  eventId: string;
  shipmentId: string;
  organizationId: OrganizationId;
  sequenceNumber: number;
  type: "prepared" | "corrected" | "voided" | "shipped";
  preparedRevisionId?: string;
  reason?: string;
  createdAt: string;
  principalKind: PrincipalKind;
  principalSubject: string;
}>;

/** A physical shipping container. It does not itself satisfy an Order line. */
export type FulfillmentShipmentContainer = Readonly<{
  shipmentId: string;
  organizationId: OrganizationId;
  status: ShipmentContainerStatus;
  customerId?: CustomerId;
  destination?: unknown;
  carrier: ManualCarrierShipment;
  /** The active immutable draft version while the container is prepared. */
  preparedRevisionId?: string;
  createdAt: string;
  createdPrincipalKind: PrincipalKind;
  createdPrincipalSubject: string;
  shippedAt?: string;
  shippedPrincipalKind?: PrincipalKind;
  shippedPrincipalSubject?: string;
  voidedAt?: string;
  voidedPrincipalKind?: PrincipalKind;
  voidedPrincipalSubject?: string;
  voidReason?: string;
}>;

/** Tenant-scoped recovery read.  The latest immutable prepared revision is projected without replacing history. */
export type FulfillmentShipmentContainerDetail = FulfillmentShipmentContainer & Readonly<{
  currentPreparedRevision?: ShipmentPreparedRevision;
  events: readonly ShipmentContainerEvent[];
}>;

/** The sole supported bridge from a combined physical shipment back to immutable order history. */
export type ShipmentHandoffAttachment = Readonly<{ shipmentId: string; handoffId: FulfillmentHandoffId }>;

export const preparedShipment = (input: Omit<FulfillmentShipmentContainer, "status" | "carrier" | "shippedAt" | "shippedPrincipalKind" | "shippedPrincipalSubject" | "voidedAt" | "voidedPrincipalKind" | "voidedPrincipalSubject" | "voidReason"> & Readonly<{ carrier?: Omit<ManualCarrierShipment, "status" | "shippedAt"> }>): FulfillmentShipmentContainer => ({ ...input, status: "prepared", carrier: manualCarrierShipment({ status: "prepared", ...(input.carrier ?? {}) }) });

/** Prepared containers can be corrected; customer handoffs are attached only after this transition. */
export const markShipmentShipped = (shipment: FulfillmentShipmentContainer, input: Readonly<{ shippedAt: string; principalKind: PrincipalKind; principalSubject: string; carrier?: Omit<ManualCarrierShipment, "status" | "shippedAt"> }>): FulfillmentShipmentContainer => {
  if (shipment.status === "shipped") return shipment;
  if (shipment.status === "voided") throw new Error("A voided shipment cannot be shipped.");
  if (!input.shippedAt || !input.principalSubject.trim()) throw new Error("Shipment completion requires actor and timestamp.");
  const { status: _existingStatus, shippedAt: _existingShippedAt, ...existingCarrier } = shipment.carrier;
  return { ...shipment, status: "shipped", carrier: manualCarrierShipment({ ...existingCarrier, ...(input.carrier ?? {}), status: "shipped", shippedAt: input.shippedAt }), shippedAt: input.shippedAt, shippedPrincipalKind: input.principalKind, shippedPrincipalSubject: input.principalSubject };
};

/** A physical shipment that has not left the building can only be voided with durable reason evidence. */
export const voidPreparedShipment = (shipment: FulfillmentShipmentContainer, input: Readonly<{ voidedAt: string; principalKind: PrincipalKind; principalSubject: string; reason: string }>): FulfillmentShipmentContainer => {
  if (shipment.status === "voided") return shipment;
  if (shipment.status !== "prepared") throw new Error("A shipped shipment requires an explicit post-shipment correction workflow.");
  if (!input.voidedAt || !input.principalSubject.trim() || !input.reason.trim()) throw new Error("Shipment cancellation requires actor, timestamp, and reason.");
  const { status: _existingStatus, shippedAt: _existingShippedAt, ...carrier } = shipment.carrier;
  return { ...shipment, status: "voided", carrier: manualCarrierShipment({ ...carrier, status: "voided" }), voidedAt: input.voidedAt, voidedPrincipalKind: input.principalKind, voidedPrincipalSubject: input.principalSubject, voidReason: input.reason.trim() };
};

export const canAttachShipmentHandoff = (shipment: FulfillmentShipmentContainer) => shipment.status === "shipped";
