import type { PrincipalKind } from "../../authorization/principals.js";
import type { CustomerId, FulfillmentHandoffId, OrganizationId } from "../shared/commercialValues.js";
import { manualCarrierShipment, type ManualCarrierShipment } from "./carrierShipment.js";

/** A physical shipping container. It does not itself satisfy an Order line. */
export type FulfillmentShipmentContainer = Readonly<{
  shipmentId: string;
  organizationId: OrganizationId;
  status: "prepared" | "shipped";
  customerId?: CustomerId;
  destination?: unknown;
  carrier: ManualCarrierShipment;
  createdAt: string;
  createdPrincipalKind: PrincipalKind;
  createdPrincipalSubject: string;
  shippedAt?: string;
  shippedPrincipalKind?: PrincipalKind;
  shippedPrincipalSubject?: string;
}>;

/** The sole supported bridge from a combined physical shipment back to immutable order history. */
export type ShipmentHandoffAttachment = Readonly<{ shipmentId: string; handoffId: FulfillmentHandoffId }>;

export const preparedShipment = (input: Omit<FulfillmentShipmentContainer, "status" | "carrier" | "shippedAt" | "shippedPrincipalKind" | "shippedPrincipalSubject"> & Readonly<{ carrier?: Omit<ManualCarrierShipment, "status" | "shippedAt"> }>): FulfillmentShipmentContainer => ({ ...input, status: "prepared", carrier: manualCarrierShipment({ status: "prepared", ...(input.carrier ?? {}) }) });

/** Prepared containers can be corrected; customer handoffs are attached only after this transition. */
export const markShipmentShipped = (shipment: FulfillmentShipmentContainer, input: Readonly<{ shippedAt: string; principalKind: PrincipalKind; principalSubject: string; carrier?: Omit<ManualCarrierShipment, "status" | "shippedAt"> }>): FulfillmentShipmentContainer => {
  if (shipment.status === "shipped") return shipment;
  if (!input.shippedAt || !input.principalSubject.trim()) throw new Error("Shipment completion requires actor and timestamp.");
  const { status: _existingStatus, shippedAt: _existingShippedAt, ...existingCarrier } = shipment.carrier;
  return { ...shipment, status: "shipped", carrier: manualCarrierShipment({ ...existingCarrier, ...(input.carrier ?? {}), status: "shipped", shippedAt: input.shippedAt }), shippedAt: input.shippedAt, shippedPrincipalKind: input.principalKind, shippedPrincipalSubject: input.principalSubject };
};

export const canAttachShipmentHandoff = (shipment: FulfillmentShipmentContainer) => shipment.status === "shipped";
