import type { PrincipalKind } from "../../authorization/principals.js";
import type { OperationContext } from "../../application/operation.js";
import type { ApplicationResult } from "../../errors/applicationError.js";
import type { FulfillmentHandoffId, OrderId, OrderLineId, OrganizationId, ProductionWorkId, ReplacementObligationId } from "../shared/commercialValues.js";
import type { ReplacementBillingTreatment, ShippingResponsibility } from "./replacementShippingEconomics.js";

export const replacementReasons = ["production_delay","print_defect","finishing_defect","wrong_material","transit_damage","lost_in_transit","customer_rejection","customer_change","internal_shipping_error","carrier_issue","other"] as const;
export type ReplacementReason = (typeof replacementReasons)[number];
export type ReplacementObligationStatus = "open" | "production_complete" | "fulfilled" | "cancelled";
export type ReplacementObligationEventKind = "created" | "production_authority_created" | "production_satisfied" | "fulfillment_satisfied" | "completed" | "cancelled" | "corrected";

/** A post-fulfillment replacement. The source handoff stays immutable forever. */
export type ReplacementObligation = Readonly<{
  replacementObligationId: ReplacementObligationId;
  organizationId: OrganizationId;
  orderId: OrderId;
  orderLineId: OrderLineId;
  sourceFulfillmentHandoffId?: FulfillmentHandoffId;
  sourceShipmentId?: string;
  predecessorReplacementObligationId?: string;
  replacementQuantity: number;
  reason: ReplacementReason;
  responsibility: ShippingResponsibility;
  billingTreatment: ReplacementBillingTreatment;
  note?: string;
  status: ReplacementObligationStatus;
  successorProductionWorkIds: readonly ProductionWorkId[];
  createdAt: string;
  createdPrincipalKind: PrincipalKind;
  createdPrincipalSubject: string;
}>;

export type CreateReplacementObligationInput = Readonly<{
  businessRequestId: string;
  orderId: OrderId;
  orderLineId: OrderLineId;
  sourceFulfillmentHandoffId?: FulfillmentHandoffId;
  sourceShipmentId?: string;
  predecessorReplacementObligationId?: string;
  replacementQuantity: number;
  reason: ReplacementReason;
  responsibility: ShippingResponsibility;
  billingTreatment: ReplacementBillingTreatment;
  note?: string;
}>;

/** This is intentionally distinct from a refund, shipment correction, or rejected output. */
export type ReplacementObligationEvent = Readonly<{ sequence:number; kind:ReplacementObligationEventKind; detail:Readonly<Record<string, unknown>>; createdAt:string; createdPrincipalKind:PrincipalKind; createdPrincipalSubject:string }>;
export type ReplacementObligationProjection = Readonly<{ obligation:ReplacementObligation; remainingProductionQuantity:number; remainingFulfillmentQuantity:number; billingPending:boolean; events:readonly ReplacementObligationEvent[] }>;
export interface ReplacementObligationApplicationPort {
  create(context:OperationContext,input:CreateReplacementObligationInput):Promise<ApplicationResult<ReplacementObligationProjection>>;
  list(context:OperationContext,orderId:OrderId):Promise<ApplicationResult<readonly ReplacementObligationProjection[]>>;
  cancel(context:OperationContext,input:Readonly<{businessRequestId:string;replacementObligationId:ReplacementObligationId}>):Promise<ApplicationResult<ReplacementObligationProjection>>;
}

export const validReplacementInput = (input: CreateReplacementObligationInput) =>
  Boolean(input.businessRequestId && input.orderId && input.orderLineId && Number.isSafeInteger(input.replacementQuantity) && input.replacementQuantity > 0 && replacementReasons.includes(input.reason));
