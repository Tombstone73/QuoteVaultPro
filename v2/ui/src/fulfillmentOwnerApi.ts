import type { OrderingCustomerSender, ShipmentSenderIntent, ShipmentSenderSnapshot } from "../../src/modules/fulfillment/shipmentSender";
import type { PhysicalIntent, PhysicalOperation, PhysicalRecoveryResult } from "../../src/modules/fulfillment/physicalOperationRecovery";
import type { FulfillmentShipmentDetail, FulfillmentShipmentCarrierInput, FulfillmentShipmentDraftAllocationInput } from "./api";

type Transport = <T>(organizationId: string, suffix: string, init?: RequestInit) => Promise<T>;
let transport: Transport = async () => { throw new Error("Durable Shipping/Fulfillment transport is unavailable. No physical request was sent."); };
/** The coordinator injects the existing authenticated, CSRF/session-fenced API transport. */
export const configureFulfillmentOwnerTransport = (value: Transport) => { transport = value; };
export type ShippingOwnerDetail = FulfillmentShipmentDetail & Readonly<{ currentPreparedRevision?: NonNullable<FulfillmentShipmentDetail["currentPreparedRevision"]> & Readonly<{ senderSnapshot?: ShipmentSenderSnapshot }> }>;
export type ShippingPrepareInput = Readonly<{ customerId?: string; destination?: unknown; carrier?: FulfillmentShipmentCarrierInput; allocations: readonly FulfillmentShipmentDraftAllocationInput[]; senderIntents?: readonly ShipmentSenderIntent[] }>;
export type ShippingCorrectionInput = Readonly<{ carrier?: FulfillmentShipmentCarrierInput; allocations: readonly FulfillmentShipmentDraftAllocationInput[]; reason: string; senderIntents?: readonly ShipmentSenderIntent[] }>;
const post = <T>(org: string, suffix: string, body: unknown) => transport<T>(org, suffix, { method: "POST", body: JSON.stringify(body) });
export const fulfillmentOwnerApi = {
  discover: (org: string) => transport<readonly PhysicalRecoveryResult[]>(org, "/physical-operations"),
  admit: (org: string, intent: PhysicalIntent) => post<PhysicalRecoveryResult>(org, "/physical-operations/admit", intent),
  receipt:(org:string,operation:PhysicalOperation,businessRequestId:string)=>transport<PhysicalRecoveryResult>(org,`/physical-operations/${encodeURIComponent(operation)}/${encodeURIComponent(businessRequestId)}`),
  withdraw: (org: string, operation:PhysicalOperation, businessRequestId: string) => post<PhysicalRecoveryResult>(org, `/physical-operations/${encodeURIComponent(operation)}/${encodeURIComponent(businessRequestId)}/withdraw`, { businessRequestId }),
  sender: (org: string, orderId: string) => transport<OrderingCustomerSender>(org, `/orders/${encodeURIComponent(orderId)}/sender-context`),
  prepare: (org: string, businessRequestId: string, input: ShippingPrepareInput) => post<ShippingOwnerDetail>(org, "/shipments/prepared", { businessRequestId, ...input }),
  correct: (org: string, shipmentId: string, businessRequestId: string, input: ShippingCorrectionInput) => post<ShippingOwnerDetail>(org, `/shipments/${encodeURIComponent(shipmentId)}/correct`, { businessRequestId, ...input }),
};
